// -----------------------------------------------------------------------------
// Funktion zum Speichern des aktuellen Canvas als PNG-Bild
// -----------------------------------------------------------------------------
function createTimestamp() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}
    
function saveCanvasAsPng() {
    const link = document.createElement('a');
    link.download = `mandelbrot_${createTimestamp()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

