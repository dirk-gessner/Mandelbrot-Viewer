
#  Nächste Schritte

* Perturbation-Session einfuehren: langlebige Ergebnisbuffer vom einzelnen Orbit trennen. (begonnen)
* Perturbation-Parameter trennen:
  * Session-Parameter einmal pro Rechteck/View laden.
  * Orbit-Parameter zusammen mit zx/zy pro Referenzorbit laden.
* Orbit-Upload separieren:
  * Orbit-Buffer und Orbit-Parameter gemeinsam aktualisieren.
  * Session-Parameter bleiben unveraendert.
* Counterbuffer ergaenzen: pro Pass schnell entscheiden, ohne Ergebnisdaten zu lesen.
* Statusbuffer behalten: aber nur fuer Diagnose/Overlay und ggf. Endauswertung.
* Sentinel-Logik einbauen: Shader berechnet nur noch 0xffffffffu-Pixel.
* Referenzkandidaten fuer Perturbation begrenzen:
  * Nicht alle gesammelten Referenzpunkte ausprobieren.
  * Nur Kandidaten innerhalb des Zielrechtecks und einer nahen Umgebung beruecksichtigen.
  * Padding abhaengig von Rect-Groesse oder View-Zoom waehlen.
  * Maximale Kandidatenanzahl pro Perturbation-Berechnung begrenzen.
  * Kandidaten weiterhin nach Eignung sortieren: Naehe, Iterationswert, lokales Zellmaximum, Escape-Wert.
* Mehrpass-Reparatur: mehrere Orbits auf dieselben Ergebnisbuffer anwenden.