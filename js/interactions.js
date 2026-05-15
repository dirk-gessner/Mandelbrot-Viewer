// -----------------------------------------------------------------------------
// Zoom-Out-Schritt: Vergrößert den aktuellen View 
// schrittweise zurück zum initialen View
// -----------------------------------------------------------------------------
function zoomOutStep() {

    const { view, initialView } = computationSettings;

    const zoomOutFactor = 2.0;

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

    view.minX = nextCenterX - nextWidth / 2;
    view.maxX = nextCenterX + nextWidth / 2;
    view.minY = nextCenterY - nextHeight / 2;
    view.maxY = nextCenterY + nextHeight / 2;

}

// -----------------------------------------------------------------------------
// Berechnet die neuen View-Parameter basierend auf der aktuellen Auswahl
// -----------------------------------------------------------------------------
function commitSelection() {

    const { view } = computationSettings;
    const { width, height } = canvas;

    const left = selection.centerX - selection.width / 2;
    const top = selection.centerY - selection.height / 2;
    const right = left + selection.width;
    const bottom = top + selection.height;

    const newMinX = view.minX + (left / width) * (view.maxX - view.minX);
    const newMaxX = view.minX + (right / width) * (view.maxX - view.minX);
    const newMinY = view.minY + (top / height) * (view.maxY - view.minY);
    const newMaxY = view.minY + (bottom / height) * (view.maxY - view.minY);

    view.minX = newMinX;
    view.maxX = newMaxX;
    view.minY = newMinY;
    view.maxY = newMaxY;
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

// Zeichnen des Auswahlrahmens für Zoom-In
function drawSelectionFrame() {
    ctx.save();
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = 1;

    const x = selection.centerX - selection.width / 2;
    const y = selection.centerY - selection.height / 2;

    ctx.strokeRect(x, y, selection.width, selection.height);
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

// Mouse-Down: Startet die Auswahl eines neuen Bereichs
// -----------------------------------------------------------------------------
canvas.addEventListener('mousedown', (event) => {

      // linke Maustaste: Zoomt schrittweise zurück zum initialen View
    if (event.button === 0) { 
        zoomOutStep();
        recomputeWithOverlay();
    } 
    // rechte Maustaste: Startet die Auswahl eines neuen Bereichs
    else if (event.button === 2) {

        // Kontextmenü verhindern
        canvas.addEventListener('contextmenu', event => event.preventDefault());

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
canvas.addEventListener('mouseup', () => {
    if (!selection.active) 
        return;
    commitSelection();
    selection.active = false;
    // Neu berechnen und cachen
    recomputeWithOverlay();
});
