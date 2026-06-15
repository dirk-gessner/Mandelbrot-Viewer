# LMV – Lightweight Mandelbrot Viewer

LMV ist ein interaktiver Mandelbrot-Viewer für den Webbrowser. Die Anwendung stellt die Mandelbrot-Menge auf einem HTML5-Canvas dar und erlaubt es, den Ausschnitt, die Berechnungsparameter, das Berechnungsbackend, die Farbgebung und die optionale Musikwiedergabe (Karls Idee) interaktiv zu verändern.

Das Projekt ist bewusst leichtgewichtig gehalten: Es gibt keine Build-Pipeline, keinen Bundler und kein Framework-Setup. Die Anwendung kann direkt über einen lokalen Webserver in einem modernen Browser gestartet werden.

---

## Benutzer-Dokumentation

### Worum handelt es sich bei dem Projekt?

LMV ist ein Lern- und Experimentierprojekt zur Mandelbrot-Menge. Der Viewer berechnet die Mandelbrot-Daten im Browser und erzeugt daraus ein farbig gerendertes Canvas-Bild.

Die Anwendung eignet sich zum Erkunden der Mandelbrot-Menge, zum Experimentieren mit Zoomstufen, Iterationstiefe, Farbpaletten und Backends sowie zum Speichern interessanter Ansichten als PNG-Datei.

Die Berechnung kann je nach Konfiguration und Ansicht über ein CPU-Backend mit Web Workern, über ein klassisches WebGPU-Backend oder über ein WebGPU-Backend mit Perturbation-Ansatz erfolgen. Für Ansichten, bei denen die aktuelle WebGPU-Implementierung wegen `f32`-Präzision nicht mehr sinnvoll eingesetzt werden kann, kann die Anwendung automatisch auf Perturbation oder auf die CPU-Berechnung zurückfallen.

### Hauptfunktionen

- Interaktive Darstellung der Mandelbrot-Menge im Browser.
- Zoom in frei wählbare Bildbereiche.
- Verschieben des sichtbaren Ausschnitts per Maus oder Touch-Geste.
- Schrittweiser Zoom-Out per Doppelklick oder Double-Tap.
- Touch-Zoom-In per Zwei-Finger-Geste auf dem Canvas.
- Änderung der Größe des Zoom-Zielbereichs per Mausrad.
- Thematisch gegliedertes Control-Panel mit seitlichen Tabs.
- Control-Panel mit explizitem Drawer-State für Maus-, Touch- und Tastaturbedienung.
- Anzeige der aktuellen X- und Y-Bereiche sowie des Zoom-Levels.
- Anzeige der zuletzt verwendeten Berechnungszeit und des zuletzt verwendeten Backends.
- Auswahl verschiedener Farbpaletten.
- Steuerung von Gamma-Korrektur, logarithmischer Skalierung, Smooth Coloring und Paletteninvertierung.
- Berechnung der `IterationData` über CPU-Worker, WebGPU oder WebGPU mit Perturbation.
- Umschaltbare Backend-Konfiguration:
  - `CPU`
  - `WebGPU`
  - `WebGPU + Perturbation`
  - `WebGPU + CPU-Fallback`
  - `WebGPU + Perturbation + CPU-Fallback`
- Automatischer Wechsel vom klassischen WebGPU-Shader zum Perturbation-Shader, wenn die `f32`-Präzision für die aktuelle Zoomstufe nicht mehr ausreicht und Perturbation aktiviert ist.
- Automatischer CPU-Fallback, sofern die Backend-Konfiguration ihn erlaubt.
- Sammlung, Priorisierung und optionale Anzeige von Referenzpunkten für die Perturbation-Berechnung.
- Glitch-Erkennung für Perturbation-Ergebnisse mit Prüfung auf abgelaufene Referenzorbits, zu kleine Orbits, zu große Delta-Orbits und nicht endliche Werte.
- Lokaler Musikplayer für selbst ausgewählte Audio-Dateien.
- Speichern der aktuellen Ansicht als PNG.
- Zurücksetzen auf den initialen Bildausschnitt.
- Responsive Anpassungen für Tablets und Smartphones, einschließlich angepasster Touch-Flächen und ausgeblendeter Header-Grafik auf kleinen Displays.

### Inbetriebnahme

1. Repository klonen oder als ZIP-Datei herunterladen.
2. Projektverzeichnis öffnen.
3. Einen lokalen Webserver im Projektverzeichnis starten, zum Beispiel über die Live-Server-Erweiterung des Editors oder einen einfachen lokalen HTTP-Server.
4. `index.html` im Browser öffnen.

Ein lokaler Webserver ist erforderlich, weil Web Worker und Modul-Worker in modernen Browsern nicht zuverlässig direkt aus `file://`-URLs geladen werden.

Der Viewer lädt Vue 3 über CDN:

```text
https://unpkg.com/vue@3/dist/vue.global.prod.js
```

Eine lokale Installation oder ein Build-Schritt ist aktuell nicht nötig.

Für das WebGPU-Backend wird ein Browser mit WebGPU-Unterstützung benötigt. Ist WebGPU nicht verfügbar, kann weder der klassische WebGPU-Pfad noch der WebGPU-Perturbation-Pfad verwendet werden. In diesem Fall ist nur ein CPU-Fallback möglich, sofern er in der Backend-Konfiguration erlaubt ist.

### Verwendung der Benutzeroberfläche

#### Canvas

Der große zentrale Bereich zeigt die Mandelbrot-Menge. Dort finden die wichtigsten Interaktionen statt: Zoomen, Verschieben und Ändern der Zoom-Zielgröße.

##### Desktop / Maus

