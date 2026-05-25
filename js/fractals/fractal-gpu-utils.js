
/**
 * Zerlegt eine JavaScript-number in zwei Float32-Anteile.
 *
 * high enthält den auf Float32 gerundeten Hauptwert.
 * low enthält den Restwert, ebenfalls als Float32.
 *
 * @param {number} value - Zu zerlegender 64-bit JavaScript-Wert.
 * @returns {{ high: number, low: number }} High-/Low-Anteile als Float32-kompatible Zahlen.
 */
export function splitFloat64ToFloat32Pair(value) {
    const high = Math.fround(value);
    const low = Math.fround(value - high);

    return {
        high,
        low,
    };
}

/**
 * Wandelt die aus der GPU gelesenen Ergebnisarrays in `IterationData` um.
 *
 * Der Shader schreibt Iterationszahlen als `u32`, während die Rendering-Pipeline
 * im Hauptthread `Uint16Array` erwartet. Die Escape-Werte werden unverändert in
 * ein eigenes `Float32Array` übernommen.
 * 
 * @param {PixelRect}           rect                - Berechneter Pixelbereich.
 * @param {Uint32Array}         gpuIterations       - Von der GPU gelesene Iterationszahlen.
 * @param {Float32Array}        gpuEscapeValues     - Von der GPU gelesene Escape-Werte.
 * @param {number}              maxIterations       - (integer) maximale Iterationszahl.
 * @returns {IterationData} Iterationsdaten im Format der bestehenden Rendering-Pipeline.
 */
export function createIterationDataFromGpuArrays(
  rect,
  gpuIterations,
  gpuEscapeValues,
  maxIterations
) {
  const pixelCount = rect.width * rect.height;
  const iterations = new Uint16Array(pixelCount);
  const escapeValues = new Float32Array(pixelCount);

  let minIterations = pixelCount > 0 ? maxIterations : 0;

  for (let index = 0; index < pixelCount; index++) {
    const iteration = gpuIterations[index];

    iterations[index] = iteration;
    escapeValues[index] = gpuEscapeValues[index];    

    if (iteration < minIterations) {
      minIterations = iteration;
    }
  }

  return {
    width: rect.width,
    height: rect.height,
    iterations,
    escapeValues,
    minIterations,
    referenceCandidates: [],
  };
}

