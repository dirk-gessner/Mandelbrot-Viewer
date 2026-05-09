// Holen des Canvas-Elements
const canvas = document.getElementById('mandelbrotCanvas');
const ctx = canvas.getContext('2d');

// Bildgröße
const width = canvas.width;
const height = canvas.height;

// Bereich der Mandelbrot-Menge (x: -2.5 bis 1, y: -1 bis 1 – das ist der "Standard"-Bereich)
const minX = -3, maxX = 1;
const minY = -1.5, maxY = 1.5;

// Maximale Iterationen (je höher, desto genauer, aber langsamer)
const maxIterations = 100;

// Funktion, um zu prüfen, ob ein Punkt zur Mandelbrot-Menge gehört
function mandelbrot(x, y) {
    let zx = 0, zy = 0;
    let iteration = 0;
    while (zx * zx + zy * zy < 4 && iteration < maxIterations) {
        let temp = zx * zx - zy * zy + x;
        zy = 2 * zx * zy + y;
        zx = temp;
        iteration++;
    }
    return iteration;
}

// Zeichnen des Bildes
function drawMandelbrot() {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let px = 0; px < width; px++) {
        for (let py = 0; py < height; py++) {
            // Umrechnung von Pixel-Koordinaten zu komplexen Zahlen
            const x = minX + (px / width) * (maxX - minX);
            const y = minY + (py / height) * (maxY - minY);

            const iterations = mandelbrot(x, y);
            const color = iterations === maxIterations ? 0 : (iterations * 255 / maxIterations);

            const index = (py * width + px) * 4;
            data[index] = color;     // Rot
            data[index + 1] = color; // Grün
            data[index + 2] = color; // Blau
            data[index + 3] = 255;   // Alpha (Transparenz)
        }
    }

    ctx.putImageData(imageData, 0, 0);
}

// Zeichnen starten
drawMandelbrot();