| Aktion | Bedienung |
|---|---|
| Ansicht verschieben | Linke Maustaste auf dem Canvas gedrückt halten und ziehen |
| Schrittweise herauszoomen | Doppelklick auf den Canvas |
| Zoom-In | Rechte Maustaste drücken, Auswahlrahmen positionieren, optional mit Mausrad skalieren, dann loslassen |
| Auswahlrahmen positionieren | Rechte Maustaste gedrückt halten und Maus bewegen |
| Auswahlrahmen skalieren | Mausrad verwenden, solange eine Zoom-Auswahl aktiv ist |

##### Touch / Tablet / Smartphone

| Aktion | Bedienung |
|---|---|
| Ansicht verschieben | Mit einem Finger auf dem Canvas ziehen |
| Zoom-In | Zwei Finger auf dem Canvas auseinanderziehen |
| Schrittweise herauszoomen | Doppelt auf den Canvas tippen |
| Control-Panel öffnen | Seitliche Tabs oder rechten Fensterrand antippen |

Touch-Gesten werden über Pointer-Events verarbeitet. Zwei-Finger-Gesten sind auf das Canvas begrenzt, damit die übrige Oberfläche bedienbar bleibt.

#### Control-Panel

Das Control-Panel befindet sich als Overlay-Drawer am rechten Fensterrand. Beim Start fährt es kurz ein Stück heraus, um auf seine Position hinzuweisen.

Der dauerhafte Sichtbarkeitszustand des Drawers wird über die CSS-Klasse `.open` gesteuert. JavaScript setzt diese Klasse explizit:

- auf Desktop-Geräten beim Überfahren des rechten Fensterrands mit der Maus,
- auf Touch-Geräten per Pointer-/Tap-Ereignis,
- beim Antippen der seitlichen Tabs,
- beim Schließen über den Close-Button,
- beim Schließen über die `Escape`-Taste.

Auf Touch-Geräten ist die geschlossene Trefferfläche größer als auf Desktop-Geräten, damit der rechte Randbereich zuverlässiger getroffen werden kann.

Die Inhalte des Control-Panels sind in seitliche Tabs gegliedert:

| Tab | Inhalt |
|---|---|
| Ansicht | Aktueller Ausschnitt, Zoom-Level, letzte Berechnungszeit, verwendetes Backend, Zurücksetzen der Ansicht |
| Berechnung | Iterationstiefe, Escape-Radius, CPU-Multithreading und Backend-Konfiguration |
| Darstellung | Farbpalette, Farbe der inneren Menge, Gamma, Log-Skalierung, Smooth Coloring, Paletteninvertierung und PNG-Export |
| Audio | Lokaler Musikplayer für ausgewählte Audio-Dateien |

#### Aktionen im Control-Panel

| Aktion | Bedienung |
|---|---|
| Control-Panel öffnen | Maus an den rechten Fensterrand bewegen, rechten Rand antippen oder seitlichen Tab antippen |
| Control-Panel schließen | Close-Button links neben dem geöffneten Control-Panel klicken/tippen oder `Escape` drücken |
| Tab wechseln | Seitlichen Tab links am Control-Panel klicken/tippen |
| Ansicht zurücksetzen | Im Tab „Ansicht“ den Button „Ansicht zurücksetzen“ verwenden |
| PNG speichern | Im Tab „Darstellung“ den Button „Als PNG speichern“ verwenden |

### Hilfe-Modal

Über den Button „Steuerung“ in der Fußzeile kann ein Hilfe-Modal geöffnet werden. Das Modal beschreibt die wichtigsten Desktop- und Touch-Bedienungen getrennt voneinander.

### Musikplayer

Der Musikplayer befindet sich im Tab „Audio“.

Musikdateien werden nicht mit dem Projekt ausgeliefert und sollten auch nicht ins Repository eingecheckt werden. Stattdessen wählt der Nutzer lokal ein Musikverzeichnis aus. Die Dateien bleiben lokal im Browser. Sie werden nicht hochgeladen und nicht im Projekt gespeichert. Die Anwendung erzeugt temporäre Objekt-URLs für die Dauer der Browser-Sitzung.

Unterstützt werden aktuell:

- MP3-Dateien (`.mp3`)
- WAV-Dateien (`.wav`)

Funktionen des Musikplayers:

- lokales Musikverzeichnis auswählen,
- Musikstück aus der geladenen Liste auswählen,
- vorheriges Stück,
- Wiedergabe starten,
- Wiedergabe pausieren,
- Wiedergabe stoppen,
- nächstes Stück,
- Lautstärke einstellen,
- Playlist wiederholen.

Hinweis: Browser erlauben die Wiedergabe mit Ton in der Regel erst nach einer Nutzerinteraktion. Deshalb startet die Musik nicht automatisch beim Laden der Seite, sondern erst über die Player-Controls.

### Farbpaletten

Aktuell sind mehrere Palettentypen vorhanden.

Cosinus-Paletten:

- `Gold-Blau`
- `Feuer`
- `Eis`
- `Party`

Graustufen-Paletten:

- `Graustufen`
- `Alternierende Graustufen`

Weitere Paletten:

- `HSV-Regenbogen`
- `Zyklische Farbbänder`

Für die innere Menge stehen mehrere feste Farben zur Verfügung:

- Schwarz
- Weiß
- Magenta
- Cyan
- Gelb

### Screenshots

