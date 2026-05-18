
// js/renderings.js
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

// übernimmt die Daten eines Rechtecks in den Ziel-Cache, 
// z.B. nach einer Verschiebung oder einer Multi-Thread-Berechnung
// targetData                   - Ziel: iterationData 
// rect (x,y, width, height)    - Koordinaten und Ausdehnung des Rechtecks, 
//                                in das RectData zu schreiben sind
// rectData                     - Quelle: iterationData
//
function writeIterationRectData(targetData, rect, rectData) {

    const targetWidth = targetData.width ; 

    for (let localY = 0; localY < rect.height; localY++) {
        for (let localX = 0; localX < rect.width; localX++) {

            const sourceIndex = localY * rect.width + localX;
            const targetIndex = (rect.y + localY) * targetWidth + (rect.x + localX);

            targetData.iterations  [targetIndex] = rectData.iterations  [sourceIndex];
            targetData.escapeValues[targetIndex] = rectData.escapeValues[sourceIndex];
        }
    }
}

// übernimmt die den nach einer Verschiebung noch vorhandenen Bereich aus 
// dem alten Cache und schreibt ihn in den neuen Cache
function copyShiftedIterationData(oldData, newData, dx, dy) {

    const sourceX = Math.max(0, -dx);
    const sourceY = Math.max(0, -dy);

    const targetX = Math.max(0, dx);
    const targetY = Math.max(0, dy);

    const copyWidth  = newData.width  - Math.abs(dx);
    const copyHeight = newData.height - Math.abs(dy);

    if (copyWidth <= 0 || copyHeight <= 0) {
        return;
    }

    for (let y = 0; y < copyHeight; y++) {
        for (let x = 0; x < copyWidth; x++) {
            const sourceIndex = (sourceY + y) * newData.width + (sourceX + x);
            const targetIndex = (targetY + y) * newData.width + (targetX + x);

            newData.iterations  [targetIndex] = oldData.iterations  [sourceIndex];
            newData.escapeValues[targetIndex] = oldData.escapeValues[sourceIndex];
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

    // Daten des nach der Verschiebung noch sichtbaren Bereichs übernehmen
    copyShiftedIterationData(oldData, newData, dx, dy);

    // ermittle die neu sichtbar gewordenen Bereiche
    // returns: [{x, y, width, height}, {x, y, width, height}, ...]
    const dirtyRects = getDirtyPanRects(dx, dy, width, height);

    // Berechne die Iterationswerte für die neu sichtbar gewordenen Bereiche
    for (const dirtyRect of dirtyRects) {

        // die hier gerufene Funktion ist als Parameter übergeben worden
        // returns: rectData = { iterations, escapeValues }
        const dirtyRectData = computeRect(dirtyRect, 
                                          width, height, 
                                          computationSettings );

        // berechnete Daten des Rechtecks in den neuen Cache übernehmen
        writeIterationRectData(newData, dirtyRect, dirtyRectData);
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

function copyIterationDataRect(sourceData, targetData, rect) {
    for (let y = 0; y < rect.height; y++) {
        for (let x = 0; x < rect.width; x++) {
            const sourceIndex =
                (rect.sourceY + y) * sourceData.width +
                (rect.sourceX + x);

            const targetIndex =
                (rect.targetY + y) * targetData.width +
                (rect.targetX + x);

            targetData.iterations[targetIndex] =
                sourceData.iterations[sourceIndex];

            targetData.escapeValues[targetIndex] =
                sourceData.escapeValues[sourceIndex];
        }
    }
}

function copyIterationDataRect(sourceData, targetData, rect) {

    for (let y = 0; y < rect.height; y++) {
        for (let x = 0; x < rect.width; x++) {
            const sourceIndex =
                (rect.sourceY + y) * sourceData.width +
                (rect.sourceX + x);

            const targetIndex =
                (rect.targetY + y) * targetData.width +
                (rect.targetX + x);

            targetData.iterations[targetIndex] =
                sourceData.iterations[sourceIndex];

            targetData.escapeValues[targetIndex] =
                sourceData.escapeValues[sourceIndex];
        }
    }
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

function viewToPixelRect(view, containingView, imageSize) {
    const containingWidth = containingView.maxX - containingView.minX;
    const containingHeight = containingView.maxY - containingView.minY;

    const x = Math.round(
        ((view.minX - containingView.minX) / containingWidth) * imageSize.width
    );

    const y = Math.round(
        ((view.minY - containingView.minY) / containingHeight) * imageSize.height
    );

    const width = Math.round(
        ((view.maxX - view.minX) / containingWidth) * imageSize.width
    );

    const height = Math.round(
        ((view.maxY - view.minY) / containingHeight) * imageSize.height
    );

    return { x, y, width, height };
}


function expandIterationDataHorizontally(   oldData,
                                            oldView,
                                            newView,
                                            newSize,
                                            computeRect,
                                            computationSettings ) {

    const newData = createEmptyIterationData(newSize.width, newSize.height);

    const offsetX = Math.round(((oldView.minX - newView.minX) / (newView.maxX - newView.minX)) * newSize.width);

    copyIterationDataRect(oldData, 
                          newData, 
                          { sourceX: 0,
                            sourceY: 0,
                            targetX: offsetX,
                            targetY: 0,
                            width:  oldData.width,
                            height: oldData.height });

    // hier besser getDirtyResizeRects verwenden                            
    const dirtyRects = [];

    if (offsetX > 0) {
        dirtyRects.push({
            x: 0,
            y: 0,
            width:  offsetX,
            height: newSize.height
        });
    }

    const rightX = offsetX + oldData.width;

    if (rightX < newSize.width) {
        dirtyRects.push({
            x: rightX,
            y: 0,
            width: newSize.width - rightX,
            height: newSize.height
        });
    }

    for (const rect of dirtyRects) {
        const rectData = computeRect(
            rect,
            newSize.width,
            newSize.height,
            withView(computationSettings, newView)
        );

        writeIterationRectData(newData, rect, rectData);
    }

    newData.minIterations = findMinIterations(newData.iterations);
    return newData;
}

function expandIterationDataVertically( oldData,
                                        oldView,
                                        newView,
                                        newSize,
                                        computeRect,
                                        computationSettings ) {

    const newData = createEmptyIterationData(newSize.width, newSize.height);

    const offsetY = Math.round(((oldView.minY - newView.minY) / (newView.maxY - newView.minY)) * newSize.height);

    copyIterationDataRect(oldData, 
                          newData, 
                          { sourceX: 0,
                            sourceY: 0,
                            targetX: 0,
                            targetY: offsetY,
                            width:  oldData.width,
                            height: oldData.height });

    // hier besser getDirtyResizeRects verwenden                            
    const dirtyRects = [];

    if (offsetY > 0) {
        dirtyRects.push({
            x: 0,
            y: 0,
            width:  newSize.width,
            height: offsetY
        });
    }

    const bottomY = offsetY + oldData.height;

    if (bottomY < newSize.height) {
        dirtyRects.push({
            x: 0,
            y: bottomY,
            width:  newSize.width,
            height: newSize.height - bottomY
        });
    }

    for (const rect of dirtyRects) {
        const rectData = computeRect(
            rect,
            newSize.width,
            newSize.height,
            withView(computationSettings, newView)
        );

        writeIterationRectData(newData, rect, rectData);
    }

    newData.minIterations = findMinIterations(newData.iterations);

    return newData;
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
        newData = createEmptyIterationData(width, height); 
        const rect = { x: 0, y: 0, width: width, height: height };
        // returns { iterations, escapeValues }
        rectData = computeRect(rect, width, height, computationSettings);

        writeIterationRectData(newData, rect, rectData);
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

        currentData = expandIterationDataHorizontally(  currentData,
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

        currentData = expandIterationDataVertically(    currentData,
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
