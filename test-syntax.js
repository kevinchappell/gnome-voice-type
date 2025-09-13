// Test file to check syntax
const GObject = imports.gi.GObject;
const St = imports.gi.St;
const PanelMenu = imports.ui.panelMenu;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;
const Clutter = imports.gi.Clutter;
const Meta = imports.gi.Meta;

const Me = imports.misc.extensionUtils.getCurrentExtension();

var MicrophoneToggle = GObject.registerClass({
    GTypeName: 'MicrophoneToggle',
}, class MicrophoneToggle extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Microphone Toggle', false);

        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(Me.dir.get_path() + '/icons/microphone-symbolic.svg'),
            style_class: 'system-status-icon'
        });

        this.add_child(this._icon);
        this.connect('button-press-event', this._onButtonPress.bind(this));

        // Set initial state to not recording
        this._isRecording = false;
        this._recordingProcess = null;
        this._tempFile = null;
        this._httpSession = new Soup.Session();
    }

    _insertText(text) {
        try {
            // Get the focused window
            var display = global.display;
            var focusWindow = display.focus_window;
            
            if (!focusWindow) {
                log('No focused window found');
                Main.notify('Voice Type', 'No focused window found');
                return;
            }

            // Check if we're running on Wayland
            var sessionType = GLib.getenv('XDG_SESSION_TYPE');
            var isWayland = sessionType === 'wayland';
            
            if (isWayland) {
                log('Running on Wayland - using virtual device approach');
            }

            // Create a synthetic key event for each character
            var virtualDevice = null;
            try {
                var seat = Clutter.get_default_backend().get_default_seat();
                if (seat) {
                    virtualDevice = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
                }
            } catch (error) {
                log('Error creating virtual device: ' + error.message);
            }
            
            if (!virtualDevice) {
                log('Failed to create virtual keyboard device');
                Main.notify('Voice Type', 'Failed to create virtual keyboard device');
                return;
            }
            
            // Small delay to ensure the window is ready
            GLib.usleep(100000); // 100ms delay
            
            // Type each character
            for (var i = 0; i < text.length; i++) {
                var char = text[i];
                var keyval = Clutter.unicode_to_keyval(char.charCodeAt(0));
                
                if (keyval !== 0) {
                    virtualDevice.notify_keyval(Clutter.CURRENT_TIME, keyval, Clutter.KeyState.PRESSED);
                    virtualDevice.notify_keyval(Clutter.CURRENT_TIME, keyval, Clutter.KeyState.RELEASED);
                    
                    // Small delay between characters for better compatibility
                    if (i < text.length - 1) {
                        GLib.usleep(10000); // 10ms between characters
                    }
                } else {
                    log('Warning: Could not convert character to keyval: ' + char);
                }
            }
            
            log('Inserted text: ' + text);
            Main.notify('Voice Type', 'Text inserted: ' + text.substring(0, 50) + (text.length > 50 ? '...' : ''));
        } catch (error) {
            log('Error inserting text: ' + error.message);
            Main.notify('Voice Type', 'Error inserting text: ' + error.message);
        }
    }
});