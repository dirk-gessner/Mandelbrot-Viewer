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
        webGpuWorkerContextPromise = initializeWebGpuWorkerContext();
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
 * @param {WebGpuComputeRequestMessage} message - Eingehende Berechnungsanfrage.
 * @returns {void}
 */
function handleComputeMandelbrotRectMessage(
    message
) {
    /* this line causes Error */
    // await getWebGpuWorkerContext(); 
    /* this line works */
    getWebGpuWorkerContext();

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
self.onmessage = (event) => {
    const message = event.data;

    try {
        console.log("Mandelbrot WebGPU worker received message", message);

        if (message.type !== "compute-mandelbrot-rect") {
            throw new Error(`Unsupported WebGPU worker message type: ${message.type}`);
        }

        /* this line causes Error */
        // await handleComputeMandelbrotRectMessage(message); 
        /* this line works */
        handleComputeMandelbrotRectMessage(message);

    } catch (error) {
        console.error("Mandelbrot WebGPU worker request failed", error);
        postErrorResponse(message?.requestId ?? -1, error);
    }
};