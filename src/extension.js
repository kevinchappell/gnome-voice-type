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

    _onButtonPress() {
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
            
            log('Started recording audio');
        } catch (error) {
            log('Error starting recording: ' + error.message);
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
                this._recordingProcess.wait_async(null, function(proc, result) {
                    try {
                        proc.wait_finish(result);
                        this._processRecording();
                    } catch (error) {
                        log('Error waiting for recording process: ' + error.message);
                    }
                }.bind(this));
            } catch (error) {
                log('Error stopping recording: ' + error.message);
            }
        }
    }

    _processRecording() {
        if (!this._tempFile || !this._tempFile.query_exists(null)) {
            log('No recording file found');
            return;
        }

        try {
            // Read the recorded file
            var success, contents;
            [success, contents] = this._tempFile.load_contents(null);
            if (!success) {
                log('Failed to read recording file');
                return;
            }

            // Create multipart form data
            var multipart = Soup.Multipart.new(Soup.FORM_MIME_TYPE_MULTIPART);
            
            // Add the file to the form data
            var fileData = GLib.Bytes.new(contents);
            var disposition = 'form-data; name="file"; filename="recording.wav"';
            multipart.append_form_file('file', 'recording.wav', 'audio/wav', fileData);

            // Create the message
            var message = Soup.Message.new_from_multipart('http://localhost:8675/transcribe', multipart);
            
            // Send the request
            this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, function(session, result) {
                try {
                    var bytes = session.send_and_read_finish(result);
                    var responseText = '';
                    if (bytes && bytes.get_data()) {
                        var data = bytes.get_data();
                        for (var j = 0; j < data.length; j++) {
                            responseText += String.fromCharCode(data[j]);
                        }
                    }
                     
                    if (message.get_status() === 200) {
                         try {
                             var response = JSON.parse(responseText);
                            if (response.text) {
                                this._insertText(response.text);
                            } else {
                                log('STT response missing text field: ' + responseText);
                                Main.notify('Voice Type', 'STT response missing text field');
                            }
                        } catch (parseError) {
                            log('Error parsing STT response JSON: ' + parseError.message);
                            Main.notify('Voice Type', 'Invalid STT response format');
                        }
                    } else if (message.get_status() === 0) {
                        log('STT endpoint connection failed - service may not be running');
                        Main.notify('Voice Type', 'STT service not available at localhost:8675');
                    } else {
                        log('STT request failed with status ' + message.get_status() + ': ' + responseText);
                        Main.notify('Voice Type', 'STT request failed (status ' + message.get_status() + ')');
                    }
                } catch (error) {
                    log('Error processing STT response: ' + error.message);
                    Main.notify('Voice Type', 'Error processing STT response');
                }
            }.bind(this));

        } catch (error) {
            log('Error processing recording: ' + error.message);
        }
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

    _updateIcon() {
        if (this._isRecording) {
            this._icon.gicon = Gio.icon_new_for_string(Me.dir.get_path() + '/icons/microphone-recording-symbolic.svg');
        } else {
            this._icon.gicon = Gio.icon_new_for_string(Me.dir.get_path() + '/icons/microphone-symbolic.svg');
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
