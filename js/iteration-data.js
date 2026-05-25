// -----------------------------------------------------------------------------
// Funktionssammlung für Operationen auf der Iterationsmatrix, die unabhängig
// von der verwendeten Funktionalität (Julia, Mandelbrot, ...) sind 
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Iterations-Matrix
// -----------------------------------------------------------------------------

const REFERENCE_CANDIDATE_LIMIT = 16;

/**
 * Lineares Feld mit einem Iterationswert je Pixel.
 *
 * @typedef {Uint16Array} IterationArray
 */

/**
 * Lineares Feld mit einem Escape-Wert je Pixel.
 *
 * @typedef {Float32Array} EscapeValueArray
 */

/**
 * Kandidat fuer einen Referenzpunkt bei einer spaeteren
 * Perturbation-Berechnung.
 *
 * Ein Kandidat beschreibt einen bereits berechneten Bildpunkt, dessen Orbit
 * lange genug in der Naehe der Mandelbrot-Menge bleibt, um als Referenzorbit
 * fuer eine tiefere Zoomstufe interessant zu sein. Typischerweise werden die
 * Kandidaten aus den Pixeln mit den hoechsten Iterationswerten gewonnen.
 *
 * `pixelX` und `pixelY` beziehen sich auf die vollstaendige Zielmatrix, nicht
 * zwingend auf ein Teilrechteck. `cx` und `cy` sind die dazugehoerigen
 * Koordinaten in der komplexen Ebene.
 *
 * @typedef {Object} ReferenceCandidate
 * @property {number} pixelX       - (integer) X-Position des Kandidaten in der vollstaendigen Pixelmatrix.
 * @property {number} pixelY       - (integer) Y-Position des Kandidaten in der vollstaendigen Pixelmatrix.
 * @property {number} cx           - (decimal) Realteil der komplexen Koordinate des Kandidaten.
 * @property {number} cy           - (decimal) Imaginaerteil der komplexen Koordinate des Kandidaten.
 * @property {number} iterations   - (integer) Iterationswert des Kandidaten bei der normalen Berechnung.
 * @property {number} escapeValue  - (decimal) Quadratischer Betrag des Orbits beim Abbruch.
 */

/**
 * Iterationsdaten fuer eine vollstaendig oder teilweise berechnete Fraktalflaeche.
 *
 * Die Arrays sind linear gespeichert. Der Wert fuer Pixel (x, y) liegt an Index:
 * y * width + x.
 *
 * `referenceCandidates` enthaelt optionale Kandidaten fuer spaetere
 * Perturbation-Berechnungen. Die Kandidaten sind Metadaten zur Berechnung und
 * werden vom normalen Rendering nicht benoetigt. Wenn das Feld vorhanden ist,
 * sollte es bevorzugt absteigend nach `iterations` sortiert sein.
 *
 * @typedef {Object} IterationData
 * @property {number}               width                 - (integer) Breite der Datenmatrix in Pixeln.
 * @property {number}               height                - (integer) Hoehe der Datenmatrix in Pixeln.
 * @property {IterationArray}       iterations            - (integer) Iterationswert je Pixel.
 * @property {EscapeValueArray}     escapeValues          - (decimal) Escape-Wert je Pixel.
 * @property {number}               minIterations         - (integer) Niedrigster Iterationswert aus `iterations`.
 * @property {ReferenceCandidate[]} [referenceCandidates] - Kandidaten fuer Referenzpunkte, typischerweise nach Iterationswert absteigend sortiert.
 */

/**
 * Aktuell gecachte Iterationsdaten der dargestellten Fraktalfläche.
 *
 * Der Wert ist null, solange noch keine Berechnung durchgeführt wurde.
 *
 * @type {?IterationData}
 */
let iterationData = null;


// -----------------------------------------------------------------------------
// Objekte für Verschiebe- und Kopieropreationen
// -----------------------------------------------------------------------------

/**
 * Rechteckiger Pixelbereich innerhalb einer Iterationsmatrix.
 *
 * @typedef {Object} PixelRect
 * @property {number} x         - (integer) Linke Position in Pixeln.
 * @property {number} y         - (integer) Obere Position in Pixeln.
 * @property {number} width     - (integer) Breite in Pixeln.
 * @property {number} height    - (integer) Höhe in Pixeln.
 */

