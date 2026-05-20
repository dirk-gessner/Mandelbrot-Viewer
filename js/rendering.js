// -----------------------------------------------------------------------------
// Funktionssammlung für Rendering der Iterations-Matrix
// -----------------------------------------------------------------------------


// -----------------------------------------------------------------------------
// Iterations-Matrix und Bild-Cache
// -----------------------------------------------------------------------------

// Daten-Cache: je eine Matrix für Iterations- und Escapewerte
// -----------------------------------------------------------------------------
// {
//     width,        - Breite               - integer
//     height,       - Höhe                 - integer
//     iterations,   - Iterationsmatrix     - Uint16Array(width * height)
//     escapeValues, - Escapewertmatrix     - Float64Array(width * height),
//     minIterations - der niedrigste Iterationswert der Feldes - integer
// };

let iterationData = null; 

// Imagecache (width * height)
// -----------------------------------------------------------------------------
// {
//      data         - enthält das zuletzt gerenderte Image als RGBA-Pixelmatrix
// }; 

let imageData = null;

// -----------------------------------------------------------------------------
// ermittelt die ImageSize aus der Zeichenfläche (canvas) 
// -----------------------------------------------------------------------------
function getCanvasImageSize() {
    return {
        width:  canvas.width,
        height: canvas.height
    };
}

// -----------------------------------------------------------------------------
// Rendering-Funktionen für die Iterations-Matrix
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

// alternierende Graustufen
function colorFromAlternatingGrayscale(t, palette) {
    const value = t % 2 === 0
        ? palette.even
        : palette.odd;

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

// kapselt die Verwendung von renderContext in 
// iterationToColor
function createIterationColorMapper(renderContext) {

    // Berechnet den RGB-Farbwert für einen Punkt basierend 
    // auf der Anzahl der Iterationen und dem Escapewert für 
    // diesen Punkt
    return function iterationToColor(  iterations, 
                                escapeValue, 
                                minIterations) {

        const { maxIterations, renderSettings, colors, colorPalettes } = renderContext;                                
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
        let linearT = ( range > 0) ? t / range : 0;

        // Logarithmische Skalierung für bessere Farbverteilung
        if (renderSettings.logScalingEnabled) {

            // abgesichert gegen Division durch 0
            const { logStrength, colorScalingCorrection } = renderSettings;
            const correction  = Math.max(colorScalingCorrection, 0.000001);
            const logT        = Math.log(Math.max(t + correction, 0.000001))
                              / Math.log(Math.max(range + correction, 1.000001));

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

        if (palette.type === 'alternatingGrayscale') {
            [r, g, b] = colorFromAlternatingGrayscale(iterations, palette);
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
    } ; 
}
// erzeugt die Pixelmatrix ImageData
// färbt Pixel ein
// gibt ImageData zurück
function createImageDataFromIterationData(  ctx,
                                            iterationData,
                                            imageSize,
                                            renderContext ) {

    const imageData = ctx.createImageData(imageSize.width, imageSize.height);
    const mapIterationToColor = createIterationColorMapper(renderContext); 

    // die Anzahl der Pixel in ImageData entspricht der Anzahl der 
    // Datenpunkte im Feld  iterations
    for (let pixelIndex = 0; pixelIndex < iterationData.iterations.length; pixelIndex++) {

        // Farbwert für einen konkreten Datenpunkt (pixelIndex) ermitteln
        const [r,g,b] = mapIterationToColor(
                            iterationData.iterations[pixelIndex],
                            iterationData.escapeValues[pixelIndex],
                            iterationData.minIterations); 

        // schreiben des Farbwerts nach imageData
        const dataIndex = pixelIndex * 4;
        imageData.data[dataIndex]     = r;
        imageData.data[dataIndex + 1] = g;
        imageData.data[dataIndex + 2] = b;
        imageData.data[dataIndex + 3] = 255;
    }

    return imageData;
}

// Rendert die Farben basierend auf der gecachten Iterations-Matrix 
// und speichert das gerenderte Image im Cache
function rebuildImageData() {

    // keine Daten -> kein Image
    if (!iterationData) {
        imageData = null;
        return;
    }   
    
    const { width, height } = iterationData;
    const imageSize = { width, height };  

    // Fehler werfen, wenn die Feldgrößen nicht zusammenpassen
    if (iterationData.iterations.length !== imageSize.width * imageSize.height) {
        throw new Error('IterationData size does not match width * height.');
    }    

    const renderContext = {
        maxIterations: computationSettings.maxIterations, 
        renderSettings, 
        colors, 
        colorPalettes
    }; 

    imageData = createImageDataFromIterationData(
        ctx,
        iterationData,
        imageSize,
        renderContext
    );
}

// -----------------------------------------------------------------------------
// Berechnung der Matrix mit den aktuellen View-Parametern 
// und Caching des Images
// -----------------------------------------------------------------------------
async function computeAndCacheIterationData(computeFn = computeMandelbrot) {

    const imageSize = getCanvasImageSize() 

    // hier könnte in Zukunft auch eine andere Berechnungsvorschrift 
    // gerufen werden, z.B. (Julia-Menge)
    iterationData = await computeFn(
                            imageSize.width, 
                            imageSize.height, 
                            computationSettings);
    app.updateInfo();
    rebuildImageData();
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
        requestAnimationFrame(async () => {
            try {
                await work()
                renderScene();
            } finally {
                hideRenderOverlay();
            }
        });
    });
}

function recomputeWithOverlay() {
    runWithOverlay(async () => {
        await computeAndCacheIterationData();
    });
}

// -----------------------------------------------------------------------------
// Rendering der Matrix und ggfs. des Auswahlrahmens
// -----------------------------------------------------------------------------
function renderScene() {
    // Zeichne das gecachte Image
    if (imageData) {
        ctx.putImageData(imageData, 0, 0);
    }

    if (selection.active) {
        drawSelectionFrame(ctx, selection);
    }
}

function renderPannedScene(pixelDx, pixelDy) {

    if (!imageData) {
        return;
    }

    const imageSize = getCanvasImageSize(); 

    ctx.save();
    ctx.clearRect(0, 0, imageSize.width, imageSize.height);
    ctx.putImageData(imageData, pixelDx, pixelDy);
    ctx.restore();
}

// Sammelfunktion für regelmäßig gemeinsam ausgeführte Schritte
function rerenderFromIterationData() {
    rebuildImageData(); 
    renderScene(); 
}
