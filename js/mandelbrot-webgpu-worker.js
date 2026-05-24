console.log("Mandelbrot WebGPU worker script loaded");


// -----------------------------------------------------------------------------
// Worker-seitige Mandelbrot-Berechnung über WebGPU
// -----------------------------------------------------------------------------
//
// Diese Datei läuft in einem separaten Web-Worker-Kontext.
//
// -----------------------------------------------------------------------------

/**
 * Ermittelt den kleinsten Iterationswert in einem linearen Iterationsfeld.
 * Worker-lokale Kopie von `findMinIterations` aus `iteration-data.js`.
 *
 * Der Worker läuft in einem eigenen Kontext und kann die Hilfsfunktion aus
 * `iteration-data.js` nicht direkt verwenden.
 * 
 * @param {IterationArray} iterations   - zu analysierende Iterationsmatrix
 * @returns {number}                    - (integer) minimaler Wert aus iterations
 */
function gpuWorkerFindMinIterations(iterations) {
    if (iterations.length === 0) {
        return 0;
    }

    let minIterations = iterations[0];

    for (let i = 1; i < iterations.length; i++) {
        if (iterations[i] < minIterations) {
            minIterations = iterations[i];
        }
    }

    return minIterations;
}

/**
 * @typedef {Object} MandelbrotPointResult
 * @property {number} iterations - (integer) Iterationswert des Punkts.
 * @property {number} escapeValue - (decimal) Quadratischer Betrag beim Abbruch.
 */

/**
 * Berechnet die Anzahl der Iterationen für einen Bildpunkt, bis Divergenz 
 * eintritt oder die Abbruchschranke für die Iterationen erreicht ist. 
 * 
 * Optimierungen: Schnelle Überprüfungen für Punkte, die sicher in der 
 * Menge liegen.
 * 
 * @param {number} cx               - (decimal) Koordinate auf der Real-Achse
 * @param {number} cy               - (decimal) Koordinate auf der Imaginär-Achse
 * @param {number} maxIterations    - (integer) obere Schranke für die Anzahl der Iterationen
 * @param {number} escapeRadius     - (decimal) Escape-Radius zur Entscheidung auf Divergenz
 * @returns {MandelbrotPointResult} - Ergebnis der Berechnung (Tupel aus iterations und esacapeValue)
 */
function gpuWorkerComputeMandelbrotPoint(
    cx, cy,
    maxIterations,
    escapeRadius
) {

    // Schnelle Überprüfung: Periode-2-Glühbirne (Kreis auf der linken Seite)
    if ((cx + 1) * (cx + 1) + cy * cy <= 0.0625) { // 1/16 = 0.0625
        return {
            iterations: maxIterations,
            escapeValue: 0,
        };
    }

    // Schnelle Überprüfung: Hauptkardiode (Herzform in der Mitte)
    const q = (cx - 0.25) * (cx - 0.25) + cy * cy;
    if (q * (q + (cx - 0.25)) <= 0.25 * cy * cy) {
        return {
            iterations: maxIterations,
            escapeValue: 0,
        };
    }

    // Standard-Iterationen für Punkte, die nicht in den schnellen 
    // Überprüfungen liegen
    let zx = 0;
    let zy = 0;
    let iteration = 0;
    const escapeRadiusSquared = escapeRadius * escapeRadius;

    while (zx * zx + zy * zy < escapeRadiusSquared && iteration < maxIterations) {
        const temp = zx * zx - zy * zy + cx;
        zy = 2 * zx * zy + cy;
        zx = temp;
        iteration++;
    }

    return {
        iterations: iteration,
        escapeValue: zx * zx + zy * zy,
    };
}

/**
 * Berechnet die Mandelbrot-Iterationen für ein gegebenes Rechteck
 * läuft innerhalb eines Worker-Threads, also single-threaded
 * 
 * @param {PixelRect}           rect                    - zu berechnendes Rechteck
 * @param {number}              imageWidth              - Breite der Pixelmatrix
 * @param {number}              imageHeight             - Höhe der Pixelmatrix
 * @param {ComputationSettings} computationSettings     - Parameter-Objekt für Mandelbrot-Berechnungen
 * @returns {IterationData}                             - IterationData-Objekt
 */
