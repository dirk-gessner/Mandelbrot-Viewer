console.log("Mandelbrot WebGPU worker script loaded");


// -----------------------------------------------------------------------------
// Worker-seitige Mandelbrot-Berechnung über WebGPU
// -----------------------------------------------------------------------------
//
// Diese Datei läuft in einem separaten Web-Worker-Kontext.
//
// In der ersten Ausbaustufe enthält sie noch keine echte WebGPU-Berechnung.
// Sie dient zunächst als Dummy-Worker, um die Nachrichtenstruktur zwischen
// Hauptthread und Worker stabil zu testen.
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
 * In diesem ersten GPU-Schritt wird nur der Iterationsbuffer berechnet.
 * Escape-Werte werden anschließend noch im JavaScript-Worker approximiert.
 *
 * @type {string}
 */
const WEBGPU_COMPUTE_SHADER_SOURCE = `
@group(0) @binding(0)
var<storage, read_write> output: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;

  if (index >= 256u) {
    return;
  }

  output[index] = index;
}
`;

/**
 * Initialisiert die WebGPU-Compute-Pipeline für die Mandelbrot-Berechnung.
 *
 * In diesem Zwischenschritt wird nur eine minimale Test-Pipeline erzeugt.
 * Die Pipeline wird noch nicht für echte Mandelbrot-Berechnungen verwendet.
 *
 * @returns {Promise<WebGpuComputePipelineContext>} Initialisierte Pipeline-Ressourcen.
 */
async function initializeWebGpuComputePipeline() {
    const { device } = await getWebGpuWorkerContext();

    console.log("Initializing WebGPU Mandelbrot compute pipeline");

    const shaderModule = device.createShaderModule({
        label: "Mandelbrot pipeline test shader",
        code: WEBGPU_COMPUTE_SHADER_SOURCE,
    });

    const computePipeline = await device.createComputePipelineAsync({
        label: "Mandelbrot pipeline test compute pipeline",
        layout: "auto",
        compute: {
            module: shaderModule,
            entryPoint: "main",
        },
    });

    console.log("WebGPU Mandelbrot compute pipeline initialized", {
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
 * Führt einen einfachen Compute-Test auf der GPU aus.
 *
 * Der Shader schreibt für jedes Element seinen linearen Index in einen
 * StorageBuffer. Anschließend werden die Daten zurück in ein Uint32Array
 * gelesen.
 *
 * Diese Funktion dient ausschließlich zum Testen der GPU-Datenpipeline.
 *
 * @returns {Promise<Uint32Array>} Von der GPU erzeugte Testdaten.
 */
async function runWebGpuComputePipelineTest() {
    const { device } = await getWebGpuWorkerContext();

    const { computePipeline } = await getWebGpuComputePipeline();

    const elementCount = 256;
    const bufferSize = elementCount * Uint32Array.BYTES_PER_ELEMENT;

    console.log("Running WebGPU compute pipeline test", {
        elementCount,
        bufferSize,
    });

    const storageBuffer = device.createBuffer({
        label: "WebGPU pipeline test storage buffer",
        size: bufferSize,
        usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_SRC |
            GPUBufferUsage.COPY_DST,
    });

    const readbackBuffer = device.createBuffer({
        label: "WebGPU pipeline test readback buffer",
        size: bufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const bindGroup = device.createBindGroup({
        label: "WebGPU pipeline test bind group",
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: storageBuffer,
                },
            },
        ],
    });

    const commandEncoder = device.createCommandEncoder({
        label: "WebGPU pipeline test command encoder",
    });

    const computePass = commandEncoder.beginComputePass({
        label: "WebGPU pipeline test compute pass",
    });

    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, bindGroup);

    const workgroupSize = 64;
    const workgroupCount = Math.ceil(elementCount / workgroupSize);

    computePass.dispatchWorkgroups(workgroupCount);

    computePass.end();

    commandEncoder.copyBufferToBuffer(
        storageBuffer,
        0,
        readbackBuffer,
        0,
        bufferSize
    );

    device.queue.submit([commandEncoder.finish()]);

    await readbackBuffer.mapAsync(GPUMapMode.READ);

    const mappedRange = readbackBuffer.getMappedRange();

    const result = new Uint32Array(mappedRange.slice(0));

    readbackBuffer.unmap();

    console.log("WebGPU compute pipeline test result", result);

    return result;
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

    const gpuTestResult = await runWebGpuComputePipelineTest();

    console.log(
        "WebGPU compute pipeline test sample",
        gpuTestResult.slice(0, 16)
    );

    const result = gpuWorkerComputeMandelbrotRect(
        message.rect,
        message.imageWidth,
        message.imageHeight,
        message.computationSettings
    );

    /** @type {WebGpuComputeSuccessMessage} */
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