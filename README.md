# LMV - Lightweight Mandelbrot Viewer

Ein interaktiver Mandelbrot-Viewer für den Webbrowser.

Das Projekt nutzt HTML5 Canvas für die Darstellung, Plain JavaScript für Berechnung und Rendering sowie eine kleine Vue-3-App für die Bedienoberfläche. Es ist bewusst leichtgewichtig gehalten: keine Build-Pipeline, kein Bundler, kein Framework-Setup. `index.html` kann direkt in einem modernen Browser geöffnet werden.

## Überblick

LMV ist ein Lern- und Experimentierprojekt zur Mandelbrot-Menge.

Der Viewer berechnet Iterationsdaten im Browser und erzeugt daraus ein gerendertes Bild für den Canvas. Berechnung, Datenhaltung, Bildaufbau, Darstellung und Interaktion sind voneinander getrennt. Dadurch können reine Rendering-Änderungen schnell aus den vorhandenen Iterationsdaten neu aufgebaut werden, ohne die Mandelbrot-Menge jedes Mal komplett neu zu berechnen.

Die Anwendung besteht aus mehreren kleinen JavaScript-Dateien, die klar abgegrenzte Aufgaben übernehmen: DOM-Zugriff, Einstellungen, Paletten, Mandelbrot-Berechnung, Rendering, Layout, Interaktion, Datei-Export, UI-Anbindung und Initialisierung.

## Aktuelle Features

- Flexible Canvas-Fläche, die den verfügbaren Raum im Hauptbereich nutzt.
- Initialer Bildausschnitt wird passend zum Canvas-Seitenverhältnis berechnet, sodass der relevante Mandelbrot-Bereich vollständig sichtbar ist.
- Fenstergrößenänderungen werden erkannt; der aktuelle Ausschnitt wird so erweitert, dass das vorherige Bild vollständig enthalten bleibt.
- Aktuelle Ansicht im Control-Panel:
  - X-Bereich
  - Y-Bereich
  - Zoom-Level
- Interaktiver Zoom per Maus:
  - rechte Maustaste startet einen Auswahlrahmen
  - der Auswahlrahmen besitzt ein Fadenkreuz über das gesamte Bild und eine kleine Zielmarkierung im Zentrum
  - Mausrad bei aktiver Auswahl verändert die Größe des Auswahlrahmens
  - Loslassen der rechten Maustaste zoomt in den gewählten Bereich
  - linke Maustaste ohne Ziehen zoomt schrittweise heraus
- Verschieben der aktuellen Ansicht:
  - linke Maustaste gedrückt halten und ziehen
  - während des Ziehens wird das vorhandene Bild verschoben dargestellt
  - beim Loslassen wird der View aktualisiert
  - bereits vorhandene Iterationsdaten werden wiederverwendet
  - nur neu sichtbar gewordene Bildbereiche werden nachberechnet
- Direkte Steuerung wichtiger Berechnungsparameter:
  - Iterationstiefe
  - Escape-Radius
- Direkte Steuerung der Darstellung:
  - Farbpalette
  - Farbe der inneren Menge
  - Gamma-Korrektur
  - Log-Skalierung
  - Korrekturwert für die Farbskalierung
  - Smooth Coloring ein/aus
  - logarithmische Skalierung ein/aus
  - Farbpalette invertieren
- Mehrere Farbpaletten:
  - `Gold-Blau`
  - `Feuer`
  - `Eis`
  - `Party`
  - `Graustufen`
  - `HSV-Regenbogen`
  - `Zyklische Farbbänder`
- Verschiedene Färbungen für die innere Menge:
  - Schwarz
  - Weiß
  - Magenta
  - Cyan
  - Gelb
