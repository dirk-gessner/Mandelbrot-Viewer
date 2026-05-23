// -----------------------------------------------------------------------------
// Holen der DOM-Elemente für die Darstellung und Interaktion
// diese werden hier zentral definiert, damit sie in allen Modulen verwendet 
// werden können
// -----------------------------------------------------------------------------
const canvasWrapper = document.querySelector('.canvas-wrapper');
const renderOverlay = document.getElementById('render-overlay');

/** 
 * @type {?HTMLCanvasElement} 
 * */
const canvas = document.getElementById('fractalCanvas');

/** 
 * @type {?CanvasRenderingContext2D} 
 * */
const ctx = canvas.getContext('2d');

if (!ctx) {
    throw new Error('2D canvas context could not be created.');
}

const controlsDrawer = document.getElementById('controls-drawer');
const controlsCloseButton = document.getElementById('controls-close-button');