![LMV Startansicht](img/screenshots/lmv-general-view.png)
![LMV Control-Panel](img/screenshots/lmv-control-panel.png)
![LMV Steuerung](img/screenshots/lmv-help-modal.png)
![LMV Farbmodus](img/screenshots/lmv-color-modes-01.png)
![LMV Farbmodus](img/screenshots/lmv-color-modes-02.png)
![LMV Farbmodus](img/screenshots/lmv-color-modes-03.png)
![LMV Zoom-Auswahl](img/screenshots/lmv-selection-frame-01.png)
![LMV Zoom-Auswahl](img/screenshots/lmv-selection-frame-02.png)
![LMV Zoom-Auswahl](img/screenshots/lmv-selection-frame-03.png)
![LMV Detailansicht](img/screenshots/lmv-detail-view.png)

---

## Entwickler-Dokumentation

### Projektstruktur

```text
.
├── index.html
├── css/
│   ├── styles.css
│   └── modules/
│       ├── controls.css
│       ├── modal.css
│       └── ...
├── img/
│   ├── lmv.png
│   ├── definition.svg
│   └── screenshots/
│       └── ...
└── js/
    ├── core/
    │   └── worker-rpc-client.js
    ├── webgpu/
    │   └── webgpu-worker-runtime.js
    ├── fractals/
    │   ├── fractal-gpu-utils.js
    │   └── mandelbrot/
    │       ├── mandelbrot.js
    │       ├── mandelbrot-cpu-worker.js
    │       ├── mandelbrot-webgpu.js
    │       └── mandelbrot-webgpu-worker.js
    ├── dom.js
    ├── settings.js
    ├── timing.js
    ├── palettes.js
    ├── iteration-data.js
    ├── rendering.js
    ├── layout.js
    ├── interactions.js
    ├── music.js
    ├── help.js
    ├── ui.js
    ├── file.js
    └── main.js
```

### Wichtige Dateien

- `index.html` enthält Seitenstruktur, Canvas, Render-Overlay, Control-Drawer, seitliche Control-Tabs, Help-Modal, Vue-gebundene Controls und die Script-Einbindung.
- `css/styles.css` bindet die CSS-Module ein.
- `css/modules/controls.css` enthält das Styling und die Animationen für den Control-Drawer, den Close-Button, die seitlichen Tabs und die Controls im Panel. Außerdem definiert es Touch-spezifische Trefferflächen und die Initial-Reveal-Animation.
- `css/modules/modal.css` enthält das Styling des Help-Modals.
- `img/definition.svg` wird im Header als Formelgrafik eingebunden. Auf kleinen Displays wird die Header-Grafik ausgeblendet, um Platz für die Bedienoberfläche zu schaffen.
- `js/dom.js` sammelt zentrale DOM-Referenzen wie Canvas, Context, Wrapper, Render-Overlay und Control-Drawer.
- `js/settings.js` enthält Berechnungs-, Rendering-, Multithreading-, Backend-, Runtime- und Musik-Einstellungen sowie JSDoc-Typdefinitionen für zentrale Settings-Strukturen.
- `js/timing.js` enthält die Laufzeitmessung für vollständige Iterationsdaten-Aktualisierungen.
- `js/palettes.js` definiert Farben und Farbpaletten.
- `js/iteration-data.js` enthält generische Operationen auf Iterationsdaten, darunter Kopieren von Rechtecken, Dirty-Rect-Ermittlung, Panning- und Resize-Logik. Die Datei dokumentiert die zentralen Datenstrukturen über JSDoc-Typdefinitionen.
- `js/core/worker-rpc-client.js` enthält einen Promise-basierten RPC-Client für Worker-Kommunikation mit Request-IDs und Pending-Request-Verwaltung.
- `js/webgpu/webgpu-worker-runtime.js` enthält wiederverwendbare WebGPU-Worker-Hilfsfunktionen, darunter Kontext- und Pipeline-Initialisierung sowie Fehlerantworten.
- `js/fractals/fractal-gpu-utils.js` enthält GPU-nahe Hilfsfunktionen, die nicht direkt Mandelbrot-spezifisch sind, zum Beispiel Float32-Splitting und den Aufbau von `IterationData` aus GPU-Arrays.
- `js/fractals/mandelbrot/mandelbrot.js` enthält die Mandelbrot-spezifische Orchestrierung, Backend-Auswahl, CPU-Worker-Aufrufe, Task-Aufteilung, das Zusammenführen der Teilergebnisse, die Referenzorbit-Berechnung und die Auswahl geeigneter Perturbation-Referenzkandidaten.
- `js/fractals/mandelbrot/mandelbrot-cpu-worker.js` enthält die synchrone Mandelbrot-Berechnung für das CPU-Backend.
- `js/fractals/mandelbrot/mandelbrot-webgpu.js` enthält den Main-Thread-Proxy zum Mandelbrot-WebGPU-Worker.
- `js/fractals/mandelbrot/mandelbrot-webgpu-worker.js` enthält die klassische WebGPU-Compute-Berechnung sowie die WebGPU-Perturbation-Berechnung der Mandelbrot-Iterations- und Escape-Werte.
- `js/rendering.js` enthält Rendering-Funktionen, den Aufbau von `ImageData` aus Iterationsdaten, Bildausgabe, Render-Overlay, Panning-Vorschau sowie das optionale Overlay für Perturbation-Referenzpunkte.
- `js/layout.js` behandelt Canvas-Größe, initialen View, Seitenverhältnis, Resize-Logik, Reset der Ansicht und den expliziten Control-Drawer-State für Maus-, Touch- und Tastaturbedienung.
- `js/interactions.js` enthält Pointer-basierte Interaktionen mit dem Canvas: Desktop-Mausbedienung, Touch-Panning, Touch-Double-Tap, Zwei-Finger-Zoom-In, Auswahlrahmen, Panning-Vorschau, Zoom-Out-Schritte und Resize-Handling.
- `js/music.js` enthält den lokalen Audio-Player, das Laden von Audio-Dateien aus einem vom Nutzer ausgewählten Verzeichnis, Playlist-Verwaltung, temporäre Objekt-URLs und Player-Funktionen.
- `js/help.js` steuert das Help-Modal.
- `js/ui.js` enthält die Vue-App für das Control-Panel und synchronisiert UI-State mit Settings, Backend-Konfiguration, Laufzeitstatistik, Tab-Auswahl und Musikplayer.
- `js/file.js` enthält den PNG-Export des aktuellen Canvas.
- `js/main.js` initialisiert Canvas, View, Control-Drawer, Help-Modal, UI-Info und startet die erste Berechnung.

