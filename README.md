# LMV – Lightweight Mandelbrot Viewer

Ein interaktiver Mandelbrot-Viewer für den Webbrowser.

LMV nutzt HTML5 Canvas für die Darstellung, Plain JavaScript für Berechnung und Rendering sowie eine kleine Vue-3-App für das Control-Panel. Das Projekt ist bewusst leichtgewichtig gehalten: Es gibt keine Build-Pipeline, keinen Bundler und kein Framework-Setup. `index.html` kann direkt in einem modernen Browser geöffnet werden.

## Überblick

LMV ist ein Lern- und Experimentierprojekt zur Mandelbrot-Menge.

Der Viewer berechnet Iterationsdaten im Browser und erzeugt daraus ein gerendertes Canvas-Bild. Berechnung, Datenhaltung, Bildaufbau, Darstellung und Interaktion sind voneinander getrennt. Dadurch können reine Rendering-Änderungen aus vorhandenen Iterationsdaten neu aufgebaut werden, ohne die Mandelbrot-Menge erneut vollständig zu berechnen.

Im Branch `20-neuberechnung-nach-resize-auf-dirtyrects-umstellen` wurde die Datenhaltung so erweitert, dass bereits berechnete Bereiche beim Verschieben und bei bestimmten Resize-Fällen wiederverwendet werden. Neu sichtbar gewordene Bildbereiche werden als Dirty Rects identifiziert und gezielt nachberechnet.

## Aktuelle Features

### Darstellung und Layout

- Flexible Canvas-Fläche, die den verfügbaren Raum im Hauptbereich nutzt.
- Initialer Bildausschnitt wird passend zum Canvas-Seitenverhältnis berechnet, sodass der relevante Mandelbrot-Bereich vollständig sichtbar ist.
- Fenstergrößenänderungen werden erkannt; der aktuelle Ausschnitt wird so erweitert, dass das vorherige Bild weiterhin enthalten bleibt.
- Render-Overlay während teurer Neuberechnungen:
  - Canvas wird visuell abgedunkelt beziehungsweise verwischt.
  - Spinner zeigt laufende Berechnung an.
- Rechtes Control-Panel als Overlay-Drawer:
  - fährt beim Start kurz sichtbar ein,
  - öffnet sich über eine Hot Zone am rechten Rand,
  - verdeckt den Canvas nur temporär,
  - nimmt dem Canvas keinen Layoutplatz weg.

### Interaktion

- Interaktiver Zoom per Maus:
  - rechte Maustaste startet einen Auswahlrahmen,
  - der Auswahlrahmen besitzt ein Fadenkreuz über das gesamte Bild und eine kleine Zielmarkierung im Zentrum,
  - Mausrad bei aktiver Auswahl verändert die Größe des Auswahlrahmens,
  - Loslassen der rechten Maustaste zoomt in den gewählten Bereich,
  - Linksklick ohne Ziehen zoomt schrittweise heraus.
- Verschieben der aktuellen Ansicht:
  - linke Maustaste gedrückt halten und ziehen,
  - während des Ziehens wird das vorhandene Bild direkt verschoben dargestellt,
  - beim Loslassen wird der View aktualisiert,
  - bereits vorhandene Iterationsdaten werden wiederverwendet,
  - nur neu sichtbar gewordene Bildbereiche werden nachberechnet.
- Mausrad ohne aktive Zoom-Auswahl verändert die Iterationstiefe.

### Control-Panel

Das Control-Panel zeigt die aktuelle Ansicht und erlaubt die direkte Änderung von Berechnungs- und Darstellungsparametern.

Angezeigt werden:

- X-Bereich,
- Y-Bereich,
- Zoom-Level.

Berechnungsparameter:

- Iterationstiefe,
- Escape-Radius.

Darstellungsparameter:

- Farbpalette,
- Farbe der inneren Menge,
- Gamma-Korrektur,
- Log-Skalierung,
- Korrekturwert für die Farbskalierung,
- Smooth Coloring ein/aus,
- logarithmische Skalierung ein/aus,
- Farbpalette invertieren.

Sonstige Funktionen:

