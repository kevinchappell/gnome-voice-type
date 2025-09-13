const Main = imports.ui.main;
const St = imports.gi.St;

let panelButton;

function init() {
    log('Simple test extension initialized');
}

function enable() {
    panelButton = new St.Bin({
        style_class: 'panel-button',
        reactive: true,
        can_focus: true,
        track_hover: true
    });
    
    let icon = new St.Icon({
        icon_name: 'audio-input-microphone-symbolic',
        style_class: 'system-status-icon'
    });
    
    panelButton.set_child(icon);
    Main.panel._rightBox.insert_child_at_index(panelButton, 0);
}

function disable() {
    if (panelButton) {
        Main.panel._rightBox.remove_child(panelButton);
    }
}