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

// berechnet die Mandelbrot-Menge für ein bestimmtes Rechteck
function computeMandelbrotRect(rect, imageWidth, imageHeight, computationSettings) {
    
    const { view, maxIterations, escapeRadius } = computationSettings;
    const { minX, maxX, minY, maxY } = view;

    const iterations   = new Uint16Array (rect.width * rect.height);
    const escapeValues = new Float64Array(rect.width * rect.height);

    for (let localY = 0; localY < rect.height; localY++) {
        for (let localX = 0; localX < rect.width; localX++) {
    
            const px = rect.x + localX;
            const py = rect.y + localY;

            const x = minX + (px / imageWidth)  * (maxX - minX);
            const y = minY + (py / imageHeight) * (maxY - minY);

            const result = mandelbrotIterations(x, y, maxIterations, escapeRadius);

            const index = localY * rect.width + localX;
            iterations  [index] = result.iterations;
            escapeValues[index] = result.escapeValue;
        }
    }

    return { 
        width : rect.width, 
        height: rect.height, 
        iterations, 
        escapeValues, 
        minIterations: findMinIterations(iterations),
    };
}

// Berechnet das Mandelbrot-Bild für die gegebenen Parameter
function computeMandelbrot(width, height, computationSettings) {
    return computeMandelbrotRect(
        { x: 0, y: 0, width, height },
        width,
        height,
        computationSettings
    );
}

