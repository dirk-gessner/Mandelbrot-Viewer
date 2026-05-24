/**
 * @file Hauptthread-Proxy für WebGPU-basierte Mandelbrot-Rechteckberechnungen.
 *
 * Dieses Modul führt selbst keine WebGPU-Befehle aus. Es verwaltet eine
 * langlebige Worker-Instanz, vergibt Anfrage-IDs, verfolgt offene Anfragen
 * und löst die vom WebGPU-Worker zurückgegebenen Ergebnisse auf.
 */

/**
 * Pfad zum Worker-Skript mit der eigentlichen WebGPU-Implementierung.
 *
 * @type {string}
 */
const MANDELBROT_WEBGPU_WORKER_SCRIPT = "./js/mandelbrot-webgpu-worker.js";

/**
 * Singleton-Worker-Instanz für alle WebGPU-Mandelbrot-Berechnungen.
 *
 * Der Worker bleibt aktiv, damit WebGPU-Device und Compute-Pipeline nur einmal
 * initialisiert und anschließend für mehrere Rechteckberechnungen
 * wiederverwendet werden können.
 *
 * @type {Worker|null}
 */
let mandelbrotWebGpuWorker = null;

/**
 * Fortlaufende Anfrage-ID für Nachrichten an den WebGPU-Worker.
 *
 * @type {number}
 */
let nextWebGpuRequestId = 1;

/**
 * Offene WebGPU-Anfragen, indiziert nach Anfrage-ID.
 *
 * @type {Map<number, WebGpuPendingRequest>}
 */
const pendingWebGpuRequests = new Map();

/**
 * Promise-Callbacks einer offenen WebGPU-Worker-Anfrage.
 *
 * @typedef {Object} WebGpuPendingRequest
 * @property {(value: IterationData) => void} resolve - Erfüllt die Anfrage.
 * @property {(reason?: unknown) => void} reject - Lehnt die Anfrage ab.
 */

/**
 * Nachricht vom Hauptthread an den WebGPU-Worker.
 *
 * @typedef {Object} WebGpuComputeRequestMessage
 * @property {"compute-mandelbrot-rect"} type - Nachrichtentyp.
 * @property {number} requestId - Eindeutige Anfrage-ID.
 * @property {PixelRect} rect - Zu berechnender Pixelbereich.
 * @property {number} imageWidth - Breite der vollständigen Zielmatrix in Pixeln.
 * @property {number} imageHeight - Höhe der vollständigen Zielmatrix in Pixeln.
 * @property {ComputationSettings} computationSettings - Mandelbrot-Berechnungseinstellungen.
 */

/**
 * Erfolgsantwort des WebGPU-Workers.
 *
 * @typedef {Object} WebGpuComputeSuccessMessage
 * @property {"compute-mandelbrot-rect-result"} type - Nachrichtentyp.
 * @property {number} requestId - Anfrage-ID der ursprünglichen Anfrage.
 * @property {true} ok - Kennzeichen für eine erfolgreiche Berechnung.
 * @property {IterationData} result - Berechnete Iterationsdaten für den angefragten Pixelbereich.
 */

/**
 * Fehlerantwort des WebGPU-Workers.
 *
 * @typedef {Object} WebGpuComputeErrorMessage
 * @property {"compute-mandelbrot-rect-result"} type - Nachrichtentyp.
 * @property {number} requestId - Anfrage-ID der ursprünglichen Anfrage.
 * @property {false} ok - Kennzeichen für eine fehlgeschlagene Berechnung.
 * @property {string} error - Fehlerbeschreibung.
 */

/**
 * Antwortnachricht des WebGPU-Workers.
 *
 * @typedef {WebGpuComputeSuccessMessage|WebGpuComputeErrorMessage} WebGpuComputeResponseMessage
 */

/**
 * Gibt die langlebige WebGPU-Worker-Instanz zurück.
 *
 * Der Worker wird bei der ersten Berechnungsanfrage lazy erzeugt und danach
 * wiederverwendet. Dadurch fallen Adapter-, Device-, Shader- und
 * Pipeline-Initialisierung nicht für jede Rechteckberechnung erneut an.
 *
 * @returns {Worker} Gemeinsam genutzte WebGPU-Worker-Instanz.
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
 * Verarbeitet Ergebnisnachrichten des WebGPU-Workers.
 *
 * @param {MessageEvent<WebGpuComputeResponseMessage>} event - Worker-Nachricht.
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
 * Lehnt alle offenen WebGPU-Anfragen nach einem unbehandelten Worker-Fehler ab.
 *
 * @param {ErrorEvent} event - Worker-Fehlerereignis.
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
 * Berechnet Mandelbrot-Iterationsdaten für ein Rechteck über den WebGPU-Worker.
 *
 * Diese Funktion schickt nur die Anfrage an den Worker und verwaltet die
 * zugehörige Promise. Die eigentliche WebGPU-Berechnung liegt in
 * `mandelbrot-webgpu-worker.js`.
 *
 * @param {PixelRect} rect - Zu berechnender Pixelbereich.
 * @param {number} imageWidth - Breite der vollständigen Zielmatrix in Pixeln.
 * @param {number} imageHeight - Höhe der vollständigen Zielmatrix in Pixeln.
 * @param {ComputationSettings} computationSettings - Mandelbrot-Berechnungseinstellungen.
 * @returns {Promise<IterationData>} Berechnete Iterationsdaten für den Pixelbereich.
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
