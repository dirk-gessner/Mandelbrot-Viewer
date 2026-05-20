const runtimeStats = {
    iterationDataUpdateStartedAt: 0,
    lastIterationDataUpdateMs: 0,
    lastIterationDataUpdateSeconds: 0,
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