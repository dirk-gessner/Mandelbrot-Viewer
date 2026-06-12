# Naechste Schritte


ToDos aus Review

* [x] **Sentinel-Pixel werden als Innenmenge interpretiert**

  * Nicht erfolgreich berechnete Pixel bleiben intern auf `0xffffffff`.
  * Beim Erzeugen von `IterationData` werden sie auf `iterationLimit` / `escapeValue = 0` abgebildet.
  * Dadurch erscheinen verbleibende ungültige Pixel wie echte Mandelbrot-Innenpunkte.
  * Priorität: **hoch**

* [x] **Mehrpass-Statistik / `okCount` war irreführend**

  * Nach mehreren Shader-Passes zählte `okCount` nur neu berechnete Pixel des letzten Passes, nicht alle gültigen Pixel.
  * Von dir bereits erledigt und gepusht.
  * Priorität: **erledigt**

* [x] **`maxObservedIterations` wird vermutlich falsch übergeben**

  * Beim Aufruf von `computeMandelbrotRectWebGpu` wird aktuell bzw. wurde `iterationLimit` als `maxObservedIterations` übergeben.
  * Korrekt wäre vermutlich der bisher beobachtete Maximalwert aus vorhandenen `IterationData`, z. B. `iterationData?.maxObservedIterations ?? 0`.
  * Wird besonders relevant, wenn die Orbit-Längenprüfung wieder aktiviert wird.
  * Priorität: **mittel bis hoch**

* [x] **Keine CPU-Nachberechnung für kleine akzeptierte Restfehler**

  * Wenn das Gesamtergebnis als akzeptabel gilt, aber noch einzelne invalide Pixel übrig sind, wird kein CPU-Fixup gemacht.
  * Zusammen mit dem Sentinel-Problem führt das zu falsch dargestellten Restpixeln.
  * Mögliche Lösung: akzeptierte Restfehler gezielt per CPU reparieren oder `invalidCount === 0` als Akzeptanzbedingung verlangen.
  * Priorität: **hoch**

* [ ] **Kandidatenstatus `used-no-improvement` ist eventuell zu grob**

  * Die Bewertung basiert vor allem darauf, ob `invalidCount` sinkt.
  * Ein Kandidat kann das Fehlerprofil verändern, ohne die Anzahl invalider Pixel zu reduzieren.
  * Für Debugging/Overlay wäre eine feinere Unterscheidung hilfreich, z. B. `used-reduced-invalid-count`, `used-changed-error-profile`, `used-no-change`.
  * Priorität: **niedrig bis mittel**

* [x] **GPU-Ressourcen werden nicht explizit freigegeben**

  * Temporäre GPUBuffer für Iterationen, Escape-Werte, Status, Readback, Orbitdaten und Counter werden nicht sichtbar per `destroy()` freigegeben.
  * In einem langlebigen Worker kann das zu GPU-Speicherdruck führen.
  * Sinnvoll wäre ein `finally`-Block mit explizitem Cleanup.
  * Priorität: **mittel**
