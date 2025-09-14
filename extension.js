import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gst from 'gi://Gst';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Voice Type Input'));

        // Track signal connections for cleanup
        this._signalConnections = [];

        // Initialize GStreamer
        Gst.init(null);

        // Create the microphone icon
        this.icon = new St.Icon({
            icon_name: 'audio-input-microphone-symbolic',
            style_class: 'system-status-icon voice-type-input-icon',
        });

        this.add_child(this.icon);

        // Recording state
        this.isRecording = false;
        this.pipeline = null;
        this.tempFile = null;

        // Connect click event to toggle recording - track connection for cleanup
        const clickConnection = this.connect('button-press-event', this._onClicked.bind(this));
        this._signalConnections.push({ object: this, id: clickConnection });

        // Disable the popup menu to avoid confusion with click toggle
        this.menu.actor.hide();
        this.menu.actor.reactive = false;
    }

    _onClicked() {
        this._toggleRecording();
        return Clutter.EVENT_PROPAGATE;
    }

    async _toggleRecording() {
        if (this.isRecording) {
            this._stopRecording();
        } else {
            await this._startRecording();
        }
    }

    async _startRecording() {
        try {
            this.isRecording = true;
            this.setMicrophoneRecording(true);

            // Create a temporary file for the recording
            this.tempFile = GLib.build_filenamev([GLib.get_tmp_dir(), `voice-input-${Date.now()}.wav`]);
            
            // Create GStreamer pipeline for audio recording
            const pipelineStr = `autoaudiosrc ! audioconvert ! audioresample ! audio/x-raw,rate=16000,channels=1 ! wavenc ! filesink location="${this.tempFile}"`;
            this.pipeline = Gst.parse_launch(pipelineStr);
            
            if (!this.pipeline) {
                throw new Error('Failed to create GStreamer pipeline');
            }

            // Start recording
            this.pipeline.set_state(Gst.State.PLAYING);

            Main.notify(_('Voice Type Input'), _('Recording started - speak now!'));
        } catch (error) {
            this.isRecording = false;
            this.setMicrophoneRecording(false);
            Main.notify(_('Voice Type Input'), _('Failed to start recording: ') + error.message);
            console.error('Error starting recording:', error);
        }
    }

    async _stopRecording() {
        try {
            if (this.pipeline) {
                // Stop the pipeline
                this.pipeline.set_state(Gst.State.NULL);
                this.pipeline = null;
            }

            this.isRecording = false;
            this.setMicrophoneRecording(false);

            if (this.tempFile) {
                Main.notify(_('Voice Type Input'), _('Processing audio...'));
                await this._transcribeAudio();
            } else {
                Main.notify(_('Voice Type Input'), _('Recording stopped'));
            }
        } catch (error) {
            Main.notify(_('Voice Type Input'), _('Error stopping recording: ') + error.message);
            console.error('Error stopping recording:', error);
        }
    }

    async _transcribeAudio() {
        try {
            // Check if file exists
            const file = Gio.File.new_for_path(this.tempFile);
            if (!file.query_exists(null)) {
                throw new Error('Audio file not found');
            }

            // For now, use curl as a fallback since Soup multipart is complex in GNOME Shell
            // This is a temporary solution until we can properly implement the Soup multipart
            const curlCommand = [
                'curl', '-X', 'POST',
                'http://localhost:8675/transcribe',
                '-H', 'accept: application/json',
                '-H', 'Content-Type: multipart/form-data',
                '-F', `file=@${this.tempFile}`,
                '--silent'
            ];

            // Execute curl command
            const proc = Gio.Subprocess.new(
                curlCommand,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            const [success, stdout, stderr] = proc.communicate_utf8(null, null);

            if (!success) {
                throw new Error('Failed to execute request');
            }

            if (proc.get_exit_status() !== 0) {
                throw new Error(`Request failed: ${stderr}`);
            }

            const result = JSON.parse(stdout);
            
            if (result.text) {
                // Type the transcribed text
                this._typeText(result.text.trim());
                Main.notify(_('Voice Type Input'), _('Text transcribed and typed!'));
            } else {
                Main.notify(_('Voice Type Input'), _('No speech detected'));
            }

        } catch (error) {
            Main.notify(_('Voice Type Input'), _('Transcription failed: ') + error.message);
            console.error('Transcription error:', error);
        } finally {
            // Clean up temporary file
            this._cleanupTempFile();
        }
    }

    _typeText(text) {
        try {
            // Get the clipboard and set text
            const clipboard = St.Clipboard.get_default();
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            
            // Simulate Ctrl+V to paste the text
            // Note: This is a simplified approach - in a real implementation,
            // you might want to use more sophisticated input simulation
            Main.notify(_('Voice Type Input'), `Text copied to clipboard: "${text}"`);
        } catch (error) {
            console.error('Error typing text:', error);
            Main.notify(_('Voice Type Input'), `Text: "${text}" (manual copy needed)`);
        }
    }

    _cleanupTempFile() {
        if (this.tempFile) {
            try {
                const file = Gio.File.new_for_path(this.tempFile);
                if (file.query_exists(null)) {
                    file.delete(null);
                }
            } catch (error) {
                console.debug('Error cleaning up temp file:', error);
            }
            this.tempFile = null;
        }
    }

    // Update microphone state visual
    setMicrophoneRecording(recording) {
        if (recording) {
            this.icon.style_class = 'system-status-icon voice-type-input-icon recording';
        } else {
            this.icon.style_class = 'system-status-icon voice-type-input-icon';
        }
    }

    destroy() {
        // Prevent multiple destroy calls
        if (this._destroying) {
            return;
        }
        this._destroying = true;
        
        // Stop recording if active
        if (this.isRecording) {
            this._stopRecording();
        }

        // Clean up GStreamer pipeline
        if (this.pipeline) {
            this.pipeline.set_state(Gst.State.NULL);
            this.pipeline = null;
        }

        // Clean up temporary file
        this._cleanupTempFile();
        
        // Disconnect all signal connections before destroying
        if (this._signalConnections) {
            this._signalConnections.forEach(connection => {
                try {
                    if (connection.object && connection.id) {
                        if (typeof connection.object.disconnect === 'function') {
                            connection.object.disconnect(connection.id);
                        }
                    }
                } catch (e) {
                    console.debug('Signal disconnect failed:', e.message);
                }
            });
            this._signalConnections = [];
        }
        
        // Destroy the icon safely
        try {
            if (this.icon && typeof this.icon.destroy === 'function') {
                this.icon.destroy();
            }
        } catch (e) {
            console.debug('Icon cleanup failed:', e.message);
        }
        this.icon = null;
        
        // Finally call parent destroy safely
        try {
            super.destroy();
        } catch (e) {
            console.debug('Parent destroy failed:', e.message);
        }
    }
});

export default class VoiceTypeInputExtension extends Extension {
    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            // Remove from panel first to prevent further interactions
            if (Main.panel?.statusArea?.[this.uuid]) {
                delete Main.panel.statusArea[this.uuid];
            }
            
            // Then destroy the indicator
            try {
                this._indicator.destroy();
            } catch (e) {
                console.debug('Indicator destroy failed during disable:', e.message);
            }
            
            this._indicator = null;
        }
    }
}