- Getrennte Berechnungs- und Rendering-Pipeline:
  - Mandelbrot-Berechnung erzeugt Iterationsdaten
  - Iterationsdaten werden in ImageData umgewandelt
  - ImageData wird auf den Canvas gezeichnet
  - Änderungen an reinen Rendering-Parametern bauen nur das Bild aus vorhandenen Iterationsdaten neu auf
  - Änderungen an Berechnungsparametern lösen eine Neuberechnung der Iterationsdaten aus
- Render-Overlay während teurer Neuberechnungen:
  - Canvas wird visuell abgedunkelt/verwischt
  - Spinner zeigt laufende Berechnung an
- Rechtes Control-Panel als Overlay-Drawer:
  - fährt beim Start kurz sichtbar ein
  - öffnet sich über eine Hot Zone am rechten Rand
  - verdeckt den Canvas nur temporär
  - nimmt dem Canvas keinen Layoutplatz weg
- Sonstige Funktionen:
  - aktuelle Ansicht als PNG speichern
  - Ansicht auf den initialen Ausschnitt zurücksetzen

## Steuerung

- **Ansicht verschieben:** Linke Maustaste auf dem Canvas gedrückt halten und ziehen. Beim Loslassen wird der View aktualisiert und nur der neu sichtbare Bereich nachberechnet.
- **Zoom-Out:** Linke Maustaste klicken, ohne zu ziehen.
- **Zoom-In:** Rechte Maustaste auf dem Canvas drücken, Auswahlrahmen positionieren, optional mit dem Mausrad skalieren, dann Maustaste loslassen.
- **Auswahlrahmen positionieren:** Rechte Maustaste gedrückt halten und Maus bewegen. Das Fadenkreuz zeigt die exakte Zielposition.
- **Iterationstiefe ändern:** Mausrad über dem Canvas verwenden, solange keine Zoom-Auswahl aktiv ist.
- **Control-Panel öffnen:** Maus an den rechten Rand bewegen.
- **PNG speichern:** Im Control-Panel unter „Sonstiges“ den Button „Als PNG speichern“ verwenden.
- **Ansicht zurücksetzen:** Im Control-Panel unter „Sonstiges“ den Button „Ansicht zurücksetzen“ verwenden.

## Projektstruktur

- `index.html`
  - enthält die Seitenstruktur, Canvas, Render-Overlay, Control-Drawer und Vue-gebundene Controls.
- `css/styles.css`
  - enthält Layout, responsives Canvas-Verhalten, Header/Footer, Control-Drawer, Render-Overlay und Spinner.
- `img/definition.svg`
  - wird im Header als Formelgrafik eingebunden.
- `js/dom.js`
  - sammelt zentrale DOM-Referenzen wie Canvas, Context, Wrapper und Render-Overlay.
- `js/settings.js`
  - enthält Berechnungs- und Rendering-Einstellungen.
- `js/palettes.js`
  - definiert Farben und Farbpaletten.
- `js/mandelbrot.js`
  - enthält die Mandelbrot-spezifische Berechnung und Optimierungen für sicher innenliegende Punkte.
- `js/rendering.js`
  - enthält Rendering-Funktionen, den Aufbau von ImageData aus Iterationsdaten, Bildausgabe, Render-Overlay und die Datenlogik für verschobene Ansichten.
- `js/layout.js`
  - behandelt Canvas-Größe, initialen View, Seitenverhältnis, Resize-Logik und Reset der Ansicht.
- `js/interactions.js`
  - enthält Mausinteraktion, Panning, Zoom-Auswahl, Zoom-Out-Schritte, Mausradsteuerung und das Zeichnen des Auswahlrahmens mit Fadenkreuz.
- `js/ui.js`
  - enthält die Vue-App für das Control-Panel und synchronisiert UI-State mit den Settings.
- `js/file.js`
  - enthält den PNG-Export des aktuellen Canvas.
- `js/main.js`
  - initialisiert Canvas, View, UI-Info und startet die erste Berechnung.

## Technische Details

Die Anwendung trennt Berechnung, Datenhaltung und Darstellung.

