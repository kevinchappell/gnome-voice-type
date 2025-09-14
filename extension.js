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
        this.recordingTimeout = null;

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

            // Set up recording timeout
            const recordingLimitSeconds = this._settings.get_int('recording-limit-seconds');
            this.recordingTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, recordingLimitSeconds, () => {
                if (this.isRecording) {
                    const enableNotifications = this._settings.get_boolean('enable-notifications');
                    if (enableNotifications) {
                        Main.notify(_('Voice Type Input'), _(`Recording stopped - ${recordingLimitSeconds} second limit reached`));
                    }
                    this._stopRecording();
                }
                this.recordingTimeout = null;
                return GLib.SOURCE_REMOVE;
            });

            const enableNotifications = this._settings.get_boolean('enable-notifications');
            if (enableNotifications) {
                Main.notify(_('Voice Type Input'), _('Recording started - speak now!'));
            }
        } catch (error) {
            this.isRecording = false;
            this.setMicrophoneRecording(false);
            
            // Clear timeout if it was set
            if (this.recordingTimeout) {
                GLib.source_remove(this.recordingTimeout);
                this.recordingTimeout = null;
            }
            
            const enableNotifications = this._settings.get_boolean('enable-notifications');
            if (enableNotifications) {
                Main.notify(_('Voice Type Input'), _('Failed to start recording: ') + error.message);
            }
            console.error('Error starting recording:', error);
        }
    }

    async _stopRecording() {
        try {
            // Clear timeout if active
            if (this.recordingTimeout) {
                GLib.source_remove(this.recordingTimeout);
                this.recordingTimeout = null;
            }
            
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
            
            // Try different methods based on the active application
            this._smartPaste(text);
            
        } catch (error) {
            console.error('Error typing text:', error);
            this._fallbackToClipboard(text);
        }
    }

    _smartPaste(text) {
        // Check if enhanced terminal support is enabled
        const enhancedTerminalSupport = this._settings.get_boolean('enhanced-terminal-support');
        console.debug(`Enhanced terminal support: ${enhancedTerminalSupport}`);
        
        if (enhancedTerminalSupport) {
            // Get the currently focused window to determine the best paste method
            const display = global.display;
            const focusWindow = display.get_focus_window();
            
            if (focusWindow) {
                const wmClass = focusWindow.get_wm_class();
                const title = focusWindow.get_title();
                
                console.debug(`Active window: wmClass="${wmClass}", title="${title}"`);
                
                // Check if it's a terminal application
                const isTerminal = this._isTerminalApplication(wmClass, title);
                console.debug(`Is terminal application: ${isTerminal}`);
                
                if (isTerminal) {
                    console.debug('Using terminal-specific paste methods');
                    this._pasteToTerminal(text);
                    return;
                }
            } else {
                console.debug('No focused window detected');
            }
        }
        
        console.debug('Using standard paste method');
        // Default paste method for non-terminal applications or when enhanced support is disabled
        this._simulatePaste();
    }

    _isTerminalApplication(wmClass, title) {
        if (!wmClass && !title) return false;
        
        // Pure terminal applications - these should use terminal paste methods
        const terminalApps = [
            'gnome-terminal', 'konsole', 'xterm', 'alacritty',
            'kitty', 'tilix', 'terminator', 'urxvt', 'rxvt',
            'wezterm', 'foot', 'st', 'x-terminal-emulator', 'terminal'
        ];
        
        // Code editors - check if we're specifically in a terminal within them
        const codeEditors = ['code', 'vscode', 'cursor'];
        
        const wmClassLower = wmClass ? wmClass.toLowerCase() : '';
        const titleLower = title ? title.toLowerCase() : '';
        
        // Check for pure terminal applications
        const isPureTerminal = terminalApps.some(terminal => 
            wmClassLower.includes(terminal) || wmClassLower === terminal
        );
        
        if (isPureTerminal) {
            return true;
        }
        
        // For code editors, only consider them terminals if title suggests terminal context
        const isCodeEditor = codeEditors.some(editor => 
            wmClassLower.includes(editor)
        );
        
        if (isCodeEditor) {
            // Only treat as terminal if title suggests we're in a terminal
            const terminalTitleIndicators = [
                'terminal', 'bash', 'zsh', 'fish', 'powershell', 'cmd',
                'integrated terminal', 'terminal tab'
            ];
            
            return terminalTitleIndicators.some(indicator => 
                titleLower.includes(indicator)
            );
        }
        
        // Don't treat other applications (like Sublime Text, Atom) as terminals
        // unless they explicitly match terminal criteria
        return false;
    }

    _pasteToTerminal(text) {
        // For terminals, try multiple approaches as they can have different behaviors
        
        // Method 1: Try Ctrl+Shift+V (common terminal paste shortcut)
        this._tryTerminalPaste(() => {
            // Method 2: If that fails, try middle mouse button (X11 selection)
            this._trySelectionPaste(() => {
                // Method 3: If that fails, try typing directly
                this._tryDirectTyping(text, () => {
                    // Method 4: Final fallback to standard Ctrl+V
                    this._simulatePaste();
                });
            });
        });
    }

    _tryTerminalPaste(fallback) {
        try {
            // Try Ctrl+Shift+V (common in terminals like gnome-terminal)
            const pasteCommand = [
                'wtype', '-M', 'ctrl', '-M', 'shift', 'v', '-m', 'shift', '-m', 'ctrl'
            ];

            const proc = Gio.Subprocess.new(
                pasteCommand,
                Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.wait_async(null, (source, result) => {
                try {
                    const success = proc.wait_finish(result);
                    if (!success || proc.get_exit_status() !== 0) {
                        console.debug('Terminal paste failed, trying fallback');
                        fallback();
                    }
                } catch (error) {
                    console.debug('Terminal paste error:', error.message);
                    fallback();
                }
            });

        } catch (error) {
            console.debug('Terminal paste execution failed:', error.message);
            fallback();
        }
    }

    _trySelectionPaste(fallback) {
        try {
            // For Wayland, try Shift+Insert as an alternative paste method
            // For X11, this will try middle mouse button
            const isWayland = global.display.is_wayland();
            
            let selectionCommand;
            if (isWayland) {
                // Shift+Insert often works as paste in terminals on Wayland
                selectionCommand = [
                    'wtype', '-M', 'shift', 'Insert', '-m', 'shift'
                ];
            } else {
                // Middle mouse button for X11
                selectionCommand = [
                    'wtype', '-k', 'Button2'
                ];
            }

            const proc = Gio.Subprocess.new(
                selectionCommand,
                Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.wait_async(null, (source, result) => {
                try {
                    const success = proc.wait_finish(result);
                    if (!success || proc.get_exit_status() !== 0) {
                        console.debug(`Selection paste failed (${isWayland ? 'Wayland' : 'X11'}), trying fallback`);
                        fallback();
                    } else {
                        console.debug(`Selection paste succeeded on ${isWayland ? 'Wayland' : 'X11'}`);
                    }
                } catch (error) {
                    console.debug('Selection paste error:', error.message);
                    fallback();
                }
            });

        } catch (error) {
            console.debug('Selection paste execution failed:', error.message);
            fallback();
        }
    }

    _tryDirectTyping(text, fallback) {
        try {
            // As a last resort before standard paste, try typing the text directly
            // This can work when paste shortcuts fail
            
            // For wtype, we need to properly escape the text
            // Split into chunks if text is too long to avoid command line limits
            const maxChunkSize = 100;
            
            if (text.length > maxChunkSize) {
                // For long text, fall back to paste method
                console.debug('Text too long for direct typing, using fallback');
                fallback();
                return;
            }
            
            // Use -- to indicate end of options, then pass text as single argument
            const typeCommand = ['wtype', '--', text];

            const proc = Gio.Subprocess.new(
                typeCommand,
                Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.wait_async(null, (source, result) => {
                try {
                    const success = proc.wait_finish(result);
                    if (!success || proc.get_exit_status() !== 0) {
                        console.debug('Direct typing failed, trying final fallback');
                        fallback();
                    } else {
                        console.debug('Direct typing succeeded');
                    }
                } catch (error) {
                    console.debug('Direct typing error:', error.message);
                    fallback();
                }
            });

        } catch (error) {
            console.debug('Direct typing execution failed:', error.message);
            fallback();
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
        // Check if this is a terminal application for X11
        const display = global.display;
        const focusWindow = display.get_focus_window();
        
        if (focusWindow) {
            const wmClass = focusWindow.get_wm_class();
            const title = focusWindow.get_title();
            
            if (this._isTerminalApplication(wmClass, title)) {
                // Try terminal-specific X11 paste methods
                this._tryX11TerminalPaste();
                return;
            }
        }
        
        // Standard X11 paste for non-terminal applications
        this._tryX11StandardPaste();
    }

    _tryX11TerminalPaste() {
        // Try Ctrl+Shift+V first (common terminal shortcut)
        try {
            const terminalPasteCommand = [
                'xdotool', 'key', 'ctrl+shift+v'
            ];

            const proc = Gio.Subprocess.new(
                terminalPasteCommand,
                Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.wait_async(null, (source, result) => {
                try {
                    const success = proc.wait_finish(result);
                    if (!success || proc.get_exit_status() !== 0) {
                        // If terminal paste fails, try middle click
                        this._tryX11MiddleClick();
                    }
                } catch (error) {
                    console.debug('X11 terminal paste failed:', error.message);
                    this._tryX11MiddleClick();
                }
            });

        } catch (error) {
            console.debug('X11 terminal paste execution failed:', error.message);
            this._tryX11MiddleClick();
        }
    }

    _tryX11MiddleClick() {
        try {
            // Try middle mouse button (selection paste)
            const middleClickCommand = [
                'xdotool', 'click', '2'
            ];

            const proc = Gio.Subprocess.new(
                middleClickCommand,
                Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.wait_async(null, (source, result) => {
                try {
                    const success = proc.wait_finish(result);
                    if (!success || proc.get_exit_status() !== 0) {
                        // Final fallback to standard paste
                        this._tryX11StandardPaste();
                    }
                } catch (error) {
                    console.debug('X11 middle click failed:', error.message);
                    this._tryX11StandardPaste();
                }
            });

        } catch (error) {
            console.debug('X11 middle click execution failed:', error.message);
            this._tryX11StandardPaste();
        }
    }

    _tryX11StandardPaste() {
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

        // Clear recording timeout
        if (this.recordingTimeout) {
            GLib.source_remove(this.recordingTimeout);
            this.recordingTimeout = null;
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