- aktuelle Ansicht als PNG speichern,
- Ansicht auf den initialen Ausschnitt zurücksetzen.

## Farbpaletten

Aktuell sind mehrere Palettentypen vorhanden:

- Cosinus-Paletten:
  - `Gold-Blau`,
  - `Feuer`,
  - `Eis`,
  - `Party`.
- Graustufen-Paletten:
  - `Graustufen`,
  - `Alternierende Graustufen`.
- Weitere Paletten:
  - `HSV-Regenbogen`,
  - `Zyklische Farbbänder`.

Für die innere Menge stehen mehrere feste Farben zur Verfügung:

- Schwarz,
- Weiß,
- Magenta,
- Cyan,
- Gelb.

## Steuerung

| Aktion | Bedienung |
|---|---|
| Ansicht verschieben | Linke Maustaste auf dem Canvas gedrückt halten und ziehen |
| Zoom-Out | Linke Maustaste klicken, ohne zu ziehen |
| Zoom-In | Rechte Maustaste drücken, Auswahlrahmen positionieren, optional mit Mausrad skalieren, dann loslassen |
| Auswahlrahmen positionieren | Rechte Maustaste gedrückt halten und Maus bewegen |
| Iterationstiefe ändern | Mausrad über dem Canvas verwenden, solange keine Zoom-Auswahl aktiv ist |
| Control-Panel öffnen | Maus an den rechten Fensterrand bewegen |
| PNG speichern | Im Control-Panel unter „Sonstiges“ den Button „Als PNG speichern“ verwenden |
| Ansicht zurücksetzen | Im Control-Panel unter „Sonstiges“ den Button „Ansicht zurücksetzen“ verwenden |

## Projektstruktur

```text
.
├── index.html
├── css/
│   └── styles.css
├── img/
│   └── definition.svg
└── js/
    ├── dom.js
    ├── settings.js
    ├── palettes.js
    ├── iteration-data.js
    ├── mandelbrot.js
    ├── rendering.js
    ├── layout.js
    ├── interactions.js
    ├── ui.js
    ├── file.js
    └── main.js
```

### Wichtige Dateien

- `index.html` enthält Seitenstruktur, Canvas, Render-Overlay, Control-Drawer, Vue-gebundene Controls und die Script-Einbindung.
- `css/styles.css` enthält Layout, responsives Canvas-Verhalten, Header/Footer, Control-Drawer, Render-Overlay und Spinner.
- `img/definition.svg` wird im Header als Formelgrafik eingebunden.
- `js/dom.js` sammelt zentrale DOM-Referenzen wie Canvas, Context, Wrapper und Render-Overlay.
- `js/settings.js` enthält Berechnungs- und Rendering-Einstellungen.
- `js/palettes.js` definiert Farben und Farbpaletten.
- `js/iteration-data.js` enthält generische Operationen auf Iterationsdaten, darunter Kopieren von Rechtecken, Dirty-Rect-Ermittlung, Panning- und Resize-Logik.
- `js/mandelbrot.js` enthält die Mandelbrot-spezifische Berechnung und Optimierungen für sicher innenliegende Punkte.
- `js/rendering.js` enthält Rendering-Funktionen, den Aufbau von `ImageData` aus Iterationsdaten, Bildausgabe, Render-Overlay und Panning-Vorschau.
- `js/layout.js` behandelt Canvas-Größe, initialen View, Seitenverhältnis, Resize-Logik und Reset der Ansicht.
- `js/interactions.js` enthält Mausinteraktion, Panning, Zoom-Auswahl, Zoom-Out-Schritte, Mausradsteuerung und das Zeichnen des Auswahlrahmens mit Fadenkreuz.
- `js/ui.js` enthält die Vue-App für das Control-Panel und synchronisiert UI-State mit den Settings.
- `js/file.js` enthält den PNG-Export des aktuellen Canvas.
- `js/main.js` initialisiert Canvas, View, UI-Info und startet die erste Berechnung.

## Technische Details

### Trennung von Berechnung, Iterationsdaten und Rendering

Die Anwendung trennt drei Ebenen:

