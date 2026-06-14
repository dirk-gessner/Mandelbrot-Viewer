// -----------------------------------------------------------------------------
// Vue.js-App für die Steuer-Elemente (z.B. Gamma-Korrektur)
// -----------------------------------------------------------------------------
const app = Vue.createApp({
    data() {
        return {

            activeControlTab: "view",

            inputConstraints, 

            viewInfo: {
                minX: 0,
                maxX: 0,
                minY: 0,
                maxY: 0, 
                zoomLevel: 1, 
            },

            inputTimer: null,

            iterationLimitInput: computationSettings.iterationLimit,
            escapeRadiusInput: computationSettings.escapeRadius,

            workerCountInput: multiThreadSettings.workerCount, 
            tasksPerWorkerInput: multiThreadSettings.tasksPerWorker, 
            backendMode: MANDELBROT_BACKEND_MODE_WEBGPU_PERTURBATION_CPU_FALLBACK, 

            lastIterationDataUpdateSeconds : runtimeStats.lastIterationDataUpdateSeconds,
            lastComputationBackend: runtimeStats.lastComputationBackend,

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
            showPerturbationReferences: renderSettings.showPerturbationReferences, 

            MANDELBROT_BACKEND_MODE_CPU,
            MANDELBROT_BACKEND_MODE_WEBGPU,
            MANDELBROT_BACKEND_MODE_WEBGPU_PERTURBATION,
            MANDELBROT_BACKEND_MODE_WEBGPU_CPU_FALLBACK,
            MANDELBROT_BACKEND_MODE_WEBGPU_PERTURBATION_CPU_FALLBACK,       
            
            availableMusicTracks: musicSettings.tracks,
            selectedMusicTrackIndex: musicSettings.selectedTrackIndex,
            musicEnabled: musicSettings.enabled,
            musicVolume: musicSettings.volume,
            musicLoop: musicSettings.loop,        
        };
    },
    
    methods: {

        setControlTab(tabKey) {
            this.activeControlTab = tabKey;
            
            if (typeof openControlsDrawer === 'function') {
                openControlsDrawer();
            }            
        },

        updateInfo() {
            const { view, initialView } = computationSettings;
            this.viewInfo.minX = view.minX;
            this.viewInfo.maxX = view.maxX;
            this.viewInfo.minY = view.minY;
            this.viewInfo.maxY = view.maxY;
            this.viewInfo.zoomLevel = ((initialView.maxX - initialView.minX) / (view.maxX - view.minX));
            this.lastIterationDataUpdateSeconds = runtimeStats.lastIterationDataUpdateSeconds;            
            this.lastComputationBackend = runtimeStats.lastComputationBackend;
        },

        updateMaxIterations() {
            const limits = inputConstraints.iterationLimit;
            computationSettings.iterationLimit = Math.max(
                limits.min,
                Math.min(Number(this.iterationLimitInput), limits.max)
            );
            this.iterationLimitInput = computationSettings.iterationLimit;
            this.updateInfo();
            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {computeRenderAndDrawScene()}, 250); 
        }, 

        updateEscapeRadius() {
            const limits = inputConstraints.escapeRadius;
            computationSettings.escapeRadius = Math.max(
                limits.min, 
                Math.min(Number(this.escapeRadiusInput), limits.max));
            this.escapeRadiusInput = computationSettings.escapeRadius;

            this.updateInfo();
            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {computeRenderAndDrawScene()}, 250); 
        },

        updateWorkerCount() {
            const limits = inputConstraints.workerCount;
            multiThreadSettings.workerCount = Math.max(
                limits.min, 
                Math.min(Number(this.workerCountInput), limits.max));
            this.workerCountInput = multiThreadSettings.workerCount;
            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {computeRenderAndDrawScene()}, 250); 
        },

        updateTasksPerWorker() {
            const limits = inputConstraints.tasksPerWorker;
            multiThreadSettings.tasksPerWorker = Math.max(
                limits.min, 
                Math.min(Number(this.tasksPerWorkerInput), limits.max));
            this.tasksPerWorkerInput = multiThreadSettings.tasksPerWorker;

            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {computeRenderAndDrawScene()}, 250); 
        },

        updateBackendMode() {
            mandelbrotBackendSettings.useWebGpu =
                this.backendMode !== MANDELBROT_BACKEND_MODE_CPU;

            mandelbrotBackendSettings.usePerturbation =
                this.backendMode === MANDELBROT_BACKEND_MODE_WEBGPU_PERTURBATION ||
                this.backendMode === MANDELBROT_BACKEND_MODE_WEBGPU_PERTURBATION_CPU_FALLBACK;

            mandelbrotBackendSettings.useCpu =
                this.backendMode === MANDELBROT_BACKEND_MODE_WEBGPU_CPU_FALLBACK ||
                this.backendMode === MANDELBROT_BACKEND_MODE_WEBGPU_PERTURBATION_CPU_FALLBACK;

            if (this.isPerturbationBackendDisabled) {
                this.showPerturbationReferences = false;
                renderSettings.showPerturbationReferences = false;
            }; 

            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {computeRenderAndDrawScene()}, 250); 
        },

        updateGamma() {
            renderSettings.gamma = this.gamma;
            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {renderAndDrawScene()}, 250); 
        },

        updateColorscalingCorrection() {
            renderSettings.colorScalingCorrection = this.colorScalingCorrection;
            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {renderAndDrawScene()}, 250); 
        },
        
        updateLogStrength() {
            renderSettings.logStrength = this.logStrength;
            clearTimeout(this.inputTimer);
            this.inputTimer = setTimeout(() => {renderAndDrawScene()}, 250); 
        },

        updateRenderOptions() {
            renderSettings.smoothColoringEnabled = this.smoothColoringEnabled;
            renderSettings.logScalingEnabled = this.logScalingEnabled;
            renderSettings.invertedPalette = this.invertedPalette;
            renderSettings.showPerturbationReferences = this.showPerturbationReferences; 
            renderAndDrawScene(); 
        },

        updatePalette() {
            renderSettings.paletteKey = this.selectedPaletteKey;
            renderAndDrawScene(); 
        }, 

        updateInnerSetColor() {
            renderSettings.innerSetColorKey = this.selectedInnerSetColorKey;
            renderAndDrawScene(); 
        }, 

        saveCanvasAsPng() {
            saveCanvasAsPng( canvas, `mandelbrot_${createTimestamp()}` );
        }, 

        resetView() {
            resetView();
        }, 

        loadMusicDirectory(event) {
            const files = event.target.files;

            loadMusicFiles(files);

            this.availableMusicTracks = musicSettings.tracks;
            this.selectedMusicTrackIndex = musicSettings.selectedTrackIndex;
            this.musicEnabled = musicSettings.enabled;
        },

        async playMusicPlayback() {
            this.musicEnabled = await playMusic();
        },

        pauseMusicPlayback() {
            pauseMusic();
            this.musicEnabled = musicSettings.enabled;
        },

        stopMusicPlayback() {
            stopMusic();
            this.musicEnabled = musicSettings.enabled;
        },

        async previousMusicTrack() {
            this.musicEnabled = await playPreviousTrack();
            this.selectedMusicTrackIndex = musicSettings.selectedTrackIndex;
        },

        async nextMusicTrack() {
            this.musicEnabled = await playNextTrack();
            this.selectedMusicTrackIndex = musicSettings.selectedTrackIndex;
        },

        async updateMusicTrack() {
            this.musicEnabled = await selectMusicTrackByIndex(this.selectedMusicTrackIndex);
            this.selectedMusicTrackIndex = musicSettings.selectedTrackIndex;
        },

        updateMusicVolume() {
            setMusicVolume(this.musicVolume);
        },

        updateMusicLoop() {
            setMusicLoop(this.musicLoop);
        },
    },

    computed: {
        isPerturbationBackendDisabled() {
            return this.backendMode !== MANDELBROT_BACKEND_MODE_WEBGPU_PERTURBATION &&
                   this.backendMode !== MANDELBROT_BACKEND_MODE_WEBGPU_PERTURBATION_CPU_FALLBACK;
        },
        isCpuBackendDisabled() {
            return this.backendMode === MANDELBROT_BACKEND_MODE_WEBGPU ||
                   this.backendMode === MANDELBROT_BACKEND_MODE_WEBGPU_PERTURBATION;
        },
    },

}).mount('#control-panel');

