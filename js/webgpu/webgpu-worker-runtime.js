
/**
 * @file Allgemeine WebGPU-/Worker-Infrastruktur.
 * 
 */

// -----------------------------------------------------------------------------
// Debug-Log-Funktionen
// -----------------------------------------------------------------------------
const DEBUG_MODE = true;

export function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log(...args);
    }
}

export function debugInfo(...args) {
    if (DEBUG_MODE) {
        console.info(...args);
    }
}

export function debugWarn(...args) {
    if (DEBUG_MODE) {
        console.warn(...args);
    }
}

// -----------------------------------------------------------------------------
// Datentypen
// -----------------------------------------------------------------------------

/**
 * Gehaltene WebGPU-Ressourcen des Workers.
 *
 * @typedef {Object} WorkerContext
 * @property {GPUAdapter} adapter - WebGPU-Adapter.
 * @property {GPUDevice} device - WebGPU-Device.
 */

/**
 * Gehaltene WebGPU-Ressourcen für die Mandelbrot-Compute-Pipeline.
 *
 * @typedef {Object} ComputePipelineContext
 * @property {GPUShaderModule} shaderModule - Kompiliertes Shader-Modul.
 * @property {GPUComputePipeline} computePipeline - Compute-Pipeline.
 */


// -----------------------------------------------------------------------------
// Messages 
// -----------------------------------------------------------------------------

/**
 * Fehlerantwort des WebGPU-Workers.
 * 
 * @typedef {Object} WorkerErrorMessage
 * @property {string}   type
 * @property {number}   requestId
 * @property {false}    ok
 * @property {string}   error
 */


// -----------------------------------------------------------------------------
// Promise-Typen
// -----------------------------------------------------------------------------

/**
 * Zwischengespeicherter WebGPU-Kontext des Workers.
 *
 * @type {Promise<WorkerContext>|null}
 */
let workerContextPromise = null;

/**
 * Zwischengespeicherte WebGPU-Compute-Pipelines nach fachlichem Pipeline-Key.
 *
 * @type {Map<string, Promise<ComputePipelineContext>>}
 */
const computePipelinePromises = new Map();


// -----------------------------------------------------------------------------
// Pipeline 
// -----------------------------------------------------------------------------

/**
 * Initialisiert die WebGPU-Compute-Pipeline für die Mandelbrot-Berechnung.
 *
 * @returns {Promise<ComputePipelineContext>} Initialisierte Pipeline-Ressourcen.
 */
async function initializeComputePipeline(
    pipelineKey, 
    shaderSource, 
    label    
) {
    const { device } = await getWorkerContext();

    debugLog("Initializing WebGPU compute pipeline");

    const shaderModule = device.createShaderModule({
        label: label,
        code: shaderSource,
    });

    const computePipeline = await device.createComputePipelineAsync({
        label: pipelineKey,
        layout: "auto",
        compute: {
            module: shaderModule,
            entryPoint: "main",
        },
    });

    debugLog("WebGPU compute pipeline initialized", {
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
 * @returns {Promise<ComputePipelineContext>} Initialisierte Pipeline-Ressourcen.
 */
export function getComputePipeline(
    pipelineKey, 
    shaderSource, 
    label    
) {
    if (!computePipelinePromises.has(pipelineKey)) {
        const computePipelinePromise = initializeComputePipeline(
            pipelineKey,
            shaderSource,
            label
        ).catch((error) => {
            computePipelinePromises.delete(pipelineKey);
            throw error;
        });

        computePipelinePromises.set(pipelineKey, computePipelinePromise);
    }

    return computePipelinePromises.get(pipelineKey);
}

// -----------------------------------------------------------------------------
// WebGPU-Worker-Kontext
// -----------------------------------------------------------------------------

/**
 * Initialisiert den WebGPU-Kontext des Workers.
 *
 * Die Initialisierung wird lazy durchgeführt und anschließend wiederverwendet.
 * In diesem Schritt wird noch keine Mandelbrot-Berechnung auf der GPU
 * ausgeführt. Es wird nur geprüft, ob der Worker ein GPUDevice anlegen kann.
 *
 * @returns {Promise<WorkerContext>} Initialisierter WebGPU-Kontext.
 */
async function initializeWorkerContext() {
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
        workerContextPromise = null;
    });

    debugLog("WebGPU worker context initialized", {
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
 * @returns {Promise<WorkerContext>} Initialisierter WebGPU-Kontext.
 */
export function getWorkerContext() {
    if (!workerContextPromise) {
        workerContextPromise = initializeWorkerContext().catch(
            (error) => {
                workerContextPromise = null;
                throw error;
            }
        );
    }

    return workerContextPromise;
}

// -----------------------------------------------------------------------------
// Worker-Antworten
// -----------------------------------------------------------------------------

/**
 * Sendet eine standardisierte Fehlerantwort an den Hauptthread.
 *
 * @param {number} requestId - (integer) Anfrage-ID, falls bekannt.
 * @param {unknown} error - Ausgelöster Fehler.
 * @returns {WorkerErrorMessage}
 */
export function postWorkerErrorResponse(
    responseType, 
    requestId, 
    error) {
    /** @type {WebGpuComputeErrorMessage} */
    const response = {
        type: responseType,
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
    };

    self.postMessage(response);
}








