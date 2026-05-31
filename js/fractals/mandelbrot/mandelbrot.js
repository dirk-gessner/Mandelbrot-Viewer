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
 * Rastergroesse fuer Perturbation-Referenzkandidaten in der aktuellen View.
 *
 * @type {number}
 */
const MANDELBROT_REFERENCE_TILE_COLUMNS = 9;
const MANDELBROT_REFERENCE_TILE_ROWS = 9;

/**
 * Anzahl der Referenzkandidaten, die pro Tile an den Worker gegeben werden.
 *
 * @type {number}
 */
const MANDELBROT_REFERENCE_CANDIDATES_PER_TILE = 2;

/**
 * Mindestabstand zweier Kandidaten innerhalb eines Tiles, relativ zur kleineren
 * Tile-Kante. Wenn kein zweiter Punkt diesen Abstand erreicht, wird der beste
 * verbleibende Punkt verwendet.
 *
 * @type {number}
 */
const MANDELBROT_REFERENCE_MIN_TILE_DISTANCE_RATIO = 0.25;

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

    // Die Mitte der interleavten Liste enthaelt die urspruenglich mittleren
    // Kandidaten. Diese sind oft wichtige Stuetzpunkte und sollen frueh laufen.
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
    debugLog(
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
    debugLog(
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

function interleaveReferenceCandidatesFromEnds(candidates) {
    const result = [];
    let left = 0;
    let right = candidates.length - 1;

    while (left <= right) {
        result.push(candidates[left]);
        left++;

        if (left <= right) {
            result.push(candidates[right]);
            right--;
        }
    }

    // Die Mitte der interleavten Liste enthaelt die urspruenglich mittleren
    // Kandidaten. Diese sind oft wichtige Stuetzpunkte und sollen frueh laufen.
    return result.reverse();
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

    let initialReferenceCandidates = null;
    let fallbackReferenceCandidates = null;

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

                debugWarn("WebGPU Mandelbrot backend failed.", error);

                if (!useCpu) { throw error };

                debugWarn("Falling back to CPU backend.");
            }

        } else if (usePerturbation) {

            debugWarn(
                "Resolution limits for Standard WebGPU (Float32) reached.", 
                "Switching to Perturbation WebGPU backend."
            );

            try {
                const candidates = interleaveReferenceCandidatesFromEnds(
                    createMandelbrotPerturbationReferenceCandidatesForRect(
                                    rect,
                                    imageWidth,
                                    imageHeight,
                                    computationSettings.view,
                                    computationSettings.iterationLimit,
                                    iterationData
                                )
                );
                initialReferenceCandidates = candidates;

                if (candidates.length > 0) {

                    const result = await computeMandelbrotRectWebGpu(
                        rect,
                        imageWidth,
                        imageHeight,
                        computationSettings,
                        candidates
                    );

                    if (!result.referenceCandidates?.length) {
                        result.referenceCandidates = candidates;
                    }

                    fallbackReferenceCandidates = result.referenceCandidates;

                    if ( result.perturbationReferenceRejected ||
                        !result.perturbationAcceptable) {        
                        debugWarn("Perturbation reference orbits rejected. Falling back to CPU backend.", {
                            perturbationStats: result.perturbationStats, 
                        });
                    } else if (result.perturbationStats.invalidCount !== 0 ) {

                        debugLog("Perturbation reference orbit accepted with minor invalid pixels.");
                        debugInfo(
                            `Invalid pixels: ${result.perturbationStats.invalidCount}`,
                            `Repaired pixels: ${result.cpuRepairedPixelCount}`,
                        ); 

                        runtimeStats.lastComputationBackend =
                            `${COMPUTATION_BACKEND_WEBGPU} perturbation`;
                        return result;

                    } else {

                        debugLog("Perturbation reference orbit accepted.");
                        debugInfo(
                            `Invalid pixels: ${result.perturbationStats.invalidCount}`,
                            `Repaired pixels: ${result.cpuRepairedPixelCount}`,
                        ); 

                        runtimeStats.lastComputationBackend =
                            `${COMPUTATION_BACKEND_WEBGPU} perturbation`;
                        return result;
                    }
                } else {

                    debugWarn("No suitable reference candidates found. Falling back to CPU backend.");
                }

            } catch (error) {

                debugWarn("WebGPU Mandelbrot perturbation backend failed.", error); 

                if (!useCpu) { 
                    throw error; 
                };

                debugWarn("Falling back to CPU backend.");
            }
        }
    }

    if (useCpu) {
        
        runtimeStats.lastComputationBackend = COMPUTATION_BACKEND_CPU;
        const result = await computeMandelbrotRectCpu(
            rect,
            imageWidth,
            imageHeight,
            computationSettings
        );

        const referenceCandidates =
            fallbackReferenceCandidates?.length
                ? fallbackReferenceCandidates
                : initialReferenceCandidates;

        if (referenceCandidates?.length) {
            result.referenceCandidates = referenceCandidates;
        }

        return result;
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
 * Die aktuelle Zielmatrix wird in konfigurierbare Tiles unterteilt. Bekannte
 * Pixel aus `previousIterationData` werden ueber deren gespeicherte `view` in
 * die aktuelle View projiziert. Pro Tile werden die Punkte mit den hoechsten
 * Iterationswerten bevorzugt; mehrere Punkte pro Tile muessen nach Moeglichkeit
 * einen Mindestabstand zueinander einhalten.
 *
 * Falls fuer ein Tile keine bekannten Punkte in das Zielrechteck projiziert
 * werden koennen, erzeugt die Funktion einen geometrischen Fallbackpunkt in der
 * Tile-Mitte. So bleibt der Perturbation-Worker auch bei nicht ueberlappenden
 * Views arbeitsfaehig.
 *
 * @param {PixelRect} rect - Zielrechteck, das per Perturbation berechnet werden soll.
 * @param {number} imageWidth - (integer) Breite der vollstaendigen Zielmatrix.
 * @param {number} imageHeight - (integer) Hoehe der vollstaendigen Zielmatrix.
 * @param {View} view - Aktuelle View der Mandelbrot-Berechnung.
 * @param {number} iterationLimit - (integer) Aktuelles Iterationslimit der Mandelbrot-Berechnung.
 * @param {?IterationData} [previousIterationData=null] - Vorherige Matrix als Quelle bekannter Iterationswerte.
 * @returns {ReferenceCandidate[]} Kandidaten fuer genau dieses Zielrechteck.
 */
function createMandelbrotPerturbationReferenceCandidatesForRect(
    rect,
    imageWidth,
    imageHeight,
    view,
    iterationLimit,
    previousIterationData = null
) {
    if (rect.width <= 0 || rect.height <= 0) {
        return [];
    }

    const viewWidth = view.maxX - view.minX;
    const viewHeight = view.maxY - view.minY;

    if (viewWidth === 0 || viewHeight === 0) {
        return [];
    }

    const tileColumns = MANDELBROT_REFERENCE_TILE_COLUMNS;
    const tileRows = MANDELBROT_REFERENCE_TILE_ROWS;
    const tileCount = tileColumns * tileRows;
    const tileWidth = imageWidth / tileColumns;
    const tileHeight = imageHeight / tileRows;
    const minDistance = Math.min(tileWidth, tileHeight) *
        MANDELBROT_REFERENCE_MIN_TILE_DISTANCE_RATIO;
    const minDistanceSquared = minDistance * minDistance;

    const tileCandidates = Array.from(
        { length: tileCount },
        () => []
    );

    function isInsideTargetRect(pixelX, pixelY) {
        return pixelX >= rect.x &&
               pixelX < rect.x + rect.width &&
               pixelY >= rect.y &&
               pixelY < rect.y + rect.height;
    }

    function getTilePosition(pixelX, pixelY) {
        const tileX = Math.min(
            tileColumns - 1,
            Math.max(0, Math.floor((pixelX / imageWidth) * tileColumns))
        );
        const tileY = Math.min(
            tileRows - 1,
            Math.max(0, Math.floor((pixelY / imageHeight) * tileRows))
        );

        return {
            tileX,
            tileY,
            tileIndex: tileY * tileColumns + tileX,
        };
    }

    function getDistanceSquared(a, b) {
        const dx = a.pixelX - b.pixelX;
        const dy = a.pixelY - b.pixelY;

        return dx * dx + dy * dy;
    }

    function isFarEnoughFromSelectedCandidates(candidate, selectedCandidates) {
        for (const selectedCandidate of selectedCandidates) {
            if (getDistanceSquared(candidate, selectedCandidate) < minDistanceSquared) {
                return false;
            }
        }

        return true;
    }

    function addKnownCandidatesFromPreviousData() {
        if (!previousIterationData?.view) {
            return;
        }

        const sourceView = previousIterationData.view;
        const sourceViewWidth = sourceView.maxX - sourceView.minX;
        const sourceViewHeight = sourceView.maxY - sourceView.minY;

        if (sourceViewWidth === 0 || sourceViewHeight === 0) {
            return;
        }

        for (let sourceY = 0; sourceY < previousIterationData.height; sourceY++) {
            for (let sourceX = 0; sourceX < previousIterationData.width; sourceX++) {
                const sourceIndex = sourceY * previousIterationData.width + sourceX;
                const cx = sourceView.minX +
                    (sourceX / previousIterationData.width) * sourceViewWidth;
                const cy = sourceView.minY +
                    (sourceY / previousIterationData.height) * sourceViewHeight;
                const pixelX = ((cx - view.minX) / viewWidth) * imageWidth;
                const pixelY = ((cy - view.minY) / viewHeight) * imageHeight;

                if (!isInsideTargetRect(pixelX, pixelY)) {
                    continue;
                }

                const { tileX, tileY, tileIndex } = getTilePosition(pixelX, pixelY);
                const tileCenterX = ((tileX + 0.5) / tileColumns) * imageWidth;
                const tileCenterY = ((tileY + 0.5) / tileRows) * imageHeight;
                const dx = pixelX - tileCenterX;
                const dy = pixelY - tileCenterY;

                tileCandidates[tileIndex].push({
                    pixelX: Math.floor(pixelX),
                    pixelY: Math.floor(pixelY),
                    cx,
                    cy,
                    iterations: previousIterationData.iterations[sourceIndex],
                    escapeValue: previousIterationData.escapeValues[sourceIndex],
                    cellMaxObservedIterations: previousIterationData.iterations[sourceIndex],
                    distanceToCellCenterSquared: dx * dx + dy * dy,
                    source: "original",
                    origin: "known-pixel",
                    status: "not-used",
                });
            }
        }
    }

    function createFallbackCandidateForTile(tileX, tileY) {
        const pixelX = Math.floor(((tileX + 0.5) / tileColumns) * imageWidth);
        const pixelY = Math.floor(((tileY + 0.5) / tileRows) * imageHeight);

        if (!isInsideTargetRect(pixelX, pixelY)) {
            return null;
        }

        return {
            pixelX,
            pixelY,
            cx: view.minX + (pixelX / imageWidth) * viewWidth,
            cy: view.minY + (pixelY / imageHeight) * viewHeight,
            iterations: iterationLimit,
            escapeValue: 0,
            cellMaxObservedIterations: iterationLimit,
            distanceToCellCenterSquared: 0,
            source: "original",
            origin: "tile-center-fallback",
            status: "not-used",
        };
    }

    addKnownCandidatesFromPreviousData();

    const result = [];
    const seenPixelKeys = new Set();

    for (let tileY = 0; tileY < tileRows; tileY++) {
        for (let tileX = 0; tileX < tileColumns; tileX++) {
            const tileIndex = tileY * tileColumns + tileX;
            const candidates = tileCandidates[tileIndex];

            candidates.sort((a, b) => {
                if (a.iterations !== b.iterations) {
                    return b.iterations - a.iterations;
                }

                if (a.distanceToCellCenterSquared !== b.distanceToCellCenterSquared) {
                    return a.distanceToCellCenterSquared - b.distanceToCellCenterSquared;
                }

                return a.escapeValue - b.escapeValue;
            });

            const selectedCandidates = [];
            const fallbackCandidates = [];

            for (const candidate of candidates) {
                const pixelKey = `${candidate.pixelX}:${candidate.pixelY}`;

                if (seenPixelKeys.has(pixelKey)) {
                    continue;
                }

                if (isFarEnoughFromSelectedCandidates(candidate, selectedCandidates)) {
                    selectedCandidates.push(candidate);
                    seenPixelKeys.add(pixelKey);
                } else {
                    fallbackCandidates.push(candidate);
                }

                if (selectedCandidates.length >= MANDELBROT_REFERENCE_CANDIDATES_PER_TILE) {
                    break;
                }
            }

            for (const candidate of fallbackCandidates) {
                if (selectedCandidates.length >= MANDELBROT_REFERENCE_CANDIDATES_PER_TILE) {
                    break;
                }

                const pixelKey = `${candidate.pixelX}:${candidate.pixelY}`;

                if (seenPixelKeys.has(pixelKey)) {
                    continue;
                }

                selectedCandidates.push(candidate);
                seenPixelKeys.add(pixelKey);
            }

            if (selectedCandidates.length === 0) {
                const fallbackCandidate = createFallbackCandidateForTile(tileX, tileY);

                if (fallbackCandidate) {
                    const pixelKey = `${fallbackCandidate.pixelX}:${fallbackCandidate.pixelY}`;

                    if (!seenPixelKeys.has(pixelKey)) {
                        selectedCandidates.push(fallbackCandidate);
                        seenPixelKeys.add(pixelKey);
                    }
                }
            }

            result.push(...selectedCandidates);
        }
    }

    // Die Mitte der interleavten Liste enthaelt die urspruenglich mittleren
    // Kandidaten. Diese sind oft wichtige Stuetzpunkte und sollen frueh laufen.
    return result;
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
