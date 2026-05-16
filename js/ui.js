// -----------------------------------------------------------------------------
// Vue.js-App für die Steuer-Elemente (z.B. Gamma-Korrektur)
// -----------------------------------------------------------------------------
const app = Vue.createApp({
    data() {
        return {
            viewInfo: {
                minX: 0,
                maxX: 0,
                minY: 0,
                maxY: 0, 
                zoomLevel: 1, 
            },

            maxIterationsInput: computationSettings.maxIterations,
            escapeRadiusInput: computationSettings.escapeRadius,

            availablePalettes: colorPalettes,
            selectedPaletteKey: renderSettings.paletteKey,
            
            availableColors: colors,
            selectedInnerSetColorKey: renderSettings.innerSetColorKey,
            gamma: renderSettings.gamma,
            gammaTimer: null,

            smoothColoringEnabled: renderSettings.smoothColoringEnabled,
            colorScalingCorrection: renderSettings.colorScalingCorrection,
            colorScalingTimer: null,

            logScalingEnabled: renderSettings.logScalingEnabled,
            logStrength: renderSettings.logStrength,
            logStrengthTimer: null,

            invertedPalette: renderSettings.invertedPalette,
        };
    },
    methods: {
        updateInfo() {
            const { view, initialView } = computationSettings;
            this.viewInfo.minX = view.minX;
            this.viewInfo.maxX = view.maxX;
            this.viewInfo.minY = view.minY;
            this.viewInfo.maxY = view.maxY;
            this.viewInfo.zoomLevel = ((initialView.maxX - initialView.minX) / (view.maxX - view.minX));
        },
        updateMaxIterations() {
            computationSettings.maxIterations = Math.max(0, Math.min(Number(this.maxIterationsInput), 2000));
            this.maxIterationsInput = computationSettings.maxIterations;

            this.updateInfo();
            recomputeWithOverlay();
        }, 

        updateEscapeRadius() {
            computationSettings.escapeRadius = Math.max(1.1, Math.min(Number(this.escapeRadiusInput), 20));
            this.escapeRadiusInput = computationSettings.escapeRadius;

            this.updateInfo();
            recomputeWithOverlay();
        },

        updateGamma() {
            renderSettings.gamma = this.gamma;
            // Verzögerung von 250ms nach der letzten Änderung, 
            // um flüssiges Anpassen zu ermöglichen;
            clearTimeout(this.gammaTimer);
            this.gammaTimer = setTimeout(() => {
                renderColorsFromCachedData();
                renderScene();
            }, 250); 
        },

        updateColorscalingCorrection() {
            renderSettings.colorScalingCorrection = this.colorScalingCorrection;
            // Verzögerung von 250ms nach der letzten Änderung, 
            // um flüssiges Anpassen zu ermöglichen;
            clearTimeout(this.colorScalingTimer);
            this.colorScalingTimer = setTimeout(() => {
                renderColorsFromCachedData();
                renderScene();
            }, 250);
        },
        
        updateLogStrength() {
            renderSettings.logStrength = this.logStrength;
            // Verzögerung von 250ms nach der letzten Änderung, 
            // um flüssiges Anpassen zu ermöglichen;
            clearTimeout(this.logStrengthTimer);
            this.logStrengthTimer = setTimeout(() => {
                renderColorsFromCachedData();
                renderScene();
            }, 250);
        },

        updateRenderOptions() {
            renderSettings.smoothColoringEnabled = this.smoothColoringEnabled;
            renderSettings.logScalingEnabled = this.logScalingEnabled;
            renderSettings.invertedPalette = this.invertedPalette;
            renderColorsFromCachedData();
            renderScene();
        },

        updatePalette() {
            renderSettings.paletteKey = this.selectedPaletteKey;
            renderColorsFromCachedData();
            renderScene();
        }, 

        updateInnerSetColor() {
            renderSettings.innerSetColorKey = this.selectedInnerSetColorKey;
            renderColorsFromCachedData();
            renderScene();
        }, 

        saveCanvasAsPng() {
            saveCanvasAsPng( canvas, `mandelbrot_${createTimestamp()}` );
        }, 

        resetView() {
            resetView();
        }, 

    },
}).mount('#control-panel');

