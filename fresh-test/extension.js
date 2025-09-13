const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const St = imports.gi.St;

let button;

function init() {
    log('Fresh voice type extension initialized');
}

function enable() {
    button = new St.Button({
        style_class: 'panel-button',
        label: '🎤'
    });
    
    Main.panel.addToStatusArea('voice-type-fresh', button);
    log('Fresh voice type extension enabled');
}

function disable() {
    if (button) {
        button.destroy();
        button = null;
    }
    log('Fresh voice type extension disabled');
}