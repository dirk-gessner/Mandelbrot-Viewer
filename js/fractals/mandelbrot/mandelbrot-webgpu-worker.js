// -----------------------------------------------------------------------------
// Worker-seitige Mandelbrot-Berechnung über WebGPU
// -----------------------------------------------------------------------------
//
// Diese Datei läuft in einem separaten Web-Worker-Kontext.
//
// -----------------------------------------------------------------------------
import {
    debugLog, 
    debugInfo, 
    debugWarn, 
    getWorkerContext,
    getComputePipeline,
    postWorkerErrorResponse,
} from "../../webgpu/webgpu-worker-runtime.js";

import {
    splitFloat64ToFloat32Pair,
    createIterationDataFromGpuArrays,
} from "../fractal-gpu-utils.js";

// -----------------------------------------------------------------------------
// Konstanten
// -----------------------------------------------------------------------------
const MANDELBROT_COMPUTE_REQUEST = "compute-mandelbrot-rect";
const MANDELBROT_COMPUTE_RESULT  = "compute-mandelbrot-rect-result";

const MANDELBROT_WEBGPU_MAX_REFERENCE_ORBIT_LENGTH = 50001;
const MANDELBROT_REFERENCE_ORBIT_ITERATIONS = 50000;
const MANDELBROT_REFERENCE_ORBIT_ESCAPE_RADIUS = 1256;
const MANDELBROT_ITERATION_SENTINEL = 0xffffffff;

const PERTURBATION_STATUS_OK = 0;
const PERTURBATION_STATUS_REFERENCE_ENDED = 1;
const PERTURBATION_STATUS_SMALL_ORBIT = 2;
const PERTURBATION_STATUS_DELTA_TOO_LARGE = 3;
const PERTURBATION_STATUS_NON_FINITE = 4;

const MANDELBROT_PERTURBATION_COUNTER_COUNT = 7;
const MANDELBROT_PERTURBATION_COUNTER_BUFFER_SIZE =
    MANDELBROT_PERTURBATION_COUNTER_COUNT * Uint32Array.BYTES_PER_ELEMENT;