1. **Berechnung**
   - Die Mandelbrot-Menge wird für den aktuell sichtbaren View berechnet.
   - Ergebnis sind Iterationswerte und Escape-Werte.

2. **Iterationsdaten**
   - Die Werte werden in einer Matrix gehalten.
   - Die Datenstruktur ist allgemeiner gedacht als die konkrete Mandelbrot-Berechnung.
   - Operationen wie Kopieren, Verschieben und Dirty-Rect-Ermittlung hängen nicht direkt von der Mandelbrot-Formel ab.

3. **Rendering**
   - Aus den Iterationsdaten wird ein `ImageData`-Objekt erzeugt.
   - Render-Parameter wie Palette, Gamma, Smooth Coloring, logarithmische Skalierung und Paletteninvertierung werden erst beim Bildaufbau angewendet.
   - Das fertige `ImageData` wird auf den Canvas gezeichnet.

Diese Trennung erlaubt schnelle Aktualisierungen bei reinen Darstellungsänderungen: Farb- und Rendering-Parameter bauen nur das Bild aus den vorhandenen Iterationsdaten neu auf. Eine vollständige Neuberechnung ist nur nötig, wenn sich Berechnungsparameter oder der sichtbare mathematische Ausschnitt ändern.

### IterationData

Die zentrale Datenstruktur enthält:

```js
{
  width,          // Breite der Matrix in Pixeln
  height,         // Höhe der Matrix in Pixeln
  iterations,     // Uint16Array(width * height)
  escapeValues,   // Float64Array(width * height)
  minIterations   // kleinster Iterationswert im Datensatz
}
```

`iterations` und `escapeValues` sind parallel aufgebaut. Der Index eines Pixels ergibt sich aus:

```text
index = y * width + x
```

### Panning mit Dirty Rects

Beim Verschieben der Ansicht wird während der Mausbewegung zunächst nur das bereits gerenderte Bild verschoben dargestellt. Dadurch fühlt sich das Panning unmittelbar an.

Beim Loslassen der Maustaste passiert Folgendes:

1. Der mathematische View wird um die Pixelverschiebung in Koordinaten verschoben.
2. Die vorhandene Iterationsmatrix wird in eine neue Matrix kopiert.
3. Der weiterhin sichtbare Bereich wird aus dem alten Cache übernommen.
4. Die neu sichtbar gewordenen Randbereiche werden als Dirty Rects bestimmt.
5. Nur diese Dirty Rects werden neu berechnet.
6. Anschließend wird aus der aktualisierten Iterationsmatrix ein neues `ImageData` erzeugt.

Bei einer kleinen horizontalen Verschiebung wird zum Beispiel nur ein vertikaler Randstreifen neu berechnet. Bei einer kombinierten horizontalen und vertikalen Verschiebung entstehen ein Randstreifen und ein zusätzlicher oberer oder unterer Streifen. Wenn die Verschiebung größer oder gleich der Bildgröße ist, wird das gesamte Bild neu berechnet.

### Resize mit Dirty Rects

Bei Größenänderungen des Fensters wird das Canvas an die tatsächliche Anzeigengröße angepasst. Der mathematische View wird so erweitert, dass das neue Seitenverhältnis ohne Verzerrung erfüllt wird.

Der Branch `20-neuberechnung-nach-resize-auf-dirtyrects-umstellen` behandelt Canvas-Vergrößerungen schrittweise:

1. Breitenänderungen werden horizontal verarbeitet.
2. Höhenänderungen werden vertikal verarbeitet.
3. Bereits vorhandene Daten werden an die passende Position im neuen Datenraster kopiert.
4. Nur die neu entstandenen Randbereiche werden berechnet.
5. Der zurückgegebene View wird zusammen mit den erzeugten Iterationsdaten übernommen.

Bei Canvas-Verkleinerungen wird aktuell vollständig neu berechnet. Das ist einfacher und vermeidet komplizierte Ausschnitts- und Resampling-Fälle.

### Smooth Coloring und Farbskalierung

