// Minimal test extension
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;
const St = imports.gi.St;

let button;

function init() {
    log('Minimal extension initialized');
}

function enable() {
    button = new St.Button({
        style_class: 'panel-button',
        label: 'Test'
    });
    
    Main.panel._rightBox.insert_child_at_index(button, 0);
    log('Minimal extension enabled');
}

function disable() {
    if (button) {
        Main.panel._rightBox.remove_child(button);
        button = null;
    }
    log('Minimal extension disabled');
}