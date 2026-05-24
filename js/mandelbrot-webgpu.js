/**
 * @file Hauptthread-Fassade fuer WebGPU-basierte Mandelbrot-Berechnungen.
 *
 * Dieses Modul enthaelt nur die Mandelbrot-spezifische Nachricht an den
 * WebGPU-Worker. Die generische Worker-/Promise-Verwaltung liegt in
 * `worker-rpc-client.js`.
 */

/**
 * Nachrichtentyp fuer Mandelbrot-Rechteckberechnungen.
 *
 * @type {string}
 */
const MANDELBROT_COMPUTE_REQUEST = "compute-mandelbrot-rect";

/**
 * Pfad zum Worker-Skript mit der eigentlichen WebGPU-Implementierung.
 *
 * @type {string}
 */
const MANDELBROT_WEBGPU_WORKER_SCRIPT = "./js/mandelbrot-webgpu-worker.js";

/**
 * Promise-basierter Client fuer den Mandelbrot-WebGPU-Worker.
 *
 * @type {{ request(message: Object): Promise<*>, terminate(): void }}
 */
const mandelbrotWebGpuClient = createWorkerRpcClient(
    MANDELBROT_WEBGPU_WORKER_SCRIPT
);

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
    return mandelbrotWebGpuClient.request({
        type: MANDELBROT_COMPUTE_REQUEST,
        rect,
        imageWidth,
        imageHeight,
        computationSettings,
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
