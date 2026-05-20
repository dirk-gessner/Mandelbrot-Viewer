// -----------------------------------------------------------------------------
// Holen der DOM-Elemente für die Darstellung und Interaktion
// diese werden hier zentral definiert, damit sie in allen Modulen verwendet 
// werden können
// -----------------------------------------------------------------------------
const canvasWrapper = document.querySelector('.canvas-wrapper');
const renderOverlay = document.getElementById('render-overlay');
const canvas = document.getElementById('fractalCanvas');
const ctx = canvas.getContext('2d');
const controlsDrawer = document.getElementById('controls-drawer');
const controlsCloseButton = document.getElementById('controls-close-button');

