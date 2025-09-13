const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;
const St = imports.gi.St;

let button;

function init() {
    log('Debug extension initialized');
}

function enable() {
    try {
        button = new St.Button({
            style_class: 'panel-button',
            label: 'TEST'
        });
        
        Main.panel.addToStatusArea('voice-type-test', button);
        log('Debug extension enabled successfully');
    } catch (error) {
        log('Error enabling debug extension: ' + error.message);
    }
}

function disable() {
    try {
        if (button) {
            button.destroy();
            button = null;
        }
        log('Debug extension disabled');
    } catch (error) {
        log('Error disabling debug extension: ' + error.message);
    }
}