/**
 * Beschreibung einer rechteckigen Kopieroperation zwischen zwei Iterationsdaten.
 *
 * @typedef {Object} CopyRegion
 * @property {number} sourceX   - (integer) X-Startposition in der Quelle.
 * @property {number} sourceY   - (integer) Y-Startposition in der Quelle.
 * @property {number} targetX   - (integer) X-Zielposition im Ziel.
 * @property {number} targetY   - (integer) Y-Zielposition im Ziel.
 * @property {number} width     - (integer) Breite des Kopierbereichs.
 * @property {number} height    - (integer) Höhe des Kopierbereichs.
 */

// -----------------------------------------------------------------------------
// 
// -----------------------------------------------------------------------------
/**
 * Ermittelt die minimale Anzahl von Iterationen in einem Datensatz. 
 * 
 * @param {IterationArray} iterations - (integer) Iterationswerte je Pixel
 * @returns {number}                  - (integer) minimaler Iterationswert des Feldes
 */
function findMinIterations(
    iterations
) {
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
 * Erzeugt ein leeres IterationData-Objekt.
 * 
 * @param {number} width        - (integer) Breite der Matrix
 * @param {number} height       - (integer) Höhe der Matrix
 * @returns {IterationData}     - ein leeres IterationData-Objekt
 */
function createEmptyIterationData(
    width, 
    height
) {
    return {
        width,
        height,
        iterations: new Uint16Array(width * height),
        escapeValues: new Float32Array(width * height),
        minIterations: 0, 
        referenceCandidates: [], 
    };
}

// -----------------------------------------------------------------------------
// Funktionen für Verschiebung und Neuberechnung der aktuellen View
// -----------------------------------------------------------------------------

/**
 * Kopiert ein IterationData-Objekt (source) oder einen Ausschnitt daraus 
 * in ein anderes IterationData-Objekt (target) - 
 * z.B. nach einer Verschiebung oder Erweiterung. 
 * 
 * copyRegion (                 - beschreibt eine verschobene Kopie: 
 *                                  source(sourceX + x, sourceY + y) 
 *                                      -> target(targetX + x, targetY + y)
 *       sourceX, sourceY,      - Sourcekordinaten
 *       targetX, targetY,      - Zielkoordinaten
 *       width, height)         - Ausdehnung des zu kopierenden Rechtecks
 * 
 * @param {IterationData} source        - Quelldaten der Kopieroperation
 * @param {IterationData} target        - Zieldaten der Kopieroperation
 * @param {CopyRegion}    copyRegion    - Parameter für die Verschiebung
 */
function copyIterationRect(
    source, 
    target, 
    copyRegion
) {
    for (let y = 0; y < copyRegion.height; y++) {
        for (let x = 0; x < copyRegion.width; x++) {
    
            const sourceIndex =
                (copyRegion.sourceY + y) * source.width + (copyRegion.sourceX + x);

            const targetIndex =
                (copyRegion.targetY + y) * target.width + (copyRegion.targetX + x);

            target.iterations  [targetIndex] = source.iterations  [sourceIndex];
            target.escapeValues[targetIndex] = source.escapeValues[sourceIndex];
        }
    }
}

/**
 * Ermittelt die Pixelbereiche (Rechtecke), 
 * die nach einer Verschiebung (dx, dy) neu berechnet werden müssen.
 * 
 * @param {number} dx       - (integer) Horizontale Verschiebung in Pixeln.
 * @param {number} dy       - (integer) Vertikale Verschiebung in Pixeln.
 * @param {number} width    - (integer) Breite der Datenmatrix in Pixeln.
 * @param {number} height   - (integer) Höhe der Datenmatrix in Pixeln.
 * @returns {PixelRect[]}   - Neu zu berechnende Rechtecke.
 */
function getDirtyPanRects(
    dx, dy, 
    width, height
) {
    const rects = [];

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx >= width || absDy >= height) {
        return [
            { x: 0, y: 0, width, height }
        ];
    }

    if (dx > 0) {
        rects.push({
            x: 0,
            y: 0,
            width: dx,
            height,
        });
    } else if (dx < 0) {
        rects.push({
            x: width + dx,
            y: 0,
            width: -dx,
            height,
        });
    }

    if (dy > 0) {
        rects.push({
            x: Math.max(dx, 0),
            y: 0,
            width: width - absDx,
            height: dy,
        });
    } else if (dy < 0) {
        rects.push({
            x: Math.max(dx, 0),
            y: height + dy,
            width: width - absDx,
            height: -dy,
        });
    }

    return rects;
}

