// -----------------------------------------------------------------------------
// Hilfe-Dialog fuer die Maussteuerung
// -----------------------------------------------------------------------------

const helpButton = document.getElementById('help-button');
const helpModal  = document.getElementById('help-modal');
const helpCloseButton = document.getElementById('help-close-button');

function openHelpModal() {
    helpModal.classList.remove('hidden');
    helpCloseButton.focus();
}

function closeHelpModal() {
    helpModal.classList.add('hidden');
    helpButton.focus();
}

helpButton.addEventListener('click', openHelpModal);
helpCloseButton.addEventListener('click', closeHelpModal);

helpModal.addEventListener('click', (event) => {
    if (event.target === helpModal) {
        closeHelpModal();
    }
});

window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !helpModal.classList.contains('hidden')) {
        closeHelpModal();
    }
});
