// Ultra minimal extension - just test if basic structure works
const Main = imports.ui.main;
const St = imports.gi.St;

function init() {
    log('Ultra minimal extension init');
}

function enable() {
    let button = new St.Label({ text: '🎤' });
    Main.panel._rightBox.insert_child_at_index(button, 0);
    log('Ultra minimal extension enabled');
}

function disable() {
    // Minimal cleanup - just remove the label
    let children = Main.panel._rightBox.get_children();
    for (let i = 0; i < children.length; i++) {
        if (children[i] instanceof St.Label && children[i].text === '🎤') {
            Main.panel._rightBox.remove_child(children[i]);
            break;
        }
    }
    log('Ultra minimal extension disabled');
}