/**
 * Berechnet Iterationsdaten für einen rechteckigen Pixelbereich.
 *
 * @callback ComputeIterationRect
 * @param {PixelRect} rect - Zu berechnender Pixelbereich.
 * @param {number} imageWidth - (integer) Breite der vollständigen Zielmatrix.
 * @param {number} imageHeight - (integer) Höhe der vollständigen Zielmatrix.
 * @param {ComputationSettings} computationSettings - Einstellungen für die Fraktalberechnung.
 * @returns {Promise<IterationData>} Berechnete Iterationsdaten für `rect`.
 */

/**
 * Erzeugt neue Iterationsdaten durch Verschieben vorhandener Daten.
 *
 * Die nach dem Shift (dx, dy) weiterhin sichtbaren Daten werden aus `oldData` kopiert.
 * Neu sichtbar gewordene Bereiche werden über `computeFn` berechnet und in die
 * neue Matrix eingefügt.
 * 
 * oldData + dx/dy + computeFn -> newData
 *
 * @param {IterationData}        oldData             - Bisherige Iterationsdaten.
 * @param {number}               dx                  - (integer) Horizontale Verschiebung in Pixeln.
 * @param {number}               dy                  - (integer) Vertikale Verschiebung in Pixeln.
 * @param {ComputeIterationRect} computeFn           - Funktion zur Berechnung neu sichtbarer Rechtecke.
 * @param {ComputationSettings}  computationSettings - Einstellungen für die Fraktalberechnung.
 * @returns {Promise<IterationData>}                 - Verschobene und ergänzte Iterationsdaten.
 */
async function computeShiftedIterationData(
    oldData,
    dx,
    dy,
    computeFn,
    computationSettings 
) {

    const { width, height } = oldData;

    // die neue Matrix ist so groß wie die alte
    const newData = createEmptyIterationData(width, height);

    // Translation oldData -> newData beschreiben
    let copyRegion = {
        sourceX: Math.max(0, -dx),
        sourceY: Math.max(0, -dy),
        targetX: Math.max(0, +dx),
        targetY: Math.max(0, +dy),
        width  : width  - Math.abs(dx) > 0 ? width  - Math.abs(dx) : 0,
        height : height - Math.abs(dy) > 0 ? height - Math.abs(dy) : 0,
    };    

    // Daten des nach der Verschiebung noch sichtbaren Bereichs übernehmen
    copyIterationRect( oldData, newData, copyRegion) ; 
    newData.referenceCandidates = shiftReferenceCandidates(
        oldData.referenceCandidates,
        dx, dy,
        width, height
    );

    // ermittle die neu sichtbar gewordenen Bereiche
    // returns: [{x, y, width, height}, {x, y, width, height}, ...]
    const dirtyRects = getDirtyPanRects(dx, dy, width, height);

    // Berechne die Iterationswerte für die neu sichtbar gewordenen Bereiche
    for (const rect of dirtyRects) {

        const rectData = await computeFn(
            rect, 
            width, 
            height, 
            computationSettings 
        );

        // Translation rect -> newData beschreiben
        copyRegion = {
            sourceX : 0, 
            sourceY : 0, 
            targetX : rect.x,
            targetY : rect.y,
            width   : rect.width,        
            height  : rect.height, 
        };

        // berechnete Daten des Rechtecks in den neuen Cache 
        // an Stelle (rect.x, rect.y) übernehmen
        copyIterationRect(rectData, newData, copyRegion);
        newData.referenceCandidates = mergeReferenceCandidates(
            newData.referenceCandidates,
            rectData.referenceCandidates
        );
    }

    // Aktualisiere die minimale Iterationsanzahl im neuen Cache, 
    // da sich durch die Verschiebung neue Bereiche mit möglicherweise 
    // niedrigeren Iterationszahlen ergeben können
    newData.minIterations = findMinIterations(newData.iterations);
    newData.referenceCandidates = refreshReferenceCandidates(
        newData, 
        computationSettings.view
    );
    return newData;
}

