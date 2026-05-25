// -----------------------------------------------------------------------------
// Worker-seitige Mandelbrot-Berechnung über WebGPU
// -----------------------------------------------------------------------------
//
// Diese Datei läuft in einem separaten Web-Worker-Kontext.
//
// -----------------------------------------------------------------------------
import {
    getWorkerContext,
    getComputePipeline,
    postWorkerErrorResponse,
} from "../../webgpu/webgpu-worker-runtime.js";

import {
    splitFloat64ToFloat32Pair,
    createIterationDataFromGpuArrays,
} from "../fractal-gpu-utils.js";

// -----------------------------------------------------------------------------
// Message-Konstanten
// -----------------------------------------------------------------------------
const MANDELBROT_COMPUTE_REQUEST = "compute-mandelbrot-rect";
const MANDELBROT_COMPUTE_RESULT  = "compute-mandelbrot-rect-result";

// -----------------------------------------------------------------------------
// Pfad zum Shader-Code
// -----------------------------------------------------------------------------
/**
 * Compute-Shader zur Berechnung der Mandelbrot-Iterationswerte.
 *
 * @type {string}
 */
const MANDELBROT_ITERATIONS_SHADER_SOURCE = `
struct Params {
  rectX: u32,
  rectY: u32,
  rectWidth: u32,
  rectHeight: u32,

  imageWidth: u32,
  imageHeight: u32,
  maxIterations: u32,
  _pad0: u32,

  centerXHigh: f32,
  centerXLow: f32,
  centerYHigh: f32,
  centerYLow: f32,

  pixelScaleX: f32,
  pixelScaleY: f32,
  imageCenterX: f32,
  imageCenterY: f32,

  escapeRadius: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
};

@group(0) @binding(0)
var<uniform> params: Params;

@group(0) @binding(1)
var<storage, read_write> iterations: array<u32>;

@group(0) @binding(2)
var<storage, read_write> escapeValues: array<f32>;

fn isInPeriod2Bulb(cx: f32, cy: f32) -> bool {
  return (cx + 1.0) * (cx + 1.0) + cy * cy <= 0.0625;
}

fn isInMainCardioid(cx: f32, cy: f32) -> bool {
  let q = (cx - 0.25) * (cx - 0.25) + cy * cy;
  return q * (q + (cx - 0.25)) <= 0.25 * cy * cy;
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let localX = globalId.x;
  let localY = globalId.y;

  if (localX >= params.rectWidth || localY >= params.rectHeight) {
    return;
  }

  let px = params.rectX + localX;
  let py = params.rectY + localY;  
  
  let localDx =
    (f32(px) - params.imageCenterX) * params.pixelScaleX;  
  
  let localDy =
    (f32(py) - params.imageCenterY) * params.pixelScaleY;  
  
  let cx =
    params.centerXHigh + (params.centerXLow + localDx);   
  
  let cy =
    params.centerYHigh + (params.centerYLow + localDy);

  let index = localY * params.rectWidth + localX;

  if (isInPeriod2Bulb(cx, cy) || isInMainCardioid(cx, cy)) {
    iterations[index] = params.maxIterations;
    escapeValues[index] = 0.0;
    return;
  }

  var zx = 0.0;
  var zy = 0.0;
  var iteration = 0u;
  let escapeRadiusSquared = params.escapeRadius * params.escapeRadius;

  loop {
    if (zx * zx + zy * zy >= escapeRadiusSquared || iteration >= params.maxIterations) {
      break;
    }

    let temp = zx * zx - zy * zy + cx;
    zy = 2.0 * zx * zy + cy;
    zx = temp;

    iteration = iteration + 1u;
  }

  iterations[index] = iteration;
  escapeValues[index] = zx * zx + zy * zy;
}
`;

// -----------------------------------------------------------------------------
// Message-Typen
// -----------------------------------------------------------------------------

