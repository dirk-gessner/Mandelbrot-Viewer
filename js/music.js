// -----------------------------------------------------------------------------
// Musik-Player
// -----------------------------------------------------------------------------

const musicAudio = new Audio();

musicAudio.preload = "metadata";
musicAudio.volume = musicSettings.volume;

// Das native Audio-Looping bleibt deaktiviert.
// Wiederholen wird auf Playlist-Ebene in playNextTrack() gesteuert.
musicAudio.loop = false;

// Temporäre Objekt-URLs für lokale Dateien.
// Sie müssen beim Laden einer neuen Playlist wieder freigegeben werden.
let musicObjectUrls = [];

musicAudio.addEventListener("ended", () => {
    playNextTrack();
});

musicAudio.addEventListener("error", () => {
    console.error("Musik: Audio-Fehler", {
        src: musicAudio.src,
        error: musicAudio.error,
        networkState: musicAudio.networkState,
        readyState: musicAudio.readyState,
    });
});

function revokeMusicObjectUrls() {
    for (const objectUrl of musicObjectUrls) {
        URL.revokeObjectURL(objectUrl);
    }

    musicObjectUrls = [];
}

function createTrackTitle(fileName) {
    return fileName
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .trim();
}

// Einige Browser liefern für lokale Dateien keinen oder keinen einheitlichen MIME-Type.
// Deshalb prüfen wir zusätzlich die Dateiendung.
function isSupportedMusicFile(file) {
    const fileName = file.name.toLowerCase();

    return (
        file.type === "audio/mpeg" ||
        file.type === "audio/wav" ||
        file.type === "audio/wave" ||
        file.type === "audio/x-wav" ||
        fileName.endsWith(".mp3") ||
        fileName.endsWith(".wav")
    );
}

function loadMusicFiles(fileList) {
    revokeMusicObjectUrls();

    const files = Array
        .from(fileList)
        .filter(isSupportedMusicFile)
        .sort((a, b) => a.name.localeCompare(b.name, "de"));

    musicSettings.tracks = files.map(file => {
        const objectUrl = URL.createObjectURL(file);
        musicObjectUrls.push(objectUrl);

        return {
            title: createTrackTitle(file.name),
            src: objectUrl,
            fileName: file.name,
        };
    });

    musicSettings.selectedTrackIndex = musicSettings.tracks.length > 0 ? 0 : -1;
    musicSettings.enabled = false;

    applySelectedMusicTrack();

    return musicSettings.tracks;
}

function getSelectedMusicTrack() {
    if (
        musicSettings.selectedTrackIndex < 0 ||
        musicSettings.selectedTrackIndex >= musicSettings.tracks.length
    ) {
        return null;
    }

    return musicSettings.tracks[musicSettings.selectedTrackIndex];
}

function applySelectedMusicTrack() {
    const track = getSelectedMusicTrack();

    if (!track) {
        musicAudio.pause();
        musicAudio.removeAttribute("src");
        musicAudio.load();
        return false;
    }

    if (musicAudio.src !== track.src) {
        musicAudio.src = track.src;
        musicAudio.load();
    }

    musicAudio.volume = musicSettings.volume;

    return true;
}

async function playMusic() {
    if (!applySelectedMusicTrack()) {
        musicSettings.enabled = false;
        return false;
    }

    try {
        await musicAudio.play();
        musicSettings.enabled = true;
        return true;
    } catch (error) {
        musicSettings.enabled = false;
        console.error("Musik: play() fehlgeschlagen", error);
        return false;
    }
}

function pauseMusic() {
    musicAudio.pause();
    musicSettings.enabled = false;
}

function stopMusic() {
    musicAudio.pause();
    musicAudio.currentTime = 0;
    musicSettings.enabled = false;
}

async function playPreviousTrack() {
    if (musicSettings.tracks.length === 0) {
        return false;
    }

    // Übliches Player-Verhalten:
    // Ist der aktuelle Track länger als drei Sekunden gelaufen,
    // springt Back zuerst an den Anfang des aktuellen Tracks.
    if (musicAudio.currentTime > 3) {
        musicAudio.currentTime = 0;
        return musicSettings.enabled;
    }

    musicSettings.selectedTrackIndex =
        (musicSettings.selectedTrackIndex - 1 + musicSettings.tracks.length) %
        musicSettings.tracks.length;

    applySelectedMusicTrack();

    if (musicSettings.enabled) {
        return await playMusic();
    }

    return false;
}

async function playNextTrack() {
    if (musicSettings.tracks.length === 0) {
        return false;
    }

    const isLastTrack = musicSettings.selectedTrackIndex >= musicSettings.tracks.length - 1;

    if (isLastTrack && !musicSettings.loop) {
        stopMusic();
        return false;
    }

    musicSettings.selectedTrackIndex =
        (musicSettings.selectedTrackIndex + 1) % musicSettings.tracks.length;

    applySelectedMusicTrack();

    if (musicSettings.enabled) {
        return await playMusic();
    }

    return false;
}

async function selectMusicTrackByIndex(index) {
    const numericIndex = Number(index);

    if (
        !Number.isInteger(numericIndex) ||
        numericIndex < 0 ||
        numericIndex >= musicSettings.tracks.length
    ) {
        console.warn("Musik: ungültiger Track-Index", {
            index,
            trackCount: musicSettings.tracks.length,
        });

        return false;
    }

    const wasPlaying = musicSettings.enabled && !musicAudio.paused;

    musicSettings.selectedTrackIndex = numericIndex;
    applySelectedMusicTrack();

    if (wasPlaying) {
        return await playMusic();
    }

    return musicSettings.enabled;
}

function setMusicVolume(volume) {
    const normalizedVolume = Math.max(0, Math.min(Number(volume), 1));

    musicSettings.volume = normalizedVolume;
    musicAudio.volume = normalizedVolume;
}

function setMusicLoop(loop) {
    musicSettings.loop = Boolean(loop);
}

function getCurrentMusicStatus() {
    return {
        tracks: musicSettings.tracks,
        selectedTrackIndex: musicSettings.selectedTrackIndex,
        selectedTrack: getSelectedMusicTrack(),
        enabled: musicSettings.enabled,
        paused: musicAudio.paused,
        volume: musicSettings.volume,
        loop: musicSettings.loop,
    };
}