/**
 * Aktualisiert den globalen Iterationsdaten-Cache nach einem Shift (dx, dy).
 *
 * Die Funktion setzt voraus, dass bereits `iterationData` vorhanden ist.
 * Sie verschiebt den vorhandenen Cache und berechnet nur neu sichtbar gewordene
 * Bereiche nach.
 *
 * @param {number}               dx - (integer) Horizontale Verschiebung in Pixeln.
 * @param {number}               dy - (integer) Vertikale Verschiebung in Pixeln.
 * @param {ComputeIterationRect} [computeFn=computeMandelbrotRect] - Funktion zur Berechnung neu sichtbarer Rechtecke.
 * @throws {Error}                  - Wenn kein Iterationsdaten-Cache vorhanden ist.
 * @returns {Promise<void>}
 */
async function updateIterationDataByShift(
    dx, dy, 
    computeFn = computeMandelbrotRect
) {

    // Wenn kein Cache vorhanden ist, einfach neu berechnen
    if (!iterationData) {
        throw new Error ('Shift without iteration data!');
    }

    // Iterationsdaten verschieben
    // computeMandelbrotRect als Parameter austauschbar
    iterationData = await computeShiftedIterationData(
                                iterationData, 
                                dx, dy, 
                                computeFn, 
                                computationSettings ); 
}

// -----------------------------------------------------------------------------
// Funktionen für Resize und Neuberechnung der aktuellen View
// -----------------------------------------------------------------------------

/**
 * Ergebnis einer Resize-Operation auf Iterationsdaten.
 *
 * @typedef {Object} ResizeIterationDataResult
 * @property {IterationData} iterationData  - Angepasste Iterationsdaten.
 * @property {View} view                    - Zur angepassten Matrix passende View.
 */

/**
 * Richtung, in der eine Iterationsmatrix erweitert wird.
 *
 * @typedef {'horizontal'|'vertical'} ResizeDirection
 */

/**
 * Erstellt eine Kopie der Berechnungseinstellungen mit ersetzter View.
 *
 * Die ursprünglichen Einstellungen werden nicht verändert. Das ist nützlich,
 * wenn eine Berechnung mit einer abweichenden View ausgeführt werden soll,
 * ohne den globalen Zustand vorzeitig umzuschalten.
 *
 * @param {ComputationSettings} settings - Ausgangseinstellungen.
 * @param {View}                view     - View, die in der Kopie verwendet werden soll.
 * @returns {ComputationSettings}        - Kopie der Einstellungen mit ersetzter View.
 */
function copySettingsWithView(
    settings, 
    view
) {
    return {
        ...settings,
        view
    };
}

/**
 * Ermittelt die nach einer Erweiterung der View neu zu berechnenden Bildbereiche.
 *
 * Die Rechtecke liegen rund um den beizubehaltenden Pixelbereich und decken
 * genau die Bereiche ab, die in der vergrößerten Matrix noch keine Daten haben.
 *
 * @param {PixelRect} preservedRect - Bereich, dessen alte Iterationsdaten erhalten bleiben.
 * @param {ImageSize} newSize       - (integer) Zielgröße der neuen Iterationsmatrix.
 * @returns {PixelRect[]}           - Neu zu berechnende Rechtecke.
 */
function getDirtyResizeRects(
    preservedRect, 
    newSize
) {
    const rects = [];

    // oben
    if (preservedRect.y > 0) {
        rects.push({
            x: 0,
            y: 0,
            width: newSize.width,
            height: preservedRect.y,
        });
    }

    // unten
    const bottom = preservedRect.y + preservedRect.height;
    if (bottom < newSize.height) {
        rects.push({
            x: 0,
            y: bottom,
            width: newSize.width,
            height: newSize.height - bottom,
        });
    }

    // links
    if (preservedRect.x > 0) {
        rects.push({
            x: 0,
            y: preservedRect.y,
            width: preservedRect.x,
            height: preservedRect.height,
        });
    }

    // rechts
    const right = preservedRect.x + preservedRect.width;
    if (right < newSize.width) {
        rects.push({
            x: right,
            y: preservedRect.y,
            width: newSize.width - right,
            height: preservedRect.height,
        });
    }

    return rects;
}