/**
 * Nachricht an den WebGPU-Mandelbrot-Worker zur Berechnung eines Rechtecks.
 *
 * @typedef {Object} ComputeRequestMessage
 * @property {"compute-mandelbrot-rect"} type - Nachrichtentyp.
 * @property {number} requestId - (integer) Eindeutige Anfrage-ID.
 * @property {PixelRect} rect - Zu berechnender Pixelbereich.
 * @property {number} imageWidth - (integer) Breite der vollständigen Zielmatrix.
 * @property {number} imageHeight - (integer) Höhe der vollständigen Zielmatrix.
 * @property {ComputationSettings} computationSettings - Einstellungen für die Berechnung.
 */

/**
 * Erfolgsantwort des WebGPU-Workers.
 * 
 * @typedef {Object} WorkerSuccessMessage
 * @property {string}   type
 * @property {number}   requestId
 * @property {true}     ok
 * @property {*}        result
 */

/**
 * Antwortnachricht des WebGPU-Workers.
 *
 * @typedef {WorkerSuccessMessage|WorkerErrorMessage} WorkerResponseMessage
 */

// -----------------------------------------------------------------------------
// Funktionen
// -----------------------------------------------------------------------------

/**
 * Erstellt den Uniform-Buffer-Inhalt für den Mandelbrot-Compute-Shader.
 *
 * Das Layout muss zur `Params`-Struktur im WGSL-Shader passen. Die komplexe
 * Bildmitte wird in High-/Low-Float32-Anteile zerlegt, damit große
 * Koordinatenwerte etwas stabiler mit lokalen Pixelabständen kombiniert
 * werden können.
 * 
 * @param {PixelRect} rect - Zu berechnender Pixelbereich.
 * @param {number} imageWidth - Breite der vollständigen Zielmatrix in Pixeln.
 * @param {number} imageHeight - Höhe der vollständigen Zielmatrix in Pixeln.
 * @param {ComputationSettings} computationSettings - Einstellungen für die Mandelbrot-Berechnung.
 * @returns {ArrayBuffer} Binärer Uniform-Buffer-Inhalt für den Shader.
 */
function createMandelbrotParamsArrayBuffer(
    rect,
    imageWidth,
    imageHeight,
    computationSettings
) {
    const { view, maxIterations, escapeRadius } = computationSettings;
    const { minX, maxX, minY, maxY } = view;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const centerXParts = splitFloat64ToFloat32Pair(centerX);
    const centerYParts = splitFloat64ToFloat32Pair(centerY);

    const pixelScaleX = Math.fround((maxX - minX) / imageWidth);
    const pixelScaleY = Math.fround((maxY - minY) / imageHeight);

    const imageCenterX = Math.fround(imageWidth / 2);
    const imageCenterY = Math.fround(imageHeight / 2);

    const buffer = new ArrayBuffer(80);
    const dataView = new DataView(buffer);

    dataView.setUint32(0, rect.x, true);
    dataView.setUint32(4, rect.y, true);
    dataView.setUint32(8, rect.width, true);
    dataView.setUint32(12, rect.height, true);

    dataView.setUint32(16, imageWidth, true);
    dataView.setUint32(20, imageHeight, true);
    dataView.setUint32(24, maxIterations, true);
    dataView.setUint32(28, 0, true);

    dataView.setFloat32(32, centerXParts.high, true);
    dataView.setFloat32(36, centerXParts.low, true);
    dataView.setFloat32(40, centerYParts.high, true);
    dataView.setFloat32(44, centerYParts.low, true);

    dataView.setFloat32(48, pixelScaleX, true);
    dataView.setFloat32(52, pixelScaleY, true);
    dataView.setFloat32(56, imageCenterX, true);
    dataView.setFloat32(60, imageCenterY, true);

    dataView.setFloat32(64, escapeRadius, true);
    dataView.setFloat32(68, 0, true);
    dataView.setFloat32(72, 0, true);
    dataView.setFloat32(76, 0, true);

    return buffer;
}

