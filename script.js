// Holen des Canvas-Elements
const canvas = document.getElementById('mandelbrotCanvas');
const ctx = canvas.getContext('2d');

// Startwerte für das Zoom-Selektionsfenster
const selection = {
    active: false,
    centerX: 0,
    centerY: 0,
    width: 0,
    height: 0,
};

// Mandelbrot-Daten und Bild-Cache
let cachedMandelbrotData = null;
let cachedImageData = null;

// Einstellungen für die Mandelbrot-Berechnung
const initialView = Object.freeze({
    minX: -3,
    maxX: 1,
    minY: -1.5,
    maxY: 1.5,
});

const computationSettings = {
    initialView,
    view: { ...initialView },
    maxIterations: 100,
    escapeRadius: 2,
};

// Einstellungen für das Rendering (z.B. Gamma-Korrektur)
const renderSettings = {
    gamma: 1.0,
    colorScalingCorrection: 1.0,
    paletteKey: 'goldBlue',
    innerSetColorKey: 'black',
};

const colors = {
    white: [255, 255, 255],
    black: [0, 0, 0],
    magenta: [255, 0, 255],
    cyan: [0, 255, 255],
    yellow: [255, 255, 0],
};

const colorPalettes = {
    goldBlue: {
        name: 'Gold-Blau',
        a: [0.5, 0.5, 0.5],
        b: [0.5, 0.5, 0.5],
        c: [1.0, 1.0, 1.0],
        d: [0.0, 0.1, 0.2],
    },

    fire: {
        name: 'Feuer',
        a: [0.60, 0.28, 0.08],
        b: [0.40, 0.30, 0.08],
        c: [1.0, 1.2, 1.5],
        d: [0.00, 0.05, 0.10],
    },

    ice: {
        name: 'Eis',
        a: [0.5, 0.5, 0.5],
        b: [0.5, 0.5, 0.5],
        c: [1.0, 1.0, 1.0],
        d: [0.55, 0.65, 0.75],
    },

    party: {
        name: 'Party',
        a: [0.5, 0.5, 0.5],
        b: [0.5, 0.5, 0.5],
        c: [1.0, 1.0, 1.0],
        d: [0.0, 0.33, 0.67],
    },
};


// -----------------------------------------------------------------------------
// Vue.js-App für die Steuer-Elemente (z.B. Gamma-Korrektur)
// -----------------------------------------------------------------------------
const app = Vue.createApp({
    data() {
        return {
          maxIterationsInput: computationSettings.maxIterations,
          escapeRadiusInput: computationSettings.escapeRadius,

          availablePalettes: colorPalettes,
          selectedPaletteKey: renderSettings.paletteKey,
          availableColors: colors,
          selectedInnerSetColorKey: renderSettings.innerSetColorKey,
          gamma: renderSettings.gamma,
          colorScalingCorrection: renderSettings.colorScalingCorrection,
        };
    },
    methods: {
        updateMaxIterations() {
            computationSettings.maxIterations = Math.max(10, Math.min(Number(this.maxIterationsInput), 2000));
            this.maxIterationsInput = computationSettings.maxIterations;

            computeAndCacheMandelbrot();
            updateInfo();
            renderScene();
        }, 

        updateEscapeRadius() {
            computationSettings.escapeRadius = Math.max(1.1, Math.min(Number(this.escapeRadiusInput), 20));
            this.escapeRadiusInput = computationSettings.escapeRadius;

            computeAndCacheMandelbrot();
            updateInfo();
            renderScene();
        },

        updateGamma() {
            renderSettings.gamma = this.gamma;
            renderColorsFromCachedData();
            renderScene();
        },

        updateColorscalingCorrection() {
            renderSettings.colorScalingCorrection = this.colorScalingCorrection;
            renderColorsFromCachedData();
            renderScene();
        }, 

        updatePalette() {
            renderSettings.paletteKey = this.selectedPaletteKey;
            renderColorsFromCachedData();
            renderScene();
        }, 

        updateInnerSetColor() {
            renderSettings.innerSetColorKey = this.selectedInnerSetColorKey;
            renderColorsFromCachedData();
            renderScene();
        }, 
    },
}).mount('#control-panel');


// -----------------------------------------------------------------------------
// Mandelbrot-Berechnung
// -----------------------------------------------------------------------------

// Berechnet die Anzahl der Iterationen für einen Bildpunkt, 
// bis die Divergenz eintritt
// Optimierungen: Schnelle Überprüfungen für Punkte, die sicher in der 
// Menge liegen
function mandelbrotIterations(cx, cy, maxIterations, escapeRadius) {

    // Schnelle Überprüfung: Periode-2-Glühbirne (Kreis auf der linken Seite)
    if ((cx + 1) * (cx + 1) + cy * cy <= 0.0625) { // 1/16 = 0.0625
        return {
            iterations: maxIterations,
            escapeValue: 0,
        };
    }

    // Schnelle Überprüfung: Hauptkardiode (Herzform in der Mitte)
    const q = (cx - 0.25) * (cx - 0.25) + cy * cy;
    if (q * (q + (cx - 0.25)) <= 0.25 * cy * cy) {
        return {
            iterations: maxIterations,
            escapeValue: 0,
        };
    }

    // Standard-Iterationen für Punkte, die nicht in den schnellen 
    // Überprüfungen liegen
    let zx = 0;
    let zy = 0;
    let iteration = 0;
    const escapeRadiusSquared = escapeRadius * escapeRadius;

    while (zx * zx + zy * zy < escapeRadiusSquared && iteration < maxIterations) {
        const temp = zx * zx - zy * zy + cx;
        zy = 2 * zx * zy + cy;
        zx = temp;
        iteration++;
    }

    return {
        iterations: iteration,
        escapeValue: zx * zx + zy * zy,
    };
}

