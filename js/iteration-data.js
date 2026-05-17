
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
