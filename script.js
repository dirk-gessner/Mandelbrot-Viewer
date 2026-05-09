// Holen des Canvas-Elements
const canvas = document.getElementById('mandelbrotCanvas');
const ctx = canvas.getContext('2d');

// Bildgröße
const width = canvas.width;
const height = canvas.height;

// initialer Bereich der Mandelbrot-Menge
const initialView = {
  minX: -3,
  maxX: 1,
  minY: -1.5,
  maxY: 1.5,
};

const view = { ...initialView };

const selection = {
  active: false,
  centerX: 0,
  centerY: 0,
  width: 0,
  height: 0,
};

// Maximale Iterationen
let maxIterations = 100;

// Cache für das Mandelbrot-Bild
let cachedImageData = null; 


// -----------------------------------------------------------------------------
// Mandelbrot-Berechnung und Rendering
// -----------------------------------------------------------------------------
function mandelbrotIterations(cx, cy, maxIterations) {

  // Schnelle Überprüfung: Periode-2-Glühbirne (Kreis auf der linken Seite)
  if ((cx + 1) * (cx + 1) + cy * cy <= 0.0625) { // 1/16 = 0.0625
    return maxIterations;
  }

  // Schnelle Überprüfung: Hauptkardiode (Herzform in der Mitte)
  const q = (cx - 0.25) * (cx - 0.25) + cy * cy;
  if (q * (q + (cx - 0.25)) <= 0.25 * cy * cy) {
    return maxIterations;
  }
      
  let zx = 0;
  let zy = 0;
  let iteration = 0;

  while (zx * zx + zy * zy < 4 && iteration < maxIterations) {
    const temp = zx * zx - zy * zy + cx;
    zy = 2 * zx * zy + cy;
    zx = temp;
    iteration++;
  }

  return iteration;
}

function computeMandelbrot(width, height, minX, maxX, minY, maxY, maxIterations) {
  const data = new Uint16Array(width * height);

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = minX + (px / width) * (maxX - minX);
      const y = minY + (py / height) * (maxY - minY);
      data[py * width + px] = mandelbrotIterations(x, y, maxIterations);
    }
  }

  return data;
}

// -----------------------------------------------------------------------------
// Einfache Farbzuordnung basierend auf der Anzahl der Iterationen
// Punkte, die zur Divergenz führen, werden heller dargestellt
// Punkte, die innerhalb der Menge liegen, werden schwarz dargestellt
// -----------------------------------------------------------------------------

function iterationToColor(iterations, maxIterations) {
  if (iterations === maxIterations) {
    return [0, 0, 0];
  }

  const value = Math.floor((iterations / maxIterations) * 255);
  return [value, value, 255 - value];
}