### UI-Struktur

Das Control-Panel bleibt ein rechter Drawer. Die thematische Gliederung erfolgt über einen Vue-State `activeControlTab`. Die einzelnen Tab-Inhalte werden mit `v-show` ein- und ausgeblendet. Dadurch bleiben die Controls im DOM erhalten und verlieren ihren lokalen Zustand nicht beim Tab-Wechsel.

Die seitlichen Tabs und der Close-Button sind außerhalb der eigentlichen Panel-Fläche positioniert. Dadurch wirken sie wie Reiter am Rand des Panels und bleiben visuell mit dem Drawer verbunden.

Der sichtbare Zustand des Drawers ist nicht mehr nur ein impliziter CSS-/Hover-Zustand. `layout.js` stellt Funktionen wie `openControlsDrawer()`, `closeControlsDrawer()` und `toggleControlsDrawer()` bereit und verwaltet den Zustand über die Klasse `.open` sowie `aria-expanded`.

### Touch- und Pointer-Interaktionen

Die Canvas-Interaktionen werden über Pointer-Events verarbeitet. Dadurch können Maus- und Touch-Bedienung in einer gemeinsamen Ereignisstruktur behandelt werden.

Wichtige Zustände:

- `pan` speichert eine aktive Verschiebegeste und unterscheidet über eine Bewegungsschwelle zwischen Tap und Drag.
- `tap` speichert Zeit und Position des letzten Touch-Taps, um Double-Tap für den Zoom-Out zu erkennen.
- `activePointers` hält die letzten bekannten Canvas-Positionen aktiver Pointer-IDs.
- `pinch` beschreibt eine aktive Zwei-Finger-Geste und erzeugt während der Bewegung einen Zoom-Auswahlrahmen.

Bei einer Zwei-Finger-Geste wird während der Bewegung nur die Vorschau des Zielbereichs gezeichnet. Die eigentliche Neuberechnung erfolgt erst beim Abschluss der Geste.

### Musikplayer-Architektur

Der Musikplayer arbeitet bewusst ohne ausgelieferte Audiodateien. Der Nutzer wählt lokal ein Verzeichnis aus. Die Anwendung filtert daraus unterstützte Audio-Dateien, baut eine Playlist auf und erzeugt für jede Datei eine temporäre Objekt-URL.

Wichtige Zustände liegen in `musicSettings`:

```js
{
  tracks: [],
  selectedTrackIndex: -1,
  volume: 0.25,
  enabled: false,
  loop: true
}
```

`selectedTrackIndex` verweist auf den aktuell gewählten Eintrag in `tracks`. Dadurch muss die Playlist nicht mit stabilen statischen Track-IDs arbeiten. Das ist sinnvoll, weil die Musikliste erst zur Laufzeit aus lokalen Dateien entsteht.

Nicht mehr benötigte Objekt-URLs sollten mit `URL.revokeObjectURL(...)` freigegeben werden, bevor eine neue Playlist geladen wird.

### Technische Details

#### Trennung von Berechnung, Iterationsdaten und Rendering

Die Anwendung trennt drei Ebenen:

1. **Berechnung**
   - Die Mandelbrot-Menge wird für den aktuell sichtbaren View berechnet.
   - Ergebnis sind Iterationswerte und Escape-Werte.
   - Die Berechnung kann über CPU-Worker, WebGPU oder WebGPU mit Perturbation erfolgen.

2. **Iterationsdaten**
   - Die Werte werden in einer Matrix gehalten.
   - Die Datenstruktur ist allgemeiner gedacht als die konkrete Mandelbrot-Berechnung.
   - Operationen wie Kopieren, Verschieben und Dirty-Rect-Ermittlung hängen nicht direkt von der Mandelbrot-Formel ab.
   - Mandelbrot-spezifische Metadaten wie Referenzkandidaten werden ergänzend an die fertigen Daten angehängt.

3. **Rendering**
   - Aus den Iterationsdaten wird ein `ImageData`-Objekt erzeugt.
   - Render-Parameter wie Palette, Gamma, Smooth Coloring, logarithmische Skalierung und Paletteninvertierung werden erst beim Bildaufbau angewendet.
   - Das fertige `ImageData` wird auf den Canvas gezeichnet.
   - Optional werden Perturbation-Referenzpunkte und ein Diagnose-Raster als Canvas-Overlay angezeigt.

Diese Trennung erlaubt schnelle Aktualisierungen bei reinen Darstellungsänderungen: Farb- und Rendering-Parameter bauen nur das Bild aus den vorhandenen Iterationsdaten neu auf. Eine vollständige Neuberechnung ist nur nötig, wenn sich Berechnungsparameter, Backend-Einstellungen oder der sichtbare mathematische Ausschnitt ändern.

#### IterationData

Die zentrale Datenstruktur enthält:

```js
{
  width,                 // Breite der Matrix in Pixeln
  height,                // Höhe der Matrix in Pixeln
  iterations,            // Uint16Array(width * height)
  escapeValues,          // Float32Array(width * height)
  minIterations,         // kleinster Iterationswert im Datensatz
  maxObservedIterations, // größter beobachteter Iterationswert im Datensatz
  referenceCandidates,   // Mandelbrot-Referenzkandidaten für Perturbation
  perturbationStats      // optionale Diagnosewerte aus dem Perturbation-Shader
}
```

`iterations` und `escapeValues` sind parallel aufgebaut. Der Index eines Pixels ergibt sich aus:

```text
index = y * width + x
```

`referenceCandidates` werden aus fertigen Mandelbrot-Iterationsdaten ermittelt und dienen als Ausgangspunkte für spätere Perturbation-Berechnungen. `perturbationStats` wird nur bei Perturbation-Ergebnissen gesetzt und enthält Diagnosewerte zur Bewertung des verwendeten Referenzorbits.

#### Backend-Auswahl

Die zentrale Einstiegstelle ist die Rechteckberechnung:

```text
computeMandelbrotRect(rect, imageWidth, imageHeight, computationSettings)
```

Diese Funktion entscheidet anhand der Backend-Konfiguration und der aktuellen Ansicht zwischen CPU, klassischem WebGPU-Shader und WebGPU-Perturbation.

Die Backend-Konfiguration wird über `mandelbrotBackendSettings` gesteuert:

```js
{
  useWebGpu: true,
  usePerturbation: true,
  useCpu: true
}
```

Die Benutzeroberfläche bildet daraus auswählbare Modi:

- `CPU`
- `WebGPU`
- `WebGPU + Perturbation`
- `WebGPU + CPU-Fallback`
- `WebGPU + Perturbation + CPU-Fallback`

Der klassische WebGPU-Shader wird verwendet, wenn:

- WebGPU in der Backend-Konfiguration erlaubt ist,
- WebGPU im Browser verfügbar ist,
- die Ansicht noch groß genug für die aktuelle `f32`-GPU-Berechnung ist.

Wenn die Pixelgröße unter die definierte Grenze für den klassischen `f32`-Shader fällt und Perturbation erlaubt ist, versucht die Anwendung den WebGPU-Perturbation-Pfad. Wenn WebGPU oder Perturbation fehlschlagen und der CPU-Fallback erlaubt ist, wird direkt der CPU-Pfad verwendet.

#### CPU-basierte Berechnung

Für kleine Rechtecke oder eine Worker-Anzahl von `1` wird ein einzelner CPU-Worker verwendet. Für größere Rechtecke wird das Rechteck horizontal in mehrere Tasks geteilt.

Konfigurierbar sind:

- Anzahl der Worker-Threads,
- Anzahl der Tasks pro Worker.

Die Aufteilung folgt dem Prinzip:

```text
taskCount = min(rect.height, workerCount * tasksPerWorker)
```

Dadurch entstehen in der Regel mehr Tasks als Worker. Das verbessert die Lastverteilung, weil die Rechenzeit innerhalb der Mandelbrot-Menge stark vom Bildbereich abhängt.

Der Ablauf für eine parallele vollständige CPU-Neuberechnung ist:

1. Aktuelles Bildrechteck bestimmen.
2. Rechteck horizontal in mehrere Tasks zerlegen.
3. Tasks in fester Reihenfolge in eine Queue legen.
4. Mehrere CPU-Worker-Aufträge starten.
5. Jeder Worker-Auftrag verarbeitet nacheinander den jeweils nächsten freien Task.
6. Ergebnisse in Task-Reihenfolge ablegen.
7. Teilergebnisse in ein gemeinsames `IterationData`-Objekt kopieren.
8. Aus `IterationData` ein neues `ImageData` erzeugen.
9. Canvas neu zeichnen.

Die CPU-Worker selbst kennen keine Parallelisierungslogik. Sie berechnen nur ein einzelnes übergebenes Rechteck und liefern dessen Iterations- und Escape-Werte zurück.

#### WebGPU-basierte Berechnung

Das WebGPU-Backend verwendet einen dauerhaft wiederverwendeten Worker:

```text
mandelbrot.js -> mandelbrot-webgpu.js -> mandelbrot-webgpu-worker.js
```

`mandelbrot-webgpu.js` arbeitet als Main-Thread-Proxy. Es verwaltet die Worker-Instanz, Request-IDs und ausstehende Promises. `mandelbrot-webgpu-worker.js` initialisiert den WebGPU-Kontext und die Compute-Pipeline.

Die klassische GPU-Berechnung erzeugt:

- einen `iterations`-Buffer,
- einen `escapeValues`-Buffer.

Beide Buffer werden nach dem Dispatch zurückgelesen und in eine `IterationData`-Struktur übertragen.

Die klassische WebGPU-Berechnung arbeitet im Shader mit `f32`. Zur Verbesserung der Koordinatenberechnung werden die View-Koordinaten center-relativ aufgebaut. Der Mittelpunkt wird in High-/Low-Float32-Anteile zerlegt. Dadurch wird der Koordinatenaufbau stabiler als bei direkter Berechnung aus `minX`/`maxX`, echte Double-Precision im Mandelbrot-Loop wird dadurch aber nicht ersetzt.

Für tiefe Zoomstufen wird deshalb je nach Konfiguration der Perturbation-Pfad oder das CPU-Backend verwendet.

#### WebGPU-Perturbation

Der Perturbation-Pfad ist für tiefere Zoomstufen gedacht, bei denen die klassische `f32`-Berechnung benachbarte Pixel nicht mehr zuverlässig auf unterschiedliche komplexe Koordinaten abbilden kann.