const MANDELBROT_PERTURBATION_MAX_SMALL_ORBIT_RATIO = 0.005;
const MANDELBROT_PERTURBATION_MAX_DELTA_TOO_LARGE_RATIO = 0.005;

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

  iterationLimit: u32,
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
    iterations[index] = params.iterationLimit;
    escapeValues[index] = 0.0;
    return;
  }

  var zx = 0.0;
  var zy = 0.0;
  var iteration = 0u;
  let escapeRadiusSquared = params.escapeRadius * params.escapeRadius;

  loop {
    if (zx * zx + zy * zy >= escapeRadiusSquared || iteration >= params.iterationLimit) {
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
 * Compute-Shader zur Mandelbrot-Berechnung ueber Perturbation.
 *
 * Der Shader verwendet einen auf der CPU vorberechneten Referenzorbit und
 * iteriert pro Pixel nur die kleine Abweichung `delta z`.
 *
 * @type {string}
 */
const MANDELBROT_PERTURBATION_SHADER_SOURCE = `
struct Params {
  rectX: u32,
  rectY: u32,
  rectWidth: u32,
  rectHeight: u32,
  iterationLimit: u32,
  pixelScaleX: f32,
  pixelScaleY: f32,
  escapeRadius: f32,
  _pad0: f32,
};

struct OrbitParams {
  referenceOrbitLength: u32,
  referencePixelX: f32,
  referencePixelY: f32,
  _pad0: f32,
};

struct PerturbationCounters {
  pixelCount: atomic<u32>,
  okCount: atomic<u32>,
  invalidCount: atomic<u32>,
  referenceEndedCount: atomic<u32>,
  smallOrbitCount: atomic<u32>,
  deltaTooLargeCount: atomic<u32>,
  nonFiniteCount: atomic<u32>,
};

@group(0) @binding(0)
var<uniform> params: Params;

@group(0) @binding(1)
var<storage, read_write> iterations: array<u32>;

@group(0) @binding(2)
var<storage, read_write> escapeValues: array<f32>;

@group(0) @binding(3)
var<storage, read> referenceZx: array<f32>;

@group(0) @binding(4)
var<storage, read> referenceZy: array<f32>;

@group(0) @binding(5)
var<storage, read_write> statuses: array<u32>;

@group(0) @binding(6)
var<uniform> orbitParams: OrbitParams;

@group(0) @binding(7)
var<storage, read_write> counters: PerturbationCounters;

@compute @workgroup_size(16, 16)

fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {

  const MANDELBROT_ITERATION_SENTINEL: u32 = 0xffffffffu;
  const GLITCH_THRESHOLD: f32 = 1.0e-6;
  const DELTA_TOO_LARGE_THRESHOLD: f32 = 1.0e6;
  const MIN_REFERENCE_MAG2_FOR_DELTA_TEST: f32 = 1.0e-12;

  let localX = globalId.x;
  let localY = globalId.y;

  if (localX >= params.rectWidth || localY >= params.rectHeight) {
    return;
  }

  let px = params.rectX + localX;
  let py = params.rectY + localY;

  let dcx = (f32(px) - orbitParams.referencePixelX) * params.pixelScaleX;
  let dcy = (f32(py) - orbitParams.referencePixelY) * params.pixelScaleY;

  let index = localY * params.rectWidth + localX;

  if (iterations[index] != MANDELBROT_ITERATION_SENTINEL) {
    atomicAdd(&counters.pixelCount, 1u);
    atomicAdd(&counters.okCount, 1u);
    return;
  }

  var dzx = 0.0;
  var dzy = 0.0;
  var zx = referenceZx[0];
  var zy = referenceZy[0];
  var iteration = 0u;
  let escapeRadiusSquared = params.escapeRadius * params.escapeRadius;
  var status = 0u;

  loop {

    if (zx * zx + zy * zy >= escapeRadiusSquared ||
        iteration >= params.iterationLimit
    ) {
      break;
    }

    // Der naechste Referenzorbit-Wert muss existieren, weil wir nach dem
    // Perturbationsschritt referenceZ[iteration] lesen.
    if (iteration + 1u >= orbitParams.referenceOrbitLength) {
        status = 1u;
        break;
    }

    let refX = referenceZx[iteration];
    let refY = referenceZy[iteration];

    let dz2x = dzx * dzx - dzy * dzy;
    let dz2y = 2.0 * dzx * dzy;

    let twoRefDzX = 2.0 * (refX * dzx - refY * dzy);
    let twoRefDzY = 2.0 * (refX * dzy + refY * dzx);

    dzx = twoRefDzX + dz2x + dcx;
    dzy = twoRefDzY + dz2y + dcy;

    iteration = iteration + 1u;

    zx = referenceZx[iteration] + dzx;
    zy = referenceZy[iteration] + dzy;

    let currentRefX = referenceZx[iteration];
    let currentRefY = referenceZy[iteration];

    let refMag2 = currentRefX * currentRefX + currentRefY * currentRefY;
    let dzMag2 = dzx * dzx + dzy * dzy;
    let zMag2 = zx * zx + zy * zy;

    // NaN/Explosion: numerisch nicht mehr sinnvoll.
    if (dzx != dzx || dzy != dzy || zx != zx || zy != zy ||
        abs(dzx) > 1.0e20 || abs(dzy) > 1.0e20 ||
        abs(zx) > 1.0e20 || abs(zy) > 1.0e20
    ) {
      status = 4u;
      break;
    }

    // Klassischer Glitch-Verdacht:
    // |Z + dz|^2 ist deutlich kleiner als |Z|^2.
    // Der bisherige Faktor 1e-6 ist vermutlich zu tolerant.
    if (iteration > 0u && refMag2 > 0.0 && zMag2 < GLITCH_THRESHOLD * refMag2) {
      status = 2u;
      break;
    }
    
    // Die Perturbation ist nicht mehr lokal genug.
    // Bei f32 sollte dz nicht in die Größenordnung des Referenzorbits wachsen.
    if (iteration > 0u &&
        refMag2 > MIN_REFERENCE_MAG2_FOR_DELTA_TEST &&
        dzMag2 > DELTA_TOO_LARGE_THRESHOLD * refMag2
    ) {
      status = 3u;
      break;
    }
  }

  statuses[index] = status;
  escapeValues[index] = zx * zx + zy * zy;
  atomicAdd(&counters.pixelCount, 1u);

  if (status == 0u) {

    iterations[index] = iteration;
    atomicAdd(&counters.okCount, 1u);

  } else {

    iterations[index] = MANDELBROT_ITERATION_SENTINEL;
    atomicAdd(&counters.invalidCount, 1u);

    if (status == 1u) {
      atomicAdd(&counters.referenceEndedCount, 1u);
    } else if (status == 2u) {
      atomicAdd(&counters.smallOrbitCount, 1u);
    } else if (status == 3u) {
      atomicAdd(&counters.deltaTooLargeCount, 1u);
    } else if (status == 4u) {
      atomicAdd(&counters.nonFiniteCount, 1u);
    }
  }
}
`;

// -----------------------------------------------------------------------------
// Message-Typen
// -----------------------------------------------------------------------------

/**
 * Nachricht an den WebGPU-Mandelbrot-Worker zur Berechnung eines Rechtecks.
 *
 * @typedef {Object} ComputeRequestMessage
 * @property {"compute-mandelbrot-rect"}    type                  - Nachrichtentyp.
 * @property {number}                       requestId             - (integer) Eindeutige Anfrage-ID.
 * @property {PixelRect}                    rect                  - Zu berechnender Pixelbereich.
 * @property {number}                       imageWidth            - (integer) Breite der vollständigen Zielmatrix.
 * @property {number}                       imageHeight           - (integer) Höhe der vollständigen Zielmatrix.
 * @property {ComputationSettings}          computationSettings   - Einstellungen für die Berechnung.
 * @property {ReferenceCandidates[]|null}   referenceCandidates   - Optional: Referenzkandidaten fuer die Perturbationsberechnung.
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

/**
 * Erstellt einen Storage-Buffer und schreibt die uebergebenen Float32-Daten.
 *
 * @param {GPUDevice} device - WebGPU-Device des Workers.
 * @param {string} label - Diagnose-Label fuer den Buffer.
 * @param {Float32Array} values - Zu schreibende Werte.
 * @returns {GPUBuffer} Gefuellter Storage-Buffer.
 */
function createReadOnlyFloat32StorageBuffer(
    device,
    label,
    values
) {
    const buffer = device.createBuffer({
        label,
        size: values.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(buffer, 0, values);

    return buffer;
}


// -----------------------------------------------------------------------------
// Funktionen für die WebGPU-Standard-Berechnung
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
    const { view, iterationLimit, escapeRadius } = computationSettings;
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

    dataView.setUint32(16, iterationLimit, true);
    dataView.setUint32(20, 0, true);

    dataView.setFloat32(24, centerXParts.high, true);
    dataView.setFloat32(28, centerXParts.low, true);
    dataView.setFloat32(32, centerYParts.high, true);
    dataView.setFloat32(36, centerYParts.low, true);

    dataView.setFloat32(40, pixelScaleX, true);
    dataView.setFloat32(44, pixelScaleY, true);
    dataView.setFloat32(48, imageCenterX, true);
    dataView.setFloat32(52, imageCenterY, true);

    dataView.setFloat32(56, escapeRadius, true);
    dataView.setFloat32(60, 0, true);
    dataView.setFloat32(64, 0, true);
    dataView.setFloat32(68, 0, true);

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
    debugLog("computeMandelbrotRectOnGpu (start)", {
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

    debugLog("WebGPU Mandelbrot dispatch");

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
        computationSettings.iterationLimit,
        undefined,
        computationSettings.view
    );

    debugLog("computeMandelbrotRectOnGpu (done)");

    return result;
}

// -----------------------------------------------------------------------------
// Funktionen für die WebGPU-Perturbations-Berechnung
// -----------------------------------------------------------------------------

/**
 * Berechnet den Referenzorbit fuer einen Perturbation-Referenzkandidaten.
 *
 * Diese Funktion laeuft im WebGPU-Worker, damit Referenzorbits spaeter lazy
 * fuer einzelne Kandidaten berechnet werden koennen, ohne den Main Thread zu
 * blockieren oder ungenutzte Orbits vorab zu erzeugen.
 *
 * @param {ReferenceCandidate} referenceCandidate - Kandidat mit komplexen Koordinaten.
 * @param {number} iterationLimit - Maximale Anzahl von Iterationen fuer den Orbit.
 * @param {number} escapeRadius - Escape-Radius fuer den Referenzorbit.
 * @returns {MandelbrotReferenceOrbit} Berechneter Referenzorbit.
 */
function computeMandelbrotReferenceOrbit(
    referenceCandidate,
    iterationLimit = MANDELBROT_REFERENCE_ORBIT_ITERATIONS,
    escapeRadius = MANDELBROT_REFERENCE_ORBIT_ESCAPE_RADIUS
) {
    const zx = new Float64Array(iterationLimit + 1);
    const zy = new Float64Array(iterationLimit + 1);

    const cx = referenceCandidate.cx;
    const cy = referenceCandidate.cy;
    const escapeRadiusSquared = escapeRadius * escapeRadius;

    let escapeIteration = -1;
    let escapeValue = 0;
    let iteration = 0;

    zx[0] = 0;
    zy[0] = 0;

    for (iteration = 0; iteration < iterationLimit; iteration++) {
        const currentZx = zx[iteration];
        const currentZy = zy[iteration];

        escapeValue = currentZx * currentZx + currentZy * currentZy;

        if (escapeValue >= escapeRadiusSquared) {
            escapeIteration = iteration;
            break;
        }

        const nextZx = currentZx * currentZx - currentZy * currentZy + cx;
        const nextZy = 2 * currentZx * currentZy + cy;

        zx[iteration + 1] = nextZx;
        zy[iteration + 1] = nextZy;
    }

    const computedIterations = escapeIteration >= 0
        ? escapeIteration
        : iterationLimit;

    if (escapeIteration < 0) {
        const finalZx = zx[computedIterations];
        const finalZy = zy[computedIterations];
        escapeValue = finalZx * finalZx + finalZy * finalZy;
    }

    return {
        referenceCandidate,
        zx: zx.slice(0, computedIterations + 1),
        zy: zy.slice(0, computedIterations + 1),
        iterations: computedIterations,
        escapeIteration,
        escapeValue,
    };
}

/**
 * Erstellt die langlebigen GPU-Buffer fuer eine Perturbation-Berechnung.
 *
 * Diese Session enthaelt bewusst nur Ergebnis-, Status- und Readback-Buffer.
 * Der Referenzorbit wird spaeter getrennt geladen, damit mehrere Orbits gegen
 * dieselben Ergebnisbuffer laufen koennen.
 *
 * @param {GPUDevice} device - WebGPU-Device des Workers.
 * @param {number} pixelCount - Anzahl der Pixel im Zielrechteck.
 * @returns {Object} Buffer-Session fuer Perturbation-Ergebnisse.
 */
function createMandelbrotPerturbationSessionBuffers(
    device,
    pixelCount
) {
    const iterationsBufferSize = pixelCount * Uint32Array.BYTES_PER_ELEMENT;
    const escapeValuesBufferSize = pixelCount * Float32Array.BYTES_PER_ELEMENT;
    const statusBufferSize = pixelCount * Uint32Array.BYTES_PER_ELEMENT;

    const iterationsBuffer = device.createBuffer({
        label: "Mandelbrot perturbation iterations storage buffer",
        size: iterationsBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    const iterationsReadbackBuffer = device.createBuffer({
        label: "Mandelbrot perturbation iterations readback buffer",
        size: iterationsBufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const escapeValuesBuffer = device.createBuffer({
        label: "Mandelbrot perturbation escape values storage buffer",
        size: escapeValuesBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const escapeValuesReadbackBuffer = device.createBuffer({
        label: "Mandelbrot perturbation escape values readback buffer",
        size: escapeValuesBufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const statusBuffer = device.createBuffer({
        label: "Mandelbrot perturbation status storage buffer",
        size: statusBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const statusReadbackBuffer = device.createBuffer({
        label: "Mandelbrot perturbation status readback buffer",
        size: statusBufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    return {
        pixelCount,
        iterationsBufferSize,
        escapeValuesBufferSize,
        statusBufferSize,
        iterationsBuffer,
        iterationsReadbackBuffer,
        escapeValuesBuffer,
        escapeValuesReadbackBuffer,
        statusBuffer,
        statusReadbackBuffer,
    };
}

function initializeMandelbrotPerturbationIterationSentinels(
    device, 
    session
) {
    const sentinelIterations = new Uint32Array(session.pixelCount);
    sentinelIterations.fill(MANDELBROT_ITERATION_SENTINEL);

    device.queue.writeBuffer(
        session.iterationsBuffer, 0,
        sentinelIterations
    );
}

/**
 * Liest die finalen Buffer einer Perturbation-Session aus.
 *
 * Diese Funktion liest die grossen Ergebnisdaten erst am Ende der
 * Perturbation-Berechnung. Wiederholte Zwischenentscheidungen sollen ueber den
 * kleinen Counterbuffer erfolgen, nicht ueber diese finalen Session-Buffer.
 *
 * @param {GPUDevice} device - WebGPU-Device des Workers.
 * @param {Object} session - Buffer-Session der Perturbation-Berechnung.
 * @returns {Promise<{
 *   gpuIterations: Uint32Array,
 *   gpuEscapeValues: Float32Array,
 *   gpuStatus: Uint32Array
 * }>}
 */
async function readMandelbrotPerturbationSessionBuffers(
    device,
    session
) {
    const commandEncoder = device.createCommandEncoder({
        label: "Mandelbrot perturbation session readback command encoder",
    });

    commandEncoder.copyBufferToBuffer(
        session.iterationsBuffer, 0,
        session.iterationsReadbackBuffer, 0,
        session.iterationsBufferSize
    );

    commandEncoder.copyBufferToBuffer(
        session.escapeValuesBuffer, 0,
        session.escapeValuesReadbackBuffer, 0,
        session.escapeValuesBufferSize
    );

    commandEncoder.copyBufferToBuffer(
        session.statusBuffer, 0,
        session.statusReadbackBuffer, 0,
        session.statusBufferSize
    );

    device.queue.submit([commandEncoder.finish()]);

    await Promise.all([
        session.iterationsReadbackBuffer.mapAsync(GPUMapMode.READ),
        session.escapeValuesReadbackBuffer.mapAsync(GPUMapMode.READ),
        session.statusReadbackBuffer.mapAsync(GPUMapMode.READ),
    ]);

    const mappedIterationsRange = session.iterationsReadbackBuffer.getMappedRange();
    const mappedEscapeValuesRange = session.escapeValuesReadbackBuffer.getMappedRange();
    const mappedStatusRange = session.statusReadbackBuffer.getMappedRange();

    const gpuIterations = new Uint32Array(mappedIterationsRange.slice(0));
    const gpuEscapeValues = new Float32Array(mappedEscapeValuesRange.slice(0));
    const gpuStatus = new Uint32Array(mappedStatusRange.slice(0));

    session.iterationsReadbackBuffer.unmap();
    session.escapeValuesReadbackBuffer.unmap();
    session.statusReadbackBuffer.unmap();

    return {
        gpuIterations,
        gpuEscapeValues,
        gpuStatus,
    };
}

function destroyGpuBuffer(buffer) {
    if (!buffer) {
        return;
    }

    try {
        buffer.destroy();
    } catch (error) {
        debugWarn("Failed to destroy GPUBuffer.", error);
    }
}

function destroyMandelbrotPerturbationSession(session) {
    
    destroyGpuBuffer(session.iterationsBuffer);
    destroyGpuBuffer(session.escapeValuesBuffer);
    destroyGpuBuffer(session.statusBuffer);
    destroyGpuBuffer(session.counterBuffer);

    destroyGpuBuffer(session.iterationsReadBuffer);
    destroyGpuBuffer(session.escapeValuesReadBuffer);
    destroyGpuBuffer(session.statusReadBuffer);
    destroyGpuBuffer(session.counterReadBuffer);

    destroyGpuBuffer(session.referenceOrbitBuffer);
    destroyGpuBuffer(session.paramsBuffer);
}

/**
 * Erstellt den GPU-Uniform-Buffer fuer die initialen Perturbation-Parameter.
 *
 * Der Buffer wird einmal pro Perturbation-Session angelegt und anschliessend
 * mit `writeMandelbrotPerturbationParamsBuffer` beschrieben.
 *
 * @param {GPUDevice} device - WebGPU-Device des Workers.
 * @returns {GPUBuffer} Uniform-Buffer fuer die sessionweiten Perturbation-Parameter.
 */
function createMandelbrotPerturbationParamsBuffer(
    device
) {
    return device.createBuffer({
        label: "Mandelbrot perturbation params uniform buffer",
        size: 40, 
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
}

/**
 * Schreibt die sessionweiten Perturbation-Parameter in den Uniform-Buffer.
 *
 * Diese Werte sind fuer alle Referenzorbit-Passes derselben Rechteckberechnung
 * konstant. Orbit-spezifische Werte werden getrennt in den Orbit-Buffer geschrieben.
 *
 * @param {GPUDevice} device - WebGPU-Device des Workers.
 * @param {GPUBuffer} paramsBuffer - Uniform-Buffer fuer die Parameter-Daten.
 * @param {PixelRect} rect - Zu berechnender Pixelbereich.
 * @param {number} imageWidth - Breite der vollstaendigen Zielmatrix in Pixeln.
 * @param {number} imageHeight - Hoehe der vollstaendigen Zielmatrix in Pixeln.
 * @param {ComputationSettings} computationSettings - Einstellungen fuer die Mandelbrot-Berechnung.
 * @returns {void}
 */
function writeMandelbrotPerturbationParamsBuffer(
    device,
    paramsBuffer, 
    rect,
    imageWidth,
    imageHeight,
    computationSettings,
) {

    const { view, iterationLimit, escapeRadius } = computationSettings;
    const { minX, maxX, minY, maxY } = view;

    const pixelScaleX = Math.fround((maxX - minX) / imageWidth);
    const pixelScaleY = Math.fround((maxY - minY) / imageHeight);

    const buffer = new ArrayBuffer(40);
    const dataView = new DataView(buffer);
 
    dataView.setUint32 ( 0, rect.x, true);
    dataView.setUint32 ( 4, rect.y, true);
    dataView.setUint32 ( 8, rect.width, true);
    dataView.setUint32 (12, rect.height, true);
    dataView.setUint32 (16, iterationLimit, true);
    dataView.setFloat32(20, pixelScaleX, true);
    dataView.setFloat32(24, pixelScaleY, true);
    dataView.setFloat32(28, escapeRadius, true);
    dataView.setFloat32(32, 0, true);    

    device.queue.writeBuffer(paramsBuffer, 0, buffer);
}

/**
 * Erstellt die wiederverwendbaren GPU-Buffer fuer Referenzorbits.
 *
 * Die Buffer werden einmal fuer eine Perturbation-Session angelegt und koennen
 * danach fuer mehrere Referenzorbits neu beschrieben werden. Die tatsaechlich
 * gueltige Orbit-Laenge wird spaeter im Orbit-Parameterbuffer uebergeben.
 *
 * @param {GPUDevice} device - WebGPU-Device des Workers.
 * @param {number} maxReferenceOrbitLength - Maximale Anzahl gespeicherter Orbit-Punkte.
 * @returns {{
 *   referenceZxBuffer: GPUBuffer,
 *   referenceZyBuffer: GPUBuffer,
 *   maxReferenceOrbitLength: number
 * }}
 */
function createMandelbrotReferenceOrbitBuffers(
    device,
    maxReferenceOrbitLength = MANDELBROT_WEBGPU_MAX_REFERENCE_ORBIT_LENGTH
) {

    // ein Buffer für die Orbit-Parameter
    const orbitParamsBufferSize = 16;

    const orbitParamsBuffer = device.createBuffer({
        label: "Mandelbrot perturbation reference orbit params uniform buffer",
        size: orbitParamsBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });    


    // zwei Buffer für die Orbit-Datenfelder
    const referenceOrbitBufferSize =
        maxReferenceOrbitLength * Float32Array.BYTES_PER_ELEMENT;

    const referenceZxBuffer = device.createBuffer({
        label: "Mandelbrot perturbation reference zx buffer",
        size: referenceOrbitBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const referenceZyBuffer = device.createBuffer({
        label: "Mandelbrot perturbation reference zy buffer",
        size: referenceOrbitBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    return {
        referenceZxBuffer,
        referenceZyBuffer,
        maxReferenceOrbitLength,
        orbitParamsBuffer, 
    };
}

/**
 * Schreibt einen konkreten Referenzorbit in vorhandene GPU-Buffer.
 *
 * @param {GPUDevice} device - WebGPU-Device des Workers.
 * @param {Object} referenceOrbitBuffers - Wiederverwendbare Orbit-Buffer.
 * @param {MandelbrotReferenceOrbit} referenceOrbit - Vorberechneter Referenzorbit.
 * @returns {void}
 */
function writeMandelbrotReferenceOrbitBuffers(
    device,
    referenceOrbitBuffers,
    referenceOrbit,
    imageWidth,
    imageHeight,
    computationSettings,
) {

    if (referenceOrbit.zx.length > referenceOrbitBuffers.maxReferenceOrbitLength ||
        referenceOrbit.zy.length > referenceOrbitBuffers.maxReferenceOrbitLength) {
        throw new Error("Reference orbit exceeds allocated WebGPU reference buffers.");
    }

    // Parameterwerte für den Refernz-Orbit
    const { view } = computationSettings;
    const { minX, maxX, minY, maxY } = view;
    const referenceCandidate = referenceOrbit.referenceCandidate;
    const referencePixelX =
        ((referenceCandidate.cx - minX) / (maxX - minX)) * imageWidth;
    const referencePixelY =
        ((referenceCandidate.cy - minY) / (maxY - minY)) * imageHeight;
        
    const buffer = new ArrayBuffer(16);
    const dataView = new DataView(buffer);
    dataView.setUint32 ( 0, referenceOrbit.zx.length, true);
    dataView.setFloat32( 4, Math.fround(referencePixelX), true);
    dataView.setFloat32( 8, Math.fround(referencePixelY), true);
    dataView.setFloat32(12, 0, true);

    device.queue.writeBuffer(
        referenceOrbitBuffers.orbitParamsBuffer,
        0,
        buffer
    );

    // Buffer für die Referenz-Orbits
    device.queue.writeBuffer(
        referenceOrbitBuffers.referenceZxBuffer,
        0,
        new Float32Array(referenceOrbit.zx)
    );

    device.queue.writeBuffer(
        referenceOrbitBuffers.referenceZyBuffer,
        0,
        new Float32Array(referenceOrbit.zy)
    );
}

/**
 * Erstellt die Buffer fuer wiederholt lesbare Perturbation-Statusinformationen.
 *
 * Der Counterbuffer wird vom Shader pro Dispatch atomisch beschrieben. Der
 * Readback-Buffer erlaubt dem Host, nach einem Dispatch nur die kompakten
 * Zaehler auszulesen, ohne Iterations- oder Statusarrays zu kopieren.
 *
 * @param {GPUDevice} device - WebGPU-Device des Workers.
 * @returns {{
 *   counterBuffer: GPUBuffer,
 *   counterReadbackBuffer: GPUBuffer,
 *   counterBufferSize: number
 * }}
 */
function createMandelbrotPerturbationCounterBuffers(
    device
) {
    const counterBuffer = device.createBuffer({
        label: "Mandelbrot perturbation counter storage buffer",
        size: MANDELBROT_PERTURBATION_COUNTER_BUFFER_SIZE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });

    const counterReadbackBuffer = device.createBuffer({
        label: "Mandelbrot perturbation counter readback buffer",
        size: MANDELBROT_PERTURBATION_COUNTER_BUFFER_SIZE,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    return {
        counterBuffer,
        counterReadbackBuffer,
        counterBufferSize: MANDELBROT_PERTURBATION_COUNTER_BUFFER_SIZE,
    };
}

/**
 * Setzt die Perturbation-Zaehler vor einem Dispatch auf null.
 *
 * Der Counterbuffer beschreibt immer nur den naechsten Dispatch. Ohne Reset
 * wuerden sich die Werte ueber mehrere Referenzorbit-Laeufe aufsummieren.
 *
 * @param {GPUDevice} device - WebGPU-Device des Workers.
 * @param {GPUBuffer} counterBuffer - Storage-Buffer mit atomischen Zaehlern.
 * @returns {void}
 */
function resetMandelbrotPerturbationCounterBuffer(
    device,
    counterBuffer
) {
    const zeroCounters = new Uint32Array(MANDELBROT_PERTURBATION_COUNTER_COUNT);

    device.queue.writeBuffer(
        counterBuffer,
        0,
        zeroCounters
    );
}

/**
 * Liest die kompakten Perturbation-Zaehler aus.
 *
 * @param {GPUDevice} device - WebGPU-Device des Workers.
 * @param {GPUBuffer} counterBuffer - Storage-Buffer mit atomischen Zaehlern.
 * @param {GPUBuffer} counterReadbackBuffer - Readback-Buffer fuer die Zaehler.
 * @param {number} counterBufferSize - Groesse des Counterbuffers in Byte.
 * @returns {Promise<Object>} Ausgelesene Zaehler als Objekt.
 */
async function readMandelbrotPerturbationCounterBuffer(
    device,
    counterBuffer,
    counterReadbackBuffer,
    counterBufferSize
) {
    const commandEncoder = device.createCommandEncoder({
        label: "Mandelbrot perturbation counter readback command encoder",
    });

    commandEncoder.copyBufferToBuffer(
        counterBuffer,
        0,
        counterReadbackBuffer,
        0,
        counterBufferSize
    );

    device.queue.submit([commandEncoder.finish()]);

    await counterReadbackBuffer.mapAsync(GPUMapMode.READ);

    const mappedRange = counterReadbackBuffer.getMappedRange();
    const counters = new Uint32Array(mappedRange.slice(0));

    counterReadbackBuffer.unmap();

    return {
        pixelCount: counters[0],
        okCount: counters[1],
        invalidCount: counters[2],
        referenceEndedCount: counters[3],
        smallOrbitCount: counters[4],
        deltaTooLargeCount: counters[5],
        nonFiniteCount: counters[6],
    };
}

function dispatchMandelbrotPerturbationPass(
    device,
    computePipeline,
    bindGroup,
    rect
) {
    const commandEncoder = device.createCommandEncoder({
        label: "Mandelbrot perturbation command encoder",
    });

    const computePass = commandEncoder.beginComputePass({
        label: "Mandelbrot perturbation compute pass",
    });

    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, bindGroup);

    const workgroupSizeX = 16;
    const workgroupSizeY = 16;
    const workgroupCountX = Math.ceil(rect.width / workgroupSizeX);
    const workgroupCountY = Math.ceil(rect.height / workgroupSizeY);

    computePass.dispatchWorkgroups(workgroupCountX, workgroupCountY);
    computePass.end();

    device.queue.submit([commandEncoder.finish()]);
}

async function runMandelbrotPerturbationPass(
    device,
    computePipeline,
    bindGroup,
    rect,
    orbitBuffers,
    referenceOrbit,
    imageWidth,
    imageHeight,
    computationSettings,
    statusInfoBuffers
) {

    // aktuellen Orbit an die GPU senden
    writeMandelbrotReferenceOrbitBuffers(
        device,
        orbitBuffers,
        referenceOrbit, 
        imageWidth, 
        imageHeight, 
        computationSettings
    );

    // Counter zurücksetzen
    resetMandelbrotPerturbationCounterBuffer(
        device,
        statusInfoBuffers.counterBuffer
    );    

    // einen Pass auf der GPU ausführen
    dispatchMandelbrotPerturbationPass(
        device, 
        computePipeline, 
        bindGroup, 
        rect, 
    ); 

    // Counter aus der GPU zurücklesen
    return await readMandelbrotPerturbationCounterBuffer(
                device,
                statusInfoBuffers.counterBuffer,
                statusInfoBuffers.counterReadbackBuffer,
                statusInfoBuffers.counterBufferSize
            );
}

// -----------------------------------------------------------------------------
/**
 * Berechnet einen einzelnen Mandelbrot-Punkt CPU-basiert.
 *
 * Worker-lokale Kopie der Punktberechnung aus mandelbrot-cpu-worker.js.
 *
 * @param {number} cx - Koordinate auf der Real-Achse.
 * @param {number} cy - Koordinate auf der Imaginär-Achse.
 * @param {number} iterationLimit - Maximale Iterationszahl.
 * @param {number} escapeRadius - Escape-Radius.
 * @returns {{ iterations: number, escapeValue: number }}
 */
function computeMandelbrotPointOnCpu(
    cx,
    cy,
    iterationLimit,
    escapeRadius
) {
    if ((cx + 1) * (cx + 1) + cy * cy <= 0.0625) {
        return {
            iterations: iterationLimit,
            escapeValue: 0,
        };
    }

    const q = (cx - 0.25) * (cx - 0.25) + cy * cy;

    if (q * (q + (cx - 0.25)) <= 0.25 * cy * cy) {
        return {
            iterations: iterationLimit,
            escapeValue: 0,
        };
    }

    let zx = 0;
    let zy = 0;
    let iteration = 0;

    const escapeRadiusSquared = escapeRadius * escapeRadius;

    while (
        zx * zx + zy * zy < escapeRadiusSquared &&
        iteration < iterationLimit
    ) {
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
 * Repariert nach einer akzeptierten Perturbation verbleibende Sentinel-Pixel
 * punktweise per CPU.
 *
 * @param {PixelRect} rect - Berechneter Pixelbereich.
 * @param {number} imageWidth - Breite der vollständigen Zielmatrix.
 * @param {number} imageHeight - Höhe der vollständigen Zielmatrix.
 * @param {ComputationSettings} computationSettings - Berechnungseinstellungen.
 * @param {Uint32Array} gpuIterations - Aus der GPU gelesene Iterationswerte.
 * @param {Float32Array} gpuEscapeValues - Aus der GPU gelesene Escape-Werte.
 * @param {Uint32Array} gpuStatus - Aus der GPU gelesene Perturbation-Statuswerte.
 * @returns {Object} Reparaturstatistik.
 */
function repairMandelbrotPerturbationSentinelPixelsOnCpu(
    rect,
    imageWidth,
    imageHeight,
    computationSettings,
    gpuIterations,
    gpuEscapeValues,
    gpuStatus
) {
    const { view, iterationLimit, escapeRadius } = computationSettings;
    const { minX, maxX, minY, maxY } = view;

    let repairedCount = 0;
    let referenceEndedCount = 0;
    let smallOrbitCount = 0;
    let deltaTooLargeCount = 0;
    let nonFiniteCount = 0;
    let unknownStatusCount = 0;

    for (let localY = 0; localY < rect.height; localY++) {
        for (let localX = 0; localX < rect.width; localX++) {
            const index = localY * rect.width + localX;

            if (gpuIterations[index] !== MANDELBROT_ITERATION_SENTINEL) {
                continue;
            }

            const status = gpuStatus[index];

            if (status === PERTURBATION_STATUS_REFERENCE_ENDED) {
                referenceEndedCount++;
            } else if (status === PERTURBATION_STATUS_SMALL_ORBIT) {
                smallOrbitCount++;
            } else if (status === PERTURBATION_STATUS_DELTA_TOO_LARGE) {
                deltaTooLargeCount++;
            } else if (status === PERTURBATION_STATUS_NON_FINITE) {
                nonFiniteCount++;
            } else {
                unknownStatusCount++;
            }

            const px = rect.x + localX;
            const py = rect.y + localY;

            const cx = minX + (px / imageWidth) * (maxX - minX);
            const cy = minY + (py / imageHeight) * (maxY - minY);

            const pointResult = computeMandelbrotPointOnCpu(
                cx,
                cy,
                iterationLimit,
                escapeRadius
            );

            gpuIterations[index] = pointResult.iterations;
            gpuEscapeValues[index] = pointResult.escapeValue;

            repairedCount++;
        }
    }

    return {
        repairedCount,
        referenceEndedCount,
        smallOrbitCount,
        deltaTooLargeCount,
        nonFiniteCount,
        unknownStatusCount,
    };
}

/**
 * Stellt sicher, dass nach dem CPU-Fixup keine Sentinel-Pixel mehr übrig sind.
 *
 * @param {Uint32Array} gpuIterations - Aus der GPU gelesene und ggf. reparierte Iterationswerte.
 * @returns {void}
 */
function assertNoMandelbrotPerturbationSentinelsRemain(gpuIterations) {
    for (let index = 0; index < gpuIterations.length; index++) {
        if (gpuIterations[index] === MANDELBROT_ITERATION_SENTINEL) {
            throw new Error(
                `CPU repair left unresolved perturbation sentinel pixel at index ${index}.`
            );
        }
    }
}

// -----------------------------------------------------------------------------
function isAcceptableMandelbrotPerturbationStats(stats) {
    if (!stats || stats.pixelCount === 0) {
        return true;
    }

    const hardInvalidCount =
        stats.referenceEndedCount + stats.nonFiniteCount;

    const smallOrbitRatio =
        stats.smallOrbitCount / stats.pixelCount;

    const deltaTooLargeRatio =
        stats.deltaTooLargeCount / stats.pixelCount;

    return hardInvalidCount === 0 &&
        smallOrbitRatio <= MANDELBROT_PERTURBATION_MAX_SMALL_ORBIT_RATIO &&
        deltaTooLargeRatio <= MANDELBROT_PERTURBATION_MAX_DELTA_TOO_LARGE_RATIO;
}

/**
 * Berechnet einen Pixelbereich der Mandelbrot-Menge per Perturbation auf der GPU.
 *
 * Der Worker berechnet den Referenzorbit aus dem uebergebenen Kandidaten und
 * lehnt den Kandidaten als normales Ergebnisobjekt ab, wenn der Orbit fuer die
 * aktuelle Berechnung nicht lang genug ist.
 *
 * @param {PixelRect} rect - Zu berechnender Pixelbereich.
 * @param {number} imageWidth - Breite der vollstaendigen Zielmatrix in Pixeln.
 * @param {number} imageHeight - Hoehe der vollstaendigen Zielmatrix in Pixeln.
 * @param {ComputationSettings} computationSettings - Einstellungen fuer die Mandelbrot-Berechnung.
 * @param {ReferenceCandidate} referenceCandidate - Referenzkandidat, aus dem der Worker den Orbit berechnet.
 * @returns {Promise<IterationData|Object>} Berechnete Iterationsdaten oder Kandidaten-Ablehnung.
 */
async function computeMandelbrotRectWithPerturbationOnGpu(
    rect,
    imageWidth,
    imageHeight,
    computationSettings,
    referenceCandidates,
) {
    debugLog("computeMandelbrotRectWithPerturbationOnGpu (start)");

    if (!referenceCandidates || referenceCandidates.length === 0) {
        return {
            perturbationReferenceRejected: true,
            reason: "no-reference-candidates",
        };
    }

    const { device } = await getWorkerContext();
    const { computePipeline } = await getComputePipeline(
        "mandelbrot-perturbation",
        MANDELBROT_PERTURBATION_SHADER_SOURCE,
        "Mandelbrot perturbation iterations"
    );

    // Die Pixelanzahl bestimmt die Größe der Buffer
    const pixelCount = rect.width * rect.height;

    // Anlegen der Session-Buffer (Iterationsdaten, EscapeVlaues, Status...)
    const session = createMandelbrotPerturbationSessionBuffers(
        device,
        pixelCount
    );
    
    try {
        initializeMandelbrotPerturbationIterationSentinels(
            device, 
            session, 
        ); 

        // Parameter-Buffer für die Session 
        // wird nur einmal initial geschrieben
        const paramsBuffer = createMandelbrotPerturbationParamsBuffer(device); 

        writeMandelbrotPerturbationParamsBuffer( 
            device, 
            paramsBuffer, 
            rect,
            imageWidth,
            imageHeight,
            computationSettings
        ); 

        // die eigentlichen Buffer für den aktuellen Orbit
        // wird bei jedem Pass geschrieben
        const orbitBuffers = createMandelbrotReferenceOrbitBuffers(device);

        // Buffer für Status-Info, 
        // wird vor jedem Run zurückgesetzt und nach jedem Run gelesen
        const statusInfoBuffers = createMandelbrotPerturbationCounterBuffers(device);


        // Bindings anlegen  
        const bindGroup = device.createBindGroup({
            label: "Mandelbrot perturbation bind group",
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: paramsBuffer }},
                { binding: 1, resource: { buffer: session.iterationsBuffer }},
                { binding: 2, resource: { buffer: session.escapeValuesBuffer }},
                { binding: 3, resource: { buffer: orbitBuffers.referenceZxBuffer }},
                { binding: 4, resource: { buffer: orbitBuffers.referenceZyBuffer }},
                { binding: 5, resource: { buffer: session.statusBuffer }},
                { binding: 6, resource: { buffer: orbitBuffers.orbitParamsBuffer }},
                { binding: 7, resource: { buffer: statusInfoBuffers.counterBuffer }},
            ],
        });

        let perturbationCounters = null;

        const referenceCandidateResults = referenceCandidates.map((candidate, candidateIndex) => ({
            ...candidate,
            source: candidate.source ?? "original",
            status: candidate.status ?? "not-used",
        }));

        const totalReferenceCandidates = referenceCandidateResults.length;
        let perturbationAcceptable = false ; 

        for (let candidateIndex = 0; candidateIndex < totalReferenceCandidates; candidateIndex++) {

            const referenceCandidate = referenceCandidateResults[candidateIndex];
            const referenceOrbit = computeMandelbrotReferenceOrbit(referenceCandidate);
            const invalidBefore = perturbationCounters?.invalidCount ?? pixelCount;

            // einen Pass auf den Sessiondaten mit einem einzelnen Orbit ausführen
            perturbationCounters = await runMandelbrotPerturbationPass(
                device,
                computePipeline,
                bindGroup,
                rect,
                orbitBuffers,
                referenceOrbit,
                imageWidth,
                imageHeight,
                computationSettings,
                statusInfoBuffers
            );

            const invalidAfter = perturbationCounters.invalidCount;
            const improvement = Math.max(0, invalidBefore - invalidAfter);

            referenceCandidate.status = improvement > 0
                ? "used-improved"
                : "used-no-improvement";

            debugInfo(
                `Next reference orbit applied: ${candidateIndex + 1} / ${totalReferenceCandidates}`, 
                `invalid Pixels: ${perturbationCounters.invalidCount}`
            );

            if (isAcceptableMandelbrotPerturbationStats(perturbationCounters)) {
                perturbationAcceptable = true ; 
                break;
            }
        }

        if (!perturbationCounters) {
            return {
                perturbationReferenceRejected: true,
                reason: "no-usable-reference-orbit",
            };
        }

        // Result-Array zurücklesen
        const gpuResult = await readMandelbrotPerturbationSessionBuffers(
            device,
            session
        );

        let cpuRepairStats = {
            repairedCount: 0,
            referenceEndedCount: 0,
            smallOrbitCount: 0,
            deltaTooLargeCount: 0,
            nonFiniteCount: 0,
            unknownStatusCount: 0,
        };

        if (perturbationAcceptable && perturbationCounters.invalidCount > 0) {
            debugWarn("Repairing invalid perturbation results on CPU.");
            debugInfo(`Invalid pixels: ${perturbationCounters.invalidCount}`);

            cpuRepairStats = repairMandelbrotPerturbationSentinelPixelsOnCpu(
                rect,
                imageWidth,
                imageHeight,
                computationSettings,
                gpuResult.gpuIterations,
                gpuResult.gpuEscapeValues,
                gpuResult.gpuStatus
            );

            debugInfo(`Repaired pixels: ${cpuRepairStats.repairedCount}`);
        }

        if (perturbationAcceptable) {
            assertNoMandelbrotPerturbationSentinelsRemain(
                gpuResult.gpuIterations
            );
        }

        // iterationData aus gpuResult erzeugen
        const result = createIterationDataFromGpuArrays(
            rect,
            gpuResult.gpuIterations,
            gpuResult.gpuEscapeValues,
            computationSettings.iterationLimit,
            MANDELBROT_ITERATION_SENTINEL,
            computationSettings.view
        );

        // das Zähler-Objekt und die annotierten Referenzkandidaten zum result hinzufügen
        result.perturbationStats = perturbationCounters;
        result.perturbationAcceptable = perturbationAcceptable;
        result.referenceCandidates = referenceCandidateResults;
        result.cpuRepairStats = cpuRepairStats;
        result.cpuRepairedPixelCount = cpuRepairStats.repairedCount;
        result.status = gpuResult.gpuStatus;

        debugLog("computeMandelbrotRectWithPerturbationOnGpu (done)");
        debugInfo(
            `Acceptable: ${result.perturbationAcceptable}`, 
            `Invalid pixels: ${result.perturbationStats.invalidCount}`, 
            `Repaired pixels: ${result.cpuRepairedPixelCount}`, 
        ); 
        
        return result;

    } finally {
        destroyMandelbrotPerturbationSession(session);
    }
}

// -----------------------------------------------------------------------------
// Messagehandler
// -----------------------------------------------------------------------------

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
    const result = message.referenceCandidates
        ? await computeMandelbrotRectWithPerturbationOnGpu(
            message.rect,
            message.imageWidth,
            message.imageHeight,
            message.computationSettings,
            message.referenceCandidates
        )
        : await computeMandelbrotRectOnGpu(
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
