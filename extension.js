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
    _init(extension) {
        super._init(0.0, _('Voice Type Input'));

        // Store extension reference for settings access
        this._extension = extension;
        this._settings = extension.getSettings();

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
            
            // Get recording quality setting
            const recordingQuality = this._settings.get_string('recording-quality');
            let sampleRate;
            
            switch (recordingQuality) {
                case 'low':
                    sampleRate = 8000;
                    break;
                case 'high':
                    sampleRate = 44100;
                    break;
                default: // medium
                    sampleRate = 16000;
                    break;
            }
            
            // Create GStreamer pipeline for audio recording
            const pipelineStr = `autoaudiosrc ! audioconvert ! audioresample ! audio/x-raw,rate=${sampleRate},channels=1 ! wavenc ! filesink location="${this.tempFile}"`;
            this.pipeline = Gst.parse_launch(pipelineStr);
            
            if (!this.pipeline) {
                throw new Error('Failed to create GStreamer pipeline');
            }

            // Start recording
            this.pipeline.set_state(Gst.State.PLAYING);

            const enableNotifications = this._settings.get_boolean('enable-notifications');
            if (enableNotifications) {
                Main.notify(_('Voice Type Input'), _('Recording started - speak now!'));
            }
        } catch (error) {
            this.isRecording = false;
            this.setMicrophoneRecording(false);
            const enableNotifications = this._settings.get_boolean('enable-notifications');
            if (enableNotifications) {
                Main.notify(_('Voice Type Input'), _('Failed to start recording: ') + error.message);
            }
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
                const enableNotifications = this._settings.get_boolean('enable-notifications');
                if (enableNotifications) {
                    Main.notify(_('Voice Type Input'), _('Processing audio...'));
                }
                await this._transcribeAudio();
            } else {
                const enableNotifications = this._settings.get_boolean('enable-notifications');
                if (enableNotifications) {
                    Main.notify(_('Voice Type Input'), _('Recording stopped'));
                }
            }
        } catch (error) {
            const enableNotifications = this._settings.get_boolean('enable-notifications');
            if (enableNotifications) {
                Main.notify(_('Voice Type Input'), _('Error stopping recording: ') + error.message);
            }
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

            // Get endpoint URL from settings
            const endpointUrl = this._settings.get_string('endpoint-url');
            const enableNotifications = this._settings.get_boolean('enable-notifications');
            
            // Ensure URL doesn't end with slash and add /transcribe
            const baseUrl = endpointUrl.replace(/\/$/, '');
            const fullUrl = `${baseUrl}/transcribe`;

            // For now, use curl as a fallback since Soup multipart is complex in GNOME Shell
            // This is a temporary solution until we can properly implement the Soup multipart
            const curlCommand = [
                'curl', '-X', 'POST',
                fullUrl,
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
                if (enableNotifications) {
                    Main.notify(_('Voice Type Input'), _('Text typed successfully!'));
                }
            } else if (enableNotifications) {
                Main.notify(_('Voice Type Input'), _('No speech detected'));
            }

        } catch (error) {
            const enableNotifications = this._settings.get_boolean('enable-notifications');
            if (enableNotifications) {
                Main.notify(_('Voice Type Input'), _('Transcription failed: ') + error.message);
            }
            console.error('Transcription error:', error);
        } finally {
            // Clean up temporary file
            this._cleanupTempFile();
        }
    }

    _typeText(text) {
        try {
            // First, copy text to clipboard
            const clipboard = St.Clipboard.get_default();
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            
            // Then simulate Ctrl+V to paste
            // This approach works on both X11 and Wayland
            this._simulatePaste();
            
        } catch (error) {
            console.error('Error typing text:', error);
            this._fallbackToClipboard(text);
        }
    }

    _simulatePaste() {
        try {
            // Use wtype for Wayland or xdotool for X11
            // First try wtype (Wayland-compatible)
            const wtypeCommand = [
                'wtype', '-M', 'ctrl', 'v', '-m', 'ctrl'
            ];

            const proc = Gio.Subprocess.new(
                wtypeCommand,
                Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.wait_async(null, (source, result) => {
                try {
                    const success = proc.wait_finish(result);
                    if (!success || proc.get_exit_status() !== 0) {
                        // If wtype fails, try xdotool (X11)
                        this._tryX11Paste();
                    }
                } catch (error) {
                    // If wtype is not available, try xdotool
                    console.debug('wtype not available:', error.message);
                    this._tryX11Paste();
                }
            });

        } catch (error) {
            // If wtype execution fails, try xdotool
            console.debug('wtype execution failed:', error.message);
            this._tryX11Paste();
        }
    }

    _tryX11Paste() {
        try {
            const xdotoolCommand = [
                'xdotool', 'key', 'ctrl+v'
            ];

            const proc = Gio.Subprocess.new(
                xdotoolCommand,
                Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.wait_async(null, (source, result) => {
                try {
                    const success = proc.wait_finish(result);
                    if (!success || proc.get_exit_status() !== 0) {
                        // If both fail, just notify user that text is in clipboard
                        const enableNotifications = this._settings.get_boolean('enable-notifications');
                        if (enableNotifications) {
                            Main.notify(_('Voice Type Input'), _('Text copied to clipboard - paste with Ctrl+V'));
                        }
                    }
                } catch (error) {
                    console.debug('xdotool failed:', error.message);
                    const enableNotifications = this._settings.get_boolean('enable-notifications');
                    if (enableNotifications) {
                        Main.notify(_('Voice Type Input'), _('Text copied to clipboard - paste with Ctrl+V'));
                    }
                }
            });

        } catch (error) {
            // Final fallback - just notify that text is in clipboard
            console.debug('xdotool execution failed:', error.message);
            const enableNotifications = this._settings.get_boolean('enable-notifications');
            if (enableNotifications) {
                Main.notify(_('Voice Type Input'), _('Text copied to clipboard - paste with Ctrl+V'));
            }
        }
    }

    _fallbackToClipboard(text) {
        try {
            // Fallback: copy to clipboard and notify user
            const clipboard = St.Clipboard.get_default();
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            const enableNotifications = this._settings.get_boolean('enable-notifications');
            if (enableNotifications) {
                Main.notify(_('Voice Type Input'), _('Text copied to clipboard - paste with Ctrl+V'));
            }
        } catch (error) {
            console.error('Clipboard fallback failed:', error);
            const enableNotifications = this._settings.get_boolean('enable-notifications');
            if (enableNotifications) {
                Main.notify(_('Voice Type Input'), `Text: "${text}" (manual copy needed)`);
            }
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
        this._indicator = new Indicator(this);
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
