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
 * Erzeugt Dummy-Iterationsdaten für ein Rechteck.
 *
 * Die erzeugten Werte sind bewusst renderbar:
 * - Iterationswerte bleiben unterhalb von maxIterations, damit sie nicht als
 *   Punkte innerhalb der Mandelbrot-Menge interpretiert werden.
 * - Escape-Werte sind > 1, damit Smooth Coloring keine NaN-Werte erzeugt.
 *
 * @param {PixelRect} rect - Zu berechnender Pixelbereich.
 * @param {ComputationSettings} computationSettings - Einstellungen für die Berechnung.
 * @returns {IterationData} Dummy-Iterationsdaten für das Rechteck.
 */
function createDummyIterationData(rect, computationSettings) {
    const pixelCount = rect.width * rect.height;
    const iterations = new Uint16Array(pixelCount);
    const escapeValues = new Float32Array(pixelCount);

    const maxIterations = Math.max(2, computationSettings.maxIterations);
    const visibleIterationRange = maxIterations - 1;

    let minIterations = Number.POSITIVE_INFINITY;

    for (let y = 0; y < rect.height; y++) {
        for (let x = 0; x < rect.width; x++) {
            const index = y * rect.width + x;

            const iteration =
                1 + ((x + y + rect.x + rect.y) % visibleIterationRange);

            iterations[index] = iteration;

            // Wert deutlich > 1, damit Smooth Coloring stabil bleibt.
            escapeValues[index] = 16.0 + iteration;

            if (iteration < minIterations) {
                minIterations = iteration;
            }
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
 * Behandelt eine Berechnungsanfrage an den Dummy-WebGPU-Worker.
 *
 * @param {WebGpuComputeRequestMessage} message - Eingehende Berechnungsanfrage.
 * @returns {void}
 */
function handleComputeMandelbrotRectMessage(message) {
    const result = createDummyIterationData(
        message.rect,
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
self.onmessage = (event) => {
    const message = event.data;

    try {
        if (message.type !== "compute-mandelbrot-rect") {
            throw new Error(`Unsupported WebGPU worker message type: ${message.type}`);
        }

        handleComputeMandelbrotRectMessage(message);
    } catch (error) {
        postErrorResponse(message?.requestId ?? -1, error);
    }
};