Auf Berechnungsebene wird die Mandelbrot-Menge für den aktuell sichtbaren View berechnet. Das Ergebnis ist eine Iterationsmatrix mit den zugehörigen Escape-Werten. Diese Datenstruktur ist bewusst allgemeiner gedacht: Die Operationen auf dieser Matrix hängen nicht daran, ob die Werte aus der Mandelbrot-Menge, einer Julia-Menge oder einer anderen Escape-Time-Berechnung stammen.

Auf Rendering-Ebene wird aus diesen Iterationsdaten ein `ImageData`-Objekt erzeugt. Dabei werden Render-Parameter wie Palette, Gamma, Smooth Coloring, logarithmische Skalierung und Paletteninvertierung angewendet. Das fertige `ImageData` wird anschließend auf den Canvas gezeichnet.

Beim Verschieben der Ansicht wird das vorhandene Bild während der Mausbewegung zunächst nur visuell verschoben. Nach dem Loslassen werden die vorhandenen Iterationsdaten für den weiterhin sichtbaren Bereich übernommen. Nur die durch die Verschiebung neu sichtbar gewordenen Rechtecke werden neu berechnet und in die Iterationsmatrix geschrieben.

Die Anwendung verwendet zwei zentrale Settings-Objekte:

- `computationSettings`
  - sichtbarer Ausschnitt
  - initialer Ausschnitt
  - maximale Iterationstiefe
  - Escape-Radius

- `renderSettings`
  - Gamma
  - Farbskalierungs-Korrektur
  - aktive Palette
  - Farbe der inneren Menge
  - Smooth Coloring
  - logarithmische Skalierung
  - Stärke der Log-Skalierung
  - invertierte Palette

Für Punkte innerhalb der Hauptkardiode und der Periode-2-Glühbirne werden schnelle Vorabtests verwendet. Dadurch müssen viele sicher innenliegende Punkte nicht vollständig iteriert werden.

Die Darstellung unterstützt mehrere Palettentypen:

- Cosinus-Paletten
- Graustufen
- HSV-Regenbogen
- zyklische Farbbänder

Für Cosinus-Paletten wird die folgende Funktion verwendet:

```text
color = a + b * cos(2π * (c * t + d))
```

Smooth Coloring kann optional aktiviert werden. Die logarithmische Skalierung kann ebenfalls ein- oder ausgeschaltet werden und lässt sich über die Log-Stärke mit der linearen Skalierung mischen.

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
- Trennung von Berechnung, Iterationsdaten, ImageData und Canvas-Ausgabe.
- Wiederverwendung berechneter Daten beim Verschieben der Ansicht.
- Strukturierung eines zunächst einfachen JavaScript-Projekts in kleinere Module.
- Umgang mit interaktivem UI-State.
- Responsive Layouts ohne Verzerrung mathematischer Koordinaten.
- Experimentieren mit Farbpaletten, Smooth Coloring und logarithmischer Skalierung.
- Vorbereitung einer generischeren Fraktal-Pipeline, z. B. für spätere Julia-Mengen.

## Mögliche nächste Schritte

- Berechnung in einen Web Worker auslagern, damit der Browser während langer Renderings reaktionsfähig bleibt.
- Touch- und Tastaturbedienung verbessern.
- Presets, Bookmarks oder eine Zoom-History einbauen.
- Frei editierbare Palettenparameter ergänzen.
- Export-Metadaten ergänzen, z. B. View-Koordinaten oder Rendering-Parameter.
- Weitere Entkopplung der generischen Iterationsdaten-Operationen von der konkreten Mandelbrot-Berechnung.
- Perspektivisch Julia-Mengen oder andere Escape-Time-Fraktale ergänzen.
- Perspektivisch ein performanteres Backend oder WebAssembly-Modul für die Berechnung testen.

---

Entwickelt als gemeinsames Lernprojekt von Karl und Dirk Geßner.
