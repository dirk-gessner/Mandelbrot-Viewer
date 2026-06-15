// -----------------------------------------------------------------------------
// Funktionen für flexible Zeichenflächen- und View-Größen
// -----------------------------------------------------------------------------

function resetView() {
    const { initialView } = computationSettings;
    computationSettings.view = { ...initialView };
    computeRenderAndDrawScene();
}

/**
 * Erzeugt den initialen View so, dass der definierte Mandelbrot-Startbereich
 * vollständig sichtbar bleibt und an das Canvas-Seitenverhältnis angepasst wird.
 *
 * @param {number} aspectRatio - Breite/Höhe des Canvas.
 * @returns {View} Sichtbarer Ausschnitt der komplexen Ebene.
 */
function createInitialViewForAspectRatio(aspectRatio) {
    const requiredView = {
        minX: -2.5,
        maxX: 1.0,
        minY: -1.5,
        maxY: 1.5,
    };

    const requiredWidth = requiredView.maxX - requiredView.minX;
    const requiredHeight = requiredView.maxY - requiredView.minY;
    const requiredAspectRatio = requiredWidth / requiredHeight;

    const centerX = (requiredView.minX + requiredView.maxX) / 2;
    const centerY = (requiredView.minY + requiredView.maxY) / 2;

    if (aspectRatio > requiredAspectRatio) {
        const height = requiredHeight;
        const width = height * aspectRatio;

        return {
            minX: centerX - width / 2,
            maxX: centerX + width / 2,
            minY: requiredView.minY,
            maxY: requiredView.maxY,
        };
    }

    const width = requiredWidth;
    const height = width / aspectRatio;

    return {
        minX: requiredView.minX,
        maxX: requiredView.maxX,
        minY: centerY - height / 2,
        maxY: centerY + height / 2,
    };
}

/**
 * Erweitert einen View auf ein Ziel-Seitenverhältnis, ohne den Mittelpunkt
 * des aktuellen Ausschnitts zu verschieben.
 *
 * Die Funktion zoomt nicht hinein, sondern erweitert bei Bedarf horizontal
 * oder vertikal, damit das Bild nach einem Resize nicht verzerrt wird.
 *
 * @param {View} view - Aktueller Ausschnitt der komplexen Ebene.
 * @param {number} targetAspectRatio - Ziel-Seitenverhältnis Breite/Höhe.
 * @returns {View} Neuer, seitenverhältnistreuer View.
 */
function expandViewToAspectRatio(view, targetAspectRatio) {

    const currentWidth = view.maxX - view.minX;
    const currentHeight = view.maxY - view.minY;
    const currentAspectRatio = currentWidth / currentHeight;

    const centerX = (view.minX + view.maxX) / 2;
    const centerY = (view.minY + view.maxY) / 2;

    const newView = {...view};

    if (targetAspectRatio > currentAspectRatio) {
        const newWidth = currentHeight * targetAspectRatio;

        newView.minX = centerX - newWidth / 2;
        newView.maxX = centerX + newWidth / 2;
    } else {
        const newHeight = currentWidth / targetAspectRatio;

        newView.minY = centerY - newHeight / 2;
        newView.maxY = centerY + newHeight / 2;
    }

    return newView ; 
}

// Passt die Größe des Canvas an die tatsächliche Anzeigengröße an und erweitert den View,
// um das neue Seitenverhältnis zu erfüllen, um sicherzustellen, dass die Mandelbrot-Menge
// korrekt dargestellt wird, ohne Verzerrungen oder abgeschnittene Bereiche
function resizeCanvasAndKeepView() {

    // wenn es noch keine Iteration-Daten gibt, ist hier nichts zu tun
    if (!iterationData) {
        return; 
    }

    const oldIterationData = iterationData;
    const oldView = { ...(oldIterationData.view ?? computationSettings.view) }; 

    const oldSize = {
        width:  canvas.width,
        height: canvas.height,
    }

    // wenn kein Resize stattgefunden hat, ist hier nichts zu tun
    if (!resizeCanvasToDisplaySize()){
        return; 
    };

    const newSize = {
        width:  canvas.width,
        height: canvas.height,
    }

    const newAspectRatio = newSize.width / newSize.height;
    const newInitialView = createInitialViewForAspectRatio(newAspectRatio);
    computationSettings.initialView = newInitialView;

    const newView = expandViewToAspectRatio( oldView, newAspectRatio );
    computationSettings.view = newView ; 

    runWithOverlay(async () => {
        // resizeIterationData verarbeitet kombinierte Größenänderungen schrittweise.
        // Der zurückgegebene View gehört exakt zu den erzeugten Iterationsdaten und
        // muss deshalb zusammen mit ihnen übernommen werden.
        // returns: { iterationData, view }
        const resizeResult = await resizeIterationData(
            oldIterationData,
            newView,
            oldSize,
            newSize,
            computeMandelbrotRect,
            finalizeMandelbrot, 
            computationSettings
        );
        iterationData = resizeResult.iterationData;
        computationSettings.view = resizeResult.view; 

        renderAndDrawScene();
        }
    );
}

// Passt die Größe des Canvas an die tatsächliche Anzeigengröße an, 
// um eine scharfe Darstellung zu gewährleisten
function resizeCanvasToDisplaySize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    if (canvas.width === width && canvas.height === height) {
        return false;
    }

    canvas.width = width;
    canvas.height = height;

    return true;
}

// Initialisiert die Canvas-Größe und den View basierend auf dem Seitenverhältnis,
// um sicherzustellen, dass die Mandelbrot-Menge korrekt dargestellt wird
function initializeCanvasAndView() {
    resizeCanvasToDisplaySize();

    const initialView = createInitialViewForAspectRatio(canvas.width / canvas.height);

    computationSettings.initialView = initialView;
    computationSettings.view = { ...initialView };
}

function openControlsDrawer() {
    controlsDrawer.classList.add('open');
    controlsDrawer.setAttribute('aria-expanded', 'true');
}

function closeControlsDrawer() {
    controlsDrawer.classList.remove('open');
    controlsDrawer.setAttribute('aria-expanded', 'false');
}

/**
 * Umschaltfunktion für spätere explizite Toggle-Buttons.
 *
 * Aktuell wird der Drawer über open/close direkt gesteuert.
 *
 * @returns {void}
 */
function toggleControlsDrawer() {
    if (controlsDrawer.classList.contains('open')) {
        closeControlsDrawer();
    } else {
        openControlsDrawer();
    }
}

/**
 * Initialisiert den Control-Drawer für Maus-, Touch- und Tastaturbedienung.
 *
 * Desktop: Öffnen per Hover.
 * Touch: Öffnen per Pointer-Down auf die Griff-/Tab-Fläche.
 * Tastatur: Schließen per Escape.
 *
 * @returns {void}
 */
function initializeControlsDrawer() {
    controlsDrawer.setAttribute('aria-expanded', 'false');

    controlsDrawer.addEventListener('mouseenter', () => {
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            openControlsDrawer();
        }
    });

    controlsDrawer.addEventListener('pointerdown', (event) => {
        if (controlsDrawer.classList.contains('open')) {
            return;
        }

        event.preventDefault();
        openControlsDrawer();
    });

    controlsCloseButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeControlsDrawer();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeControlsDrawer();
        }
    });

    window.setTimeout(() => {
        controlsDrawer.classList.add('initial-reveal-done');
    }, 2000);    
}

