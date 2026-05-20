// -----------------------------------------------------------------------------
// Mandelbrot-Berechnung
// -----------------------------------------------------------------------------

function computeMandelbrotRectInWorker(
  rect,
  imageWidth,
  imageHeight,
  computationSettings
) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("./js/mandelbrot-worker.js", {
      type: "module"
    });

    worker.onmessage = (event) => {
      worker.terminate();
      resolve(event.data);
    };

    worker.onerror = (error) => {
      worker.terminate();
      reject(error);
    };

    worker.postMessage({
      rect,
      imageWidth,
      imageHeight,
      computationSettings
    });
  });
}

async function computeMandelbrotRect(rect, imageWidth, imageHeight, settings) {
  // Schritt 1: aktuell nur ein Worker
  return await computeMandelbrotRectInWorker(
    rect,
    imageWidth,
    imageHeight,
    settings
  );
}

// Berechnet das Mandelbrot-Bild für die gegebenen Parameter
async function computeMandelbrot(width, height, computationSettings) {
    return await computeMandelbrotRect(
        { x: 0, y: 0, width, height },
        width,
        height,
        computationSettings
    );
}

