// -----------------------------------------------------------------------------
// Definitionen für Farben und Farbpaletten
// -----------------------------------------------------------------------------

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
        type: 'cosinus',
        a: [0.5, 0.5, 0.5],
        b: [0.5, 0.5, 0.5],
        c: [1.0, 1.0, 1.0],
        d: [0.0, 0.1, 0.2],
    },

    fire: {
        name: 'Feuer',
        type: 'cosinus',
        a: [0.60, 0.28, 0.08],
        b: [0.40, 0.30, 0.08],
        c: [1.0, 1.2, 1.5],
        d: [0.00, 0.05, 0.10],
    },

    ice: {
        name: 'Eis',
        type: 'cosinus',
        a: [0.5, 0.5, 0.5],
        b: [0.5, 0.5, 0.5],
        c: [1.0, 1.0, 1.0],
        d: [0.55, 0.65, 0.75],
    },

    party: {
        name: 'Party',
        type: 'cosinus',
        a: [0.5, 0.5, 0.5],
        b: [0.5, 0.5, 0.5],
        c: [1.0, 1.0, 1.0],
        d: [0.0, 0.33, 0.67],
    },
    
    grayscale: {
        name: 'Graustufen',
        type: 'grayscale',
    }, 

    alternatingGrayscale: {
        name: 'Alternierende Graustufen',
        type: 'alternatingGrayscale',
        even: 64,
        odd: 192,
    },    

    hsv: {
        name: 'HSV-Regenbogen',
        type: 'hsv',
    },

    bands: {
        name: 'Zyklische Farbbänder',
        type: 'bands',
    },
};
