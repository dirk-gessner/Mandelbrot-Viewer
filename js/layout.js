// -----------------------------------------------------------------------------
// Funktionen für flexible Zeichenflächen- und View-Größen
// -----------------------------------------------------------------------------

function resetView() {
    const { initialView } = computationSettings;
    computationSettings.view = { ...initialView };
    recomputeWithOverlay();
}

// Berechnet den initialen View basierend auf dem Seitenverhältnis der Canvas,
// um sicherzustellen, dass der relevante Bereich der Mandelbrot-Menge immer 
// vollständig sichtbar ist, ohne Verzerrung
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

// Erweitert den aktuellen View so, dass er das Ziel-Seitenverhältnis erfüllt,
// ohne den Mittelpunkt zu verändern, um Verzerrungen zu vermeiden
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
    runWithOverlay(() => {

        const oldView = {...computationSettings.view};
        const oldIterationData = iterationData; 

        const oldSize = {
            width:  canvas.width,
            height: canvas.height,
        }

        resizeCanvasToDisplaySize();

        const newSize = {
            width:  canvas.width,
            height: canvas.height,
        }

        if (newSize.width === oldSize.width && newSize.height === oldSize.height) {
            return;
        }

        const newAspectRatio = newSize.width / newSize.height;
        const newInitialView = createInitialViewForAspectRatio(newAspectRatio);
        computationSettings.initialView = newInitialView;

        const newView = expandViewToAspectRatio( oldView, newAspectRatio );
        computationSettings.view = newView ; 

        iterationData = resizeIterationData(
            oldIterationData,
            oldView,
            newView,
            newSize,
            computeMandelbrotRect,
            computationSettings
        );

        app.updateInfo();
        rebuildImageData();
    });
}

// Passt die Größe des Canvas an die tatsächliche Anzeigengröße an, 
// um eine scharfe Darstellung zu gewährleisten
function resizeCanvasToDisplaySize() {
    const rect = canvas.getBoundingClientRect();

    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);
}

// Initialisiert die Canvas-Größe und den View basierend auf dem Seitenverhältnis,
// um sicherzustellen, dass die Mandelbrot-Menge korrekt dargestellt wird
function initializeCanvasAndView() {
    resizeCanvasToDisplaySize();

    const initialView = createInitialViewForAspectRatio(canvas.width / canvas.height);

    computationSettings.initialView = initialView;
    computationSettings.view = { ...initialView };
}

// timer für die Verzögerung der Neuberechnung 
// bei schnellen Events
let resizeTimer = null;

// nach einem Resize-Event wird die Canvas-Größe angepasst und der View erweitert, 
// um das neue Seitenverhältnis zu erfüllen, um Verzerrungen zu vermeiden
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);

    resizeTimer = setTimeout(() => {
        resizeCanvasAndKeepView();
    }, 250);
});
