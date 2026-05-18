// -----------------------------------------------------------------------------
// globale Objekte für die Parameter für Berechnung und Rendering
// -----------------------------------------------------------------------------

// Einstellungen für die Mandelbrot-Berechnung
const computationSettings = {
    initialView: null,
    view: null,
    maxIterations: 100,
    escapeRadius: 2,
};

// Einstellungen für das Rendering (z.B. Gamma-Korrektur)
const renderSettings = {
    gamma: 1.0,
    colorScalingCorrection: 1.0,
    paletteKey: 'goldBlue',
    innerSetColorKey: 'black',
    smoothColoringEnabled: true,
    logScalingEnabled: true,
    logStrength: 1.0,
    invertedPalette: false,
};

