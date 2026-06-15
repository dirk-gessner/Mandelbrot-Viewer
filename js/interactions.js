// -----------------------------------------------------------------------------
// Funktionsammlung für Interaktionen mit der App
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Änderungen der View
// -----------------------------------------------------------------------------

/**
 * Vergrößert den aktuellen View schrittweise zurück in Richtung initialView.
 *
 * Wird für Desktop-Doppelklick und Touch-Double-Tap verwendet.
 * Sobald der Zielbereich erreicht oder überschritten würde, wird exakt
 * `initialView` zurückgegeben.
 *
 * @param {View} view - Aktueller Ausschnitt.
 * @param {View} initialView - Ursprünglicher Startausschnitt.
 * @param {number} [zoomOutFactor=2.0] - Faktor zur Vergrößerung des Ausschnitts.
 * @returns {View} Neuer Ausschnitt.
 */
function zoomOutView(
    view, 
    initialView, 
    zoomOutFactor = 2.0
) {

    const centerX = (view.minX + view.maxX) / 2;
    const centerY = (view.minY + view.maxY) / 2;

    const currentWidth = view.maxX - view.minX;
    const currentHeight = view.maxY - view.minY;

    const targetWidth = initialView.maxX - initialView.minX;
    const targetHeight = initialView.maxY - initialView.minY;

    const nextWidth = Math.min(currentWidth * zoomOutFactor, targetWidth);
    const nextHeight = Math.min(currentHeight * zoomOutFactor, targetHeight);

    if (nextWidth >= targetWidth || nextHeight >= targetHeight) {
        return {
            minX: initialView.minX,
            maxX: initialView.maxX,
            minY: initialView.minY,
            maxY: initialView.maxY,
        };
    }

    return {
        minX : centerX - nextWidth  / 2,
        maxX : centerX + nextWidth  / 2,
        minY : centerY - nextHeight / 2,
        maxY : centerY + nextHeight / 2,
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

// pan.moved unterscheidet Tap von Drag. Erst ab panDragThreshold wird eine
// Verschiebung als echte Pan-Geste behandelt.
const panDragThreshold = 4;

// -----------------------------------------------------------------------------
// Event-Listener für Mausinteraktionen
// -----------------------------------------------------------------------------

/**
 * Rechnet Pointer-Koordinaten aus CSS-Pixeln in Canvas-Pixel um.
 *
 * Das ist notwendig, weil die interne Canvas-Auflösung von der dargestellten
 * CSS-Größe abweichen kann.
 *
 * @param {PointerEvent|MouseEvent|WheelEvent} event - Browser-Event mit clientX/clientY.
 * @returns {{x: number, y: number}} Position relativ zur Canvas-Bitmap.
 */
function getCanvasCoords(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY,
    };
}

const tap = {
  lastTime: 0,
  lastX: 0,
  lastY: 0,
  maxDelayMs: 300,
  maxDistancePx: 24,
};

/**
 * Prüft, ob eine Touch-Position als zweiter Tap eines Double-Taps gilt.
 *
 * Die Funktion aktualisiert den gespeicherten Tap-Zustand immer, auch wenn
 * kein Double-Tap erkannt wurde.
 *
 * @param {{x: number, y: number}} pos - Aktuelle Touch-Position in Canvas-Pixeln.
 * @returns {boolean} True, wenn Zeit- und Distanzschwelle erfüllt sind.
 */
function isDoubleTap(pos) {
  const now = performance.now();
  const dt = now - tap.lastTime;
  const distance = Math.hypot(pos.x - tap.lastX, pos.y - tap.lastY);

  const result = dt <= tap.maxDelayMs && distance <= tap.maxDistancePx;

  tap.lastTime = now;
  tap.lastX = pos.x;
  tap.lastY = pos.y;

  return result;
}

// Touch-Interaktionen verwenden Pointer-IDs, weil mehrere Finger parallel
// aktiv sein können. activePointers enthält immer die letzte bekannte
// Canvas-Position je Pointer.
const activePointers = new Map();

let pinchFrameRequested = false;

// Pinch-Zoom wird in zwei Phasen behandelt:
// 1. Während der Bewegung wird nur ein Auswahlrahmen gezeichnet.
// 2. Beim Loslassen wird daraus ein neuer View berechnet.
const pinch = {
    active: false,
    startDistance: 0,

    lastFrameCenterX: 0,
    lastFrameCenterY: 0,
    lastFrameWidth: 0,
    lastFrameHeight: 0,
};

function getActivePointerList() {
    return Array.from(activePointers.values());
}

function getPointerDistance(p1, p2) {
    return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

function getPointerCenter(p1, p2) {
    return {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
    };
}

function cloneView(view) {
    return {
        minX: view.minX,
        maxX: view.maxX,
        minY: view.minY,
        maxY: view.maxY,
    };
}

function startPinch() {
    const pointers = getActivePointerList();

    if (pointers.length !== 2) {
        return;
    }

    const center = getPointerCenter(pointers[0], pointers[1]);

    pinch.active = true;
    pinch.startDistance = getPointerDistance(pointers[0], pointers[1]);

    pan.active = false;
    pan.moved = false;
    pan.dx = 0;
    pan.dy = 0;
}

function finishPinch() {
    const pointers = getActivePointerList();

    if (!pinch.active || pointers.length !== 2) {
        return false;
    }

    const newView = getViewFromSelection(
        computationSettings.view,
        selection,
        canvas.width,
        canvas.height
    );

    selection.active = false;
    pinch.active = false;
    pinchFrameRequested = false;

    if (!newView) {
        return false;
    }

    computationSettings.view = newView;
    computeRenderAndDrawScene();

    return true;
}

/**
 * Aktualisiert den sichtbaren Zoom-Auswahlrahmen während einer Pinch-Geste.
 *
 * Die eigentliche Neuberechnung des Fraktals erfolgt erst beim Abschluss
 * der Geste; während der Bewegung wird nur die Vorschau gezeichnet.
 *
 * @returns {void}
 */
function updatePinchSelectionFrame() {
    if (!pinch.active || activePointers.size !== 2) {
        selection.active = false;
        drawScene();
        return;
    }

    const pointers = getActivePointerList();
    const currentDistance = getPointerDistance(pointers[0], pointers[1]);
    const currentCenter = getPointerCenter(pointers[0], pointers[1]);

    if (currentDistance <= pinch.startDistance) {
        selection.active = false;
        drawScene();
        return;
    }

    const scale = currentDistance / pinch.startDistance;

    selection.active = true;
    selection.centerX = currentCenter.x;
    selection.centerY = currentCenter.y;
    selection.width = canvas.width / scale;
    selection.height = canvas.height / scale;

    selection.width = Math.max(20, Math.min(selection.width, canvas.width));
    selection.height = Math.max(20, Math.min(selection.height, canvas.height));

    const changed =
        Math.abs(selection.centerX - pinch.lastFrameCenterX) > 1 ||
        Math.abs(selection.centerY - pinch.lastFrameCenterY) > 1 ||
        Math.abs(selection.width - pinch.lastFrameWidth) > 1 ||
        Math.abs(selection.height - pinch.lastFrameHeight) > 1;

    if (!changed) {
        return;
    }

    pinch.lastFrameCenterX = selection.centerX;
    pinch.lastFrameCenterY = selection.centerY;
    pinch.lastFrameWidth = selection.width;
    pinch.lastFrameHeight = selection.height;

    drawScene();
}

function requestPinchSelectionFrame() {
    if (pinchFrameRequested) {
        return;
    }

    pinchFrameRequested = true;

    requestAnimationFrame(() => {
        pinchFrameRequested = false;
        updatePinchSelectionFrame();
    });
}

// Kontextmenü verhindern
canvas.addEventListener('contextmenu', event => event.preventDefault());

// Pointer-Events für die Auswahl eines neuen Bereichs oder das Verschieben des Views
canvas.addEventListener('pointerdown', handleCanvasPointerDown);
canvas.addEventListener('pointermove', handleCanvasPointerMove);
canvas.addEventListener('pointerup', handleCanvasPointerUp);
canvas.addEventListener('pointercancel', handleCanvasPointerCancel);


// Pointer-Down: Startet die Auswahl eines neuen Bereichs
// -----------------------------------------------------------------------------
function handleCanvasPointerDown(event) {

    canvas.setPointerCapture(event.pointerId);

    // Touch: Startet die Pinch-Geste oder das Verschieben des Views
    if (event.pointerType === 'touch') {

        const pos = getCanvasCoords(event);

        activePointers.set(event.pointerId, {
            x: pos.x,
            y: pos.y,
        });

        if (activePointers.size === 1) {
            pan.active = true;
            pan.moved = false;
            pan.startX = pos.x;
            pan.startY = pos.y;
            pan.dx = 0;
            pan.dy = 0;
        } else if (activePointers.size === 2) {
            startPinch();
        }

        return;
    }

    // linke Maustaste: Startet das Verschieben des Views
    else if (event.pointerType === 'mouse' && event.button === 0) {    
        const pos = getCanvasCoords(event);

        pan.active = true;
        pan.moved = false;
        pan.startX = pos.x;
        pan.startY = pos.y;
        pan.dx = 0;
        pan.dy = 0;
    } 

    // rechte Maustaste: Startet die Auswahl eines neuen Bereichs
    else if (event.pointerType === 'mouse' && event.button === 2) {

        const pos = getCanvasCoords(event);
        const { width, height } = canvas;

        selection.active  = true;
        selection.centerX = pos.x;
        selection.centerY = pos.y;
        selection.width   = width * 0.25;
        selection.height  = height * 0.25;
    }

    drawScene();
};

// Pointer-Move: Aktualisiert die Position des Auswahlrahmens
// -----------------------------------------------------------------------------
function handleCanvasPointerMove(event) {

    if (event.pointerType === 'touch') {
        const pos = getCanvasCoords(event);

        if (activePointers.has(event.pointerId)) {
            activePointers.set(event.pointerId, {
                x: pos.x,
                y: pos.y,
            });
        }

        if (pinch.active) {
            requestPinchSelectionFrame();
            return;
        }
    }    

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
};

// Pointer-Up: Bestätigt die Auswahl und zoomt in den neuen Bereich
// -----------------------------------------------------------------------------
function handleCanvasPointerUp(event) {


    if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }

    if (event.pointerType === 'touch') {
        const pos = getCanvasCoords(event);

        if (activePointers.has(event.pointerId)) {
            activePointers.set(event.pointerId, {
                x: pos.x,
                y: pos.y,
            });
        }

        if (pinch.active) {
            finishPinch();
            activePointers.delete(event.pointerId);
            return;
        }

        activePointers.delete(event.pointerId);
    }

    if (pan.active) {

        if (event.pointerType === 'touch' && !pan.moved) {

            const pos = getCanvasCoords(event);

            pan.active = false;
            pan.moved  = false;
            pan.dx = 0;
            pan.dy = 0;

            if (isDoubleTap(pos)) {
                computationSettings.view = zoomOutView(
                    computationSettings.view,
                    computationSettings.initialView,
                    2.0
                );

                computeRenderAndDrawScene();
            }
        }

        if (pan.moved) {

            computationSettings.view = shiftViewByPixels(
                computationSettings.view, 
                pan.dx, pan.dy, 
                canvas.width, canvas.height
            );
            computeRenderAndDrawScene(pan.dx, pan.dy);
        }

        pan.active = false;
        pan.moved  = false;
        pan.dx = 0;
        pan.dy = 0;

        return; 
    }

    if (event.pointerType === 'mouse' && selection.active ) {

        computationSettings.view = getViewFromSelection( 
            computationSettings.view, 
            selection, 
            canvas.width, canvas.height); 
        selection.active = false;
        computeRenderAndDrawScene();
        return;
    }
}

function handleCanvasPointerCancel(event) {
    pan.active = false;
    selection.active = false;
    pinchFrameRequested = false;

    if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }

    activePointers.delete(event.pointerId);

    if (activePointers.size === 0) {
        pinch.active = false;
    }

    drawScene();
}

// Mouse-Wheel: Zoomt in oder aus, wenn die Auswahl aktiv ist, 
// und passt die Größe des Auswahlrahmens an
// Ansonsten wird das Mausrad verwendet, um iterationLimit zu erhöhen 
// oder zu verringern
// -----------------------------------------------------------------------------
canvas.addEventListener('wheel', (event) => {

    if (pan.active) {
        return;
    }

    if (!selection.active) {
        return
    }

    event.preventDefault();

    const cv = canvas;
    const sl = selection;
    const zoomFactor = event.deltaY < 0 ? 0.9 : 1.1;

    sl.width *= zoomFactor;
    sl.height *= zoomFactor;

    // Optional: Mindest- und Max-Größe begrenzen
    sl.width = Math.max(20, Math.min(sl.width, cv.width));
    sl.height = Math.max(20, Math.min(sl.height, cv.height));

    drawScene();
}, { passive: false });

// Doppelklick: Zoomt schrittweise zurück zum initialen View
// -----------------------------------------------------------------------------
canvas.addEventListener('dblclick', event => {
  event.preventDefault();

  computationSettings.view = zoomOutView(
    computationSettings.view,
    computationSettings.initialView,
    2.0
  );

  computeRenderAndDrawScene();
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
