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

    data = cachedMandelbrotData;

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