/**
 * Berechnet die fehlenden Bereiche einer nach Resize erweiterten Iterationsmatrix.
 *
 * Die Funktion ermittelt aus `preservedRect` und `newSize` alle neu sichtbaren
 * Rechtecke, berechnet sie mit `computeFn` für `newView` und kopiert die
 * Ergebnisse in `newData`.
 *
 * @param {IterationData}        newData        - Zielmatrix, in die die neu berechneten Daten geschrieben werden.
 * @param {PixelRect}            preservedRect  - Bereich in `newData`, der bereits alte Daten enthält.
 * @param {ImageSize}            newSize        - (integer) Zielgröße der neuen Iterationsmatrix.
 * @param {View}                 newView        - View, die zur neuen Zielgröße gehört.
 * @param {ComputeIterationRect} computeFn      - Funktion zur Berechnung einzelner Rechtecke.
 * @param {ComputationSettings}  computationSettings - Berechnungseinstellungen als Grundlage.
 * @returns {Promise<IterationData>}            - Zielmatrix mit ergänzten Dirty-Rects.
 */
async function fillDirtyResizeRects(
    newData, 
    preservedRect, 
    newSize, newView, 
    computeFn, 
    computationSettings
) {

    const dirtyRects = getDirtyResizeRects(preservedRect, newSize);

    for (const rect of dirtyRects) {

        const rectData = await computeFn(
            rect,
            newSize.width,
            newSize.height,
            copySettingsWithView(computationSettings, newView)
        );

        // Translation rect -> newData beschreiben
        const copyRegion = {
            sourceX: 0, 
            sourceY: 0, 
            targetX: rect.x,
            targetY: rect.y,
            width  : rect.width, 
            height : rect.height, 
        };

        // berechnete Daten des Rechtecks in den neuen Cache 
        // an Stelle (rect.x, rect.y) übernehmen
        copyIterationRect(rectData, newData, copyRegion); 
        newData.referenceCandidates = mergeReferenceCandidates(
            newData.referenceCandidates,
            rectData.referenceCandidates
        );
    }

    newData.minIterations = findMinIterations(newData.iterations);
    newData.referenceCandidates = refreshReferenceCandidates(
        newData, 
        computationSettings.view
    );
    return newData; 
}

/**
 * Erweitert Iterationsdaten in horizontaler _oder_ vertikaler Richtung.
 *
 * Die vorhandenen Daten aus `oldData` werden positionsgetreu in eine
 * neue Matrix kopiert. 
 * Anschließend werden die neu entstandenen Bereiche mit `computeFn` berechnet.
 *
 * @param {ResizeDirection}      direction           - Richtung der Erweiterung.
 * @param {IterationData}        oldData             - Bisherige Iterationsdaten.
 * @param {View}                 oldView             - View, die zu `oldData` gehört.
 * @param {View}                 newView             - View, die zur erweiterten Zielmatrix gehört.
 * @param {ImageSize}            newSize             - (integer) Zielgröße der erweiterten Iterationsmatrix.
 * @param {ComputeIterationRect} computeFn           - Funktion zur Berechnung neu entstandener Rechtecke.
 * @param {ComputationSettings}  computationSettings - Berechnungseinstellungen als Grundlage.
 * @returns {Promise<IterationData>}                 - Erweiterte Iterationsdaten mit nachberechneten Randbereichen.
 */
async function expandIterationData(
    direction, 
    oldData,
    oldView,
    newView,
    newSize,
    computeFn,
    computationSettings 
) {

    const newData = createEmptyIterationData(newSize.width, newSize.height);

    const offsetX = direction === 'horizontal'
                  ? Math.round((  (oldView.minX - newView.minX) 
                                / (newView.maxX - newView.minX)) * newSize.width)
                  : 0 ;
    const offsetY = direction === 'vertical'        
                  ? Math.round((  (oldView.minY - newView.minY) 
                                / (newView.maxY - newView.minY)) * newSize.height)
                  : 0 ; 

    const preservedRect = {
            x     : offsetX, 
            y     : offsetY,
            width : oldData.width, 
            height: oldData.height, 
        };                                                 

    // Translation oldData (preservedRect) -> newData beschreiben
    const copyRegion = {
        sourceX: 0,
        sourceY: 0,
        targetX: preservedRect.x,
        targetY: preservedRect.y,
        width  : preservedRect.width,
        height : preservedRect.height,
    }; 

    // Daten aus oldData (preservedRect) nach newData kopieren
    copyIterationRect(oldData, newData, copyRegion);
    newData.referenceCandidates = shiftReferenceCandidates(
        oldData.referenceCandidates,
        preservedRect.x,
        preservedRect.y,
        newSize.width,
        newSize.height
    );

    return await fillDirtyResizeRects( 
        newData, 
        preservedRect, 
        newSize, 
        newView, 
        computeFn, 
        computationSettings );  
}

