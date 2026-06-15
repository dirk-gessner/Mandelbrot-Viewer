// -----------------------------------------------------------------------------
// globale Objekte für die Parameter für Berechnung und Rendering
// -----------------------------------------------------------------------------

/**
 * Eingabegrenzen für numerische App-Einstellungen.
 *
 * @typedef {Object} NumberInputConstraint
 * @property {number} min - (decimal/integer) Kleinster erlaubter Wert.
 * @property {number} max - (decimal/integer) Größter erlaubter Wert.
 * @property {number} step - (decimal/integer) Schrittweite für UI-Eingaben.
 */

/**
 * Zentrale Eingabegrenzen für Berechnungs- und Threading-Parameter.
 */
const inputConstraints = {
    iterationLimit: {
        min: 0,
        max: 50000,
        step: 50,
    },
    escapeRadius: {
        min: 1.1,
        max: 20,
        step: 0.1,
    },
    workerCount: {
        min: 1,
        max: 20,
        step: 1,
    },
    tasksPerWorker: {
        min: 1,
        max: 20,
        step: 1,
    },
};

/**
 * Sichtbarer Ausschnitt der komplexen Ebene.
 *
 * @typedef {Object} View
 * @property {number} minX - (decimal) Linke Grenze des Ausschnitts auf der Realachse.
 * @property {number} maxX - (decimal) Rechte Grenze des Ausschnitts auf der Realachse.
 * @property {number} minY - (decimal) Obere/untere Grenze des Ausschnitts auf der Imaginärachse, abhängig von der Canvas-Abbildung.
 * @property {number} maxY - (decimal) Gegenüberliegende Grenze des Ausschnitts auf der Imaginärachse.
 */

/**
 * Einstellungen für die Mandelbrot-Berechnung.
 *
 * @typedef {Object} ComputationSettings
 * @property {?View}  initialView    - Ursprünglicher Ausschnitt, auf den zurückgezoomt werden kann.
 * @property {?View}  view           - Aktuell dargestellter Ausschnitt.
 * @property {number} iterationLimit - (integer) Maximale Iterationstiefe pro Pixel.
 * @property {number} escapeRadius   - (decimal) Radius, ab dem ein Punkt als divergiert gilt.
 */

/**
 * Globale Einstellungen für die Fraktalberechnung.
 *
 * @type {ComputationSettings}
 */
const computationSettings = {
    initialView:    null,
    view:           null,
    iterationLimit:  1000,
    escapeRadius:   5,
};


/**
 * Einstellungen für das Rendering.
 *
 * @typedef {Object} RenderSettings
 * @property {number}  gamma                      - (decimal) Gamma-Korrekturwert.
 * @property {number}  colorScalingCorrection     - (decimal) Korrekturwert fürs Color-Scaling.
 * @property {string}  paletteKey                 - Schlüsselwert einer Palette (siehe palettes.js).
 * @property {string}  innerSetColorKey           - Farbbezeichner für die Darstellung der inneren Menge des Fraktals.
 * @property {boolean} smoothColoringEnabled      - Weiche Farbübergänge ein/aus.
 * @property {boolean} logScalingEnabled          - Logarithmische Farbskalierung ein/aus.
 * @property {number}  logStrength                - (decimal) Anteil logarithmischer vs. linearer Farbskalierung: 0 = komplett linear, 1 = komplett logarithmisch.
 * @property {boolean} invertedPalette            - Farbpalette invertieren ein/aus.
 * @property {boolean} showPerturbationReferences - Referenzpunkte für Perturbationsberechnung anzeigen
 */

/**
 * Globale Einstellungen für das Rendering.
 * 
 * @type {RenderSettings}
 */
const renderSettings = {
    gamma:                      1.0,
    colorScalingCorrection:     1.0,
    paletteKey:                 'goldBlue',
    innerSetColorKey:           'schwarz',
    smoothColoringEnabled:      true,
    logScalingEnabled:          true,
    logStrength:                1.0,
    invertedPalette:            false,
    showPerturbationReferences: false, 
};

/**
 * Einstellungen für das CPU-MultiThreading.
 *
 * @typedef {Object} MultiThreadSettings
 * @property {number}  workerCount      - (integer) Anzahl der Workerthreads
 * @property {number}  tasksPerWorker   - (integer) Anzahl der je Workerthread geplanten Aufgaben
 */

/**
 * Globale Einstellungen für das Multithreading.
 * 
 * @type {MultiThreadSettings}
 */ 
const multiThreadSettings = {
    workerCount:    12, 
    tasksPerWorker: 3, 
};

/**
 * Einstellungen fuer die Auswahl des Mandelbrot-Berechnungsbackends.
 *
 * Diese Optionen beeinflussen nicht das mathematische Ergebnis, sondern nur,
 * welche Implementierungsstrategie verwendet werden darf.
 *
 * @typedef {Object} MandelbrotBackendSettings
 * @property {boolean} useWebGpu        - Erlaubt die Berechnung ueber WebGPU.
 * @property {boolean} usePerturbation  - Erlaubt den Perturbation-Shader fuer tiefe Zoomstufen.
 * @property {boolean} useCpu           - Erlaubt Rueckfall auf CPU, wenn GPU/Perturbation nicht geeignet ist.
 */

/**
 * Globale Einstellungen für die Backendkonfiguration
 * 
 * @type {MandelbrotBackendSettings}
 */
const mandelbrotBackendSettings = {
    useWebGpu: true, 
    usePerturbation: true, 
    useCpu: true, 
}; 

const MANDELBROT_BACKEND_MODE_CPU = "cpu";
const MANDELBROT_BACKEND_MODE_WEBGPU = "webgpu";
const MANDELBROT_BACKEND_MODE_WEBGPU_PERTURBATION = "webgpu-perturbation";
const MANDELBROT_BACKEND_MODE_WEBGPU_CPU_FALLBACK = "webgpu-cpu-fallback";
const MANDELBROT_BACKEND_MODE_WEBGPU_PERTURBATION_CPU_FALLBACK = "webgpu-perturbation-cpu-fallback";

/**
 * ID des aktuell geplanten Timers für die verzögerte Neuberechnung.
 * Der Wert 0 bedeutet, dass aktuell kein Timer vorgemerkt ist.
 *
 * @type {number}
 */
let inputTimer = 0;

// -----------------------------------------------------------------------------
// Musik-Player
// -----------------------------------------------------------------------------

/**
 * Einstellungen und Daten für den eingebauten Musik-Player.
 * 
 * @typedef {Object} MusicTrack
 * @property {string} title     - Anzeigename.
 * @property {string} src       - Blob-URL oder regulärer URL-Pfad.
 * @property {string} fileName  - Ursprünglicher Dateiname.
 */

/**
 * Einstellungen für den eingebauten Musik-Player.
 * @typedef {Object} MusicSettings 
 * @property {MusicTrack[]} tracks          - Liste der verfügbaren Musikstücke.
 * @property {number} selectedTrackIndex    - Index des aktuell ausgewählten Musikstücks.
 * @property {number} volume                - Lautstärke (0.0 bis 1.0).
 * @property {boolean} enabled              - Musik-Player aktiviert/deaktiviert.
 * @property {boolean} loop                 - Wiederholung aktiviert/deaktiviert.
 */

/**
 * Globale Musik-Einstellungen.
 *
 * @type {MusicSettings}
 */
const musicSettings = {
    tracks: [],
    selectedTrackIndex: -1,
    volume: 0.25,
    enabled: false,
    loop: true,
};