Der Ablauf ist:

1. Aus vorhandenen `IterationData` werden Mandelbrot-Referenzkandidaten gesammelt.
2. Die Kandidaten werden für das zu berechnende Rechteck priorisiert.
3. Für Kandidaten wird im Hauptthread ein Referenzorbit mit JavaScript-`number` berechnet.
4. Kandidaten mit zu kurzem Referenzorbit werden verworfen.
5. Der Referenzorbit wird als Float32-Buffer an den WebGPU-Worker übertragen.
6. Der Perturbation-Shader berechnet die Pixel relativ zum Referenzorbit.
7. Zusätzlich zu Iterations- und Escape-Werten schreibt der Shader Statuswerte pro Pixel.
8. Die Statuswerte werden ausgewertet und als `perturbationStats` an das Ergebnis gehängt.
9. Nur akzeptable Perturbation-Ergebnisse werden verwendet; andernfalls wird der nächste Referenzkandidat versucht.
10. Wenn kein geeigneter Referenzkandidat gefunden wird und CPU-Fallback erlaubt ist, wird auf die CPU-Berechnung zurückgefallen.

Die Referenzkandidaten werden über ein Raster aus dem Bild verteilt gesammelt. Pro Rasterzelle werden Kandidaten nahe am lokalen Iterationsmaximum bevorzugt. Dadurch stehen auch bei unterschiedlichen Bildbereichen und Dirty-Rects mehrere mögliche Referenzpunkte zur Verfügung.

#### Glitch-Erkennung bei Perturbation

Der Perturbation-Shader schreibt pro Pixel einen Statuswert. Aus diesen Werten werden Diagnosezähler gebildet:

- `referenceEndedCount`: Der Referenzorbit war für einzelne Pixel zu kurz.
- `smallOrbitCount`: Der Delta-Orbit wurde im Verhältnis zum Referenzorbit zu klein und damit potenziell instabil.
- `deltaTooLargeCount`: Der Delta-Orbit wurde zu groß für den gewählten Referenzpunkt.
- `nonFiniteCount`: Es sind nicht endliche Werte entstanden.
- `invalidCount`: Summe aller nicht erfolgreichen Statuswerte.

Harte Fehler wie abgelaufene Referenzorbits oder nicht endliche Werte werden nicht akzeptiert. Glitch-Verdacht durch kleine Orbits oder zu große Delta-Orbits wird nur bis zu konfigurierten Anteilsgrenzen toleriert.

Die aktuelle Implementierung korrigiert fehlerhafte Pixel nicht einzeln, sondern verwirft das gesamte Perturbation-Ergebnis für den Kandidaten und versucht einen anderen Referenzpunkt.

#### Referenzpunkte und Diagnose-Overlay

Wenn „Referenzpunkte anzeigen“ aktiviert ist, zeichnet das Rendering ein Overlay über das aktuelle Bild:

- ein Raster für die Kandidatensammlung,
- kleine Markierungen für verfügbare Referenzkandidaten,
- eine hervorgehobene Markierung für den aktuell passendsten Kandidaten zur View.

Dieses Overlay dient der Diagnose und wird nicht in die eigentlichen `ImageData`-Pixel geschrieben.

#### WebGPU-Dispatch

Der Compute-Shader arbeitet mit zweidimensionalen Workgroups. Die Anwendung protokolliert optional:

- Workgroup-Größe,
- Anzahl der Workgroups,
- angeforderte Shader-Invocations,
- tatsächlich aktive Pixel,
- inaktive Rand-Invocations.

Diese Werte beschreiben die angeforderten Shader-Invocations. Die tatsächliche Anzahl physischer GPU-Threads wird von WebGPU abstrahiert und ist nicht zuverlässig auslesbar.

#### Laufzeitmessung

Für vollständige Neuberechnungen wird die letzte `IterationData`-Aktualisierung gemessen. Die Messung umfasst die Berechnung der neuen Iterationsdaten inklusive Backend-Aufwand, Worker-Verteilung, GPU-Readback, Perturbation-Referenzorbit und Zusammenführung der Teilergebnisse.

Nicht gemessen werden reine Render-Änderungen wie Farbpalette, Gamma oder Log-Skalierung, weil diese keine neue Iterationsmatrix erzeugen und deshalb schlecht mit vollständigen Neuberechnungen vergleichbar sind.

Der zuletzt gemessene Wert wird im Control-Panel in Sekunden mit drei Nachkommastellen angezeigt. Zusätzlich wird das zuletzt tatsächlich verwendete Backend angezeigt.

#### Panning mit Dirty Rects

Beim Verschieben der Ansicht wird während der Maus- oder Touch-Bewegung zunächst nur das bereits gerenderte Bild verschoben dargestellt. Dadurch fühlt sich das Panning unmittelbar an.

Beim Loslassen beziehungsweise Beenden der Geste passiert Folgendes:

1. Der mathematische View wird um die Pixelverschiebung in Koordinaten verschoben.
2. Die vorhandene Iterationsmatrix wird in eine neue Matrix kopiert.
3. Der weiterhin sichtbare Bereich wird aus dem alten Cache übernommen.
4. Die neu sichtbar gewordenen Randbereiche werden als Dirty Rects bestimmt.
5. Nur diese Dirty Rects werden neu berechnet.
6. Die Referenzkandidaten werden passend zur aktualisierten Matrix neu ermittelt.
7. Anschließend wird aus der aktualisierten Iterationsmatrix ein neues `ImageData` erzeugt.

Bei einer kleinen horizontalen Verschiebung wird zum Beispiel nur ein vertikaler Randstreifen neu berechnet. Bei einer kombinierten horizontalen und vertikalen Verschiebung entstehen ein Randstreifen und ein zusätzlicher oberer oder unterer Streifen.