function gpuWorkerComputeMandelbrotRect(
    rect,
    imageWidth, imageHeight,
    computationSettings
) {

    console.log(
        "gpuWorkerComputeMandelbrotRect (start)",
        {
            rect: rect,
            imageWidth: imageWidth,
            imageHeight: imageHeight,
            computationSettings: computationSettings,
        }
    );

    const { view, maxIterations, escapeRadius } = computationSettings;
    const { minX, maxX, minY, maxY } = view;

    const iterations = new Uint16Array(rect.width * rect.height);
    const escapeValues = new Float32Array(rect.width * rect.height);

    for (let localY = 0; localY < rect.height; localY++) {
        for (let localX = 0; localX < rect.width; localX++) {

            const px = rect.x + localX;
            const py = rect.y + localY;

            const x = minX + (px / imageWidth) * (maxX - minX);
            const y = minY + (py / imageHeight) * (maxY - minY);

            const result = gpuWorkerComputeMandelbrotPoint(x, y, maxIterations, escapeRadius);

            const index = localY * rect.width + localX;
            iterations[index] = result.iterations;
            escapeValues[index] = result.escapeValue;
        }
    }

    console.log(
        "gpuWorkerComputeMandelbrotRect (done)"
    );

    return {
        width: rect.width,
        height: rect.height,
        iterations,
        escapeValues,
        minIterations: gpuWorkerFindMinIterations(iterations),
    };
}

/**
 * computeMandelbrotRectOnGpu
 * 
 * @param {PixelRect} rect 
 * @param {number} imageWidth 
 * @param {number} imageHeight 
 * @param {ComputationSettings} computationSettings 
 * @returns 
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

    const { device } = await getWebGpuWorkerContext();
    const { computePipeline } = await getWebGpuComputePipeline();

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

    const result = createIterationDataFromGpuIterations(
        rect,
        gpuIterations,
        gpuEscapeValues,
        computationSettings
    );

    console.log("computeMandelbrotRectOnGpu (done)", {
        pixelCount,
        minIterations: result.minIterations,
        iterations_sample: result.iterations.slice(0, 16),
        escapeValues_sample: result.escapeValues.slice(0, 16),
    });

    return result;
}

/* --------------------------------------------------------------------------------------- */
/* --------------------------------------------------------------------------------------- */

/**
 * Gehaltene WebGPU-Ressourcen des Workers.
 *
 * @typedef {Object} WebGpuWorkerContext
 * @property {GPUAdapter} adapter - WebGPU-Adapter.
 * @property {GPUDevice} device - WebGPU-Device.
 */

/**
 * Zwischengespeicherter WebGPU-Kontext des Workers.
 *
 * @type {Promise<WebGpuWorkerContext>|null}
 */
let webGpuWorkerContextPromise = null;

/**
 * Gehaltene WebGPU-Ressourcen für die Mandelbrot-Compute-Pipeline.
 *
 * @typedef {Object} WebGpuComputePipelineContext
 * @property {GPUShaderModule} shaderModule - Kompiliertes Shader-Modul.
 * @property {GPUComputePipeline} computePipeline - Compute-Pipeline.
 */

/**
 * Zwischengespeicherte WebGPU-Compute-Pipeline.
 *
 * @type {Promise<WebGpuComputePipelineContext>|null}
 */
let webGpuComputePipelinePromise = null;

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

  minX: f32,
  maxX: f32,
  minY: f32,
  maxY: f32,

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

  let cx =
    params.minX +
    (f32(px) / f32(params.imageWidth)) *
    (params.maxX - params.minX);

  let cy =
    params.minY +
    (f32(py) / f32(params.imageHeight)) *
    (params.maxY - params.minY);

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

/**
 * Initialisiert die WebGPU-Compute-Pipeline für die Mandelbrot-Berechnung.
 *
 * @returns {Promise<WebGpuComputePipelineContext>} Initialisierte Pipeline-Ressourcen.
 */
async function initializeWebGpuComputePipeline() {
    const { device } = await getWebGpuWorkerContext();

    console.log("Initializing WebGPU compute pipeline");

    const shaderModule = device.createShaderModule({
        label: "WebGPU compute shader",
        code: MANDELBROT_ITERATIONS_SHADER_SOURCE,
    });

    const computePipeline = await device.createComputePipelineAsync({
        label: "WebGPU compute pipeline",
        layout: "auto",
        compute: {
            module: shaderModule,
            entryPoint: "main",
        },
    });

    console.log("WebGPU compute pipeline initialized", {
        shaderModule,
        computePipeline,
    });

    return {
        shaderModule,
        computePipeline,
    };
}

/**
 * Gibt die initialisierte WebGPU-Compute-Pipeline zurück.
 *
 * Mehrere parallele Aufrufe teilen sich dieselbe Initialisierungs-Promise.
 * Bei Fehlern wird der Cache zurückgesetzt, damit spätere Aufrufe erneut
 * initialisieren können.
 *
 * @returns {Promise<WebGpuComputePipelineContext>} Initialisierte Pipeline-Ressourcen.
 */
function getWebGpuComputePipeline() {
    if (!webGpuComputePipelinePromise) {
        webGpuComputePipelinePromise =
            initializeWebGpuComputePipeline().catch((error) => {
                webGpuComputePipelinePromise = null;
                throw error;
            });
    }

    return webGpuComputePipelinePromise;
}