/**
 * Berechnet einen Pixelbereich der Mandelbrot-Menge auf der GPU.
 *
 * Die Funktion erzeugt die benötigten WebGPU-Buffer, schreibt die
 * Uniform-Parameter für den Shader, startet den Compute-Pass und liest die
 * Iterations- und Escape-Werte anschließend wieder in JavaScript-Arrays
 * zurück.
 * 
 * @param {PixelRect} rect - Zu berechnender Pixelbereich.
 * @param {number} imageWidth - Breite der vollständigen Zielmatrix in Pixeln.
 * @param {number} imageHeight - Höhe der vollständigen Zielmatrix in Pixeln.
 * @param {ComputationSettings} computationSettings - Einstellungen für die Mandelbrot-Berechnung.
 * @returns {Promise<IterationData>} Berechnete Iterationsdaten für den Pixelbereich.
 */
async function computeMandelbrotRectOnGpu(
    rect,
    imageWidth,
    imageHeight,
    computationSettings
) {
    console.log("computeMandelbrotRectOnGpu (start)", {
        rect,
        imageWidth,
        imageHeight,
    });

    const { device } = await getWorkerContext();
    const { computePipeline } = await getComputePipeline(
        "mandelbrot", 
        MANDELBROT_ITERATIONS_SHADER_SOURCE, 
        "Mandelbrot iterations"
    );

    const pixelCount = rect.width * rect.height;
    const iterationsBufferSize = pixelCount * Uint32Array.BYTES_PER_ELEMENT;
    const escapeValuesBufferSize = pixelCount * Float32Array.BYTES_PER_ELEMENT;

    const paramsArrayBuffer = createMandelbrotParamsArrayBuffer(
        rect,
        imageWidth,
        imageHeight,
        computationSettings
    );

    const paramsBuffer = device.createBuffer({
        label: "Mandelbrot params uniform buffer",
        size: paramsArrayBuffer.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const iterationsBuffer = device.createBuffer({
        label: "Mandelbrot iterations storage buffer",
        size: iterationsBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const iterationsReadbackBuffer = device.createBuffer({
        label: "Mandelbrot iterations readback buffer",
        size: iterationsBufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const escapeValuesBuffer = device.createBuffer({
        label: "Mandelbrot escape values storage buffer",
        size: escapeValuesBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const escapeValuesReadbackBuffer = device.createBuffer({
        label: "Mandelbrot escape values readback buffer",
        size: escapeValuesBufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    device.queue.writeBuffer(paramsBuffer, 0, paramsArrayBuffer);

    const bindGroup = device.createBindGroup({
        label: "Mandelbrot iterations bind group",
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: paramsBuffer,
                },
            },
            {
                binding: 1,
                resource: {
                    buffer: iterationsBuffer,
                },
            },
            {
                binding: 2,
                resource: {
                    buffer: escapeValuesBuffer,
                },
            },
        ],
    });

    const commandEncoder = device.createCommandEncoder({
        label: "Mandelbrot iterations command encoder",
    });

    const computePass = commandEncoder.beginComputePass({
        label: "Mandelbrot iterations compute pass",
    });

    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, bindGroup);

    // das folgende, um die Anzahl der Threads, etc. zu loggen, sonst einfach 
    // -------------------------------------------------------------------------
    // computePass.dispatchWorkgroups(
    //     Math.ceil(rect.width / 16),
    //     Math.ceil(rect.height / 16)
    // );
    // -------------------------------------------------------------------------
    const workgroupSizeX = 16;
    const workgroupSizeY = 16;

    const workgroupCountX = Math.ceil(rect.width / workgroupSizeX);
    const workgroupCountY = Math.ceil(rect.height / workgroupSizeY);

    const dispatchedWorkgroups = workgroupCountX * workgroupCountY;
    const dispatchedInvocations =
        dispatchedWorkgroups * workgroupSizeX * workgroupSizeY;

    const activePixels = rect.width * rect.height;
    const inactiveInvocations = dispatchedInvocations - activePixels;

    console.log("WebGPU Mandelbrot dispatch", {
        rect,
        workgroupSizeX,
        workgroupSizeY,
        workgroupCountX,
        workgroupCountY,
        dispatchedWorkgroups,
        dispatchedInvocations,
        activePixels,
        inactiveInvocations,
    });

    computePass.dispatchWorkgroups(workgroupCountX, workgroupCountY);
    // -------------------------------------------------------------------------

    computePass.end();

    commandEncoder.copyBufferToBuffer(
        iterationsBuffer,
        0,
        iterationsReadbackBuffer,
        0,
        iterationsBufferSize
    );
    
    commandEncoder.copyBufferToBuffer(
        escapeValuesBuffer,
        0,
        escapeValuesReadbackBuffer,
        0,
        escapeValuesBufferSize
    );

    device.queue.submit([commandEncoder.finish()]);

    await Promise .all ([
        iterationsReadbackBuffer.mapAsync(GPUMapMode.READ),
        escapeValuesReadbackBuffer.mapAsync(GPUMapMode.READ),
    ]);

    const mappedIterationsRange   = iterationsReadbackBuffer.getMappedRange();
    const mappedEscapeValuesRange = escapeValuesReadbackBuffer.getMappedRange();

    const gpuIterations   = new Uint32Array(mappedIterationsRange.slice(0));
    const gpuEscapeValues = new Float32Array(mappedEscapeValuesRange.slice(0));

    iterationsReadbackBuffer.unmap();
    escapeValuesReadbackBuffer.unmap();

    const result = createIterationDataFromGpuArrays(
        rect,
        gpuIterations,
        gpuEscapeValues,
        computationSettings.maxIterations
    );

    console.log("computeMandelbrotRectOnGpu (done)", {
        pixelCount,
        minIterations: result.minIterations,
        iterations_sample: result.iterations.slice(0, 16),
        escapeValues_sample: result.escapeValues.slice(0, 16),
    });

    return result;
}

/**
 * Behandelt eine Berechnungsanfrage an den WebGPU-Mandelbrot-Worker.
 *
 * Die Anfrage wird auf der GPU berechnet und anschließend als standardisierte
 * Erfolgsantwort an den Hauptthread zurückgesendet.
 * 
 * @param {ComputeRequestMessage} message - Eingehende Berechnungsanfrage.
 * @returns {WorkerSuccessMessage}
 */
async function handleComputeMandelbrotRectMessage(
    message
) {
    const result = await computeMandelbrotRectOnGpu(
        message.rect, 
        message.imageWidth, 
        message.imageHeight, 
        message.computationSettings
    );

    const response = {
        type: MANDELBROT_COMPUTE_RESULT,
        requestId: message.requestId,
        ok: true,
        result,
    };

    self.postMessage(response);
}

// -----------------------------------------------------------------------------
// main
// -----------------------------------------------------------------------------

/**
 * Haupteinstiegspunkt für Nachrichten an den WebGPU-Mandelbrot-Worker.
 *
 * @param {MessageEvent<ComputeRequestMessage>} event - Worker-Nachricht.
 * @returns {void}
 */
self.onmessage = async (event) => {
    const message = event.data;

    try {
        if (message.type !== MANDELBROT_COMPUTE_REQUEST) {
            throw new Error(`Unsupported WebGPU worker message type: ${message.type}`);
        }

        await handleComputeMandelbrotRectMessage(message);

    } catch (error) {
        console.error("Mandelbrot WebGPU worker request failed", error);
        postWorkerErrorResponse(
            "MANDELBROT_COMPUTE_RESULT", 
            message?.requestId ?? -1, 
            error);
    }
};
