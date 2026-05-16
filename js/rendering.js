// -----------------------------------------------------------------------------
// Mandelbrot-Daten und Bild-Cache
// -----------------------------------------------------------------------------
let cachedMandelbrotData = null;
let cachedImageData = null;

// -----------------------------------------------------------------------------
// Rendering-Funktionen für die Zahlenmatrix
// -----------------------------------------------------------------------------

// berechnet den RGB-Farbwert via Cosinus-Palette 
function colorFromCosinePalette(t, palette) {
    const r = 255 * (palette.a[0] + palette.b[0] * Math.cos(2 * Math.PI * (palette.c[0] * t + palette.d[0])));
    const g = 255 * (palette.a[1] + palette.b[1] * Math.cos(2 * Math.PI * (palette.c[1] * t + palette.d[1])));
    const b = 255 * (palette.a[2] + palette.b[2] * Math.cos(2 * Math.PI * (palette.c[2] * t + palette.d[2])));

    return [r, g, b];
}

// berechnet den RGB-Farbwert für eine Graustufen-Palette
function colorFromGrayscale(t) {
    const value = Math.round(t * 255);
    return [value, value, value];
}

// berechnet zyklische Farbbänder 
function colorFromCyclicBands(t) {
    const band = t % 128;
    const hue = (band / 128) * 360;

    return hsvToRgb(hue, 1, 1);
}

// Konvertiert HSV-Farbraum zu RGB
function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;

  let r, g, b;

  if (h < 60) {
    r = c; g = x; b = 0;
  } else if (h < 120) {
    r = x; g = c; b = 0;
  } else if (h < 180) {
    r = 0; g = c; b = x;
  } else if (h < 240) {
    r = 0; g = x; b = c;
  } else if (h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];
}

// invertiert den RGB-Wert eines Pixles, falls aktiviert,
function applyPaletteInversion(color) {
    return [
        255 - color[0],
        255 - color[1],
        255 - color[2],
    ];
}

// Berechnet den RGB-Farbwert für einen Punkt basierend 
// auf der Anzahl der Iterationen
function iterationToColor(iterations, 
                          escapeValue, 
                          minIterations, 
                          maxIterations) {

    const innerSetColor = colors[renderSettings.innerSetColorKey] || [0, 0, 0];                            
    if (iterations === maxIterations) {
        return innerSetColor;
    }

    let t = iterations; 

    // Smooth Coloring (Farbwert als Fließkommazahl basierend auf der Escape-Rate)
    if (renderSettings.smoothColoringEnabled) {
        t = t + 1 - Math.log2(Math.log2(Math.sqrt(escapeValue)));
    } 

    t = t - minIterations;
    const range = maxIterations - minIterations;
    const linearT = t / range;

    // Logarithmische Skalierung für bessere Farbverteilung
    if (renderSettings.logScalingEnabled) {

        const { logStrength, colorScalingCorrection } = renderSettings;
        const logT = Math.log(t     + colorScalingCorrection) 
                   / Math.log(range + colorScalingCorrection);

        // logStrength steuert die Mischung zwischen linearer
        // und logarithmischer Skalierung
        t = linearT * (1 - logStrength) + logT * logStrength;
    } else {
        t = linearT;
    }

    // Gamma-Korrektur für bessere Kontraste                  
    t = Math.pow(t, renderSettings.gamma); 

    // die gewählte Farbpalette entscheidet, wie der Farbwert 
    // aus dem "smoothie"-Wert berechnet wird
    const palette = colorPalettes[renderSettings.paletteKey];
    let r, g, b;

    if (palette.type === 'cosinus') {
        [r, g, b] = colorFromCosinePalette(t, palette);
    }

    if (palette.type === 'grayscale') {
        const value = Math.round(t * 255);
        [r, g, b] = [value, value, value];
    }

    if (palette.type === 'hsv') {
        [r, g, b] = hsvToRgb(t * 360, 1, 1);
    }

    if (palette.type === 'bands') {
        [r, g, b] = colorFromCyclicBands(iterations);
    }

    if (renderSettings.invertedPalette) {
        [r, g, b] = applyPaletteInversion([r, g, b]);
    }

    return [r, g, b];
}

// Rendert die Farben basierend auf den gecachten Mandelbrot-Daten
function renderColorsFromCachedData() {

    const { width, height } = canvas;
    const { maxIterations } = computationSettings;

    const data = cachedMandelbrotData;

    cachedImageData = ctx.createImageData(width, height);
    const pixels = cachedImageData.data;

    for (let i = 0; i < data.iterations.length; i++) {
        const [r, g, b] = iterationToColor(data.iterations[i], data.escapeValues[i], data.minIterations, maxIterations);
        const idx = i * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
    }
}

// -----------------------------------------------------------------------------
// Funktionen für Verschiebung und Neuberechnung der aktuellen View
// -----------------------------------------------------------------------------

// übernimmt die Daten eines Rechtecks in den Ziel-Cache, 
// z.B. nach einer Verschiebung oder einer Multi-Thread-Berechnung
function writeMandelbrotRect(targetData, rect, rectData, imageWidth) {

    for (let localY = 0; localY < rect.height; localY++) {
        for (let localX = 0; localX < rect.width; localX++) {
            const sourceIndex = localY * rect.width + localX;
            const targetIndex = (rect.y + localY) * imageWidth + (rect.x + localX);

            targetData.iterations[targetIndex] = rectData.iterations[sourceIndex];
            targetData.escapeValues[targetIndex] = rectData.escapeValues[sourceIndex];
        }
    }
}

