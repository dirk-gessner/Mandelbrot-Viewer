// -----------------------------------------------------------------------------
// Funktionssammlung für Operationen auf der Iterationsmatrix, die unabhängig
// von der verwendeten Funktionalität (Julia, Mandelbrot, ...) sind 
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// ermittelt die minimale Anzahl von Iterationen in einem Datensatz
// -----------------------------------------------------------------------------
function findMinIterations(iterations) {
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

// -----------------------------------------------------------------------------
// erzeugt ein leeres IterationData-Objekt
// -----------------------------------------------------------------------------
function createEmptyIterationData(width, height) {
    return {
        width,
        height,
        iterations: new Uint16Array(width * height),
        escapeValues: new Float64Array(width * height),
        minIterations: 0
    };
}

// -----------------------------------------------------------------------------
// Funktionen für Verschiebung und Neuberechnung der aktuellen View
// -----------------------------------------------------------------------------

// übernimmt source oder einen Ausschnitt aus source nach target, 
// z.B. nach einer Verschiebung oder Erweiterung
// source                       - Quelle: iterationData
// target                       - Ziel:   iterationData 
// copyRegion (                 - beschreibt eine verschobene Kopie: 
//                                  source(sourceX + x, sourceY + y) 
//                                      -> target(targetX + x, targetY + y)
//       sourceX, sourceY,      - Sourcekordinaten
//       targetX, targetY,      - Zielkoordinaten
//       width, height)         - Ausdehnung des zu kopierenden Rechtecks
function copyIterationRect(source, target, copyRegion) 
{
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

// ermittelt die Bereiche (Rechtecke), die nach der Verschiebung 
// neu berechnet werden müssen
function getDirtyPanRects(dx, dy, width, height) {
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

// legt einen neuen IterationCache an, in dem der bisherige um eine 
// Pixel-Distanz (dx, dy) verschoben ist und berechnet 
// die neu hinzugekommenen Bereiche nach
function createShiftedIterationData(oldData,
                                    dx,
                                    dy,
                                    computeRect,
                                    computationSettings ) {

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

    // ermittle die neu sichtbar gewordenen Bereiche
    // returns: [{x, y, width, height}, {x, y, width, height}, ...]
    const dirtyRects = getDirtyPanRects(dx, dy, width, height);

    // Berechne die Iterationswerte für die neu sichtbar gewordenen Bereiche
    for (const rect of dirtyRects) {

        const rectData = computeRect(
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
    }

    // Aktualisiere die minimale Iterationsanzahl im neuen Cache, 
    // da sich durch die Verschiebung neue Bereiche mit möglicherweise 
    // niedrigeren Iterationszahlen ergeben können
    newData.minIterations = findMinIterations(newData.iterations);

    return newData;
}

// Wrapper-Funktion für die Verschiebung der Iteration-Matrix um (dx, dy)
function shiftIterationData(dx, dy) {

    // Wenn kein Cache vorhanden ist, einfach neu berechnen
    if (!iterationData) {
        computeAndCacheIterationData();
        return;
    }

    // Iterationsdaten verschieben
    // computeMandelbrotRect als Parameter austauschbar
    iterationData = createShiftedIterationData(
                                iterationData, 
                                dx, dy, 
                                computeMandelbrotRect, 
                                computationSettings ); 

    app.updateInfo();
    rebuildImageData();
}

// -----------------------------------------------------------------------------
// Funktionen für Resize und Neuberechnung der aktuellen View
// -----------------------------------------------------------------------------

function withView(settings, view) {
    return {
        ...settings,
        view
    };
}

function getDirtyResizeRects(preservedRect, newSize) {
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

function fillDirtyResizeRects(
    newData, 
    preservedRect, 
    newSize, newView, 
    computeRect, 
    computationSettings) {

    const dirtyRects = getDirtyResizeRects(preservedRect, newSize);

    for (const rect of dirtyRects) {

        const rectData = computeRect(
            rect,
            newSize.width,
            newSize.height,
            withView(computationSettings, newView)
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
    }

    newData.minIterations = findMinIterations(newData.iterations);
    return newData; 
}

function expandIterationData(
    direction, 
    oldData,
    oldView,
    newView,
    newSize,
    computeRect,
    computationSettings ) {

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

    return fillDirtyResizeRects( 
        newData, 
        preservedRect, 
        newSize, 
        newView, 
        computeRect, 
        computationSettings );  
}

function resizeIterationData(   oldData,
                                oldView,
                                newView,
                                oldSize, 
                                newSize,
                                computeRect,
                                computationSettings ) {
    
    const dx = newSize.width  - oldSize.width;
    const dy = newSize.height - oldSize.height;

    if (!oldData) {
        throw new Error('Resize without oldIterationData!');
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
        const rectData = computeRect(rect, width, height, computationSettings);

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

        currentData = expandIterationData(  
                        'horizontal',
                        currentData,
                        currentView,
                        nextView,
                        nextSize,
                        computeRect,
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

        currentData = expandIterationData(
                        'vertical',
                        currentData,
                        currentView,
                        nextView,
                        nextSize,
                        computeRect,
                        computationSettings );
        currentView = nextView;
        currentSize = nextSize;
    }

    return {
        iterationData:  currentData, 
        view:           currentView, 
    }; 
}
