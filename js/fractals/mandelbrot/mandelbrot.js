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
 * @param {?View}          [view=null] - Ausschnitt der komplexen Ebene, auf den sich die zusammengefuehrte Matrix bezieht.
 * @returns {IterationData}         - Zusammengeführte Iterationsdaten für `rect`.
 */
function mergeIterationDataParts(
    rect, 
    parts,
    view = null
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
        view,
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

    const iterationData = mergeIterationDataParts(
        rect,
        parts,
        computationSettings.view
    );

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
                const candidates = createMandelbrotPerturbationReferenceCandidatesForRect(
                    rect,
                    imageWidth,
                    imageHeight,
                    computationSettings.view,
                    computationSettings.iterationLimit,
                );              

                if (candidates.length > 0) {

                    const result = await computeMandelbrotRectWebGpu(
                        rect,
                        imageWidth,
                        imageHeight,
                        computationSettings,
                        candidates,
                        computationSettings.iterationLimit
                    );

                    result.referenceCandidates = candidates;

                    if (result.perturbationReferenceRejected ||
                        !isAcceptablePerturbationResult(result)) 
                    {
                        console.warn("Perturbation reference orbits rejected. Falling back to CPU backend.", {
                            perturbationStats: result.perturbationStats, 
                        });
                    }
                    else if (result.perturbationStats.invalidCount !== 0 ) {

                        console.info("Perturbation reference orbit accepted with minor invalid pixels.", {
                            perturbationStats: result.perturbationStats,
                        }); 

                        runtimeStats.lastComputationBackend =
                            `${COMPUTATION_BACKEND_WEBGPU} perturbation`;
                        return result;

                    } else {

                        console.info("Perturbation reference orbit accepted.", {
                            perturbationStats: result.perturbationStats,
                        }); 

                        runtimeStats.lastComputationBackend =
                            `${COMPUTATION_BACKEND_WEBGPU} perturbation`;
                        return result;
                    }
                } else {

                    console.warn("No suitable reference candidates found. Falling back to CPU backend.");
                }

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
 * Erzeugt Referenzkandidaten fuer eine konkrete Perturbation-Rechteckberechnung.
 *
 * Die Kandidaten werden erst erzeugt, wenn das Zielrechteck und die aktuelle
 * View feststehen. Dadurch beziehen sich `pixelX` und `pixelY` direkt auf die
 * aktuelle Berechnung; eine nachtraegliche Rekalibrierung alter Bildpunkte ist
 * fuer diesen Pfad nicht noetig.
 *
 * Die Funktion erzeugt ein kleines, gleichmaessiges Raster innerhalb des
 * Zielrechtecks. Der Worker berechnet spaeter fuer jeden Kandidaten den echten
 * Referenzorbit und verwirft Kandidaten, deren Orbit zu kurz ist.
 *
 * @param {PixelRect} rect - Zielrechteck, das per Perturbation berechnet werden soll.
 * @param {number} imageWidth - (integer) Breite der vollstaendigen Zielmatrix.
 * @param {number} imageHeight - (integer) Hoehe der vollstaendigen Zielmatrix.
 * @param {View} view - Aktuelle View der Mandelbrot-Berechnung.
 * @param {number} iterationLimit - (integer) Aktuelles Iterationslimit der Mandelbrot-Berechnung.
 * @returns {ReferenceCandidate[]} Kandidaten fuer genau dieses Zielrechteck.
 */
function createMandelbrotPerturbationReferenceCandidatesForRect(
    rect,
    imageWidth,
    imageHeight,
    view,
    iterationLimit
) {
    if (rect.width <= 0 || rect.height <= 0) {
        return [];
    }

    const viewWidth = view.maxX - view.minX;
    const viewHeight = view.maxY - view.minY;

    if (viewWidth === 0 || viewHeight === 0) {
        return [];
    }

    const gridColumns = Math.min(9, Math.max(1, Math.ceil(rect.width / 128)));
    const gridRows = Math.min(9, Math.max(1, Math.ceil(rect.height / 128)));

    const rectCenterX = rect.x + rect.width / 2;
    const rectCenterY = rect.y + rect.height / 2;
    const safeRectWidth = Math.max(rect.width, 1);
    const safeRectHeight = Math.max(rect.height, 1);

    const candidates = [];
    const seenPixelKeys = new Set();

    function addCandidate(pixelX, pixelY) {
        const clampedPixelX = Math.min(
            imageWidth - 1,
            Math.max(0, pixelX)
        );
        const clampedPixelY = Math.min(
            imageHeight - 1,
            Math.max(0, pixelY)
        );

        const candidatePixelX = Math.floor(clampedPixelX);
        const candidatePixelY = Math.floor(clampedPixelY);
        const pixelKey = `${candidatePixelX}:${candidatePixelY}`;

        if (seenPixelKeys.has(pixelKey)) {
            return;
        }

        seenPixelKeys.add(pixelKey);

        const normalizedDx = (candidatePixelX - rectCenterX) / safeRectWidth;
        const normalizedDy = (candidatePixelY - rectCenterY) / safeRectHeight;

        candidates.push({
            pixelX: candidatePixelX,
            pixelY: candidatePixelY,
            cx: view.minX + (candidatePixelX / imageWidth) * viewWidth,
            cy: view.minY + (candidatePixelY / imageHeight) * viewHeight,
            iterations: iterationLimit,
            escapeValue: 0,
            cellMaxObservedIterations: iterationLimit,
            distanceToRectCenterSquared:
                normalizedDx * normalizedDx + normalizedDy * normalizedDy,
        });
    }

    addCandidate(rectCenterX, rectCenterY);

    for (let cellY = 0; cellY < gridRows; cellY++) {
        for (let cellX = 0; cellX < gridColumns; cellX++) {
            addCandidate(
                rect.x + ((cellX + 0.5) / gridColumns) * rect.width,
                rect.y + ((cellY + 0.5) / gridRows) * rect.height
            );
        }
    }

    return candidates.sort((a, b) =>
        a.distanceToRectCenterSquared - b.distanceToRectCenterSquared
    );
}
/**
 * Mandelbrot-spezifischer Finalisierungs-Hook fuer fertige Iterationsdaten.
 *
 * Aktuell gibt es hier nichts zu tun. Die Funktion bleibt als Callback erhalten,
 * damit spaetere Mandelbrot-Metadaten wieder an genau dieser Stelle ergaenzt
 * werden koennen.
 *
 * @param {IterationData} iterationData - Fertige Mandelbrot-Iterationsmatrix.
 * @param {ComputationSettings} computationSettings - Mandelbrot-Berechnungseinstellungen.
 * @returns {IterationData} Unveraenderte Iterationsmatrix.
 */
function finalizeMandelbrot(
    iterationData,
    computationSettings
) {
    return iterationData;
}
