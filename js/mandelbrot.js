// -----------------------------------------------------------------------------
// Mandelbrot-Orchestrierung im Hauptthread
// -----------------------------------------------------------------------------
//
// Diese Datei koordiniert die Mandelbrot-Berechnung aus Sicht des Hauptthreads.
// Sie berechnet Pixel nicht selbst, sondern zerlegt Rechtecke in Teilaufgaben,
// startet Web-Worker, sammelt deren IterationData-Ergebnisse ein und führt sie
// wieder zu einer zusammenhängenden Matrix zusammen.
//
// Die eigentliche synchrone Punkt- und Rechteckberechnung liegt in
// `mandelbrot-worker.js`.
// -----------------------------------------------------------------------------

/**
 * Teilt ein Pixelrechteck horizontal in mehrere Teilrechtecke.
 *
 * Die Teilrechtecke behalten `x` und `width` des Ausgangsrechtecks.
 * Die Höhe wird möglichst gleichmäßig aufgeteilt; Restzeilen werden auf die
 * ersten Teilrechtecke verteilt.
 *
 * @param {PixelRect}       rect    - Zu teilendes Pixelrechteck.
 * @param {number}          parts   - (integer) Gewünschte Anzahl von Teilrechtecken.
 * @returns {PixelRect[]}           - Horizontale Teilrechtecke mit positiver Höhe.
 */
function splitRectHorizontally(
    rect, 
    parts
) {
    const result = [];
    
    // Notausgang, um Division durch Null zu vermeiden
    if (parts < 1) {
        result.push(rect); 
        return result; 
    }

    const baseHeight = Math.floor(rect.height / parts);
    const remainder = rect.height % parts;

    let y = rect.y;

    for (let i = 0; i < parts; i++) {
        const height = baseHeight + (i < remainder ? 1 : 0);

        if (height <= 0) {
            continue;
        }

        result.push({
            x: rect.x,
            y,
            width: rect.width,
            height
        });

        y += height;
    }

    return result;
}

/**
 * Fügt horizontal berechnete Iterationsdaten-Teile wieder zu einer Matrix zusammen.
 *
 * Die Reihenfolge der Teile muss der Reihenfolge aus `splitRectHorizontally`
 * entsprechen. Die Datenarrays werden linear hintereinander in neue Arrays
 * kopiert.
 *
 * @param {PixelRect}       rect    - Gesamtbereich, den die Teile zusammen abdecken.
 * @param {IterationData[]} parts   - Berechnete Teilmatrizen in vertikaler Reihenfolge.
 * @returns {IterationData}         - Zusammengeführte Iterationsdaten für `rect`.
 */
function mergeIterationDataParts(
    rect, 
    parts
) {
    const totalPixels = rect.width * rect.height;

    const iterations   = new Uint16Array(totalPixels);
    const escapeValues = new Float32Array(totalPixels);

    let targetOffset  = 0;
    let minIterations = Number.POSITIVE_INFINITY;

    for (const part of parts) {
        iterations.set(part.iterations, targetOffset);
        escapeValues.set(part.escapeValues, targetOffset);

        targetOffset += part.iterations.length;

        if (part.minIterations < minIterations) {
            minIterations = part.minIterations;
        }
    }

    return {
        width:  rect.width,
        height: rect.height,
        iterations,
        escapeValues,
        minIterations
    };
}

/**
 * Startet einen Web-Worker zur Berechnung eines Mandelbrot-Rechtecks.
 *
 * Für jeden Aufruf wird ein neuer Worker erzeugt und nach der Antwort wieder
 * beendet.
 *
 * @param {PixelRect}           rect                - Zu berechnender Pixelbereich.
 * @param {number}              imageWidth          - (integer) Breite der vollständigen Zielmatrix.
 * @param {number}              imageHeight         - (integer) Höhe der vollständigen Zielmatrix.
 * @param {ComputationSettings} computationSettings - Einstellungen für die Berechnung.
 * @param {number}              [workerId=0]        - (integer) Diagnose-ID für Fehlermeldungen.
 * @returns {Promise<IterationData>}                - Vom Worker berechnete Iterationsdaten.
 */
function computeMandelbrotRectInWorker(
    rect,
    imageWidth,
    imageHeight,
    computationSettings, 
    workerId = 0
) {
    return new Promise((resolve, reject) => {

        const worker = new Worker("./js/mandelbrot-worker.js", {
            type: "module"
        });

        worker.onmessage = (event) => {
            worker.terminate();
            resolve(event.data);
        };

        worker.onerror = (error) => {
            console.error("Worker error", workerId, error);
            worker.terminate();
            reject(error);
        };

        worker.postMessage({
            rect,
            imageWidth,
            imageHeight,
            computationSettings
        });
    });
}

/**
 * Berechnet mehrere Mandelbrot-Teilrechtecke mit begrenzter Worker-Parallelität.
 *
 * Dies ist kein echter Worker-Pool: Für jeden Task wird über
 * `computeMandelbrotRectInWorker` ein eigener Worker erzeugt. Die Funktion
 * begrenzt nur, wie viele dieser Worker-Aufträge gleichzeitig laufen.
 *
 * Die Ergebnisreihenfolge entspricht der Reihenfolge der übergebenen Tasks.
 *
 * @param {PixelRect[]}         tasks                - Zu berechnende Teilrechtecke.
 * @param {number}              imageWidth           - (integer) Breite der vollständigen Zielmatrix.
 * @param {number}              imageHeight          - (integer) Höhe der vollständigen Zielmatrix.
 * @param {ComputationSettings} computationSettings  - Einstellungen für die Berechnung.
 * @param {number}              workerCount          - (integer) Maximale Anzahl gleichzeitig laufender Worker-Aufträge.
 * @returns {Promise<IterationData[]>}               - Berechnete Iterationsdaten je Task.
 */
