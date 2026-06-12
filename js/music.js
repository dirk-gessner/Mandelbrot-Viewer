// -----------------------------------------------------------------------------
// Musik-Player
// -----------------------------------------------------------------------------

const musicAudio = new Audio();

musicAudio.preload = "metadata";
musicAudio.volume = musicSettings.volume;
musicAudio.loop = musicSettings.loop;

function getSelectedMusicTrack() {
  return musicTracks[musicSettings.selectedTrackKey] ?? null;
}

function applyMusicTrack() {
  const track = getSelectedMusicTrack();

  if (!track) {
    musicAudio.removeAttribute("src");
    musicAudio.load();
    return;
  }

  if (musicAudio.src.endsWith(track.src)) {
    return;
  }

  musicAudio.src = track.src;
  musicAudio.load();
}

async function playMusic() {
  applyMusicTrack();

  const track = getSelectedMusicTrack();
  if (!track) {
    musicSettings.enabled = false;
    return false;
  }

  musicAudio.volume = musicSettings.volume;
  musicAudio.loop = musicSettings.loop;

  try {
    await musicAudio.play();
    musicSettings.enabled = true;
    return true;
  } catch (error) {
    musicSettings.enabled = false;
    console.warn("Musikwiedergabe konnte nicht gestartet werden.", error);
    return false;
  }
}

function pauseMusic() {
  musicAudio.pause();
  musicSettings.enabled = false;
}

async function toggleMusic() {
  if (musicSettings.enabled && !musicAudio.paused) {
    pauseMusic();
    return false;
  }

  return await playMusic();
}

async function selectMusicTrack(trackKey) {
  const wasPlaying = musicSettings.enabled && !musicAudio.paused;

  musicSettings.selectedTrackKey = trackKey;
  applyMusicTrack();

  if (wasPlaying) {
    return await playMusic();
  }

  return false;
}

function setMusicVolume(volume) {
  const normalizedVolume = Math.max(0, Math.min(Number(volume), 1));

  musicSettings.volume = normalizedVolume;
  musicAudio.volume = normalizedVolume;
}

function setMusicLoop(loop) {
  musicSettings.loop = Boolean(loop);
  musicAudio.loop = musicSettings.loop;
}