/**
 * createMandelbrotParamsArrayBuffer
 * 
 * @param {PixelRect} rect 
 * @param {number} imageWidth 
 * @param {number} imageHeight 
 * @param {ComputationSettings} computationSettings 
 * @returns {*}
 */
function createMandelbrotParamsArrayBuffer(
  rect,
  imageWidth,
  imageHeight,
  computationSettings
) {
  const { view, maxIterations, escapeRadius } = computationSettings;
  const { minX, maxX, minY, maxY } = view;

  const buffer = new ArrayBuffer(64);
  const dataView = new DataView(buffer);

  dataView.setUint32(0, rect.x, true);
  dataView.setUint32(4, rect.y, true);
  dataView.setUint32(8, rect.width, true);
  dataView.setUint32(12, rect.height, true);

  dataView.setUint32(16, imageWidth, true);
  dataView.setUint32(20, imageHeight, true);
  dataView.setUint32(24, maxIterations, true);
  dataView.setUint32(28, 0, true);

  dataView.setFloat32(32, minX, true);
  dataView.setFloat32(36, maxX, true);
  dataView.setFloat32(40, minY, true);
  dataView.setFloat32(44, maxY, true);

  dataView.setFloat32(48, escapeRadius, true);
  dataView.setFloat32(52, 0, true);
  dataView.setFloat32(56, 0, true);
  dataView.setFloat32(60, 0, true);

  return buffer;
}

/**
 * createIterationDataFromGpuIterations
 * 
 * @param {PixelRect} rect 
 * @param {*} gpuIterations 
 * @param {ComputationSettings} computationSettings 
 * @returns {IterationData}
 */
function createIterationDataFromGpuIterations(
  rect,
  gpuIterations,
  gpuEscapeValues,
  computationSettings
) {
  const pixelCount = rect.width * rect.height;
  const iterations = new Uint16Array(pixelCount);
  const escapeValues = new Float32Array(pixelCount);
  const maxIterations = computationSettings.maxIterations;

  let minIterations = pixelCount > 0 ? maxIterations : 0;

  for (let index = 0; index < pixelCount; index++) {
    const iteration = gpuIterations[index];

    iterations[index] = iteration;
    escapeValues[index] = gpuEscapeValues[index];    

    if (iteration < minIterations) {
      minIterations = iteration;
    }
  }

  return {
    width: rect.width,
    height: rect.height,
    iterations,
    escapeValues,
    minIterations,
  };
}

/**
 * Initialisiert den WebGPU-Kontext des Workers.
 *
 * Die Initialisierung wird lazy durchgeführt und anschließend wiederverwendet.
 * In diesem Schritt wird noch keine Mandelbrot-Berechnung auf der GPU
 * ausgeführt. Es wird nur geprüft, ob der Worker ein GPUDevice anlegen kann.
 *
 * @returns {Promise<WebGpuWorkerContext>} Initialisierter WebGPU-Kontext.
 */
async function initializeWebGpuWorkerContext() {
    if (!self.navigator?.gpu) {
        throw new Error("WebGPU is not available in this worker context.");
    }

    const adapter = await self.navigator.gpu.requestAdapter();

    if (!adapter) {
        throw new Error("No suitable WebGPU adapter found.");
    }

    const device = await adapter.requestDevice();

    device.lost.then((info) => {
        console.error("WebGPU device was lost.", info);
        webGpuWorkerContextPromise = null;
    });

    console.log("WebGPU worker context initialized", {
        adapter,
        device,
    });

    return {
        adapter,
        device,
    };
}

/**
 * Gibt den initialisierten WebGPU-Kontext des Workers zurück.
 *
 * Mehrere parallele Aufrufe teilen sich dieselbe Initialisierungs-Promise.
 *
 * @returns {Promise<WebGpuWorkerContext>} Initialisierter WebGPU-Kontext.
 */
function getWebGpuWorkerContext() {
    if (!webGpuWorkerContextPromise) {
        webGpuWorkerContextPromise = initializeWebGpuWorkerContext().catch(
            (error) => {
                webGpuWorkerContextPromise = null;
                throw error;
            }
        );
    }

    return webGpuWorkerContextPromise;
}

/**
 * Nachricht an den WebGPU-Mandelbrot-Worker zur Berechnung eines Rechtecks.
 *
 * @typedef {Object} WebGpuComputeRequestMessage
 * @property {"compute-mandelbrot-rect"} type - Nachrichtentyp.
 * @property {number} requestId - (integer) Eindeutige Anfrage-ID.
 * @property {PixelRect} rect - Zu berechnender Pixelbereich.
 * @property {number} imageWidth - (integer) Breite der vollständigen Zielmatrix.
 * @property {number} imageHeight - (integer) Höhe der vollständigen Zielmatrix.
 * @property {ComputationSettings} computationSettings - Einstellungen für die Berechnung.
 */

