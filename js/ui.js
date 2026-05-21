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

            inputTimer: null,

            maxIterationsInput: computationSettings.maxIterations,
            escapeRadiusInput: computationSettings.escapeRadius,

            workerCountInput: multiThreadSettings.workerCount, 
            tasksPerWorkerInput: multiThreadSettings.tasksPerWorker, 
            lastIterationDataUpdateSeconds : runtimeStats.lastIterationDataUpdateSeconds,

            availablePalettes: colorPalettes,
            selectedPaletteKey: renderSettings.paletteKey,
            
            availableColors: colors,
            selectedInnerSetColorKey: renderSettings.innerSetColorKey,
            gamma: renderSettings.gamma,

            smoothColoringEnabled: renderSettings.smoothColoringEnabled,
            colorScalingCorrection: renderSettings.colorScalingCorrection,

            logScalingEnabled: renderSettings.logScalingEnabled,
            logStrength: renderSettings.logStrength,

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
            this.lastIterationDataUpdateSeconds = runtimeStats.lastIterationDataUpdateSeconds;            
        },

        updateMaxIterations() {
            computationSettings.maxIterations = Math.max(0, Math.min(Number(this.maxIterationsInput), 5000));
            this.maxIterationsInput = computationSettings.maxIterations;

            this.updateInfo();
            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {recomputeWithOverlay()}, 250); 
        }, 

        updateEscapeRadius() {
            computationSettings.escapeRadius = Math.max(1.1, Math.min(Number(this.escapeRadiusInput), 20));
            this.escapeRadiusInput = computationSettings.escapeRadius;

            this.updateInfo();
            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {recomputeWithOverlay()}, 250); 
        },

        updateWorkerCount() {
            multiThreadSettings.workerCount = Math.max(1, Math.min(Number(this.workerCountInput), 20));
            this.workerCountInput = multiThreadSettings.workerCount;
            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {recomputeWithOverlay()}, 250); 
        },

        updateTasksPerWorker() {
            multiThreadSettings.tasksPerWorker = Math.max(1, Math.min(Number(this.tasksPerWorkerInput), 20));
            this.tasksPerWorkerInput = multiThreadSettings.tasksPerWorker;
            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {recomputeWithOverlay()}, 250); 
        },

        updateGamma() {
            renderSettings.gamma = this.gamma;
            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {rerenderFromIterationData()}, 250); 
        },

        updateColorscalingCorrection() {
            renderSettings.colorScalingCorrection = this.colorScalingCorrection;
            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {rerenderFromIterationData()}, 250); 
        },
        
        updateLogStrength() {
            renderSettings.logStrength = this.logStrength;
            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {rerenderFromIterationData()}, 250); 
        },

        updateRenderOptions() {
            renderSettings.smoothColoringEnabled = this.smoothColoringEnabled;
            renderSettings.logScalingEnabled = this.logScalingEnabled;
            renderSettings.invertedPalette = this.invertedPalette;
            rerenderFromIterationData(); 
        },

        updatePalette() {
            renderSettings.paletteKey = this.selectedPaletteKey;
            rerenderFromIterationData(); 
        }, 

        updateInnerSetColor() {
            renderSettings.innerSetColorKey = this.selectedInnerSetColorKey;
            rerenderFromIterationData(); 
        }, 

        saveCanvasAsPng() {
            saveCanvasAsPng( canvas, `mandelbrot_${createTimestamp()}` );
        }, 

        resetView() {
            resetView();
        }, 

    },
}).mount('#control-panel');