Für Punkte außerhalb der Mandelbrot-Menge kann Smooth Coloring aktiviert werden. Dabei wird der Farbwert nicht nur aus der ganzzahligen Iterationszahl gebildet, sondern mit dem Escape-Wert geglättet.

Zusätzlich unterstützt die Darstellung:

- lineare Skalierung,
- logarithmische Skalierung,
- Mischung zwischen linearer und logarithmischer Skalierung über `logStrength`,
- Gamma-Korrektur,
- Farbskalierungs-Korrektur,
- Paletteninvertierung.

Für Cosinus-Paletten wird folgende Funktion verwendet:

```text
color = a + b * cos(2π * (c * t + d))
```

### Mandelbrot-Optimierungen

Für sicher innenliegende Punkte werden schnelle Vorabtests genutzt:

- Periode-2-Glühbirne,
- Hauptkardiode.

Punkte, die durch diese Tests sicher innerhalb der Menge liegen, müssen nicht vollständig iteriert werden.

## Ausführen

1. Repository klonen oder Projektordner öffnen.
2. `index.html` in einem modernen Browser öffnen.
3. Der Viewer lädt Vue 3 über CDN:

```html
https://unpkg.com/vue@3/dist/vue.global.prod.js
```

Eine lokale Installation oder ein Build-Schritt ist aktuell nicht nötig.

## Entwicklungsnotizen

### Warum Dirty Rects?

Ohne Dirty Rects müsste bei jeder Verschiebung oder Vergrößerung des Canvas das gesamte Bild neu berechnet werden. Das ist besonders bei hoher Iterationstiefe teuer.

Dirty Rects reduzieren die Arbeit auf die Bereiche, für die noch keine gültigen Iterationsdaten vorhanden sind. Das verbessert insbesondere:

- Panning über kleine Distanzen,
- Vergrößerung des Browserfensters,
- Layoutänderungen, bei denen bereits sichtbare Bereiche erhalten bleiben.

### Grenzen der aktuellen Lösung

- Verkleinerungen des Canvas werden vollständig neu berechnet.
- Die Berechnung läuft weiterhin im Hauptthread.
- Während sehr teurer Berechnungen kann die UI kurz blockieren.
- Es gibt noch keine Touch- oder Tastatursteuerung.
- Es gibt noch keine Persistenz für Bookmarks, Presets oder Zoom-Historie.

## Lernziele

- Grundlagen von HTML5 Canvas und Pixel-Rendering.
- Mathematische Struktur der Mandelbrot-Menge.
- Trennung von Berechnung, Iterationsdaten, `ImageData` und Canvas-Ausgabe.
- Wiederverwendung berechneter Daten beim Verschieben der Ansicht.
- Dirty-Rect-Strategien für Panning und Resize.
- Strukturierung eines einfachen JavaScript-Projekts in kleinere Module.
- Umgang mit interaktivem UI-State.
- Responsive Layouts ohne Verzerrung mathematischer Koordinaten.
- Experimentieren mit Farbpaletten, Smooth Coloring und logarithmischer Skalierung.
- Vorbereitung einer generischeren Fraktal-Pipeline, zum Beispiel für spätere Julia-Mengen.

## Mögliche nächste Schritte

- Berechnung in einen Web Worker auslagern, damit der Browser während langer Renderings reaktionsfähig bleibt.
- Touch- und Tastaturbedienung verbessern.
- Presets, Bookmarks oder eine Zoom-History einbauen.
- Frei editierbare Palettenparameter ergänzen.
- Export-Metadaten ergänzen, zum Beispiel View-Koordinaten oder Rendering-Parameter.
- Canvas-Verkleinerungen ebenfalls cache-basiert behandeln, sofern sich daraus ein klarer Nutzen ergibt.
- Weitere Entkopplung der generischen Iterationsdaten-Operationen von der konkreten Mandelbrot-Berechnung.
- Perspektivisch Julia-Mengen oder andere Escape-Time-Fraktale ergänzen.
- Perspektivisch ein performanteres Backend oder WebAssembly-Modul für die Berechnung testen.

---

Entwickelt als gemeinsames Lernprojekt von Karl und Dirk Geßner.