async function computeTasksWithWorkerConcurrency(
    tasks,
    imageWidth,
    imageHeight,
    computationSettings,
    workerCount
) {
    const results = new Array(tasks.length);
    let nextTaskIndex = 0;

    async function runWorker(workerId) {
        while (nextTaskIndex < tasks.length) {
            const taskIndex = nextTaskIndex++;
            const rect = tasks[taskIndex];

            const result = await computeMandelbrotRectInWorker(
                rect,
                imageWidth,
                imageHeight,
                computationSettings,
                workerId
            );

            results[taskIndex] = result;
        }
    }

    const workers = [];

    for (let workerId = 0; workerId < workerCount; workerId++) {
        workers.push(runWorker(workerId));
    }

    await Promise.all(workers);

    return results;
}

/**
 * Berechnet ein Mandelbrot-Rechteck parallel über mehrere Worker-Aufträge.
 *
 * Das Rechteck wird horizontal in Teilaufgaben zerlegt. Die Teilaufgaben werden
 * mit begrenzter Worker-Parallelität berechnet und anschließend wieder zu einem
 * zusammenhängenden `IterationData`-Objekt zusammengeführt.
 *
 * @param {PixelRect}           rect                 - Zu berechnender Pixelbereich.
 * @param {number}              imageWidth           - (integer) Breite der vollständigen Zielmatrix.
 * @param {number}              imageHeight          - (integer) Höhe der vollständigen Zielmatrix.
 * @param {ComputationSettings} computationSettings  - Einstellungen für die Berechnung.
 * @param {number}              workerCount          - (integer) Maximale Anzahl gleichzeitig laufender Worker-Aufträge.
 * @returns {Promise<IterationData>}                 - Berechnete Iterationsdaten für `rect`.
 */
async function computeMandelbrotRectParallel(
    rect,
    imageWidth,
    imageHeight,
    computationSettings,
    workerCount
) {
    const tasksPerWorker = multiThreadSettings.tasksPerWorker;
    const taskCount = Math.min(rect.height, workerCount * tasksPerWorker);    
    const tasks = splitRectHorizontally(rect, taskCount);

    const startedAt = performance.now();
    console.log(
        "computeMandelbrotRectParallel (start)",
        {
            requestedWorkers: workerCount,
            tasksPerWorker: tasksPerWorker,
            actualTasks: tasks.length,
        }
    );

    const parts = await computeTasksWithWorkerConcurrency(
        tasks,
        imageWidth,
        imageHeight,
        computationSettings,
        workerCount
    );

    const iterationData = mergeIterationDataParts(rect, parts);

    const elapsed = performance.now() - startedAt;
    console.log(
        "computeMandelbrotRectParallel (done)",
        {
            elapsedMilleSeconds: elapsed,
        }
    );

    return iterationData; 
}

/**
 * Berechnet ein Mandelbrot-Rechteck mit der aktuell konfigurierten CPU-Worker-Strategie.
 *
 * Kleine Rechtecke oder eine Worker-Anzahl <= 1 werden als einzelner Worker-Auftrag
 * berechnet. Größere Rechtecke werden in mehrere Teilrechtecke zerlegt und parallel
 * über Worker-Aufträge berechnet.
 *
 * Diese Funktion bildet die zentrale Rechteck-Schnittstelle für CPU-basierte
 * Mandelbrot-Berechnungen.
 *
 * @param {PixelRect}           rect                 - Zu berechnender Pixelbereich.
 * @param {number}              imageWidth           - (integer) Breite der vollständigen Zielmatrix.
 * @param {number}              imageHeight          - (integer) Höhe der vollständigen Zielmatrix.
 * @param {ComputationSettings} computationSettings  - Einstellungen für die Berechnung.
 * @returns {Promise<IterationData>}                 - Berechnete Iterationsdaten für `rect`.
 */
async function computeMandelbrotRect(
    rect,
    imageWidth,
    imageHeight,
    computationSettings
) {
    const workerCount = multiThreadSettings.workerCount;

    if (workerCount <= 1 || rect.width * rect.height < 10000) {
        return computeMandelbrotRectInWorker(
            rect,
            imageWidth,
            imageHeight,
            computationSettings
        );
    }

    return computeMandelbrotRectParallel(
        rect,
        imageWidth,
        imageHeight,
        computationSettings,
        workerCount
    );
}

/**
 * Berechnet die Mandelbrot-Iterationsdaten für eine vollständige Bildfläche.
 *
 * Die Funktion ist ein Convenience-Wrapper um `computeMandelbrotRect` und erzeugt
 * dafür ein Rechteck über die gesamte Zielmatrix.
 *
 * @param {number}              width                - (integer) Breite der Zielmatrix.
 * @param {number}              height               - (integer) Höhe der Zielmatrix.
 * @param {ComputationSettings} computationSettings  - Einstellungen für die Berechnung.
 * @returns {Promise<IterationData>}                 - Berechnete Iterationsdaten für die vollständige Bildfläche.
 */
async function computeMandelbrot(
    width, 
    height, 
    computationSettings
) {
    return await computeMandelbrotRect(
        { x: 0, y: 0, width, height },
        width,
        height,
        computationSettings
    );
}

