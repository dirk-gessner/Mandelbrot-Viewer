// -----------------------------------------------------------------------------
// Mandelbrot-Orchestrierung im Hauptthread
// -----------------------------------------------------------------------------
//
// Diese Datei koordiniert die Mandelbrot-Berechnung aus Sicht des Hauptthreads.
// Sie berechnet Pixel nicht selbst, sondern entscheidet zwischen WebGPU- und
// CPU-Backend, zerlegt CPU-Rechtecke in Teilaufgaben, startet Web-Worker,
// sammelt deren IterationData-Ergebnisse ein und führt sie wieder zu einer
// zusammenhängenden Matrix zusammen.
//
// Die eigentliche CPU-Berechnung liegt in `mandelbrot-cpu-worker.js`; die
// WebGPU-Berechnung wird über `mandelbrot-webgpu.js` an den WebGPU-Worker
// delegiert.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Konstanten und globale Einstellungen
// -----------------------------------------------------------------------------

/**
 * Kleinste Pixelgröße in der komplexen Ebene, ab der das f32-WebGPU-Backend
 * noch verwendet wird.
 *
 * Unterhalb dieser Grenze wird auf das CPU-Backend ausgewichen, weil dessen
 * JavaScript-number-Arithmetik für tiefe Zoomstufen mehr Präzision bietet.
 *
 * @type {number}
 */
const WEBGPU_MIN_PIXEL_SIZE = 1e-7;

/**
 * Aktiviert oder deaktiviert das WebGPU-Backend global.
 *
 * Wenn diese Option deaktiviert ist, verwendet die zentrale Berechnungsfassade
 * immer den CPU-Pfad, unabhängig von der aktuellen Zoomstufe.
 *
 * @type {boolean}
 */
const USE_WEBGPU_BACKEND = true;

/**
 * Pfad zum CPU-Worker-Skript für Mandelbrot-Rechteckberechnungen.
 *
 * @type {string}
 */
const MANDELBROT_CPU_WORKER_SCRIPT = "./js/fractals/mandelbrot/mandelbrot-cpu-worker.js";

/**
 * Maximale Anzahl von Referenzkandidaten, die gesammelt und für Perturbationsberechnungen
 * noch verwendet wird.
 *
 * @type {number}
 */
const MANDELBROT_REFERENCE_CANDIDATE_LIMIT = 64;

/**
 * Maximalwerte für die Iterationen bei der Ermittlung der Referenz-Orbits.
 * 
 * @type {number}
 */
const MANDELBROT_REFERENCE_ORBIT_ITERATIONS = 50000;
const MANDELBROT_REFERENCE_ORBIT_ESCAPE_RADIUS = 1256;

