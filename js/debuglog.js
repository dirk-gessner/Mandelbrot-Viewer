// -----------------------------------------------------------------------------
// Debug-Log-Funktionen
// -----------------------------------------------------------------------------
const DEBUG_MODE = true;

function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log(...args);
    }
}

function debugInfo(...args) {
    if (DEBUG_MODE) {
        console.info(...args);
    }
}

function debugWarn(...args) {
    if (DEBUG_MODE) {
        console.warn(...args);
    }
}
