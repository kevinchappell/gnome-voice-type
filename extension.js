import GObject from 'gi://GObject';
import St from 'gi://St';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Voice Type Input'));

        // Create the microphone icon
        this.icon = new St.Icon({
            icon_name: 'audio-input-microphone-symbolic',
            style_class: 'system-status-icon voice-type-input-icon',
        });

        this.add_child(this.icon);

        // Create a simple popup menu
        let item = new PopupMenu.PopupMenuItem(_('Voice Type Input'));
        item.connect('activate', () => {
            // TODO: Add voice input functionality here
            Main.notify(_('Voice Type Input'), _('Voice input functionality coming soon!'));
        });
        this.menu.addMenuItem(item);

        // Add a separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Add settings item (for future use)
        let settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
        settingsItem.connect('activate', () => {
            // TODO: Open extension settings
            Main.notify(_('Voice Type Input'), _('Settings coming soon!'));
        });
        this.menu.addMenuItem(settingsItem);
    }

    // Optional: Add methods for microphone state
    setMicrophoneActive(active) {
        if (active) {
            this.icon.style_class = 'system-status-icon voice-type-input-icon active';
        } else {
            this.icon.style_class = 'system-status-icon voice-type-input-icon';
        }
    }
});

export default class VoiceTypeInputExtension extends Extension {
    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
