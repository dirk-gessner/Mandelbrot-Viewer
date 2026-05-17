
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
// Funktionen für Verschiebung und Neuberechnung der aktuellen View
// -----------------------------------------------------------------------------

// übernimmt die Daten eines Rechtecks in den Ziel-Cache, 
// z.B. nach einer Verschiebung oder einer Multi-Thread-Berechnung
function writeIterationRectData(targetData, rect, rectData, imageWidth) {

    for (let localY = 0; localY < rect.height; localY++) {
        for (let localX = 0; localX < rect.width; localX++) {
            const sourceIndex = localY * rect.width + localX;
            const targetIndex = (rect.y + localY) * imageWidth + (rect.x + localX);

            targetData.iterations[targetIndex] = rectData.iterations[sourceIndex];
            targetData.escapeValues[targetIndex] = rectData.escapeValues[sourceIndex];
        }
    }
}

// übernimmt die den nach einer Verschiebung noch vorhandenen Bereich aus 
// dem alten Cache und schreibt ihn in den neuen Cache
function copyShiftedIterationData(oldData, newData, dx, dy, width, height) {
    const sourceX = Math.max(0, -dx);
    const sourceY = Math.max(0, -dy);

    const targetX = Math.max(0, dx);
    const targetY = Math.max(0, dy);

    const copyWidth = width - Math.abs(dx);
    const copyHeight = height - Math.abs(dy);

    if (copyWidth <= 0 || copyHeight <= 0) {
        return;
    }

    for (let y = 0; y < copyHeight; y++) {
        for (let x = 0; x < copyWidth; x++) {
            const sourceIndex = (sourceY + y) * width + (sourceX + x);
            const targetIndex = (targetY + y) * width + (targetX + x);

            newData.iterations[targetIndex] = oldData.iterations[sourceIndex];
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
function createShiftedIterationData(
    oldData,
    dx,
    dy,
    computeRect,
    computationSettings
) {
    const { width, height } = oldData;

    const newData = {
        width,
        height,
        iterations: new Uint16Array(width * height),
        escapeValues: new Float64Array(width * height),
        minIterations: 0,
    };

    // Daten des nach der Verschiebung noch sichtbaren Bereichs übernehmen
    copyShiftedIterationData(oldData, newData, dx, dy, width, height);

    // ermittle die neu sichtbar gewordenen Bereiche
    const dirtyRects = getDirtyPanRects(dx, dy, width, height);

    // Berechne die Iterationswerte für die neu sichtbar gewordenen Bereiche
    for (const rect of dirtyRects) {

        // die hier gerufene Funktion ist als Parameter übergeben worden
        const rectData = computeRect( rect, 
                                      width, height, 
                                      computationSettings );

        // berechnete Daten des Rechtecks in den neuen Cache übernehmen
        writeIterationRectData(newData, rect, rectData, width);
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

function copyIterationDataToRect(sourceData, targetData, targetRect) {
    for (let y = 0; y < sourceData.height; y++) {
        for (let x = 0; x < sourceData.width; x++) {
            const sourceIndex = y * sourceData.width + x;
            const targetIndex =
                (targetRect.y + y) * targetData.width + (targetRect.x + x);

            targetData.iterations[targetIndex] = sourceData.iterations[sourceIndex];
            targetData.escapeValues[targetIndex] = sourceData.escapeValues[sourceIndex];
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

function canCopyIterationDataToRect(sourceData, targetData, targetRect) {
    return (
        sourceData &&
        targetRect.x >= 0 &&
        targetRect.y >= 0 &&
        targetRect.width === sourceData.width &&
        targetRect.height === sourceData.height &&
        targetRect.x + targetRect.width <= targetData.width &&
        targetRect.y + targetRect.height <= targetData.height
    );
}

function resizeIterationData(
    oldData,
    oldView,
    newView,
    newSize,
    computeRect,
    computationSettings
) {
    const {width, height} = newSize; 

    // neue Iterationsmatrix anlegen
    const newData = {
        width,
        height,
        iterations: new Uint16Array(width * height),
        escapeValues: new Float64Array(width * height),
        minIterations: 0,
    };

    const targetRect = viewToPixelRect ( oldView, newView, newSize ); 

    if (!canCopyIterationDataToRect(oldData, newData, targetRect)) {
        const fullRect = { x: 0, y: 0, width, height };
        const fullData = computeRect(fullRect, width, height, computationSettings);

        writeIterationRectData(newData, fullRect, fullData, width);
        newData.minIterations = findMinIterations(newData.iterations);

        return newData;
    }
    
    // alten Bereich an passende Position kopieren
    copyIterationDataToRect(oldData, newData, targetRect); 

    // neue Randbereiche als Dirty Rects berechnen
    const dirtyRects = getDirtyResizeRects(targetRect, newSize);

    // Berechne die Iterationswerte für die neu sichtbar gewordenen Bereiche
    for (const rect of dirtyRects) {

        // die hier gerufene Funktion ist als Parameter übergeben worden
        const rectData = computeRect( rect, 
                                      width, height, 
                                      computationSettings );

        // berechnete Daten des Rechtecks in den neuen Cache übernehmen
        writeIterationRectData(newData, rect, rectData, width);
    }

    // minIterations neu bestimmen
    // Aktualisiere die minimale Iterationsanzahl im neuen Cache, 
    // da sich durch die Verschiebung neue Bereiche mit möglicherweise 
    // niedrigeren Iterationszahlen ergeben können
    newData.minIterations = findMinIterations(newData.iterations);

    // neue Iterationsdaten zurückgeben
    return newData;
}