// übernimmt die den nach einer Verschiebung noch vorhandenen Bereich aus 
// dem alten Cache und schreibt ihn in den neuen Cache
function copyShiftedMandelbrotData(oldData, newData, dx, dy, width, height) {
    const sourceX = Math.max(0, -dx);
    const sourceY = Math.max(0, -dy);

    const targetX = Math.max(0, dx);
    const targetY = Math.max(0, dy);

    const copyWidth = width - Math.abs(dx);
    const copyHeight = height - Math.abs(dy);

    if (copyWidth <= 0 || copyHeight <= 0) {
        return;
    }

    for (let y = 0; y < copyHeight; y++) {
        for (let x = 0; x < copyWidth; x++) {
            const sourceIndex = (sourceY + y) * width + (sourceX + x);
            const targetIndex = (targetY + y) * width + (targetX + x);

            newData.iterations[targetIndex] = oldData.iterations[sourceIndex];
            newData.escapeValues[targetIndex] = oldData.escapeValues[sourceIndex];
        }
    }
}

// ermittelt die Bereiche (Rechtecke), die nach der Verschiebung 
// neu berechnet werden müssen
function getDirtyPanRects(dx, dy, width, height) {
    const rects = [];

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx >= width || absDy >= height) {
        return [
            { x: 0, y: 0, width, height }
        ];
    }

    if (dx > 0) {
        rects.push({
            x: 0,
            y: 0,
            width: dx,
            height,
        });
    } else if (dx < 0) {
        rects.push({
            x: width + dx,
            y: 0,
            width: -dx,
            height,
        });
    }

    if (dy > 0) {
        rects.push({
            x: Math.max(dx, 0),
            y: 0,
            width: width - absDx,
            height: dy,
        });
    } else if (dy < 0) {
        rects.push({
            x: Math.max(dx, 0),
            y: height + dy,
            width: width - absDx,
            height: -dy,
        });
    }

    return rects;
}

// Verschiebt den Mandelbrot-Cache um eine Pixel-Distanz und berechnet nur die
// neu sichtbar gewordenen Bildbereiche nach.
function panCachedMandelbrotData(dx, dy) {

    // Wenn kein Cache vorhanden ist, einfach neu berechnen
    if (!cachedMandelbrotData) {
        computeAndCacheMandelbrot();
        return;
    }

    const { width, height } = canvas;
    const oldData = cachedMandelbrotData;
    const newData = {
        iterations: new Uint16Array(width * height),
        escapeValues: new Float64Array(width * height),
        minIterations: 0,
    };

    // Übernehme die Daten des nach der Verschiebung noch sichtbaren Bereichs
    copyShiftedMandelbrotData(oldData, newData, dx, dy, width, height);

    // ermittle die neu sichtbar gewordenen Bereiche
    const dirtyRects = getDirtyPanRects(dx, dy, width, height);

    // Berechne die Mandelbrot-Daten für die neu sichtbar gewordenen Bereiche
    for (const rect of dirtyRects) {
        const rectData = computeMandelbrotRect(
            rect,
            width,
            height,
            computationSettings
        );
        // Übernehme die berechneten Daten des Rechtecks in den neuen Cache
        writeMandelbrotRect(newData, rect, rectData, width);
    }

    // Aktualisiere die minimale Iterationsanzahl im neuen Cache, 
    // da sich durch die Verschiebung neue Bereiche mit möglicherweise 
    // niedrigeren Iterationszahlen ergeben können
    newData.minIterations = findMinIterations(newData.iterations);

    // Ersetze den alten Cache durch den neuen Cache
    cachedMandelbrotData = newData;

    app.updateInfo();
    renderColorsFromCachedData();
}

// -----------------------------------------------------------------------------
// Berechnung der Matrix mit den aktuellen View-Parametern 
// und Caching des Images
// -----------------------------------------------------------------------------
function computeAndCacheMandelbrot() {
    const { width, height } = canvas;
    cachedMandelbrotData = computeMandelbrot(width, height, computationSettings);
    app.updateInfo();
    renderColorsFromCachedData();
}

// -----------------------------------------------------------------------------
// Funktionen für das Render-Overlay
// -----------------------------------------------------------------------------
function showRenderOverlay() {
    canvasWrapper.classList.add('is-rendering');
    renderOverlay.classList.remove('hidden');
}

function hideRenderOverlay() {
    canvasWrapper.classList.remove('is-rendering');
    renderOverlay.classList.add('hidden');
}

function runWithOverlay(work) {
    showRenderOverlay();

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            try {
                work()
                renderScene();
            } finally {
                hideRenderOverlay();
            }
        });
    });
}

function recomputeWithOverlay() {
    runWithOverlay(() => {
        computeAndCacheMandelbrot();
    });
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

function renderPannedScene(pixelDx, pixelDy) {
    if (!cachedImageData) {
        return;
    }

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(cachedImageData, pixelDx, pixelDy);
    ctx.restore();
}