// -----------------------------------------------------------------------------
// Funktionen
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
        minIterations,
        referenceCandidates: [], 
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
function computeMandelbrotRectInCpuWorker(
    rect,
    imageWidth,
    imageHeight,
    computationSettings, 
    workerId = 0
) {
    return new Promise((resolve, reject) => {

        const worker = new Worker(MANDELBROT_CPU_WORKER_SCRIPT, {
            type: "module"
        });

        worker.onmessage = (event) => {
            worker.terminate();
            const result = event.data;
            resolve(result);
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
 * `computeMandelbrotRectInCpuWorker` ein eigener Worker erzeugt. Die Funktion
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
async function computeTasksWithCpuWorkerConcurrency(
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

            const result = await computeMandelbrotRectInCpuWorker(
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
async function computeMandelbrotRectCpuParallel(
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
        "computeMandelbrotRectCpuParallel (start)",
        {
            requestedWorkers: workerCount,
            tasksPerWorker: tasksPerWorker,
            actualTasks: tasks.length,
        }
    );

    const parts = await computeTasksWithCpuWorkerConcurrency(
        tasks,
        imageWidth,
        imageHeight,
        computationSettings,
        workerCount
    );

    const iterationData = mergeIterationDataParts(rect, parts);

    const elapsed = performance.now() - startedAt;
    console.log(
        "computeMandelbrotRectCpuParallel (done)",
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
async function computeMandelbrotRectCpu(
    rect,
    imageWidth,
    imageHeight,
    computationSettings
) {
    const workerCount = multiThreadSettings.workerCount;

    if (workerCount <= 1 || rect.width * rect.height < 10000) {
        return computeMandelbrotRectInCpuWorker(
            rect,
            imageWidth,
            imageHeight,
            computationSettings
        );
    }

    return computeMandelbrotRectCpuParallel(
        rect,
        imageWidth,
        imageHeight,
        computationSettings,
        workerCount
    );
}

/**
 * Prueft, ob die aktuelle Ansicht noch sinnvoll mit dem klassischen f32-WebGPU-
 * Shader berechnet werden kann.
 *
 * Unterhalb der Grenz-Pixelgroesse reicht die f32-Praezision nicht mehr aus,
 * um benachbarte Pixel sauber auf unterschiedliche komplexe Koordinaten
 * abzubilden. In diesem Fall sollte der Perturbation-Shader verwendet werden.
 *
 * @param {View}    view        - Aktueller Ausschnitt der komplexen Ebene.
 * @param {number}  imageWidth  - (integer) Breite der vollständigen Zielmatrix.
 * @param {number}  imageHeight - (integer) Höhe der vollständigen Zielmatrix.
 * @returns {boolean}           - true, wenn WebGPU für diese Ansicht verwendet werden soll.
 */
function canUseStandardWebGpuShaderForView(view, imageWidth, imageHeight) {
    const pixelWidth = Math.abs(view.maxX - view.minX) / imageWidth;
    const pixelHeight = Math.abs(view.maxY - view.minY) / imageHeight;

    return Math.min(pixelWidth, pixelHeight) > WEBGPU_MIN_PIXEL_SIZE;
}

/**
 * Berechnet die Mandelbrot-Iterationsdaten für ein Rechteck.
 *
 * Diese Funktion ist die zentrale Fassade für die Rechteckberechnung. Sie
 * entscheidet zwischen WebGPU-Backend und CPU-Backend. Bei zu tiefen
 * Zoomstufen wird direkt der CPU-Pfad verwendet, weil die aktuelle
 * WebGPU-Implementierung mit f32 arbeitet.
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
    const useStandardWebGpuShader = (
            USE_WEBGPU_BACKEND && canUseStandardWebGpuShaderForView(
                computationSettings.view,
                imageWidth,
                imageHeight
            )
        );
    const usePerturbationWebGpuShader = ( 
            USE_WEBGPU_BACKEND && !useStandardWebGpuShader 
        ); 
        
    if (useStandardWebGpuShader) {
        try {
            runtimeStats.lastComputationBackend = COMPUTATION_BACKEND_WEBGPU;
            return await computeMandelbrotRectWebGpu(
                rect,
                imageWidth,
                imageHeight,
                computationSettings
            );
        } catch (error) {
            console.warn(
                "WebGPU Mandelbrot backend failed. Falling back to CPU backend.",
                error
            );
        }
    } else if (usePerturbationWebGpuShader) {

        console.warn(
            "Resolution limits for Standard WebGPU (Float32) reached. Switching to Perturbation WebGPU backend."
        );

        const referenceOrbit = selectMandelbrotPerturbationReferenceOrbit(
            iterationData?.referenceCandidates,
            computationSettings.view,
            computationSettings.maxIterations
        );

        if (referenceOrbit) {
            try {
                runtimeStats.lastComputationBackend =
                    `${COMPUTATION_BACKEND_WEBGPU} perturbation`;

                return await computeMandelbrotRectWebGpu(
                    rect,
                    imageWidth,
                    imageHeight,
                    computationSettings,
                    referenceOrbit
                );
            } catch (error) {
                console.warn(
                    "WebGPU Mandelbrot perturbation backend failed. Falling back to CPU backend.",
                    error
                );
            }
        } else {
            console.warn(
                "WebGPU Mandelbrot perturbation backend can't find a suitable reference orbit. Falling back to CPU backend."
            );
        }
    }

    runtimeStats.lastComputationBackend = COMPUTATION_BACKEND_CPU;
    return computeMandelbrotRectCpu(
        rect,
        imageWidth,
        imageHeight,
        computationSettings
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


// -----------------------------------------------------------------------------
// Hilfsfunktionen für die Ermittlung der Referenzkandidaten für 
// Perturbationsberechnungen
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} MandelbrotReferenceOrbit
 * @property {ReferenceCandidate}   referenceCandidate  - Kandidat, fuer den der Orbit berechnet wurde.
 * @property {Float64Array}         zx                  - Realteile des Referenzorbits.
 * @property {Float64Array}         zy                  - Imaginaerteile des Referenzorbits.
 * @property {number}               iterations          - (integer) Anzahl berechneter Orbitpunkte.
 * @property {number}               escapeIteration     - (integer) Erste Escape-Iteration oder -1, wenn kein Escape erreicht wurde.
 * @property {number}               escapeValue         - (decimal) Quadratischer Betrag am Ende der Berechnung.
 */

/**
 * Berechnet den Referenzorbit für einen gegebenen Kandidaten.
 * 
 * @param {ReferenceCandidate} referenceCandidate   - Kandidat, für den der Referenzorbit berechnet werden soll.
 * @param {number} maxIterations                    - (integer) Maximale Anzahl von Iterationen für die Berechnung des Orbits.
 * @param {number} escapeRadius                     - (decimal) Radius, bei dem ein Orbit als "escaped" gilt.   
 * @returns {MandelbrotReferenceOrbit}              - Berechneter Referenzorbit mit zugehörigen Informationen.     
 */
function computeMandelbrotReferenceOrbit(
    referenceCandidate,
    maxIterations = MANDELBROT_REFERENCE_ORBIT_ITERATIONS,
    escapeRadius  = MANDELBROT_REFERENCE_ORBIT_ESCAPE_RADIUS
) {
    const zx = new Float64Array(maxIterations + 1);
    const zy = new Float64Array(maxIterations + 1);

    const cx = referenceCandidate.cx;
    const cy = referenceCandidate.cy;
    const escapeRadiusSquared = escapeRadius * escapeRadius;

    let escapeIteration = -1;
    let escapeValue = 0;
    let iteration = 0;

    zx[0] = 0;
    zy[0] = 0;

    for (iteration = 0; iteration < maxIterations; iteration++) {
        const currentZx = zx[iteration];
        const currentZy = zy[iteration];

        escapeValue = currentZx * currentZx + currentZy * currentZy;

        if (escapeValue >= escapeRadiusSquared) {
            escapeIteration = iteration;
            break;
        }

        const nextZx = currentZx * currentZx - currentZy * currentZy + cx;
        const nextZy = 2 * currentZx * currentZy + cy;

        zx[iteration + 1] = nextZx;
        zy[iteration + 1] = nextZy;
    }

    const computedIterations = escapeIteration >= 0
        ? escapeIteration
        : maxIterations;

    if (escapeIteration < 0) {
        const finalZx = zx[computedIterations];
        const finalZy = zy[computedIterations];
        escapeValue = finalZx * finalZx + finalZy * finalZy;
    }

    return {
        referenceCandidate,
        zx: zx.slice(0, computedIterations + 1),
        zy: zy.slice(0, computedIterations + 1),
        iterations: computedIterations,
        escapeIteration,
        escapeValue,
    };
}

/**
 * Vergleicht zwei Referenzkandidaten nach ihrer allgemeinen Qualitaet.
 *
 * Kandidaten mit hoeherem Iterationswert werden bevorzugt. Bei gleichem
 * Iterationswert gewinnt der Kandidat mit kleinerem Escape-Wert, weil sein
 * Orbit zum Abbruchzeitpunkt weniger stark divergiert ist.
 *
 * Die Funktion ist als Sortier-Callback fuer `Array.prototype.sort` gedacht.
 * Ein negativer Rueckgabewert bedeutet, dass `a` vor `b` einsortiert wird.
 *
 * @param {ReferenceCandidate} a - Erster Referenzkandidat.
 * @param {ReferenceCandidate} b - Zweiter Referenzkandidat.
 * @returns {number} Sortierwert fuer absteigende Kandidatenqualitaet.
 */
function compareReferenceCandidates(a, b) {
    if (b.iterations !== a.iterations) {
        return b.iterations - a.iterations;
    }

    return a.escapeValue - b.escapeValue;
}

/**
 * Ermittelt die besten Referenzkandidaten aus berechneten Iterations- und
 * Escape-Wert-Arrays.
 *
 * Die Funktion arbeitet auf einem Teilrechteck `rect`, gibt die Pixelpositionen
 * aber immer bezogen auf die vollstaendige Zielmatrix zurueck. Dadurch koennen
 * Kandidaten aus Teilberechnungen spaeter direkt zusammengefuehrt werden.
 *
 * Die komplexen Koordinaten werden mit derselben linearen Abbildung bestimmt,
 * die auch die CPU-Berechnung verwendet:
 *
 *   cx = minX + pixelX / imageWidth  * (maxX - minX)
 *   cy = minY + pixelY / imageHeight * (maxY - minY)
 * 
 * @param {PixelRect}        rect          - Berechneter Pixelbereich innerhalb der Zielmatrix.
 * @param {number}           imageWidth    - (integer) Breite der vollstaendigen Zielmatrix.
 * @param {number}           imageHeight   - (integer) Hoehe der vollstaendigen Zielmatrix.
 * @param {View}             view          - Ausschnitt der komplexen Ebene.
 * @param {IterationArray}   iterations    - Iterationswerte fuer `rect`.
 * @param {EscapeValueArray} escapeValues  - Escape-Werte fuer `rect`.
 * @param {number}           maxIterations - (integer) aktueller Wert für Iterationsabbruch ohne Divergenz
 * @param {number}           [limit=MANDELBROT_REFERENCE_CANDIDATE_LIMIT] - (integer) Maximale Anzahl Kandidaten.
 * @returns {ReferenceCandidate[]} Beste Kandidaten aus dem uebergebenen Rechteck.
 */
function collectReferenceCandidatesFromArrays(
    rect,
    imageWidth, imageHeight,
    view,
    iterations,
    escapeValues,
    maxIterations, 
    limit = MANDELBROT_REFERENCE_CANDIDATE_LIMIT
) {
    const gridColumns = 8;
    const gridRows = 8;
    const candidatesByCell = new Array(gridColumns * gridRows).fill(null);
    const { minX, maxX, minY, maxY } = view;

    for (let localY = 0; localY < rect.height; localY++) {
        for (let localX = 0; localX < rect.width; localX++) {
            const index = localY * rect.width + localX;
            const pixelX = rect.x + localX;
            const pixelY = rect.y + localY;

            const candidate = {
                pixelX,
                pixelY,
                cx: minX + (pixelX / imageWidth) * (maxX - minX),
                cy: minY + (pixelY / imageHeight) * (maxY - minY),
                iterations: iterations[index],
                escapeValue: escapeValues[index],
            };

            const cellX = Math.min(
                gridColumns - 1,
                Math.floor((pixelX / imageWidth) * gridColumns)
            );

            const cellY = Math.min(
                gridRows - 1,
                Math.floor((pixelY / imageHeight) * gridRows)
            );

            const cellIndex = cellY * gridColumns + cellX;
            const currentCandidate = candidatesByCell[cellIndex];
            const candidateReachedMax = candidate.iterations >= maxIterations;

            if  ( candidateReachedMax&&
                    ( !currentCandidate ||
                      compareReferenceCandidates(candidate, currentCandidate) < 0)) 
            {
                candidatesByCell[cellIndex] = candidate;
            }
        }
    }

    return candidatesByCell
        .filter(candidate => candidate !== null)
        .sort(compareReferenceCandidates)
        .slice(0, limit);
}

/**
 * Ermittelt die Referenzkandidaten einer vollstaendigen Iterationsmatrix neu.
 *
 * Die Funktion sammelt Kandidaten aus den kompletten `iterations`- und
 * `escapeValues`-Arrays. Das ist sinnvoll, wenn eine Matrix aus kopierten und
 * neu berechneten Bereichen zusammengesetzt wurde, z.B. nach Pan- oder
 * Resize-Operationen. Dadurch werden die Kandidaten wieder passend zur gesamten
 * aktuellen Zielmatrix verteilt.
 *
 * Das uebergebene `iterationData`-Objekt wird nicht veraendert.
 *
 * @param {IterationData} iterationData - Vollstaendige Iterationsmatrix, fuer die Kandidaten ermittelt werden sollen.
 * @param {View}          view          - Zur Iterationsmatrix gehoerender Ausschnitt der komplexen Ebene.
 * @param {number}        maxIterations - (integer) aktueller Wert für Iterationsabbruch ohne Divergenz
 * @returns {ReferenceCandidate[]} Neu ermittelte Referenzkandidaten.
 */
function refreshReferenceCandidates(
    iterationData,
    view, 
    maxIterations
) {
    return collectReferenceCandidatesFromArrays(
        { x: 0, y: 0, width: iterationData.width, height: iterationData.height },
        iterationData.width,
        iterationData.height,
        view,
        iterationData.iterations,
        iterationData.escapeValues, 
        maxIterations, 
    );
}


/**
 * Sortiert Referenzkandidaten nach ihrer Eignung fuer eine Ziel-View.
 *
 * Die Sortierung bevorzugt Kandidaten innerhalb der Ziel-View. Innerhalb der
 * View zaehlt zuerst die Orbit-Qualitaet, ausserhalb zuerst die Naehe zur
 * View-Mitte.
 *
 * @param {ReferenceCandidate[]} referenceCandidates - Verfuegbare Referenzkandidaten.
 * @param {View} view - Ziel-View, fuer die Referenzpunkte gesucht werden.
 * @returns {ReferenceCandidate[]} Sortierte Kandidatenliste, bester Kandidat zuerst.
 */
function sortReferenceCandidatesForView(
    referenceCandidates,
    view
) {
    if (!referenceCandidates || referenceCandidates.length === 0) {
        return [];
    }

    const centerX = (view.minX + view.maxX) / 2;
    const centerY = (view.minY + view.maxY) / 2;

    const viewWidth = Math.abs(view.maxX - view.minX);
    const viewHeight = Math.abs(view.maxY - view.minY);

    // Absicherung gegen entartete Views, damit die Distanzbewertung nicht durch
    // Division durch 0 oder extrem kleine Werte instabil wird.
    const safeViewWidth = Math.max(viewWidth, Number.EPSILON);
    const safeViewHeight = Math.max(viewHeight, Number.EPSILON);

    function isCandidateInsideView(candidate) {
        return candidate.cx >= Math.min(view.minX, view.maxX) &&
               candidate.cx <= Math.max(view.minX, view.maxX) &&
               candidate.cy >= Math.min(view.minY, view.maxY) &&
               candidate.cy <= Math.max(view.minY, view.maxY);
    }

    function getNormalizedDistanceToViewCenter(candidate) {
        const normalizedDx = (candidate.cx - centerX) / safeViewWidth;
        const normalizedDy = (candidate.cy - centerY) / safeViewHeight;

        return Math.sqrt(
            normalizedDx * normalizedDx +
            normalizedDy * normalizedDy
        );
    }

    function compareCandidates(a, b) {
        const aInside = isCandidateInsideView(a);
        const bInside = isCandidateInsideView(b);

        if (aInside !== bInside) {
            return aInside ? -1 : 1;
        }

        const aDistance = getNormalizedDistanceToViewCenter(a);
        const bDistance = getNormalizedDistanceToViewCenter(b);

        // Innerhalb der Ziel-View ist die Orbit-Qualitaet wichtiger als die
        // exakte Lage. Ausserhalb der Ziel-View ist Naehe wichtiger, weil der
        // Kandidat sonst als Referenzpunkt fuer diese View wenig hilfreich ist.
        if (aInside && bInside) {
            if (a.iterations !== b.iterations) {
                return b.iterations - a.iterations;
            }

            if (aDistance !== bDistance) {
                return aDistance - bDistance;
            }
        } else {
            if (aDistance !== bDistance) {
                return aDistance - bDistance;
            }

            if (a.iterations !== b.iterations) {
                return b.iterations - a.iterations;
            }
        }

        return a.escapeValue - b.escapeValue;
    }

    return [...referenceCandidates].sort(compareCandidates);
}

/**
 * Waehlt den besten Referenzkandidaten fuer eine Ziel-View aus.
 *
 * @param {ReferenceCandidate[]} referenceCandidates - Verfuegbare Referenzkandidaten.
 * @param {View} view - Ziel-View, fuer die ein Referenzpunkt gesucht wird.
 * @returns {?ReferenceCandidate} Bester Kandidat oder null.
 */
function selectReferenceCandidateForView(
    referenceCandidates,
    view
) {
    return sortReferenceCandidatesForView(referenceCandidates, view)[0] ?? null;
}

/**
 * Ermittelt einen fuer Perturbation brauchbaren Referenzorbit.
 *
 * Die Funktion probiert die nach Ziel-View sortierten Kandidaten der Reihe nach.
 * Kandidaten, die in der bisherigen Berechnung bereits vor `maxIterations`
 * escaped sind, werden uebersprungen, weil ihr Orbit sehr wahrscheinlich nicht
 * lang genug fuer stabile Perturbation ist.
 *
 * Nach der Orbitberechnung wird zusaetzlich geprueft, ob der Referenzorbit
 * mindestens bis zur aktuell benoetigten Iterationstiefe reicht.
 *
 * @param {ReferenceCandidate[]} referenceCandidates - Verfuegbare Referenzkandidaten.
 * @param {View} view - Ziel-View, fuer die ein Referenzorbit gesucht wird.
 * @param {number} maxIterations - (integer) Benoetigte Iterationstiefe fuer das aktuelle Rendering.
 * @returns {?MandelbrotReferenceOrbit} Brauchbarer Referenzorbit oder null.
 */
function selectMandelbrotPerturbationReferenceOrbit(
    referenceCandidates,
    view,
    maxIterations
) {
    const candidates = sortReferenceCandidatesForView(referenceCandidates, view)
        .filter(candidate => candidate.iterations >= maxIterations);

    for (const candidate of candidates) {
        const referenceOrbit = computeMandelbrotReferenceOrbit(candidate);

        if (referenceOrbit.escapeIteration < 0) {
            return referenceOrbit;
        }
    }

    return null;
}

/**
 * Ergaenzt Mandelbrot-spezifische Metadaten fuer eine fertige Iterationsmatrix.
 *
 * Aktuell werden Referenzkandidaten fuer spaetere Perturbationsberechnungen aus
 * der vollstaendigen Matrix ermittelt.
 *
 * @param {IterationData} iterationData - Fertige Mandelbrot-Iterationsmatrix.
 * @param {ComputationSettings} computationSettings - Mandelbrot-Berechnungseinstellungen.
 * @returns {IterationData} Iterationsmatrix mit aktualisierten Referenzkandidaten.
 */
function finalizeMandelbrot(
    iterationData,
    computationSettings
) {
    iterationData.referenceCandidates =
        refreshReferenceCandidates(
            iterationData,
            computationSettings.view, 
            computationSettings.maxIterations, 
        );

    return iterationData;
}
