const useWebGpuDummyBackend = true;

/**
 * @file Main-thread proxy for WebGPU-based Mandelbrot rectangle computation.
 *
 * This module does not perform WebGPU work directly. It owns a long-lived
 * worker instance, assigns request ids, tracks pending requests and resolves
 * results returned by the WebGPU worker.
 */

/**
 * Name of the worker script that will later contain the WebGPU implementation.
 *
 * @type {string}
 */
const MANDELBROT_WEBGPU_WORKER_SCRIPT = "./js/mandelbrot-webgpu-worker.js";

/**
 * Singleton worker instance used for all WebGPU Mandelbrot computations.
 *
 * The worker is kept alive because WebGPU device and pipeline initialization
 * should be reused across multiple rectangle computations.
 *
 * @type {Worker|null}
 */
let mandelbrotWebGpuWorker = null;

/**
 * Monotonically increasing request id for worker messages.
 *
 * @type {number}
 */
let nextWebGpuRequestId = 1;

/**
 * Pending requests keyed by request id.
 *
 * @type {Map<number, WebGpuPendingRequest>}
 */
const pendingWebGpuRequests = new Map();

/**
 * Pending Promise callbacks for a WebGPU worker request.
 *
 * @typedef {Object} WebGpuPendingRequest
 * @property {(value: IterationData) => void} resolve Resolves the request.
 * @property {(reason?: unknown) => void} reject Rejects the request.
 */

/**
 * Message sent from the main thread to the WebGPU worker.
 *
 * @typedef {Object} WebGpuComputeRequestMessage
 * @property {"compute-mandelbrot-rect"} type Message type.
 * @property {number} requestId Unique request id.
 * @property {Rect} rect Rectangle to compute.
 * @property {number} imageWidth Width of the complete image in pixels.
 * @property {number} imageHeight Height of the complete image in pixels.
 * @property {ComputationSettings} computationSettings Mandelbrot computation settings.
 */

/**
 * Successful response sent by the WebGPU worker.
 *
 * @typedef {Object} WebGpuComputeSuccessMessage
 * @property {"compute-mandelbrot-rect-result"} type Message type.
 * @property {number} requestId Request id from the original request.
 * @property {true} ok Indicates success.
 * @property {IterationData} result Computed iteration data for the requested rectangle.
 */

/**
 * Error response sent by the WebGPU worker.
 *
 * @typedef {Object} WebGpuComputeErrorMessage
 * @property {"compute-mandelbrot-rect-result"} type Message type.
 * @property {number} requestId Request id from the original request.
 * @property {false} ok Indicates failure.
 * @property {string} error Error message.
 */

/**
 * Response message sent by the WebGPU worker.
 *
 * @typedef {WebGpuComputeSuccessMessage|WebGpuComputeErrorMessage} WebGpuComputeResponseMessage
 */

/**
 * Returns the long-lived WebGPU worker instance.
 *
 * The worker is created lazily on the first computation request and then reused.
 * Reusing the worker avoids repeated setup cost for adapter, device, shader
 * module and compute pipeline in the worker implementation.
 *
 * @returns {Worker} The shared WebGPU worker instance.
 */
function getMandelbrotWebGpuWorker() {
    if (mandelbrotWebGpuWorker) {
        return mandelbrotWebGpuWorker;
    }

    mandelbrotWebGpuWorker = new Worker(MANDELBROT_WEBGPU_WORKER_SCRIPT, {
        type: "module",
    });

    mandelbrotWebGpuWorker.onmessage = handleMandelbrotWebGpuWorkerMessage;
    mandelbrotWebGpuWorker.onerror = handleMandelbrotWebGpuWorkerError;

    return mandelbrotWebGpuWorker;
}

/**
 * Handles result messages from the WebGPU worker.
 *
 * @param {MessageEvent<WebGpuComputeResponseMessage>} event Worker message event.
 * @returns {void}
 */
function handleMandelbrotWebGpuWorkerMessage(event) {
    const message = event.data;
    const pendingRequest = pendingWebGpuRequests.get(message.requestId);

    if (!pendingRequest) {
        console.warn(
            "Received WebGPU Mandelbrot response for unknown request",
            message
        );
        return;
    }

    pendingWebGpuRequests.delete(message.requestId);

    if (message.ok) {
        pendingRequest.resolve(message.result);
        return;
    }

    pendingRequest.reject(new Error(message.error));
}

/**
 * Rejects all pending WebGPU requests after an unhandled worker error.
 *
 * @param {ErrorEvent} event Worker error event.
 * @returns {void}
 */
function handleMandelbrotWebGpuWorkerError(event) {
    const error = new Error(
        event.message || "Unhandled error in Mandelbrot WebGPU worker."
    );

    for (const pendingRequest of pendingWebGpuRequests.values()) {
        pendingRequest.reject(error);
    }

    pendingWebGpuRequests.clear();

    mandelbrotWebGpuWorker?.terminate();
    mandelbrotWebGpuWorker = null;
}

/**
 * Computes Mandelbrot iteration data for a rectangle using the WebGPU worker.
 *
 * This function only sends the request to the worker. The actual WebGPU
 * implementation lives in `mandelbrot-webgpu-worker.js`.
 *
 * @param {Rect} rect Rectangle to compute.
 * @param {number} imageWidth Width of the complete image in pixels.
 * @param {number} imageHeight Height of the complete image in pixels.
 * @param {ComputationSettings} computationSettings Mandelbrot computation settings.
 * @returns {Promise<IterationData>} Computed iteration data for the rectangle.
 */
function computeMandelbrotRectWebGpu(
    rect,
    imageWidth,
    imageHeight,
    computationSettings
) {
    return new Promise((resolve, reject) => {
        const requestId = nextWebGpuRequestId++;

        pendingWebGpuRequests.set(requestId, {
            resolve,
            reject,
        });

        /** @type {WebGpuComputeRequestMessage} */
        const message = {
            type: "compute-mandelbrot-rect",
            requestId,
            rect,
            imageWidth,
            imageHeight,
            computationSettings,
        };

        getMandelbrotWebGpuWorker().postMessage(message);
    });
}

/**
 * Führt einen einfachen manuellen Test des WebGPU-Worker-Proxys aus.
 *
 * Diese Funktion ist nur für die Entwicklungsphase gedacht und sollte nicht
 * dauerhaft Teil der öffentlichen App-Logik bleiben.
 *
 * @returns {Promise<void>}
 */
async function testMandelbrotWebGpuWorkerProxy() {
    const result = await computeMandelbrotRectWebGpu(
        { x: 0, y: 0, width: 8, height: 4 },
        8,
        4,
        {
            initialView: null,
            view: {
                minX: -2,
                maxX: 1,
                minY: -1,
                maxY: 1,
            },
            maxIterations: 100,
            escapeRadius: 5,
        }
    );

    console.log("WebGPU worker proxy test result", result);
}