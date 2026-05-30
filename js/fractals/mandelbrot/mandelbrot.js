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
const MANDELBROT_REFERENCE_CANDIDATE_LIMIT = 324;
const MANDELBROT_REFERENCE_CANDIDATES_PER_CELL = 4;

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
    let maxObservedIterations = 0;

    for (const part of parts) {
        iterations.set(part.iterations, targetOffset);
        escapeValues.set(part.escapeValues, targetOffset);

        targetOffset += part.iterations.length;

        if (part.minIterations < minIterations) {
            minIterations = part.minIterations;
        }
        if (part.maxObservedIterations > maxObservedIterations) {
            maxObservedIterations = part.maxObservedIterations;
        }
    }

    return {
        width:  rect.width,
        height: rect.height,
        iterations,
        escapeValues,
        minIterations,
        maxObservedIterations, 
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

const MANDELBROT_PERTURBATION_MAX_SMALL_ORBIT_RATIO = 0.001;
const MANDELBROT_PERTURBATION_MAX_DELTA_TOO_LARGE_RATIO = 0.01;

/**
 * Bewertet, ob ein Perturbation-Ergebnis mit dem verwendeten Referenzorbit
 * noch als brauchbar akzeptiert werden soll.
 *
 * Ergebnisse ohne `perturbationStats` oder mit `pixelCount === 0` gelten als
 * akzeptabel, weil sie nicht aus dem Perturbation-Diagnosepfad stammen oder
 * keine Pixel enthalten.
 *
 * Harte Fehler (`referenceEndedCount` und `nonFiniteCount`) werden nicht
 * toleriert. Glitch-Verdacht durch kleine Orbits und zu grosse Delta-Orbits
 * darf nur bis zu den konfigurierten Anteilsgrenzen auftreten.
 *
 * Die Funktion korrigiert keine fehlerhaften Pixel. Sie entscheidet nur, ob das
 * komplette Ergebnis verwendet oder der naechste Referenzkandidat versucht wird.
 * 
 * @param {IterationData} result    - Ergebnis einer Perturbation-Berechnung inklusive optionaler `perturbationStats`.
 * @returns {boolean}               - `true`, wenn das Ergebnis akzeptiert werden soll, sonst `false`.
 */
function isAcceptablePerturbationResult(
    result
) {
    const stats = result.perturbationStats;

    if (!stats || stats.pixelCount === 0) {
        return true;
    }

    const hardInvalidCount =
        stats.referenceEndedCount + stats.nonFiniteCount;

    const smallOrbitRatio =
        stats.smallOrbitCount / stats.pixelCount;

    const deltaTooLargeRatio =
        stats.deltaTooLargeCount / stats.pixelCount;

    const acceptable =
        hardInvalidCount === 0 &&
        smallOrbitRatio <= MANDELBROT_PERTURBATION_MAX_SMALL_ORBIT_RATIO &&
        deltaTooLargeRatio <= MANDELBROT_PERTURBATION_MAX_DELTA_TOO_LARGE_RATIO;

    console.info("ReferenceCandidate", {
        acceptable,
        pixel: stats.pixelCount,
        smallOrbit: stats.smallOrbitCount,
        smallOrbitRatio,
        deltaTooLarge: stats.deltaTooLargeCount,
        deltaTooLargeRatio,
        referenceEnded: stats.referenceEndedCount,
        nonFinite: stats.nonFiniteCount,
    });

    return acceptable;
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

    const standardWebGpuIsPreciseEnough =
        canUseStandardWebGpuShaderForView(
            computationSettings.view,
            imageWidth,
            imageHeight
        );

    const useStandardWebGpu =
        mandelbrotBackendSettings.useWebGpu;

    const usePerturbation =
        mandelbrotBackendSettings.useWebGpu &&
        mandelbrotBackendSettings.usePerturbation;

    const useCpu =
        !mandelbrotBackendSettings.useWebGpu ||
        mandelbrotBackendSettings.useCpu;

    if (useStandardWebGpu) {

        if (standardWebGpuIsPreciseEnough ||
            (!usePerturbation && !useCpu)) {
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
                    "WebGPU Mandelbrot backend failed.",
                    error
                );

                if (!useCpu) { throw error };

                console.warn("Falling back to CPU backend.");
            }

        } else if (usePerturbation) {

            console.warn(
                "Resolution limits for Standard WebGPU (Float32) reached. Switching to Perturbation WebGPU backend."
            );

            try {
                const candidates = sortMandelbrotPerturbationReferenceCandidates(
                    iterationData?.referenceCandidates,
                    rect,
                    computationSettings.iterationLimit,
                );              

                for (const candidate of candidates) {
                    const referenceOrbit = computeMandelbrotReferenceOrbit(candidate);

                    const requiredIterations =
                        getRequiredReferenceOrbitIterations(
                            candidate,
                            computationSettings.iterationLimit,
                            iterationData?.maxObservedIterations ?? 0
                        );

                    if (referenceOrbit.iterations < requiredIterations) {
                        console.warn("Perturbation reference orbit rejected", {
                            candidate,
                            referenceOrbitIterations: referenceOrbit.iterations,
                            requiredIterations,
                        });
                        continue;
                    }

                    const result = await computeMandelbrotRectWebGpu(
                        rect,
                        imageWidth,
                        imageHeight,
                        computationSettings,
                        referenceOrbit
                    );

                    if (!isAcceptablePerturbationResult(result)) {
                        console.warn("Perturbation reference orbit rejected", {
                            candidate,
                            referenceOrbitIterations: referenceOrbit.iterations,
                            requiredIterations,
                            perturbationStats: result.perturbationStats, 
                        });
                        continue;
                    }

                    if (result.perturbationStats.invalidCount !== 0 ) {

                        console.info("Perturbation reference orbit accepted with minor invalid pixels.", {
                            perturbationStats: result.perturbationStats,
                        }); 
                    } else {

                        console.info("Perturbation reference orbit accepted.", {
                            perturbationStats: result.perturbationStats,
                        }); 
                    }

                    runtimeStats.lastComputationBackend =
                        `${COMPUTATION_BACKEND_WEBGPU} perturbation`;
                    return result;
                }   

                console.warn("No suitable reference candidates found. Falling back to CPU backend.");

            } catch (error) {

                console.warn("WebGPU Mandelbrot perturbation backend failed.", error); 

                if (!useCpu) { 
                    throw error; 
                };

                console.warn("Falling back to CPU backend.");
            }
        }
    }

    if (useCpu) {
        runtimeStats.lastComputationBackend = COMPUTATION_BACKEND_CPU;
        return computeMandelbrotRectCpu(
            rect,
            imageWidth,
            imageHeight,
            computationSettings
        );
    }

    throw new Error("No enabled Mandelbrot backend can compute the current view.");
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
 * @param {number} iterationLimit                    - (integer) Maximale Anzahl von Iterationen für die Berechnung des Orbits.
 * @param {number} escapeRadius                     - (decimal) Radius, bei dem ein Orbit als "escaped" gilt.   
 * @returns {MandelbrotReferenceOrbit}              - Berechneter Referenzorbit mit zugehörigen Informationen.     
 */
