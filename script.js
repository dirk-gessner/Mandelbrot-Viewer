// Holen des Canvas-Elements
const canvas = document.getElementById('mandelbrotCanvas');
const ctx = canvas.getContext('2d');

// Bildgröße
const width = canvas.width;
const height = canvas.height;

// Bereich der Mandelbrot-Menge
const minX = -3;
const maxX = 1;
const minY = -1.5;
const maxY = 1.5;

// Maximale Iterationen
const maxIterations = 100;

function mandelbrotIterations(cx, cy, maxIterations) {
  let zx = 0;
  let zy = 0;
  let iteration = 0;

  while (zx * zx + zy * zy < 4 && iteration < maxIterations) {
    const temp = zx * zx - zy * zy + cx;
    zy = 2 * zx * zy + cy;
    zx = temp;
    iteration++;
  }

  return iteration;
}

function computeMandelbrot(width, height, minX, maxX, minY, maxY, maxIterations) {
  const data = new Uint16Array(width * height);

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = minX + (px / width) * (maxX - minX);
      const y = minY + (py / height) * (maxY - minY);
      data[py * width + px] = mandelbrotIterations(x, y, maxIterations);
    }
  }

  return data;
}

function iterationToColor(iterations, maxIterations) {
  if (iterations === maxIterations) {
    return [0, 0, 0];
  }

  const value = Math.floor((iterations / maxIterations) * 255);
  return [value, value, 255 - value];
}

function renderMandelbrot(ctx, width, height, data, maxIterations) {
  const imageData = ctx.createImageData(width, height);
  const pixels = imageData.data;

  for (let i = 0; i < data.length; i++) {
    const [r, g, b] = iterationToColor(data[i], maxIterations);
    const idx = i * 4;
    pixels[idx] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
    pixels[idx + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
}

const mandelbrotData = computeMandelbrot(width, height, minX, maxX, minY, maxY, maxIterations);
renderMandelbrot(ctx, width, height, mandelbrotData, maxIterations);