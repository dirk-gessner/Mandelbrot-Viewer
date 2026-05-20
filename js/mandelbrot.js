// -----------------------------------------------------------------------------
// Mandelbrot-Berechnung
// -----------------------------------------------------------------------------

function splitRectHorizontally(rect, parts) {
    const result = [];

    const baseHeight = Math.floor(rect.height / parts);
    const remainder = rect.height % parts;

    let y = rect.y;

    for (let i = 0; i < parts; i++) {
        const height = baseHeight + (i < remainder ? 1 : 0);

        if (height <= 0) {
            continue;
        }

        result.push({
            x: rect.x,
            y,
            width: rect.width,
            height
        });

        y += height;
    }

    return result;
}

function mergeIterationDataParts(rect, parts) {
    const totalPixels = rect.width * rect.height;

    const iterations = new Uint16Array(totalPixels);
    const escapeValues = new Float64Array(totalPixels);

    let targetOffset = 0;
    let minIterations = Number.POSITIVE_INFINITY;

    for (const part of parts) {
        iterations.set(part.iterations, targetOffset);
        escapeValues.set(part.escapeValues, targetOffset);

        targetOffset += part.iterations.length;

        if (part.minIterations < minIterations) {
            minIterations = part.minIterations;
        }
    }

    return {
        width:  rect.width,
        height: rect.height,
        iterations,
        escapeValues,
        minIterations
    };
}

function computeMandelbrotRectInWorker(
    rect,
    imageWidth,
    imageHeight,
    computationSettings, 
    workerId = 0
) {
    return new Promise((resolve, reject) => {

        // console.log(
        //     "computeMandelbrotRectInWorker",
        //     {
        //         workerId: workerId,
        //         rect: rect,
        //     }
        // );

        const worker = new Worker("./js/mandelbrot-worker.js", {
            type: "module"
        });

        worker.onmessage = (event) => {
            worker.terminate();
            resolve(event.data);
        };

        worker.onerror = (error) => {
            console.error("Worker error", workerId, error);
            worker.terminate();
            reject(error);
        };

        worker.postMessage({
            rect,
            imageWidth,
            imageHeight,
            computationSettings
        });
    });
}

async function computeTasksWithWorkerPool(
    tasks,
    imageWidth,
    imageHeight,
    computationSettings,
    workerCount
) {
    const results = new Array(tasks.length);
    let nextTaskIndex = 0;

    async function runWorker(workerId) {
        while (nextTaskIndex < tasks.length) {
            const taskIndex = nextTaskIndex++;
            const rect = tasks[taskIndex];

            const result = await computeMandelbrotRectInWorker(
                rect,
                imageWidth,
                imageHeight,
                computationSettings,
                workerId
            );

            results[taskIndex] = result;
        }
    }

    const workers = [];

    for (let workerId = 0; workerId < workerCount; workerId++) {
        workers.push(runWorker(workerId));
    }

    await Promise.all(workers);

    return results;
}

async function computeMandelbrotRectParallel(
    rect,
    imageWidth,
    imageHeight,
    computationSettings,
    workerCount
) {
    const tasksPerWorker = multiThreadSettings.tasksPerWorker;
    const taskCount = Math.min(rect.height, workerCount * tasksPerWorker);    
    const tasks = splitRectHorizontally(rect, taskCount);

    const startedAt = performance.now();
    console.log(
        "computeMandelbrotRectParallel (start)",
        {
            requestedWorkers: workerCount,
            tasksPerWorker: tasksPerWorker,
            actualTasks: tasks.length,
        }
    );

    const parts = await computeTasksWithWorkerPool(
        tasks,
        imageWidth,
        imageHeight,
        computationSettings,
        workerCount
    );

    const iterationData = mergeIterationDataParts(rect, parts);

    const elapsed = performance.now() - startedAt;
    console.log(
        "computeMandelbrotRectParallel (done)",
        {
            elapsedMilleSeconds: elapsed,
        }
    );

    return iterationData; 
}

async function computeMandelbrotRect(
    rect,
    imageWidth,
    imageHeight,
    computationSettings
) {
    const workerCount = multiThreadSettings.workerCount;

    if (workerCount <= 1 || rect.width * rect.height < 10000) {
        return computeMandelbrotRectInWorker(
            rect,
            imageWidth,
            imageHeight,
            computationSettings
        );
    }

    return computeMandelbrotRectParallel(
        rect,
        imageWidth,
        imageHeight,
        computationSettings,
        workerCount
    );
}

// Berechnet das Mandelbrot-Bild für die gegebenen Parameter
async function computeMandelbrot(width, height, computationSettings) {
    return await computeMandelbrotRect(
        { x: 0, y: 0, width, height },
        width,
        height,
        computationSettings
    );
}

