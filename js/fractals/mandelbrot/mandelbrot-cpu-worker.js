// -----------------------------------------------------------------------------
// Worker-seitige Mandelbrot-Berechnung
// -----------------------------------------------------------------------------
//
// Diese Datei läuft in einem separaten Web-Worker-Kontext. Sie enthält die
// CPU-basierte, synchrone Berechnung einzelner Mandelbrot-Rechtecke.
//
// Der Hauptthread übergibt per `postMessage` ein `MandelbrotWorkerRequest`
// mit Pixelrechteck, Gesamtbildgröße und Berechnungseinstellungen. Der Worker
// berechnet daraus ein `IterationData`-Objekt und sendet es zurück.
//
// Funktionen in dieser Datei sind bewusst worker-lokal gehalten. Hilfsfunktionen
// aus den normalen Browser-Skripten, z.B. `iteration-data.js`, sind im Worker
// nicht automatisch verfügbar.
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
function workerFindMinIterations(iterations) {
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
function workerComputeMandelbrotPoint(
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
function workerComputeMandelbrotRect(
    rect, 
    imageWidth, imageHeight, 
    computationSettings
) {
    
    const { view, maxIterations, escapeRadius } = computationSettings;
    const { minX, maxX, minY, maxY } = view;

    const iterations   = new Uint16Array (rect.width * rect.height);
    const escapeValues = new Float32Array(rect.width * rect.height);

    for (let localY = 0; localY < rect.height; localY++) {
        for (let localX = 0; localX < rect.width; localX++) {
    
            const px = rect.x + localX;
            const py = rect.y + localY;

            const x = minX + (px / imageWidth)  * (maxX - minX);
            const y = minY + (py / imageHeight) * (maxY - minY);

            const result = workerComputeMandelbrotPoint(x, y, maxIterations, escapeRadius);

            const index = localY * rect.width + localX;
            iterations  [index] = result.iterations;
            escapeValues[index] = result.escapeValue;
        }
    }

    return { 
        width : rect.width, 
        height: rect.height, 
        iterations, 
        escapeValues, 
        minIterations: workerFindMinIterations(iterations),
    };
}

/**
 * Nachricht an den CPU-Mandelbrot-Worker.
 *
 * @typedef {Object} MandelbrotWorkerRequest
 * @property {PixelRect} rect
 * @property {number} imageWidth
 * @property {number} imageHeight
 * @property {ComputationSettings} computationSettings
 */

self.onmessage = (event) => {
    const {
        rect,
        imageWidth,
        imageHeight,
        computationSettings
    } = event.data;

    const result = workerComputeMandelbrotRect(
        rect,
        imageWidth,
        imageHeight,
        computationSettings
    );

    self.postMessage(result);
};