/**
 * Passt Iterationsdaten an eine neue Canvas-Größe an.
 *
 * Die Funktion koordiniert die Resize-Strategie:
 * - keine Größenänderung: vorhandene Daten und View werden unverändert zurückgegeben
 * - Verkleinerung: die Matrix wird vollständig neu berechnet
 * - Vergrößerung: die Matrix wird horizontal und/oder vertikal erweitert,
 *   wobei vorhandene Daten übernommen und nur neue Bereiche berechnet werden
 *
 * @param {IterationData}        oldData             - Bisherige Iterationsdaten.
 * @param {View}                 oldView             - View, die zu `oldData` gehört.
 * @param {View}                 newView             - Gewünschte View für die neue Canvas-Größe.
 * @param {ImageSize}            oldSize             - (integer) Bisherige Canvas-Größe.
 * @param {ImageSize}            newSize             - (integer) Neue Canvas-Größe.
 * @param {ComputeIterationRect} computeFn           - Funktion zur Berechnung einzelner Rechtecke.
 * @param {ComputationSettings}  computationSettings - Berechnungseinstellungen.
 * @throws {Error}                                   - Wenn keine alten Iterationsdaten übergeben werden.
 * @returns {Promise<ResizeIterationDataResult>}     - Angepasste Iterationsdaten und die dazu passende View.
 */
async function resizeIterationData( 
    oldData,
    oldView,
    newView,
    oldSize, 
    newSize,
    computeFn = computeMandelbrotRect,
    computationSettings 
) {
    
    const dx = newSize.width  - oldSize.width;
    const dy = newSize.height - oldSize.height;

    if (!oldData) {
        throw new Error('Resize without iteration data!');
    }

    // keine Veränderung whatsoever
    if ( dx == 0 && dy == 0 ) {
        return {
            iterationData:  oldData, 
            view:           oldView, 
        };
    }

    // komplette Neuberechnung bei Verkleinerung
    if ( dx < 0 || dy < 0 ) {

        const {width, height} = newSize; 
        const newData = createEmptyIterationData(width, height); 
        const rect = { x: 0, y: 0, width: width, height: height };
        const rectData = await computeFn(rect, width, height, computationSettings);

        // Translation rect -> newData beschreiben
        const copyRegion = { 
            sourceX: 0, 
            sourceY: 0, 
            targetX: rect.x,
            targetY: rect.y,
            width  : rect.width, 
            height : rect.height, 
        };

        // berechnete Daten des Rechtecks in den neuen Cache 
        // an Stelle (rect.x, rect.y) übernehmen
        copyIterationRect(rectData, newData, copyRegion);

        newData.minIterations = findMinIterations(newData.iterations);
        newData.referenceCandidates = refreshReferenceCandidates(
            newData, 
            computationSettings.view
        );

        return {
            iterationData:  newData, 
            view:           newView, 
        }
    }

    let currentData = oldData;
    let currentView = oldView;
    let currentSize = oldSize;

    // dx > 0 erweitere Matrix horizontal
    if ( dx > 0 ) {

        // width aus newSize, height aus currentSize
        const nextSize = {
            width:  newSize.width,
            height: currentSize.height
        };

        const nextView = expandViewToAspectRatio(currentView, nextSize.width / nextSize.height);

        currentData = await expandIterationData(  
                        'horizontal',
                        currentData,
                        currentView,
                        nextView,
                        nextSize,
                        computeFn,
                        computationSettings );
        currentView = nextView;
        currentSize = nextSize;
    }

    // dy > 0 erweitere Matrix vertikal
    if ( dy > 0 ) {

        // width aus currentSize, height aus newSize
        const nextSize = {
            width:  currentSize.width,
            height: newSize.height
        };

        const nextView = expandViewToAspectRatio(currentView, nextSize.width / nextSize.height);

        currentData = await expandIterationData(
                        'vertical',
                        currentData,
                        currentView,
                        nextView,
                        nextSize,
                        computeFn,
                        computationSettings );
        currentView = nextView;
        currentSize = nextSize;
    }

    return {
        iterationData:  currentData, 
        view:           currentView, 
    }; 
}