Wenn die Verschiebung größer oder gleich der Bildgröße ist, wird das gesamte Bild neu berechnet.

#### Resize mit Dirty Rects

Bei Größenänderungen des Fensters wird das Canvas an die tatsächliche Anzeigengröße angepasst. Der mathematische View wird so erweitert, dass das neue Seitenverhältnis ohne Verzerrung erfüllt wird.

Canvas-Vergrößerungen werden schrittweise behandelt:

1. Breitenänderungen werden horizontal verarbeitet.
2. Höhenänderungen werden vertikal verarbeitet.
3. Bereits vorhandene Daten werden an die passende Position im neuen Datenraster kopiert.
4. Nur die neu entstandenen Randbereiche werden berechnet.
5. Der zurückgegebene View wird zusammen mit den erzeugten Iterationsdaten übernommen.
6. Die Referenzkandidaten werden passend zur neuen Matrix aktualisiert.

Bei Canvas-Verkleinerungen wird aktuell vollständig neu berechnet. Das ist einfacher und vermeidet komplizierte Ausschnitts- und Resampling-Fälle.

#### Smooth Coloring und Farbskalierung

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

#### Mandelbrot-Optimierungen

Für sicher innenliegende Punkte werden schnelle Vorabtests genutzt:

- Periode-2-Glühbirne,
- Hauptkardiode.

Punkte, die durch diese Tests sicher innerhalb der Menge liegen, müssen nicht vollständig iteriert werden.

### Entwicklungsnotizen

#### Warum Web Worker?

Die Mandelbrot-Berechnung ist rechenintensiv. Durch Web Worker kann sie aus dem Hauptthread ausgelagert werden. Im CPU-Backend wird dadurch außerdem eine parallele Berechnung über mehrere Worker ermöglicht.

Die Architektur ist darauf ausgelegt, dass die aufrufenden Schichten weiterhin mit einer vollständigen `IterationData`-Struktur arbeiten, während die Backend-Details innerhalb der Berechnungsschicht gekapselt bleiben.

#### Warum WebGPU?

Die Berechnung einzelner Mandelbrot-Pixel ist hochgradig parallelisierbar. WebGPU erlaubt es, viele Pixel gleichzeitig über einen Compute-Shader zu berechnen.

In der aktuellen Umsetzung werden sowohl die Iterationswerte als auch die Escape-Werte auf der GPU berechnet und anschließend als Typed Arrays zurück in die bestehende `IterationData`-Pipeline übertragen.

#### Warum Perturbation?

Der klassische WebGPU-Shader arbeitet mit `f32`. Das ist für viele normale Ansichten schnell und ausreichend genau, stößt bei tiefen Zoomstufen aber an Präzisionsgrenzen. Der Perturbation-Ansatz nutzt einen Referenzorbit und berechnet Pixel relativ zu diesem Orbit.

Dadurch können tiefere Ansichten experimentell weiterhin über WebGPU berechnet werden, ohne im Shader echte Double-Precision-Arithmetik vorauszusetzen.

#### Warum CPU-Fallback?

Auch der Perturbation-Pfad ist aktuell ein experimenteller Ansatz. Referenzpunkte können ungeeignet sein, Referenzorbits können zu kurz sein und einzelne Pixel können Glitch-Symptome zeigen.

Der CPU-Fallback sorgt dafür, dass die Anwendung weiterhin ein Ergebnis liefern kann, wenn das klassische WebGPU-Backend oder der Perturbation-Pfad für die aktuelle Ansicht nicht geeignet sind.

#### Warum mehr Tasks als Worker?

Die Rechenzeit ist über das Bild ungleich verteilt. Bereiche nahe der Grenze der Mandelbrot-Menge benötigen häufig deutlich mehr Iterationen als andere Bereiche.

Wenn das Bild nur in so viele Teile zerlegt wird, wie Worker vorhanden sind, kann ein einzelner langsamer Teilbereich die Gesamtdauer dominieren. Mehr kleinere Tasks verbessern die Lastverteilung: Worker, die mit einem schnellen Task fertig sind, können weitere Tasks übernehmen.

#### Warum Dirty Rects?

Ohne Dirty Rects müsste bei jeder Verschiebung oder Vergrößerung des Canvas das gesamte Bild neu berechnet werden. Das ist besonders bei hoher Iterationstiefe teuer.

Dirty Rects reduzieren die Arbeit auf die Bereiche, für die noch keine gültigen Iterationsdaten vorhanden sind. Das verbessert insbesondere:

- Panning über kleine Distanzen,
- Vergrößerung des Browserfensters,
- Layoutänderungen, bei denen bereits sichtbare Bereiche erhalten bleiben.

#### Warum Pointer-Events?

Die Bedienung soll auf Desktop, Tablet und Smartphone möglichst konsistent funktionieren. Pointer-Events erlauben eine gemeinsame Behandlung von Maus- und Touch-Eingaben, ohne die Canvas-Logik in getrennte Maus- und Touch-Implementierungen aufzuteilen.

Für Touch-Gesten werden Pointer-IDs verwendet. Dadurch kann die Anwendung erkennen, ob ein Finger oder zwei Finger aktiv sind, und zwischen Panning, Double-Tap und Pinch-Zoom unterscheiden.

#### Warum ein expliziter Drawer-State?

Ein reiner CSS-/Hover-Ansatz ist auf Touch-Geräten unzuverlässig, weil dort kein stabiles Hover-Modell existiert. Deshalb wird der Drawer-Zustand über JavaScript gesetzt und über `.open` dargestellt.

