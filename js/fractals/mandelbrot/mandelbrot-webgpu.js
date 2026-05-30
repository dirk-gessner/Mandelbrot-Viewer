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
const MANDELBROT_WEBGPU_WORKER_SCRIPT = "./js/fractals/mandelbrot/mandelbrot-webgpu-worker.js";

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
 * @param {ReferenceCandidates[]|null} referenceCandidates - Optional: Referenzkandidaten fuer Perturbation.
 * @param {number} maxObservedIterations - Hoechster beobachteter Iterationswert der aktuellen Matrix.
 * @returns {Promise<IterationData>} Berechnete Iterationsdaten für den Pixelbereich.
 */
async function computeMandelbrotRectWebGpu(
    rect,
    imageWidth,
    imageHeight,
    computationSettings,
    referenceCandidates = null,
    maxObservedIterations = 0
) {
    return  await mandelbrotWebGpuClient.request({
        type: MANDELBROT_COMPUTE_REQUEST,
        rect,
        imageWidth,
        imageHeight,
        computationSettings,
        referenceCandidates,
        maxObservedIterations,
    });
}

