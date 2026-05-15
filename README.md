# LMV - Lightweight Mandelbrot Viewer

Ein interaktiver Mandelbrot-Viewer für den Webbrowser. Das Projekt nutzt HTML5 Canvas für die Darstellung, Plain JavaScript für Berechnung und Rendering sowie eine kleine Vue-App für die Bedienoberfläche.

## Überblick

LMV ist ein Lern- und Experimentierprojekt zur Mandelbrot-Menge. Der Viewer berechnet die Iterationsdaten im Browser, cached diese Daten getrennt vom eingefärbten Bild und erlaubt dadurch schnelle Änderungen an Farb- und Rendering-Parametern, ohne die Mandelbrot-Menge jedes Mal neu berechnen zu müssen.

Das Projekt ist bewusst einfach gehalten: keine Build-Pipeline, kein Bundler, kein Framework-Setup. `index.html` kann direkt in einem modernen Browser geöffnet werden.

## Aktuelle Features

- Flexible Canvas-Fläche, die den verfügbaren Raum im Hauptbereich nutzt.
- Initialer Bildausschnitt wird passend zum Canvas-Seitenverhältnis berechnet, sodass der relevante Mandelbrot-Bereich vollständig sichtbar ist.
- Fenstergrößenänderungen werden erkannt; der aktuelle Ausschnitt wird so erweitert, dass das vorherige Bild vollständig enthalten bleibt.
- Interaktiver Zoom per Maus:
  - rechte Maustaste startet einen Auswahlrahmen
  - Mausrad bei aktiver Auswahl verändert die Größe des Auswahlrahmens
  - Loslassen der rechten Maustaste zoomt in den gewählten Bereich
  - linke Maustaste zoomt schrittweise heraus
- Direkte Steuerung wichtiger Berechnungsparameter:
  - Iterationstiefe
  - Escape-Radius
- Direkte Steuerung der Darstellung:
  - Farbpalette
  - Farbe der inneren Menge
  - Gamma-Korrektur
  - Korrekturwert für die Farbskalierung
- Mehrere Cosinus-Farbpaletten, aktuell unter anderem `Gold-Blau`, `Feuer`, `Eis` und `Party`.
- Getrennte Berechnungs- und Rendering-Pipeline:
  - Mandelbrot-Daten werden berechnet und gecacht
  - Farbänderungen rendern nur aus dem Cache neu
- Render-Overlay während teurer Neuberechnungen.
- Rechtes Control-Panel als Overlay-Drawer:
  - fährt beim Start kurz sichtbar ein
  - öffnet sich über eine Hot Zone am rechten Rand
  - verdeckt den Canvas nur temporär, nimmt ihm aber keinen Layoutplatz weg

## Steuerung

- **Zoom-In:** Rechte Maustaste auf dem Canvas drücken, Auswahlrahmen positionieren, optional mit dem Mausrad skalieren, dann Maustaste loslassen.
- **Zoom-Out:** Linke Maustaste auf dem Canvas klicken.
- **Iterationstiefe ändern:** Mausrad über dem Canvas verwenden, solange keine Zoom-Auswahl aktiv ist.
- **Control-Panel öffnen:** Maus an den rechten Rand bewegen.

## Projektstruktur

- `index.html` enthält die semantische Seitenstruktur, Canvas, Overlay und Vue-gebundene Controls.
- `styles.css` enthält Layout, responsive Canvas-Regeln, Header/Footer, Control-Drawer und Render-Overlay.
- `script.js` enthält Mandelbrot-Berechnung, Rendering, Mausinteraktion, Vue-State-Synchronisation und Resize-Logik.
- `definition.svg` wird im Header als Formelgrafik eingebunden.

## Technische Details

Die Berechnung arbeitet mit zwei Settings-Objekten:

- `computationSettings` enthält Parameter, die die berechneten Mandelbrot-Daten verändern, z. B. sichtbarer Ausschnitt, Iterationstiefe und Escape-Radius.
- `renderSettings` enthält Parameter, die nur die Darstellung der vorhandenen Daten verändern, z. B. Gamma, Farbskalierung, Palette und Farbe der inneren Menge.

Für Punkte innerhalb der Hauptkardiode und der Periode-2-Glühbirne werden schnelle Vorabtests verwendet. Dadurch müssen viele sicher innenliegende Punkte nicht vollständig iteriert werden.

Die Darstellung verwendet Smooth Coloring und eine Cosinus-Palettenfunktion:

```text
color = a + b * cos(2π * (c * t + d))
```

Dadurch lassen sich unterschiedliche Paletten durch wenige Parameter beschreiben.

## Ausführen

1. Repository klonen oder Projektordner öffnen.
2. `index.html` in einem modernen Browser öffnen.
3. Der Viewer lädt Vue 3 über CDN:

```html
https://unpkg.com/vue@3/dist/vue.global.prod.js
```

Eine lokale Installation oder ein Build-Schritt ist aktuell nicht nötig.

## Lernziele

- Grundlagen von HTML5 Canvas und Pixel-Rendering.
- Mathematische Struktur der Mandelbrot-Menge.
- Trennung von Berechnung, Cache und Darstellung.
- Umgang mit interaktivem UI-State.
- Responsive Layouts ohne Verzerrung mathematischer Koordinaten.
- Schrittweiser Übergang von globalem JavaScript-State zu strukturierteren Settings-Objekten.

## Mögliche nächste Schritte

- Berechnung in einen Web Worker auslagern, damit der Browser während langer Renderings reaktionsfähig bleibt.
- Weitere Paletten oder editierbare Palettenparameter ergänzen.
- Touch- und Tastaturbedienung verbessern.
- Presets, Bookmarks oder eine Zoom-History einbauen.
- Perspektivisch ein performanteres Backend oder WebAssembly-Modul für die Berechnung testen.

---

Entwickelt als gemeinsames Lernprojekt von Karl und Dirk Geßner.
