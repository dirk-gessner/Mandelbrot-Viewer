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
 * Die Funktion berechnet noch kein Mandelbrot-Fraktal. Sie erzeugt lediglich
 * Daten im korrekten Format, damit die Worker-Kommunikation und spätere
 * Integration unabhängig von WebGPU getestet werden können.
 *
 * @param {PixelRect} rect - Zu berechnender Pixelbereich.
 * @returns {IterationData} Dummy-Iterationsdaten für das Rechteck.
 */
function createDummyIterationData(rect) {
  const pixelCount = rect.width * rect.height;
  const iterations = new Uint16Array(pixelCount);
  const escapeValues = new Float32Array(pixelCount);

  for (let index = 0; index < pixelCount; index++) {
    iterations[index] = index % 256;
    escapeValues[index] = 0;
  }

  return {
    width: rect.width,
    height: rect.height,
    iterations,
    escapeValues,
    minIterations: 0,
  };
}

/**
 * Behandelt eine Berechnungsanfrage an den Dummy-WebGPU-Worker.
 *
 * @param {WebGpuComputeRequestMessage} message - Eingehende Berechnungsanfrage.
 * @returns {void}
 */
function handleComputeMandelbrotRectMessage(message) {
  const result = createDummyIterationData(message.rect);

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