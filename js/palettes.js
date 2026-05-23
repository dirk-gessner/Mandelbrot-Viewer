// -----------------------------------------------------------------------------
// Definitionen für Farben und Farbpaletten
// -----------------------------------------------------------------------------

/**
 * RGB-Farbwert mit je einem Kanal für Rot, Grün und Blau.
 * Jeder Kanal ist ein ganzzahliger Wert von 0 bis 255.
 *
 * @typedef {[number, number, number]} RgbColor
 */

/**
 * Benannte RGB-Farben, die z.B. für die innere Menge verwendet werden können.
 *
 * @type {Object.<string, RgbColor>}
 */
const colors = {
    weiß:    [255, 255, 255],
    schwarz: [0, 0, 0],
    magenta: [255, 0, 255],
    cyan:    [0, 255, 255],
    gelb:    [255, 255, 0],
    rot:     [255, 0, 0],
    grün:    [0, 255, 0],
    blau:    [0, 0, 255],
};

/**
 * Gemeinsame Eigenschaften aller Farbpaletten.
 *
 * @typedef {Object} BasePalette
 * @property {string} name - Anzeigename der Palette.
 * @property {string} type - Technischer Typ der Palette.
 */

/**
 * RGB-Faktorvektor für Palettenberechnungen.
 * Die Werte sind Dezimalwerte und werden kanalweise verwendet.
 *
 * @typedef {[number, number, number]} RgbFactor
 */

/**
 * Cosinus-Palette nach vier RGB-Parametervektoren.
 *
 * https://apps.fenixfox-studios.com/cosine_palette/
 * 
 * Die RGB-Faktorvektoren werden kanalweise gelesen:
 * Index 0 = Rot, Index 1 = Grün, Index 2 = Blau.
 *
 * a = Grundwert.
 * b = Kontrast / Amplitude.
 * c = Wiederholungen / Frequenz.
 * d = Verschiebung / Phase.
 *
 * @typedef {BasePalette & {
 *   type: 'cosinus',
 *   a: RgbFactor,
 *   b: RgbFactor,
 *   c: RgbFactor,
 *   d: RgbFactor
 * }} CosinePalette
 */

/**
 * @typedef {BasePalette & {
 *   type:  'alternatingColors',
 *   even:  RgbColor,
 *   odd:   RgbColor
 * }} AlternatingColorsPalette
 */

/**
 * @typedef {BasePalette & { type: 'hsv' }} HsvPalette
 */

/**
 * @typedef {BasePalette & { type: 'bands' }} BandsPalette
 */

/**
 * @typedef {
 *   CosinePalette |
 *   AlternatingColorsPalette |
 *   HsvPalette |
 *   BandsPalette
 * } ColorPalette
 */

/**
 * Verfügbare Farbpaletten für das Rendering des Fraktals.
 *
 * @type {Object.<string, ColorPalette>}
 */

const colorPalettes = {
    goldBlue: {
        name: 'Gold-Blau',
        type: 'cosinus',
        a: [0.50, 0.50, 0.50],
        b: [0.50, 0.50, 0.50],
        c: [1.00, 1.00, 1.00],
        d: [0.00, 0.10, 0.25],
    },

    fire: {
        name: 'Feuer',
        type: 'cosinus',
        a: [0.60, 0.00, 0.00],
        b: [0.45, 0.65, 0.00],
        c: [1.50, 1.50, 1.50],
        d: [0.50, 0.55, 0.50],
    },

    ice: {
        name: 'Eis',
        type: 'cosinus',
        a: [0.00, 0.00, 0.50],
        b: [0.45, 0.80, 0.20],
        c: [1.50, 1.50, 1.50],  
        d: [0.50, 0.50, 0.50],
    },

    party: {
        name: 'Party',
        type: 'cosinus',
        a: [0.5, 0.5, 0.5],
        b: [0.5, 0.5, 0.5],
        c: [2.0, 2.0, 2.0],
        d: [0.0, 0.33, 0.67],
    },
    
    grayscale: {
        name: 'Graustufen',
        type: 'cosinus',
        a: [0.50, 0.50, 0.50],
        b: [0.50, 0.50, 0.50],
        c: [0.50, 0.50, 0.50],
        d: [0.50, 0.50, 0.50],
    },
    
    hsv: {
        name: 'HSV-Regenbogen',
        type: 'hsv',
    },

    alternatingColors: {
        name: 'Alternierende Graustufen',
        type: 'alternatingColors',
        even: [64, 64, 64],
        odd:  [192, 192, 192], 
    },    

    alternatingBlueOrange: {
        name: 'Alternierend Blau-Orange',
        type: 'alternatingColors',
        even: [0, 0, 128],
        odd:  [255, 148, 0], 
    },    

    bands: {
        name: 'Zyklische Farbbänder',
        type: 'bands',
    },
};