// -----------------------------------------------------------------------------
// Rendering-Funktion für die Zahlenmatrix
// -----------------------------------------------------------------------------
function renderMandelbrot(ctx, width, height, data, maxIterations) {
  const imageData = ctx.createImageData(width, height);
  const pixels = imageData.data;

  for (let i = 0; i < data.length; i++) {
    const [r, g, b] = iterationToColor(data[i], maxIterations);
    const idx = i * 4;
    pixels[idx] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
    pixels[idx + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
}

// -----------------------------------------------------------------------------
// Berechnung der Matrix mit den aktuellen View-Parametern 
// und Caching des Images
// -----------------------------------------------------------------------------
function computeAndCacheMandelbrot() {
  const data = computeMandelbrot(width, height, view.minX, view.maxX, view.minY, view.maxY, maxIterations);
  cachedImageData = ctx.createImageData(width, height);
  const pixels = cachedImageData.data;

  for (let i = 0; i < data.length; i++) {
    const [r, g, b] = iterationToColor(data[i], maxIterations);
    const idx = i * 4;
    pixels[idx] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
    pixels[idx + 3] = 255;
  }
}

// -----------------------------------------------------------------------------
// Rendering der Matrix und ggfs. des Auswahlrahmens
// -----------------------------------------------------------------------------
function renderScene() {
  // Zeichne das gecachte Mandelbrot-Bild
  if (cachedImageData) {
    ctx.putImageData(cachedImageData, 0, 0);
  }

  if (selection.active) {
    drawSelectionFrame();
  }
}

// -----------------------------------------------------------------------------
// Zeichnen des Auswahlrahmens
// -----------------------------------------------------------------------------
function drawSelectionFrame() {
  ctx.save();
  ctx.strokeStyle = 'yellow';
  ctx.lineWidth = 1;
  // ctx.setLineDash([8, 4]);
  const x = selection.centerX - selection.width / 2;
  const y = selection.centerY - selection.height / 2;
  ctx.strokeRect(x, y, selection.width, selection.height);
  ctx.restore();
}

// -----------------------------------------------------------------------------
// Zoom-Out-Schritt: Vergrößert den aktuellen View 
// schrittweise zurück zum initialen View
// -----------------------------------------------------------------------------
function zoomOutStep() {

  const zoomOutFactor = 2.0;

  const currentWidth = view.maxX - view.minX;
  const currentHeight = view.maxY - view.minY;
  const targetWidth = initialView.maxX - initialView.minX;
  const targetHeight = initialView.maxY - initialView.minY;

  if (currentWidth >= targetWidth && currentHeight >= targetHeight) {
    Object.assign(view, initialView);
    return;
  }

  const centerX = (view.minX + view.maxX) / 2;
  const centerY = (view.minY + view.maxY) / 2;

  const newWidth = Math.min(currentWidth * zoomOutFactor, targetWidth);
  const newHeight = Math.min(currentHeight * zoomOutFactor, targetHeight);

  view.minX = centerX - newWidth / 2;
  view.maxX = centerX + newWidth / 2;
  view.minY = centerY - newHeight / 2;
  view.maxY = centerY + newHeight / 2;
}

// -----------------------------------------------------------------------------
// Berechnet die neuen View-Parameter basierend auf der aktuellen Auswahl
// -----------------------------------------------------------------------------
function commitSelection() {
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
// Event-Listener für Mausinteraktionen
// -----------------------------------------------------------------------------

// liefert die Koordinaten relativ zum Canvas, um die Mausposition
// korrekt zu interpretieren
function getCanvasCoords(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

// Mouse-Down: Startet die Auswahl eines neuen Bereichs
// -----------------------------------------------------------------------------
canvas.addEventListener('mousedown', (event) => {

    // linke Maustaste: Zoomt schrittweise zurück zum initialen View
  if (event.button === 0) { 
    zoomOutStep();
    computeAndCacheMandelbrot();
  } 
  // rechte Maustaste: Startet die Auswahl eines neuen Bereichs
  else if (event.button === 2) {

    // Kontextmenü verhindern
    canvas.addEventListener('contextmenu', event => event.preventDefault());

    const pos = getCanvasCoords(event);

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
  if (!selection.active) return;
  const pos = getCanvasCoords(event);
  selection.centerX = pos.x;
  selection.centerY = pos.y;
  renderScene();
});

// Mouse-Wheel: Zoomt in oder aus, wenn die Auswahl aktiv ist, 
// und passt die Größe des Auswahlrahmens an
// Ansonsten wird das Mausrad verwendet, um maxIterations zu erhöhen 
// oder zu verringern
// -----------------------------------------------------------------------------
canvas.addEventListener('wheel', (event) => {
  if (selection.active) {
    event.preventDefault();

    const zoomFactor = event.deltaY < 0 ? 0.9 : 1.1;
    selection.width *= zoomFactor;
    selection.height *= zoomFactor;

    // Optional: Mindest- und Max-Größe begrenzen
    selection.width = Math.max(20, Math.min(selection.width, width));
    selection.height = Math.max(20, Math.min(selection.height, height));
  } else {
    maxIterations += event.deltaY < 0 ? 50 : -50;
    maxIterations = Math.max(10, Math.min(maxIterations, 1000));
    computeAndCacheMandelbrot();
  }
  renderScene();
}, { passive: false });

// Mouse-Up: Bestätigt die Auswahl und zoomt in den neuen Bereich
// -----------------------------------------------------------------------------
canvas.addEventListener('mouseup', () => {
  if (!selection.active) return;
  commitSelection();
  selection.active = false;
  // Neu berechnen und cachen
  computeAndCacheMandelbrot(); 
  renderScene();
});

// Initiale Berechnung
computeAndCacheMandelbrot();
renderScene();