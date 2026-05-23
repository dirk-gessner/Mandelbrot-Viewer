// -----------------------------------------------------------------------------
// Funktionsammlung für Interaktionen mit der App
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Änderungen der View
// -----------------------------------------------------------------------------

// Zoom-Out-Schritt: Vergrößert den aktuellen View 
// schrittweise zurück zum initialen View
// -----------------------------------------------------------------------------
function zoomOutView(
    view, 
    initialView, 
    zoomOutFactor = 2.0
) {

    const currentWidth = view.maxX - view.minX;
    const currentHeight = view.maxY - view.minY;
    const targetWidth = initialView.maxX - initialView.minX;
    const targetHeight = initialView.maxY - initialView.minY;

    const currentCenterX = (view.minX + view.maxX) / 2;
    const currentCenterY = (view.minY + view.maxY) / 2;

    const targetCenterX = (initialView.minX + initialView.maxX) / 2;
    const targetCenterY = (initialView.minY + initialView.maxY) / 2;

    const nextWidth = Math.min(currentWidth * zoomOutFactor, targetWidth);
    const nextHeight = Math.min(currentHeight * zoomOutFactor, targetHeight);

    const sizeProgress =
        (nextWidth - currentWidth) / (targetWidth - currentWidth || 1);

    const nextCenterX =
        currentCenterX + (targetCenterX - currentCenterX) * sizeProgress;

    const nextCenterY =
        currentCenterY + (targetCenterY - currentCenterY) * sizeProgress;

    return {
        minX : nextCenterX - nextWidth  / 2,
        maxX : nextCenterX + nextWidth  / 2,
        minY : nextCenterY - nextHeight / 2,
        maxY : nextCenterY + nextHeight / 2,
    }

}

// Berechnet die neuen View-Parameter basierend auf der aktuellen Auswahl
// -----------------------------------------------------------------------------
function getViewFromSelection(
    view, 
    selection, 
    imageWidth, 
    imageHeight
) {
    
    const left = selection.centerX - selection.width / 2;
    const top = selection.centerY - selection.height / 2;
    const right = left + selection.width;
    const bottom = top + selection.height;

    const newMinX = view.minX + (left   / imageWidth ) * (view.maxX - view.minX);
    const newMaxX = view.minX + (right  / imageWidth ) * (view.maxX - view.minX);
    const newMinY = view.minY + (top    / imageHeight) * (view.maxY - view.minY);
    const newMaxY = view.minY + (bottom / imageHeight) * (view.maxY - view.minY);

    return {
        minX: newMinX,
        maxX: newMaxX,
        minY: newMinY,
        maxY: newMaxY,
    }; 
}

// Verschiebt die aktuelle View um den Vektor (pixelDx, pixelDy) 
// -----------------------------------------------------------------------------
function shiftViewByPixels(
    view, 
    pixelDx, pixelDy, 
    imageWidth, imageHeight
) {
    const viewWidth  = view.maxX - view.minX;
    const viewHeight = view.maxY - view.minY;
    const shiftX = (pixelDx / imageWidth ) * viewWidth;
    const shiftY = (pixelDy / imageHeight) * viewHeight;

    view.minX -= shiftX;
    view.maxX -= shiftX;
    view.minY -= shiftY;
    view.maxY -= shiftY;

    return view; 
}

// Startwerte für den Verschiebe-Vektor
// -----------------------------------------------------------------------------
const pan = {
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
};

const panDragThreshold = 4;

// -----------------------------------------------------------------------------
// Event-Listener für Mausinteraktionen
// -----------------------------------------------------------------------------

// liefert die Koordinaten relativ zum Canvas, um die Mausposition
// korrekt zu interpretieren
function getCanvasCoords(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY,
    };
}

// Kontextmenü verhindern
canvas.addEventListener('contextmenu', event => event.preventDefault());

// Mouse-Down: Startet die Auswahl eines neuen Bereichs
// -----------------------------------------------------------------------------
canvas.addEventListener('mousedown', (event) => {

      // linke Maustaste: Zoomt schrittweise zurück zum initialen View
    if (event.button === 0) { 
        const pos = getCanvasCoords(event);

        pan.active = true;
        pan.moved = false;
        pan.startX = pos.x;
        pan.startY = pos.y;
        pan.dx = 0;
        pan.dy = 0;
    } 
    // rechte Maustaste: Startet die Auswahl eines neuen Bereichs
    else if (event.button === 2) {

        const pos = getCanvasCoords(event);
        const { width, height } = canvas;

        selection.active  = true;
        selection.centerX = pos.x;
        selection.centerY = pos.y;
        selection.width   = width * 0.25;
        selection.height  = height * 0.25;
    }
    drawScene();
});

