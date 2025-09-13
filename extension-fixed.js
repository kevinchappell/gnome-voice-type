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

        // Check dependencies first
        this._checkDependencies();

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
        this._dependenciesMet = this._checkDependencies();
    }

    _checkDependencies() {
        let missing = [];
        
        // Check for GStreamer
        try {
            let proc = Gio.Subprocess.new(
                ['which', 'gst-launch-1.0'],
                Gio.SubprocessFlags.NONE
            );
            if (!proc) missing.push('GStreamer (gst-launch-1.0)');
        } catch (e) {
            missing.push('GStreamer (gst-launch-1.0)');
        }
        
        if (missing.length > 0) {
            log('Voice Type: Missing dependencies: ' + missing.join(', '));
            Main.notify('Voice Type Error', 'Missing: ' + missing.join(', '));
            return false;
        }
        
        return true;
    }

    _onButtonPress() {
        if (!this._dependenciesMet) {
            Main.notify('Voice Type Error', 'Missing required dependencies');
            return;
        }

        this._isRecording = !this._isRecording;
        this._updateIcon();

        if (this._isRecording) {
            this._startRecording();
        } else {
            this._stopRecording();
        }
    }

    _startRecording() {
        try {
            // Create temporary file for recording
            this._tempFile = Gio.File.new_tmp('voice-type-XXXXXX.wav')[0];
            
            // Use GStreamer to record audio
            var pipeline = [
                'gst-launch-1.0', '-e',
                'pulsesrc', '!', 'audioconvert', '!', 'audioresample', '!',
                'audio/x-raw,rate=16000,channels=1', '!', 'wavenc', '!',
                'filesink location=' + this._tempFile.get_path()
            ];
            
            this._recordingProcess = Gio.Subprocess.new(
                pipeline,
                Gio.SubprocessFlags.NONE
            );
            
            log('Voice Type: Started recording audio');
        } catch (error) {
            log('Voice Type: Error starting recording: ' + error.message);
            Main.notify('Voice Type Error', 'Failed to start recording: ' + error.message);
            this._isRecording = false;
            this._updateIcon();
        }
    }

    _stopRecording() {
        if (this._recordingProcess) {
            try {
                // Send SIGINT to gracefully stop recording
                this._recordingProcess.send_signal(GLib.SIGINT);
                
                // Wait for process to finish
                this._recordingProcess.wait_async(null, (proc, result) => {
                    try {
                        proc.wait_finish(result);
                        this._processRecording();
                    } catch (error) {
                        log('Voice Type: Error waiting for recording process: ' + error.message);
                        Main.notify('Voice Type Error', 'Recording process failed');
                    }
                });
            } catch (error) {
                log('Voice Type: Error stopping recording: ' + error.message);
                Main.notify('Voice Type Error', 'Failed to stop recording');
            }
        }
    }

    _processRecording() {
        if (!this._tempFile || !this._tempFile.query_exists(null)) {
            log('Voice Type: No recording file found');
            Main.notify('Voice Type Error', 'No recording file created');
            return;
        }

        try {
            // Read the recorded file
            var success, contents;
            [success, contents] = this._tempFile.load_contents(null);
            if (!success) {
                log('Voice Type: Failed to read recording file');
                Main.notify('Voice Type Error', 'Failed to read recording');
                return;
            }

            // Check if STT service is available first
            this._checkSTTService().then((available) => {
                if (available) {
                    this._sendToSTT(contents);
                } else {
                    Main.notify('Voice Type', 'STT service not available at localhost:8675');
                }
            }).catch((error) => {
                log('Voice Type: Error checking STT service: ' + error.message);
                Main.notify('Voice Type Error', 'STT service check failed');
            });

        } catch (error) {
            log('Voice Type: Error processing recording: ' + error.message);
            Main.notify('Voice Type Error', 'Failed to process recording');
        }
    }

    _checkSTTService() {
        return new Promise((resolve, reject) => {
            try {
                let message = Soup.Message.new('GET', 'http://localhost:8675/health');
                if (!message) {
                    resolve(false);
                    return;
                }

                this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                    try {
                        session.send_and_read_finish(result);
                        resolve(message.get_status() === 200);
                    } catch (error) {
                        resolve(false);
                    }
                });
            } catch (error) {
                resolve(false);
            }
        });
    }

    _sendToSTT(audioContents) {
        try {
            // Create form data manually for libsoup 3.0 compatibility
            let boundary = '----VoiceTypeBoundary' + Date.now();
            let header = '--' + boundary + '\r\n' +
                        'Content-Disposition: form-data; name="file"; filename="recording.wav"\r\n' +
                        'Content-Type: audio/wav\r\n\r\n';
            let footer = '\r\n--' + boundary + '--\r\n';
            
            let headerBytes = new TextEncoder().encode(header);
            let footerBytes = new TextEncoder().encode(footer);
            
            let totalLength = headerBytes.length + audioContents.length + footerBytes.length;
            let combinedBytes = new Uint8Array(totalLength);
            
            combinedBytes.set(headerBytes, 0);
            combinedBytes.set(new Uint8Array(audioContents), headerBytes.length);
            combinedBytes.set(footerBytes, headerBytes.length + audioContents.length);
            
            let message = Soup.Message.new('POST', 'http://localhost:8675/transcribe');
            if (!message) {
                Main.notify('Voice Type Error', 'Failed to create STT request');
                return;
            }
            
            message.set_request_body_from_bytes(
                'multipart/form-data; boundary=' + boundary,
                GLib.Bytes.new(combinedBytes)
            );
            
            this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    var bytes = session.send_and_read_finish(result);
                    var responseText = '';
                    if (bytes && bytes.get_data()) {
                        var data = bytes.get_data();
                        responseText = new TextDecoder().decode(data);
                    }
                     
                    if (message.get_status() === 200) {
                         try {
                             var response = JSON.parse(responseText);
                            if (response.text) {
                                this._insertText(response.text);
                            } else {
                                log('Voice Type: STT response missing text field');
                                Main.notify('Voice Type Error', 'Invalid STT response format');
                            }
                        } catch (parseError) {
                            log('Voice Type: Error parsing STT response JSON: ' + parseError.message);
                            Main.notify('Voice Type Error', 'Invalid STT response format');
                        }
                    } else {
                        log('Voice Type: STT request failed with status ' + message.get_status());
                        Main.notify('Voice Type Error', 'STT request failed (status ' + message.get_status() + ')');
                    }
                } catch (error) {
                    log('Voice Type: Error processing STT response: ' + error.message);
                    Main.notify('Voice Type Error', 'Error processing STT response');
                }
            });

        } catch (error) {
            log('Voice Type: Error sending to STT: ' + error.message);
            Main.notify('Voice Type Error', 'Failed to send audio to STT service');
        }
    }

    _insertText(text) {
        try {
            // Get the focused window
            var display = global.display;
            var focusWindow = display.focus_window;
            
            if (!focusWindow) {
                log('Voice Type: No focused window found');
                Main.notify('Voice Type', 'No focused window found - text copied to clipboard');
                this._copyToClipboard(text);
                return;
            }

            // Check if we're running on Wayland
            var sessionType = GLib.getenv('XDG_SESSION_TYPE');
            var isWayland = sessionType === 'wayland';
            
            if (isWayland) {
                log('Voice Type: Running on Wayland - using virtual device approach');
            }

            // Create a synthetic key event for each character
            var virtualDevice = null;
            try {
                var seat = Clutter.get_default_backend().get_default_seat();
                if (seat) {
                    virtualDevice = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
                }
            } catch (error) {
                log('Voice Type: Error creating virtual device: ' + error.message);
            }
            
            if (!virtualDevice) {
                log('Voice Type: Failed to create virtual keyboard device - copying to clipboard');
                Main.notify('Voice Type', 'Cannot type text - copied to clipboard');
                this._copyToClipboard(text);
                return;
            }
            
            // Use async delay instead of blocking usleep
            this._typeTextAsync(text, virtualDevice);
            
        } catch (error) {
            log('Voice Type: Error inserting text: ' + error.message);
            Main.notify('Voice Type Error', 'Failed to insert text - copied to clipboard');
            this._copyToClipboard(text);
        }
    }

    _typeTextAsync(text, virtualDevice) {
        // Use GLib.timeout_add for non-blocking text typing
        let index = 0;
        let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            if (index >= text.length) {
                log('Voice Type: Inserted text: ' + text);
                Main.notify('Voice Type', 'Text inserted: ' + text.substring(0, 50) + (text.length > 50 ? '...' : ''));
                return GLib.SOURCE_REMOVE;
            }
            
            try {
                let char = text[index];
                let keyval = Clutter.unicode_to_keyval(char.charCodeAt(0));
                
                if (keyval !== 0) {
                    virtualDevice.notify_keyval(Clutter.CURRENT_TIME, keyval, Clutter.KeyState.PRESSED);
                    virtualDevice.notify_keyval(Clutter.CURRENT_TIME, keyval, Clutter.KeyState.RELEASED);
                } else {
                    log('Voice Type: Warning: Could not convert character to keyval: ' + char);
                }
            } catch (error) {
                log('Voice Type: Error typing character: ' + error.message);
            }
            
            index++;
            return GLib.SOURCE_CONTINUE;
        });
    }

    _copyToClipboard(text) {
        try {
            let clipboard = St.Clipboard.get_default();
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            log('Voice Type: Text copied to clipboard: ' + text);
        } catch (error) {
            log('Voice Type: Error copying to clipboard: ' + error.message);
        }
    }

    _updateIcon() {
        try {
            if (this._isRecording) {
                this._icon.gicon = Gio.icon_new_for_string(Me.dir.get_path() + '/icons/microphone-recording-symbolic.svg');
            } else {
                this._icon.gicon = Gio.icon_new_for_string(Me.dir.get_path() + '/icons/microphone-symbolic.svg');
            }
        } catch (error) {
            log('Voice Type: Error updating icon: ' + error.message);
        }
    }

    destroy() {
        if (this._recordingProcess) {
            try {
                this._recordingProcess.force_exit();
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        
        if (this._tempFile) {
            try {
                this._tempFile.delete(null);
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        
        super.destroy();
    }
});

let microphoneToggle;

function init() {
    log('Voice Type extension initialized');
}

function enable() {
    try {
        microphoneToggle = new MicrophoneToggle();
        Main.panel.addToStatusArea('microphone-toggle', microphoneToggle);
        log('Voice Type extension enabled');
    } catch (error) {
        log('Voice Type: Error enabling extension: ' + error.message);
    }
}

function disable() {
    if (microphoneToggle) {
        microphoneToggle.destroy();
        microphoneToggle = null;
    }
    log('Voice Type extension disabled');
}