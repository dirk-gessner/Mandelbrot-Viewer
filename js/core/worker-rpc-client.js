/**
 * Offene Worker-Anfragen, indiziert nach Anfrage-ID.
 *
 * @typedef {Object} PendingWorkerRequest
 * @property {(value: *) => void} resolve - Erfuellt die Anfrage mit dem Worker-Ergebnis.
 * @property {(reason?: unknown) => void} reject - Lehnt die Anfrage mit einem Fehler ab.
 */

/**
 * Erstellt einen Promise-basierten RPC-Client fuer einen Web-Worker.
 *
 * Der Client erzeugt den Worker lazy bei der ersten Anfrage, vergibt fuer jede
 * Nachricht eine eindeutige `requestId` und loest die passende Promise auf,
 * sobald der Worker eine Antwort mit derselben `requestId` sendet.
 *
 * @param {string} workerScript - Pfad zum Worker-Skript.
 * @returns {{ request(message: Object): Promise<*>, terminate(): void }} RPC-Client fuer den Worker.
 */
function createWorkerRpcClient(workerScript) {
    /** @type {Map<number, PendingWorkerRequest>} */
    const pendingRequests = new Map();

    /** @type {number} */
    let nextRequestId = 1;

    /** @type {Worker|null} */
    let worker = null;

    /**
     * Gibt die langlebige Worker-Instanz zurueck.
     *
     * @returns {Worker} Gemeinsam genutzte Worker-Instanz.
     */
    function getWorker() {
        if (worker) {
            return worker;
        }

        worker = new Worker(workerScript, {
            type: "module",
        });

        worker.onmessage = handleWorkerMessage;
        worker.onerror = handleWorkerError;

        return worker;
    }

    /**
     * Verarbeitet Antwortnachrichten des Workers.
     *
     * Erwartet wird ein Antwortobjekt mit `requestId`, `ok` und entweder
     * `result` oder `error`.
     *
     * @param {MessageEvent} event - Worker-Nachricht.
     * @returns {void}
     */
    function handleWorkerMessage(event) {
        const message = event.data;
        const pendingRequest = pendingRequests.get(message.requestId);

        if (!pendingRequest) {
            debugWarn("Received worker response for unknown request", message);
            return;
        }

        pendingRequests.delete(message.requestId);

        if (message.ok) {
            pendingRequest.resolve(message.result);
            return;
        }

        pendingRequest.reject(new Error(message.error));
    }

    /**
     * Lehnt alle offenen Anfragen nach einem unbehandelten Worker-Fehler ab.
     *
     * @param {ErrorEvent} event - Worker-Fehlerereignis.
     * @returns {void}
     */
    function handleWorkerError(event) {
        const error = new Error(event.message || "Unhandled error in worker.");

        for (const pendingRequest of pendingRequests.values()) {
            pendingRequest.reject(error);
        }

        pendingRequests.clear();
        terminate();
    }

    /**
     * Sendet eine Anfrage an den Worker und liefert das Worker-Ergebnis als Promise.
     *
     * Die `requestId` wird vom Client gesetzt. Aufrufer muessen nur den fachlichen
     * Nachrichtentyp und die Nutzdaten uebergeben.
     *
     * @param {Object} message - Fachliche Anfrage an den Worker.
     * @returns {Promise<*>} Promise fuer das Worker-Ergebnis.
     */
    function request(message) {
        return new Promise((resolve, reject) => {
            const requestId = nextRequestId++;

            pendingRequests.set(requestId, {
                resolve,
                reject,
            });

            try {
                getWorker().postMessage({
                    ...message,
                    requestId,
                });
            } catch (error) {
                pendingRequests.delete(requestId);
                reject(error);
            }
        });
    }

    /**
     * Beendet den Worker und verwirft offene Anfragen.
     *
     * Offene Promises werden abgelehnt, damit Aufrufer nicht dauerhaft auf eine
     * Antwort eines beendeten Workers warten.
     *
     * @returns {void}
     */
    function terminate() {
        for (const pendingRequest of pendingRequests.values()) {
            pendingRequest.reject(new Error("Worker was terminated."));
        }

        pendingRequests.clear();
        worker?.terminate();
        worker = null;
    }

    return {
        request,
        terminate,
    };
}