// -----------------------------------------------------------------------------
// Berechnung der Matrix mit den aktuellen View-Parametern 
// und Caching des Images
// -----------------------------------------------------------------------------

/**
 * Berechnet Iterationsdaten für eine vollständige Bildfläche.
 *
 * @callback ComputeIterationData
 * @param {number}              width               - (integer) Breite der Zielmatrix.
 * @param {number}              height              - (integer) Höhe der Zielmatrix.
 * @param {ComputationSettings} computationSettings - Einstellungen für die Fraktalberechnung.
 * @returns {Promise<IterationData>}                - Berechnete Iterationsdaten.
 */

/**
 * Berechnet die Iterationsdaten für die aktuelle Canvas-Größe neu.
 *
 * Die Funktion verwendet die aktuelle interne Canvas-Größe sowie die globalen
 * `computationSettings` und schreibt das Ergebnis in den globalen Cache
 * `iterationData`.
 *
 * @param {ComputeIterationData} [computeFn=computeMandelbrot] - Funktion zur vollständigen Berechnung.
 * @returns {Promise<void>}
 */
async function computeIterationData(
    computeFn = computeMandelbrot
) {

    const imageSize = getCanvasImageSize() 

    // hier könnte in Zukunft auch eine andere Berechnungsvorschrift 
    // gerufen werden, z.B. (Julia-Menge)
    iterationData = await measureIterationDataUpdate(() =>
                    computeFn(
                        imageSize.width, 
                        imageSize.height, 
                        computationSettings)
    );
}


// -----------------------------------------------------------------------------
// Hilfsfunktionen für die Ermittlung der Referenzkandidaten für 
// Perturbationsberechnungen
// -----------------------------------------------------------------------------

/**
 * Fuehrt mehrere Kandidatenlisten zusammen und reduziert sie auf die besten
 * Referenzkandidaten.
 *
 * Die Bewertung ist bewusst einfach: Kandidaten mit hoeherem Iterationswert
 * sind besser. Bei gleichem Iterationswert wird der kleinere Escape-Wert
 * bevorzugt, weil dieser Punkt tendenziell weniger stark divergiert ist.
 *
 * `undefined` oder leere Listen sind erlaubt, damit Aufrufer nicht an jeder
 * Stelle defensiv pruefen muessen, ob ein Ergebnis bereits Kandidaten enthaelt.
 *
 * @param {...ReferenceCandidate[]} candidateLists - Kandidatenlisten, die zusammengefuehrt werden sollen.
 * @returns {ReferenceCandidate[]} Die besten Kandidaten, absteigend nach Qualitaet sortiert.
 */
function mergeReferenceCandidates(
    ...candidateLists
) {
    const candidates = [];

    for (const candidateList of candidateLists) {
        if (!candidateList) {
            continue;
        }

        for (const candidate of candidateList) {
            candidates.push(candidate);
        }
    }

    candidates.sort((a, b) => {
        if (b.iterations !== a.iterations) {
            return b.iterations - a.iterations;
        }

        return a.escapeValue - b.escapeValue;
    });

    return candidates.slice(0, REFERENCE_CANDIDATE_LIMIT);
}

/**
 * Verschiebt Referenzkandidaten um eine Pixelverschiebung und entfernt
 * Kandidaten, die danach ausserhalb der Zielmatrix liegen.
 *
 * Diese Funktion passt zur Pan-Logik: vorhandene Iterationsdaten werden bei
 * einer Verschiebung im neuen Bild um `dx`/`dy` versetzt wiederverwendet.
 * Die komplexen Koordinaten `cx`/`cy` bleiben dabei unveraendert, weil sie
 * denselben mathematischen Punkt beschreiben. Nur die Pixelposition innerhalb
 * der neuen Zielmatrix aendert sich.
 *
 * @param {ReferenceCandidate[]} candidates - Bisherige Referenzkandidaten.
 * @param {number} dx                       - (integer) Horizontale Pixelverschiebung.
 * @param {number} dy                       - (integer) Vertikale Pixelverschiebung.
 * @param {number} width                    - (integer) Breite der Zielmatrix.
 * @param {number} height                   - (integer) Hoehe der Zielmatrix.
 * @returns {ReferenceCandidate[]} Verschobene und auf die Zielmatrix begrenzte Kandidaten.
 */
