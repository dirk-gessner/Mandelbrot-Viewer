// js/dom.js
// -----------------------------------------------------------------------------
// Holen der DOM-Elemente für die Darstellung und Interaktion
// diese werden hier zentral definiert, damit sie in allen Modulen verwendet 
// werden können
// -----------------------------------------------------------------------------
const canvasWrapper = document.querySelector('.canvas-wrapper');
const renderOverlay = document.getElementById('render-Overlay');
const canvas = document.getElementById('mandelbrotCanvas');
const ctx = canvas.getContext('2d');