// Mouse-Move: Aktualisiert die Position des Auswahlrahmens
// -----------------------------------------------------------------------------
canvas.addEventListener('mousemove', (event) => {
    if (pan.active) {
        const pos = getCanvasCoords(event);
        pan.dx = Math.round(pos.x - pan.startX);
        pan.dy = Math.round(pos.y - pan.startY);

        if (!pan.moved && Math.hypot(pan.dx, pan.dy) >= panDragThreshold) {
            pan.moved = true;
        }

        if (pan.moved) {
            drawScene(pan.dx, pan.dy);
        }

        return;
    }

    if (selection.active) {
        const pos = getCanvasCoords(event);
        selection.centerX = pos.x;
        selection.centerY = pos.y;
        drawScene();
        return; 
    }
});

// Mouse-Wheel: Zoomt in oder aus, wenn die Auswahl aktiv ist, 
// und passt die Größe des Auswahlrahmens an
// Ansonsten wird das Mausrad verwendet, um maxIterations zu erhöhen 
// oder zu verringern
// -----------------------------------------------------------------------------
canvas.addEventListener('wheel', (event) => {

    if (pan.active) {
        return;
    }

    if (selection.active) {

        event.preventDefault();

        const cv = canvas;
        const sl = selection;
        const zoomFactor = event.deltaY < 0 ? 0.9 : 1.1;

        sl.width *= zoomFactor;
        sl.height *= zoomFactor;

        // Optional: Mindest- und Max-Größe begrenzen
        sl.width = Math.max(20, Math.min(sl.width, cv.width));
        sl.height = Math.max(20, Math.min(sl.height, cv.height));

    } else {

        // Verändere die maxIterations mit dem Mausrad

        // Alias für einfacheren Zugriff
        const cs = computationSettings;
        const limits = inputConstraints.maxIterations;

        cs.maxIterations += event.deltaY < 0 ? 50 : -50;
        cs.maxIterations = Math.max(limits.min, Math.min(cs.maxIterations, limits.max));

        // Synchronisiere mit Vue-Inputfeld
        app.maxIterationsInput = cs.maxIterations; 

        // Verzögerung von 250ms nach dem letzten Mausrad-Event;
        clearTimeout(inputTimer);
        inputTimer = setTimeout(() => {computeRenderAndDrawScene()}, 250); 
    }
    drawScene();
}, { passive: false });

// Mouse-Up: Bestätigt die Auswahl und zoomt in den neuen Bereich
// -----------------------------------------------------------------------------
window.addEventListener('mouseup', () => {

    if (! ( pan.active || selection.active )) {
        return ; 
    }

    let dx = 0; 
    let dy = 0; 

    if (pan.active) {

        if (pan.moved) {

            dx = pan.dx;
            dy = pan.dy;

            computationSettings.view = shiftViewByPixels(
                computationSettings.view, 
                dx, dy, 
                canvas.width, canvas.height
            );

        } else {

            computationSettings.view = zoomOutView(
                computationSettings.view, 
                computationSettings.initialView, 
                2.0
            );
        }

        pan.active = false;
        pan.moved  = false;
        pan.dx = 0;
        pan.dy = 0;

    } else if (selection.active) {
        computationSettings.view = getViewFromSelection( 
            computationSettings.view, 
            selection, 
            canvas.width, canvas.height); 
        selection.active = false;
    }

    // Neuberechnung, REndering und Ausgabe der neuen View
    computeRenderAndDrawScene(dx, dy);
});

// nach einem Resize-Event wird die Canvas-Größe angepasst und der View erweitert, 
// um das neue Seitenverhältnis zu erfüllen, um Verzerrungen zu vermeiden
// -----------------------------------------------------------------------------
window.addEventListener('resize', () => {
    clearTimeout(inputTimer);

    inputTimer = setTimeout(() => {
        resizeCanvasAndKeepView();
    }, 500);
});
