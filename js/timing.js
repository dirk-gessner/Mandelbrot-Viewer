
const COMPUTATION_BACKEND_CPU = "CPU";
const COMPUTATION_BACKEND_WEBGPU = "WebGPU";

/**
 * @typedef {Object} RuntimeStats
 * @property {number} iterationDataUpdateStartedAt          - (integer) Timestamp, wann die aktuelle Datenaktualisierung begonnen hat.
 * @property {number} lastIterationDataUpdateMs             - (integer) Dauer der letzten vollständigen Datenaktualisierung in Millisekunden.
 * @property {number|null} lastIterationDataUpdateSeconds   - (integer) Dauer der letzten vollständigen Datenaktualisierung.
 * @property {string|null} lastComputationBackend           - (string) Zuletzt tatsächlich verwendetes Backend.
 */
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