function shiftReferenceCandidates(
    candidates,
    dx, dy,
    width, height
) {
    if (!candidates) {
        return [];
    }

    const shiftedCandidates = [];

    for (const candidate of candidates) {
        const pixelX = candidate.pixelX + dx;
        const pixelY = candidate.pixelY + dy;

        if (pixelX < 0 || pixelX >= width || pixelY < 0 || pixelY >= height) {
            continue;
        }

        shiftedCandidates.push({
            ...candidate,
            pixelX,
            pixelY,
        });
    }

    return mergeReferenceCandidates(shiftedCandidates);
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
 * @param {PixelRect}        rect         - Berechneter Pixelbereich innerhalb der Zielmatrix.
 * @param {number}           imageWidth   - (integer) Breite der vollstaendigen Zielmatrix.
 * @param {number}           imageHeight  - (integer) Hoehe der vollstaendigen Zielmatrix.
 * @param {View}             view         - Ausschnitt der komplexen Ebene.
 * @param {IterationArray}   iterations   - Iterationswerte fuer `rect`.
 * @param {EscapeValueArray} escapeValues - Escape-Werte fuer `rect`.
 * @param {number}           [limit=REFERENCE_CANDIDATE_LIMIT] - (integer) Maximale Anzahl Kandidaten.
 * @returns {ReferenceCandidate[]} Beste Kandidaten aus dem uebergebenen Rechteck.
 */
function collectReferenceCandidatesFromArrays(
    rect,
    imageWidth, imageHeight,
    view,
    iterations,
    escapeValues,
    limit = REFERENCE_CANDIDATE_LIMIT
) {
    const gridColumns = 4;
    const gridRows = 4;
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

            if (
                !currentCandidate ||
                candidate.iterations > currentCandidate.iterations ||
                (
                    candidate.iterations === currentCandidate.iterations &&
                    candidate.escapeValue < currentCandidate.escapeValue
                )
            ) {
                candidatesByCell[cellIndex] = candidate;
            }
        }
    }

    return mergeReferenceCandidates(
        candidatesByCell.filter(candidate => candidate !== null)
    ).slice(0, limit);
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
    view
) {
    return collectReferenceCandidatesFromArrays(
        { x: 0, y: 0, width: iterationData.width, height: iterationData.height },
        iterationData.width,
        iterationData.height,
        view,
        iterationData.iterations,
        iterationData.escapeValues
    );
}

/**
 * Waehlt den besten Referenzkandidaten fuer eine Ziel-View aus.
 *
 * Die Funktion bevorzugt Kandidaten, die innerhalb der Ziel-View liegen. Unter
 * diesen Kandidaten gewinnt zuerst der hoehere Iterationswert. Bei gleichem
 * Iterationswert wird der Kandidat bevorzugt, der naeher an der Mitte der
 * Ziel-View liegt. Der Escape-Wert dient zuletzt als Tie-Breaker; ein kleinerer
 * Escape-Wert ist besser.
 *
 * Falls kein Kandidat innerhalb der Ziel-View liegt, wird der Kandidat gewaehlt,
 * der der Mitte der Ziel-View am naechsten liegt. Auch in diesem Fall dienen
 * Iterationswert und Escape-Wert als nachrangige Tie-Breaker.
 *
 * @param {ReferenceCandidate[]} referenceCandidates - Verfuegbare Referenzkandidaten.
 * @param {View}                 view                - Ziel-View, fuer die ein Referenzpunkt gesucht wird.
 * @returns {?ReferenceCandidate} Bester Kandidat fuer die Ziel-View oder null, wenn keine Kandidaten vorhanden sind.
 */
function selectReferenceCandidateForView(
    referenceCandidates,
    view
) {
    if (!referenceCandidates || referenceCandidates.length === 0) {
        return null;
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

    return [...referenceCandidates].sort(compareCandidates)[0];
}