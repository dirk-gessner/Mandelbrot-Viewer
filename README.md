# Mandelbrot-Viewer

Ein interaktiver Mandelbrot-Viewer, entwickelt mit JavaScript und HTML5 Canvas. Perfekt für Anfänger, um Fraktale zu erkunden und zu lernen.

## Über das Projekt

Dieses Projekt ist ein Proof of Concept (PoC) für einen Mandelbrot-Viewer im Webbrowser. Es trennt Berechnung und Darstellung, um später ein Backend (z.B. in C++) anzubinden. Entwickelt von Vater und Sohn als Lernprojekt.

## Features

- **Interaktives Zoomen**: Rechtsklick + Mausrad zum Hineinzoomen, Linksklick zum Herauszoomen.
- **Anpassbare Iterationstiefe**: Mausrad zum Ändern der Berechnungstiefe.
- **Performance-Optimierungen**: Schnelle Tests für die Hauptkardiode und Periode-2-Glühbirne.
- **Responsive Design**: Canvas passt sich an die Fenstergröße an.

## Steuerung

- **Zoom-In**: Rechte Maustaste gedrückt halten + Mausrad drehen.
- **Zoom-Out**: Linke Maustaste klicken (schrittweise zurück zum Start).
- **Iterationstiefe ändern**: Mausrad drehen (ohne Maustaste).

## Technische Details

- **Frontend**: Plain JavaScript, HTML5 Canvas.
- **Berechnung**: Iteratives Verfahren für die Mandelbrot-Menge.
- **Caching**: Bild wird gecacht, um flüssige Interaktion zu ermöglichen.
- **Zukunft**: 
    - Aufnahme von Controls für Farbmanipulationen (Palette, Color-Cycling, ...)
    - Erweiterung um Backend in C++ für höhere Performance.

## Installation und Ausführung

1. Klone das Repository: `git clone <repo-url>`
2. Öffne `index.html` in einem modernen Webbrowser (z.B. Chrome).
3. Viel Spaß beim Entdecken der Mandelbrot-Menge!

## Lernziele

- Grundlagen von JavaScript und Canvas.
- Mathematik hinter Fraktalen.
- Architektur von Frontend-Anwendungen.
- Performance-Optimierung in Webbrowsern.

## Mitwirken

Feedback und Verbesserungen sind willkommen! Für Fragen: [E-Mail oder Issue-Tracker].

---

Entwickelt mit ❤️ von Karl und Papa.