CSS bleibt für Darstellung, Animation und responsive Trefferflächen zuständig. JavaScript entscheidet, wann das Panel geöffnet oder geschlossen ist.

### Grenzen der aktuellen Lösung

- Die CPU-Worker werden aktuell pro Task über die bestehende Worker-Aufruffunktion erzeugt und nach Abschluss beendet; ein dauerhaft wiederverwendeter CPU-Worker-Pool wäre ein möglicher nächster Optimierungsschritt.
- Die Teilergebnisse werden beim Transfer noch nicht konsequent mit Transferables optimiert.
- Die klassische WebGPU-Berechnung arbeitet mit `f32`; für tiefe Zoomstufen ist deshalb Perturbation oder ein CPU-Fallback erforderlich.
- Die center-relative Koordinatenberechnung verbessert die WebGPU-Präzision, ersetzt aber keine echte Double-Precision-Arithmetik im Shader.
- Der Perturbation-Pfad ist experimentell und hängt stark von geeigneten Referenzpunkten ab.
- Die Glitch-Erkennung bewertet aktuell das gesamte Perturbation-Ergebnis eines Referenzkandidaten; einzelne fehlerhafte Pixel werden noch nicht lokal nachberechnet oder korrigiert.
- Referenzorbits werden aktuell im Hauptthread berechnet.
- Verkleinerungen des Canvas werden vollständig neu berechnet.
- Die Touch-Bedienung deckt Panning, Double-Tap-Zoom-Out, Pinch-Zoom-In und Drawer-Öffnung ab; Tastaturbedienung ist aktuell im Wesentlichen auf das Schließen des Drawers per `Escape` beschränkt.
- Es gibt noch keine Persistenz für Bookmarks, Presets oder Zoom-Historie.
- Die Multithreading-Parameter sind manuell einstellbar; eine automatische Wahl anhand von `navigator.hardwareConcurrency` wäre denkbar.

### Lernziele

- Grundlagen von HTML5 Canvas und Pixel-Rendering.
- Mathematische Struktur der Mandelbrot-Menge.
- Trennung von Berechnung, Iterationsdaten, `ImageData` und Canvas-Ausgabe.
- Auslagerung rechenintensiver Arbeit in Web Worker.
- Zerlegung großer Rechenbereiche in kleinere Tasks.
- Einfache Worker-Pool- beziehungsweise Task-Queue-Strategien.
- Nutzung von WebGPU Compute Shadern für pixelweise parallele Berechnungen.
- Aufbau und Readback von GPU-Buffern.
- Umgang mit `f32`-Präzisionsgrenzen in GPU-Shadern.
- Grundidee von Perturbation-Berechnungen für tiefere Mandelbrot-Zoomstufen.
- Auswahl, Bewertung und Visualisierung von Referenzpunkten.
- Einfache Glitch-Erkennung bei Perturbation-Ergebnissen.
- Wiederverwendung berechneter Daten beim Verschieben der Ansicht.
- Dirty-Rect-Strategien für Panning und Resize.
- Strukturierung eines einfachen JavaScript-Projekts in kleinere Module.
- Umgang mit interaktivem UI-State.
- Responsive Layouts ohne Verzerrung mathematischer Koordinaten.
- Touch- und Pointer-Event-Verarbeitung für Canvas-Interaktionen.
- Explizite UI-Zustände für mobile Drawer-Bedienung.
- Experimentieren mit Farbpaletten, Smooth Coloring und logarithmischer Skalierung.
- Vorbereitung einer generischeren Fraktal-Pipeline, zum Beispiel für spätere Julia-Mengen.

### Mögliche nächste Schritte

- CPU-Worker wiederverwenden statt für jeden Task neu erzeugen.
- Typed-Array-Buffer mit Transferables übertragen, um Kopieraufwand zu reduzieren.
- Automatische Worker-Anzahl aus `navigator.hardwareConcurrency` ableiten.
- Task-Größe dynamisch an Bildgröße und Iterationstiefe anpassen.
- WebGPU-/CPU-/Perturbation-Vergleichstests für kleine Referenzbereiche ergänzen.
- Die `f32`-Grenze für den Wechsel vom klassischen WebGPU-Shader zur Perturbation empirisch justieren.
- Perturbation-Glitches pixel- oder kachelweise nachberechnen, statt ganze Kandidaten-Ergebnisse zu verwerfen.
- Referenzorbit-Berechnung in einen Worker auslagern.
- Double-Single-Arithmetik oder weitere Perturbation-Varianten für tiefere GPU-Zoomstufen prüfen.
- Robustere Merge-Logik für beliebige Teilrechtecke ergänzen.
- Touch-Bedienung weiter verfeinern, insbesondere das Verhalten bei Pinch-Abbruch und Wechsel zwischen Pan- und Pinch-Gesten.
- Tastaturbedienung erweitern, zum Beispiel für Zoom, Panning oder Fokussteuerung im Control-Panel.
- Presets, Bookmarks oder eine Zoom-History einbauen.
- Frei editierbare Palettenparameter ergänzen.
- Export-Metadaten ergänzen, zum Beispiel View-Koordinaten oder Rendering-Parameter.
- Canvas-Verkleinerungen ebenfalls cache-basiert behandeln, sofern sich daraus ein klarer Nutzen ergibt.
- Weitere Entkopplung der generischen Iterationsdaten-Operationen von der konkreten Mandelbrot-Berechnung.
- Perspektivisch Julia-Mengen oder andere Escape-Time-Fraktale ergänzen.

---

Entwickelt als gemeinsames Lernprojekt von Karl und Dirk Geßner.
