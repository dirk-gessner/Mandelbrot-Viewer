# Naechste Schritte

## Erledigt

* Perturbation-Session eingefuehrt:
  * Ergebnisbuffer, Escape-Buffer, Statusbuffer und Readback-Buffer werden als Session-Kontext angelegt.
  * Die finalen Session-Buffer koennen gemeinsam ausgelesen werden.
* Perturbation-Parameter getrennt:
  * Session-Parameter werden einmal pro Rechteck/View geschrieben.
  * Orbit-Parameter werden zusammen mit dem Referenzorbit geschrieben.
* Orbit-Upload separiert:
  * Orbit-Buffer werden einmal angelegt.
  * Referenzorbit-Daten und Orbit-Parameter koennen wiederholt in bestehende Buffer geschrieben werden.
* Counterbuffer ergaenzt:
  * Der Shader schreibt kompakte Perturbation-Counter.
  * Der Host liest die Counter nach einem Pass aus.
  * `perturbationStats` kommt aus dem Counterbuffer.
* Statusbuffer beibehalten:
  * Der Statusbuffer bleibt als pro-Pixel-Diagnosefeld erhalten.
  * Er ist nicht mehr die Quelle fuer die Statistikzaehlung.
* Sentinel-Logik begonnen:
  * Der Iterationsbuffer kann mit `0xffffffff` initialisiert werden.
  * Der Perturbation-Shader nutzt den Sentinel als Maske fuer neu zu berechnende Pixel.
  * Der Iterationsbuffer benoetigt dafuer `COPY_DST`.

## Naechster Block

* Referenzorbit-Berechnung in den WebGPU-Worker verlagern:
  * Der Main Thread uebergibt Referenzkandidaten statt fertiger Referenzorbits.
  * Der Worker berechnet Referenzorbits nur dann, wenn sie fuer einen Pass gebraucht werden.
  * Die bisherige Referenzorbit-Berechnung aus `mandelbrot.js` in den Worker verschieben oder worker-nah kapseln.
  * Pruefen, welche Bewertungslogik mitwandern muss, z.B. Mindestlaenge des Referenzorbits.

* Perturbation-Mehrpass im Worker einbauen:
  * Fuer jeden geeigneten Kandidaten einen Referenzorbit berechnen.
  * Orbit in bestehende Orbit-Buffer schreiben.
  * Counterbuffer resetten.
  * Perturbation-Pass dispatchen.
  * Counter auslesen.
  * Stoppen, wenn `invalidCount === 0` oder keine Kandidaten mehr sinnvoll sind.

* Referenzkandidaten fuer Perturbation begrenzen:
  * Nicht alle gesammelten Referenzpunkte ausprobieren.
  * Nur Kandidaten innerhalb des Zielrechtecks und einer nahen Umgebung beruecksichtigen.
  * Padding abhaengig von Rect-Groesse oder View-Zoom waehlen.
  * Maximale Kandidatenanzahl pro Perturbation-Berechnung begrenzen.
  * Kandidaten weiterhin nach Eignung sortieren: Naehe, Iterationswert, lokales Zellmaximum, Escape-Wert.

## Danach

* Finalen Umgang mit verbleibenden Sentinel-Pixeln festlegen:
  * Ergebnis akzeptieren, wenn `invalidCount` klein genug ist.
  * Optional einzelne Restpixel per CPU nachberechnen, solange die Anzahl klein bleibt.
  * Ergebnis verwerfen oder CPU-Fallback verwenden, wenn zu viele Pixel ungueltig bleiben.
* Debug-Overlay fuer Perturbation-Status vorbereiten:
  * Statusbuffer fuer farbliche Markierung pro Fehlerstatus nutzen.
  * Overlay optional im Rendering aktivieren.
* Datei-Struktur spaeter pruefen:
  * Standard-WebGPU-Berechnung und Perturbation-Berechnung ggf. auf getrennte Module aufteilen.
  * Gemeinsame Worker-/Buffer-Helfer auslagern, falls die Datei weiter waechst.
