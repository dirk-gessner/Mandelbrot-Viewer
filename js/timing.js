
const COMPUTATION_BACKEND_CPU = "CPU";
const COMPUTATION_BACKEND_WEBGPU = "WebGPU";

const runtimeStats = {
    iterationDataUpdateStartedAt: 0,
    lastIterationDataUpdateMs: 0,
    lastIterationDataUpdateSeconds: 0,
    lastComputationBackend: "—",
};

async function measureIterationDataUpdate(work) {
    
    const startedAt = performance.now();

    try {
        return await work();
    } finally {
        const elapsedMs = performance.now() - startedAt;

        runtimeStats.lastIterationDataUpdateMs = elapsedMs;
        runtimeStats.lastIterationDataUpdateSeconds = elapsedMs / 1000;
    }
}