function computeMandelbrotReferenceOrbit(
    referenceCandidate,
    iterationLimit = MANDELBROT_REFERENCE_ORBIT_ITERATIONS,
    escapeRadius  = MANDELBROT_REFERENCE_ORBIT_ESCAPE_RADIUS
) {
    const zx = new Float64Array(iterationLimit + 1);
    const zy = new Float64Array(iterationLimit + 1);

    const cx = referenceCandidate.cx;
    const cy = referenceCandidate.cy;
    const escapeRadiusSquared = escapeRadius * escapeRadius;

    let escapeIteration = -1;
    let escapeValue = 0;
    let iteration = 0;

    zx[0] = 0;
    zy[0] = 0;

    for (iteration = 0; iteration < iterationLimit; iteration++) {
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
        : iterationLimit;

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
 * @param {number}           [limit=MANDELBROT_REFERENCE_CANDIDATE_LIMIT] - (integer) Maximale Anzahl Kandidaten.
 * @returns {ReferenceCandidate[]} Beste Kandidaten aus dem uebergebenen Rechteck.
 */
function collectReferenceCandidatesFromArrays(
    rect,
    imageWidth, imageHeight,
    view,
    iterations,
    escapeValues,
    limit = MANDELBROT_REFERENCE_CANDIDATE_LIMIT
) {
    const gridColumns = 9;
    const gridRows = 9;
    const cellCount = gridColumns * gridRows;

    const cellWidth = imageWidth / gridColumns;
    const cellHeight = imageHeight / gridRows;
    const minCandidateDistance = Math.min(cellWidth, cellHeight) * 0.25;
    const minCandidateDistanceSquared = minCandidateDistance * minCandidateDistance;

    const candidatesByCell = Array.from(
        { length: cellCount },
        () => []
    );
    const cellMaxObservedIterations = new Uint32Array(cellCount);

    const { minX, maxX, minY, maxY } = view;

    function getCellPosition(pixelX, pixelY) {
        const cellX = Math.min(
            gridColumns - 1,
            Math.floor((pixelX / imageWidth) * gridColumns)
        );

        const cellY = Math.min(
            gridRows - 1,
            Math.floor((pixelY / imageHeight) * gridRows)
        );

        return { cellX, cellY, cellIndex: cellY * gridColumns + cellX };
    }

    function getDistanceSquared(ax, ay, bx, by) {
        const dx = ax - bx;
        const dy = ay - by;

        return dx * dx + dy * dy;
    }    

    function getDistanceToCellCenterSquared(pixelX, pixelY, cellX, cellY) {
        const cellCenterX = ((cellX + 0.5) / gridColumns) * imageWidth;
        const cellCenterY = ((cellY + 0.5) / gridRows) * imageHeight;

        return getDistanceSquared(
            pixelX,
            pixelY,
            cellCenterX,
            cellCenterY
        );
    }

    function isFarEnoughFromSelectedCandidates(candidate, selectedCandidates) {
        for (const selectedCandidate of selectedCandidates) {
            const distanceSquared = getDistanceSquared(
                candidate.pixelX,
                candidate.pixelY,
                selectedCandidate.pixelX,
                selectedCandidate.pixelY
            );

            if (distanceSquared < minCandidateDistanceSquared) {
                return false;
            }
        }

        return true;
    }

    function compareCellCandidates(a, b) {
        if (a.iterations !== b.iterations) {
            return b.iterations - a.iterations;
        }

        if (a.distanceToCellCenterSquared !== b.distanceToCellCenterSquared) {
            return a.distanceToCellCenterSquared - b.distanceToCellCenterSquared;
        }

        return a.escapeValue - b.escapeValue;
    }

    // Erster Durchlauf:
    // Fuer jede Rasterzelle den lokalen Maximalwert der Iterationen bestimmen.
    // Dadurch koennen spaeter auch Views ohne sichtbare Innenmenge brauchbare
    // Kandidaten liefern.
    for (let localY = 0; localY < rect.height; localY++) {
        for (let localX = 0; localX < rect.width; localX++) {
            const index = localY * rect.width + localX;
            const pixelX = rect.x + localX;
            const pixelY = rect.y + localY;
            const { cellIndex } = getCellPosition(pixelX, pixelY);

            if (iterations[index] > cellMaxObservedIterations[cellIndex]) {
                cellMaxObservedIterations[cellIndex] = iterations[index];
            }
        }
    }

    // Zweiter Durchlauf:
    // Pro Zelle einen repraesentativen Kandidaten nahe am lokalen Maximum suchen.
    // Unter aehnlich interessanten Punkten gewinnt derjenige, der naeher an der
    // Zellmitte liegt. Das reduziert den Bias zur Eintrittskante der Menge.
    for (let localY = 0; localY < rect.height; localY ++) {
        for (let localX = 0; localX < rect.width; localX ++ ) {

            const index = localY * rect.width + localX;
            const pixelX = rect.x + localX;
            const pixelY = rect.y + localY;
            const { cellX, cellY, cellIndex } = getCellPosition(pixelX, pixelY);

            const maxObservedIterationsInCell = cellMaxObservedIterations[cellIndex];

            // Punkte, die deutlich unterhalb des lokalen Zellmaximums liegen,
            // sind als Referenzkandidaten weniger interessant.
            const iterationTolerance = Math.max(
                5,
                Math.floor(maxObservedIterationsInCell * 0.01)
            );

            if (iterations[index] < maxObservedIterationsInCell - iterationTolerance) {
                continue;
            }

            const candidate = {
                pixelX,
                pixelY,
                cx: minX + (pixelX / imageWidth) * (maxX - minX),
                cy: minY + (pixelY / imageHeight) * (maxY - minY),
                iterations: iterations[index],
                escapeValue: escapeValues[index],
                cellMaxObservedIterations: maxObservedIterationsInCell, 
                distanceToCellCenterSquared:
                    getDistanceToCellCenterSquared(pixelX, pixelY, cellX, cellY),
            };

            const cellCandidates = candidatesByCell[cellIndex];
            cellCandidates.push(candidate);

        }
    }

    for (const cellCandidates of candidatesByCell) {
        cellCandidates.sort(compareCellCandidates);

        const selectedCandidates = [];

        for (const candidate of cellCandidates) {
            if (!isFarEnoughFromSelectedCandidates(candidate, selectedCandidates)) {
                continue;
            }

            selectedCandidates.push(candidate);

            if (selectedCandidates.length >= MANDELBROT_REFERENCE_CANDIDATES_PER_CELL) {
                break;
            }
        }

        cellCandidates.length = 0;
        cellCandidates.push(...selectedCandidates);
    }

    return candidatesByCell
        .flat()
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
 * @returns {ReferenceCandidate[]} Neu ermittelte Referenzkandidaten.
 */
function refreshReferenceCandidates(
    iterationData,
    view, 
) {
    return collectReferenceCandidatesFromArrays(
        { x: 0, y: 0, width: iterationData.width, height: iterationData.height },
        iterationData.width,
        iterationData.height,
        view,
        iterationData.iterations,
        iterationData.escapeValues, 
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

    function compareReferenceCandidatesForView(a, b) {
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

    return [...referenceCandidates].sort(compareReferenceCandidatesForView);
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
 * Bestimmt, wie lang ein Referenzorbit mindestens sein muss, damit er fuer die
 * aktuelle Perturbation-Berechnung verwendet werden darf.
 *
 * Wenn die aktuelle Iterationsmatrix bereits das Iterationslimit erreicht hat, 
 * muss auch der Referenzorbit bis zum aktuellen `iterationLimit` reichen. 
 * Andernfalls reicht ein Orbit, der etwas ueber dem beobachteten Zellmaximum 
 * liegt. Die Sicherheitsmarge verhindert, dass Referenzen zu frueh enden, 
 * wenn nahe Pixel etwas laenger laufen als der Kandidat selbst.
 *
 * @param {ReferenceCandidate}  candidate             - Referenzkandidat, dessen Orbit bewertet wird.
 * @param {number}              iterationLimit        - (integer) Aktuelles Iterationslimit der Mandelbrot-Berechnung.
 * @param {number}              maxObservedIterations - (integer) Hoechster beobachteter Iterationswert der aktuellen Iterationsmatrix.
 * @returns {number}                                  - (integer) Mindestanzahl an Orbit-Iterationen, die der Kandidat liefern muss.
 */
function getRequiredReferenceOrbitIterations(
    candidate,
    iterationLimit,
    maxObservedIterations
) {
    const viewReachedIterationLimit =
        maxObservedIterations >= iterationLimit;

    if (viewReachedIterationLimit) {
        return iterationLimit;
    }

    const observedIterations =
        candidate.cellMaxObservedIterations ?? candidate.iterations;

    const safetyMargin = Math.max(
        100,
        Math.floor(observedIterations * 0.1)
    );

    return Math.min(
        iterationLimit,
        observedIterations + safetyMargin
    );
}

/**
 * Sortiert Referenzkandidaten nach ihrer Eignung fuer eine konkrete
 * Perturbation-Rechteckberechnung.
 *
 * Kandidaten innerhalb oder knapp ausserhalb des Zielrechtecks werden bevorzugt,
 * weil ihr Referenzorbit fuer die dortigen Pixel meist stabiler ist. Danach
 * werden Kandidaten bevorzugt, die das aktuelle Iterationslimit erreicht haben.
 * Anschliessend entscheidet die normalisierte Distanz zur Rechteckmitte,
 * danach das lokale Zellmaximum und zuletzt der Escape-Wert.
 *
 * Das Padding um das Rechteck erlaubt Referenzen aus der direkten Umgebung.
 * Das ist besonders fuer kleine Dirty-Rects nach Panning oder Resize wichtig,
 * bei denen ein guter Referenzpunkt knapp ausserhalb des neu berechneten
 * Bereichs liegen kann.
 *
 * @param {ReferenceCandidate[]}    referenceCandidates - Verfuegbare Referenzkandidaten.
 * @param {PixelRect}               rect                - Zielrechteck, das per Perturbation berechnet werden soll.
 * @param {number}                  iterationLimit      - (integer) Aktuelles Iterationslimit der Mandelbrot-Berechnung.
 * @returns {ReferenceCandidate[]}                      - Neue Kandidatenliste, bester Kandidat zuerst.
 */
function sortMandelbrotPerturbationReferenceCandidates(
    referenceCandidates,
    rect,
    iterationLimit,
) {
    if (!referenceCandidates || referenceCandidates.length === 0) {
        return [];
    }

    const rectCenterX = rect.x + rect.width / 2;
    const rectCenterY = rect.y + rect.height / 2;

    // Padding erlaubt Referenzpunkte knapp ausserhalb des Dirty-Rects.
    // Das ist wichtig bei kleinen neu berechneten Streifen nach Panning/Resize.
    const padding = Math.max(
        32,
        Math.floor(Math.max(rect.width, rect.height) * 0.25)
    );

    const paddedRect = {
        minX: rect.x - padding,
        maxX: rect.x + rect.width + padding,
        minY: rect.y - padding,
        maxY: rect.y + rect.height + padding,
    };

    const safeRectWidth = Math.max(rect.width, 1);
    const safeRectHeight = Math.max(rect.height, 1);

    function isInsidePaddedRect(candidate) {
        return candidate.pixelX >= paddedRect.minX &&
               candidate.pixelX <  paddedRect.maxX &&
               candidate.pixelY >= paddedRect.minY &&
               candidate.pixelY <  paddedRect.maxY;
    }

    function getNormalizedDistanceToRectCenter(candidate) {
        const dx = (candidate.pixelX - rectCenterX) / safeRectWidth;
        const dy = (candidate.pixelY - rectCenterY) / safeRectHeight;

        return Math.sqrt(dx * dx + dy * dy);
    }

    return [...referenceCandidates].sort((a, b) => {
        const aInside = isInsidePaddedRect(a);
        const bInside = isInsidePaddedRect(b);

        if (aInside !== bInside) {
            return aInside ? -1 : 1;
        }

        const aReachedLimit = a.iterations >= iterationLimit;
        const bReachedLimit = b.iterations >= iterationLimit;

        if (aReachedLimit !== bReachedLimit) {
            return aReachedLimit ? -1 : 1;
        }

        const aDistance = getNormalizedDistanceToRectCenter(a);
        const bDistance = getNormalizedDistanceToRectCenter(b);

        if (aDistance !== bDistance) {
            return aDistance - bDistance;
        }

        const aCellMax = a.cellMaxObservedIterations ?? a.iterations;
        const bCellMax = b.cellMaxObservedIterations ?? b.iterations;

        if (aCellMax !== bCellMax) {
            return bCellMax - aCellMax;
        }

        return a.escapeValue - b.escapeValue;
    });
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
        );

    return iterationData;
}