/**
 * Erfolgsantwort des WebGPU-Mandelbrot-Workers.
 *
 * @typedef {Object} WebGpuComputeSuccessMessage
 * @property {"compute-mandelbrot-rect-result"} type - Nachrichtentyp.
 * @property {number} requestId - (integer) Anfrage-ID der ursprünglichen Nachricht.
 * @property {true} ok - Kennzeichen für erfolgreiche Berechnung.
 * @property {IterationData} result - Berechnete Iterationsdaten.
 */

/**
 * Fehlerantwort des WebGPU-Mandelbrot-Workers.
 *
 * @typedef {Object} WebGpuComputeErrorMessage
 * @property {"compute-mandelbrot-rect-result"} type - Nachrichtentyp.
 * @property {number} requestId - (integer) Anfrage-ID der ursprünglichen Nachricht.
 * @property {false} ok - Kennzeichen für fehlgeschlagene Berechnung.
 * @property {string} error - Fehlerbeschreibung.
 */

/**
 * Entscheidet, ob die f32-Auflösung der GPU noch ausreichend für die Auflösung ist
 * 
 * @param {*} view 
 * @param {number} imageWidth 
 * @param {number} imageHeight 
 * @returns 
 */
function shouldUseGpuForView(
    view, 
    imageWidth, 
    imageHeight
) {
  const pixelWidth  = Math.abs(view.maxX - view.minX) / imageWidth;
  const pixelHeight = Math.abs(view.maxY - view.minY) / imageHeight;

  return Math.min(pixelWidth, pixelHeight) > 1e-7;
}

/**
 * Behandelt eine Berechnungsanfrage an den Dummy-WebGPU-Worker.
 *
 * Aktuell wird bereits die WebGPU-Pipeline initialisiert. Die fachliche
 * Mandelbrot-Berechnung erfolgt weiterhin per JavaScript-Fallback.
 * 
 * @param {WebGpuComputeRequestMessage} message - Eingehende Berechnungsanfrage.
 * @returns {void}
 */
async function handleComputeMandelbrotRectMessage(
    message
) {
    let result; 
    if (shouldUseGpuForView(
            message.computationSettings.view,
            message.imageWidth,
            message.imageHeight)) {
        try {
            result = await computeMandelbrotRectOnGpu(
                message.rect, 
                message.imageWidth, 
                message.imageHeight, 
                message.computationSettings
            );
        } catch (error) {
            console.warn(
                "GPU Mandelbrot computation failed. Using worker JavaScript fallback.",
                error
            ); 
        }
    } else {
        console.warn(
            "View is too deep for f32 GPU computation. Using worker JavaScript fallback."
        );
    }        

    if (!result) {
        // TODO: This fallback is single-threaded because it runs inside the WebGPU worker.
        // For deep zooms, prefer falling back to the main CPU backend in mandelbrot.js
        // so the existing multi-worker CPU implementation can be used.
        result = gpuWorkerComputeMandelbrotRect(
                message.rect,
                message.imageWidth,
                message.imageHeight,
                message.computationSettings
            );
    }

    const response = {
        type: "compute-mandelbrot-rect-result",
        requestId: message.requestId,
        ok: true,
        result,
    };

    self.postMessage(response);
}

/**
 * Sendet eine standardisierte Fehlerantwort an den Hauptthread.
 *
 * @param {number} requestId - (integer) Anfrage-ID, falls bekannt.
 * @param {unknown} error - Ausgelöster Fehler.
 * @returns {void}
 */
function postErrorResponse(requestId, error) {
    /** @type {WebGpuComputeErrorMessage} */
    const response = {
        type: "compute-mandelbrot-rect-result",
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
    };

    self.postMessage(response);
}

/**
 * Haupteinstiegspunkt für Nachrichten an den WebGPU-Mandelbrot-Worker.
 *
 * @param {MessageEvent<WebGpuComputeRequestMessage>} event - Worker-Nachricht.
 * @returns {void}
 */
self.onmessage = async (event) => {
    const message = event.data;

    try {
        console.log("Mandelbrot WebGPU worker received message", message);

        if (message.type !== "compute-mandelbrot-rect") {
            throw new Error(`Unsupported WebGPU worker message type: ${message.type}`);
        }

        await handleComputeMandelbrotRectMessage(message);

    } catch (error) {
        console.error("Mandelbrot WebGPU worker request failed", error);
        postErrorResponse(message?.requestId ?? -1, error);
    }
};