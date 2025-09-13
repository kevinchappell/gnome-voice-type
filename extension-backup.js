const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;

let microphoneToggle;

function init() {
    // Initialization code - runs once when extension is loaded
    log('Voice Type extension initialized');
}

function enable() {
    // Create and add the microphone toggle to the panel
    const MicrophoneToggle = Me.imports.src.extension.MicrophoneToggle;
    microphoneToggle = new MicrophoneToggle();
    Main.panel.addToStatusArea('microphone-toggle', microphoneToggle);
    log('Voice Type extension enabled');
}

function disable() {
    // Clean up when extension is disabled
    if (microphoneToggle) {
        microphoneToggle.destroy();
        microphoneToggle = null;
    }
    log('Voice Type extension disabled');
}