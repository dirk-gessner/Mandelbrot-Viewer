// -----------------------------------------------------------------------------
// Funktionsammlung für Interaktionen mit der App
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Zoom-Out-Schritt: Vergrößert den aktuellen View 
// schrittweise zurück zum initialen View
// -----------------------------------------------------------------------------
function zoomOutStep(view, initialView, zoomOutFactor = 2.0) {

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

// -----------------------------------------------------------------------------
// Berechnet die neuen View-Parameter basierend auf der aktuellen Auswahl
// -----------------------------------------------------------------------------
function getViewFromSelection(view, selection, imageWidth, imageHeight) {
    
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

// -----------------------------------------------------------------------------
// Zoom-In-Selektionsfenster: Ermöglicht es dem Benutzer, einen Bereich auszuwählen,
// in den gezoomt werden soll, indem er mit der rechten Maustaste klickt und zieht
// -----------------------------------------------------------------------------

// Startwerte für das Zoom-In-Selektionsfenster
const selection = {
    active: false,
    centerX: 0,
    centerY: 0,
    width: 0,
    height: 0,
};

const pan = {
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
};

const panDragThreshold = 4;

// Zeichnen des Auswahlrahmens für Zoom-In
function drawSelectionFrame(ctx, selection) {

    const x = selection.centerX - selection.width / 2;
    const y = selection.centerY - selection.height / 2;
    const centerX = selection.centerX;
    const centerY = selection.centerY;

    ctx.save();

    // Auswahlrahmen
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, selection.width, selection.height);

    // Fadenkreuz
    ctx.globalAlpha = 0.8;
    ctx.beginPath();

    // vertikale Linie
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, canvas.height);

    // horizontale Linie
    ctx.moveTo(0, centerY);
    ctx.lineTo(canvas.width, centerY);

    ctx.stroke();

    // kleine Zielmarkierung im Zentrum
    ctx.beginPath();
    ctx.arc(centerX, centerY, 10, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.restore();
}

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

function shiftViewByPixels(pixelDx, pixelDy) {
    const { view } = computationSettings;
    const { width, height } = canvas;
    const viewWidth = view.maxX - view.minX;
    const viewHeight = view.maxY - view.minY;
    const shiftX = (pixelDx / width) * viewWidth;
    const shiftY = (pixelDy / height) * viewHeight;

    view.minX -= shiftX;
    view.maxX -= shiftX;
    view.minY -= shiftY;
    view.maxY -= shiftY;
}

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

        selection.active = true;
        selection.centerX = pos.x;
        selection.centerY = pos.y;
        selection.width = width * 0.25;
        selection.height = height * 0.25;
    }
    renderScene();
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
            renderPannedScene(pan.dx, pan.dy);
        }

        return;
    }

    if (!selection.active) 
        return;
    const pos = getCanvasCoords(event);
    selection.centerX = pos.x;
    selection.centerY = pos.y;
    renderScene();
});

// timer für die Verzögerung der Neuberechnung 
// bei schnellen Events
let wheelTimer = null;

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

        cs.maxIterations += event.deltaY < 0 ? 50 : -50;
        cs.maxIterations = Math.max(50, Math.min(cs.maxIterations, 2000));

        // Synchronisiere mit Vue-Inputfeld
        app.maxIterationsInput = cs.maxIterations; 

        // Verzögerung von 250ms nach dem letzten Mausrad-Event;
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => {     
            recomputeWithOverlay();
        }, 250); 
    }
    renderScene();
}, { passive: false });

// Mouse-Up: Bestätigt die Auswahl und zoomt in den neuen Bereich
// -----------------------------------------------------------------------------
window.addEventListener('mouseup', () => {

    if (pan.active) {
        const dx = pan.dx;
        const dy = pan.dy;
        const wasMoved = pan.moved;

        pan.active = false;
        pan.moved = false;
        pan.dx = 0;
        pan.dy = 0;

        if (wasMoved) {
            runWithOverlay(() => {
                shiftViewByPixels(dx, dy);
                shiftIterationData(dx, dy);
            });
        } else {
            computationSettings.view = zoomOutStep(
                                            computationSettings.view, 
                                            computationSettings.initialView, 
                                            2.0);
            recomputeWithOverlay();
        }

        return;
    }

    if (!selection.active) {
            return;
    }; 

    computationSettings.view = getViewFromSelection( 
                                    computationSettings.view, 
                                    selection, 
                                    canvas.width, canvas.height); 
    selection.active = false;
    
    // Neu berechnen und cachen
    recomputeWithOverlay();
});