// Berechnet das Mandelbrot-Bild für die gegebenen Parameter
function computeMandelbrot(width, height, computationSettings) {

    const { view, maxIterations, escapeRadius } = computationSettings;
    const { minX, maxX, minY, maxY } = view;

    const iterations = new Uint16Array(width * height);
    const escapeValues = new Float64Array(width * height);
    let minIterations = maxIterations; 


    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const x = minX + (px / width ) * (maxX - minX);
            const y = minY + (py / height) * (maxY - minY);
            const index = py * width + px;
            const result = mandelbrotIterations(x, y, maxIterations, escapeRadius);

            if ( result.iterations < minIterations ) {
                minIterations = result.iterations;
            }

            iterations[index] = result.iterations;
            escapeValues[index] = result.escapeValue;
        }
    }

    return {
        iterations,
        escapeValues,
        minIterations
    };
}

// -----------------------------------------------------------------------------
// Rendering-Funktionen für die Zahlenmatrix
// -----------------------------------------------------------------------------

// Einfache Farbzuordnung basierend auf der Anzahl der Iterationen
// Punkte, die zur Divergenz führen, werden farbig dargestellt
// Punkte, die innerhalb der Menge liegen, werden schwarz dargestellt
function iterationToColor(iterations, 
                          escapeValue, 
                          minIterations, 
                          maxIterations) {

    const innerSetColor = colors[renderSettings.innerSetColorKey] || [0, 0, 0];                            
    if (iterations === maxIterations) {
        return innerSetColor;
    }

    let smoothie = iterations; 

    // Smooth Coloring (Farbwert als Fließkommazahl basierend auf der Escape-Rate)
    smoothie = smoothie + 1 - Math.log2(Math.log2(Math.sqrt(escapeValue)));

    // Logarithmische Skalierung für bessere Farbverteilung
    smoothie = Math.log(smoothie - minIterations + renderSettings.colorScalingCorrection) 
                    / Math.log(maxIterations   - minIterations + renderSettings.colorScalingCorrection);

    // Gamma-Korrektur für bessere Kontraste                  
    smoothie = Math.pow(smoothie, renderSettings.gamma); 

    // Cosinus-Färbung 
    // Parameter für Gold-Blau-Palette
    const palette = colorPalettes[renderSettings.paletteKey];

    let r = 255 * (palette.a[0] + palette.b[0] * Math.cos(2* Math.PI * (palette.c[0] * smoothie + palette.d[0])));
    let g = 255 * (palette.a[1] + palette.b[1] * Math.cos(2* Math.PI * (palette.c[1] * smoothie + palette.d[1])));
    let b = 255 * (palette.a[2] + palette.b[2] * Math.cos(2* Math.PI * (palette.c[2] * smoothie + palette.d[2])));

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
    updateInfo();
    renderColorsFromCachedData();
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

    const { view, initialView } = computationSettings;

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

    const { view } = computationSettings;
    const { width, height } = canvas;

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
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY,
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
        const { width, height } = canvas;

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
    if (!selection.active) 
        return;
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

        const cv = canvas;
        const sl = selection;
        const zoomFactor = event.deltaY < 0 ? 0.9 : 1.1;

        sl.width *= zoomFactor;
        sl.height *= zoomFactor;

        // Optional: Mindest- und Max-Größe begrenzen
        sl.width = Math.max(20, Math.min(sl.width, cv.width));
        sl.height = Math.max(20, Math.min(sl.height, cv.height));

    } else {

        // Verändere die maxIterations mit dem Mausrad

        // Alias für einfacheren Zugriff
        const cs = computationSettings;

        cs.maxIterations += event.deltaY < 0 ? 50 : -50;
        cs.maxIterations = Math.max(50, Math.min(cs.maxIterations, 2000));

        // Synchronisiere mit Vue-Inputfeld
        app.maxIterationsInput = cs.maxIterations; 
        computeAndCacheMandelbrot();
    }
    renderScene();
}, { passive: false });

// Mouse-Up: Bestätigt die Auswahl und zoomt in den neuen Bereich
// -----------------------------------------------------------------------------
canvas.addEventListener('mouseup', () => {
    if (!selection.active) 
        return;
    commitSelection();
    selection.active = false;
    // Neu berechnen und cachen
    computeAndCacheMandelbrot(); 
    renderScene();
});

// -----------------------------------------------------------------------------
// Funktionen für das Info-Panel
// -----------------------------------------------------------------------------
function updateInfo() {
    const { view, initialView } = computationSettings;
    const infoDiv = document.getElementById('info');
    infoDiv.innerHTML = `
        X: ${view.minX.toFixed(6)} bis ${view.maxX.toFixed(6)}<br>
        Y: ${view.minY.toFixed(6)} bis ${view.maxY.toFixed(6)}<br>
        <strong>Zoom-Level:</strong> ${((initialView.maxX - initialView.minX) / (view.maxX - view.minX)).toFixed(2)}x<br>`;
}


// Initiale Berechnung
computeAndCacheMandelbrot();
updateInfo();
renderScene();
