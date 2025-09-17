import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gst from 'gi://Gst';
import Soup from 'gi://Soup';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
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

      // Recursion guards
      this._togglingRecording = false;
      this._stoppingRecording = false;

      // Debug window related
      this._debugMode = this._settings.get_boolean('debug-mode');
      this._debugWindow = null;
      this._debugLabel = null;
      this._debugInsertPos = 0;
      this._debugTypeSource = 0;
      this._lastTypeMethod = '';

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
      // Prevent recursive toggle calls
      if (this._togglingRecording) {
        return;
      }
      this._togglingRecording = true;

      try {
        if (this.isRecording) {
          this._stopRecording();
        } else {
          await this._startRecording();
        }
      } catch (error) {
        console.error('Error in _toggleRecording:', error);
      } finally {
        this._togglingRecording = false;
      }
    }

    async _startRecording() {
      try {
        console.debug('_startRecording called');
        this.isRecording = true;
        this.setMicrophoneRecording(true);

        // Refresh debug mode flag each start in case user changed it in prefs
        this._debugMode = this._settings.get_boolean('debug-mode');
        if (this._debugMode) {
          this._ensureDebugWindow();
          this._appendDebugLine('[info] Recording started');
        }

        // Force file-based recording only - streaming disabled
        console.debug('Starting file-based recording (streaming disabled)...');
        await this._startFileRecording();

      } catch (error) {
        console.error('Error in _startRecording:', error);
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

    async _startFileRecording() {
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
    }

    async _stopRecording() {
      // Prevent recursive stop calls
      if (this._stoppingRecording) {
        return;
      }
      this._stoppingRecording = true;

      try {
        // Clear timeout if active
        if (this.recordingTimeout) {
          GLib.source_remove(this.recordingTimeout);
          this.recordingTimeout = null;
        }

        const enableNotifications = this._settings.get_boolean('enable-notifications');

        // Only handle file-based recording - streaming disabled
        if (this.pipeline) {
          // Stop the pipeline
          this.pipeline.set_state(Gst.State.NULL);
          this.pipeline = null;
        }

        if (this.tempFile) {
          if (enableNotifications) {
            Main.notify(_('Voice Type Input'), _('Processing audio...'));
          }
          if (this._debugMode) this._appendDebugLine('[info] Processing audio');
          await this._transcribeAudio();
        } else if (enableNotifications) {
          Main.notify(_('Voice Type Input'), _('Recording stopped'));
        }

        this.isRecording = false;
        this.setMicrophoneRecording(false);

      } catch (error) {
        const enableNotifications = this._settings.get_boolean('enable-notifications');
        if (enableNotifications) {
          Main.notify(_('Voice Type Input'), _('Error stopping recording: ') + error.message);
        }
        console.error('Error stopping recording:', error);
      } finally {
        this._stoppingRecording = false;
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

        // Use Soup for HTTP multipart upload instead of external curl
        const fileInfo = file.query_info('standard::*', Gio.FileQueryInfoFlags.NONE, null);
        const [success, fileContent] = file.load_contents(null);
        if (!success) {
          throw new Error('Failed to load audio file');
        }

        const multipart = Soup.Multipart.new('multipart/form-data');
        multipart.append_form_file('file', fileInfo.get_name(), 'audio/wav', fileContent);

        const message = Soup.Message.new_from_multipart(fullUrl, multipart);
        message.request_headers.append('accept', 'application/json');

        const session = Soup.Session.new();
        const json = await new Promise((resolve, reject) => {
          session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
            try {
              const bytes = sess.send_and_read_finish(res);
              const statusCode = message.get_status();
              if (statusCode >= 200 && statusCode < 300) {
                const ByteArray = imports.byteArray;
                const bodyText = ByteArray.toString(bytes.get_data());
                try {
                  resolve(JSON.parse(bodyText));
                } catch (e) {
                  console.debug('JSON parse failed:', e.message);
                  reject(new Error('Invalid JSON response'));
                }
              } else {
                const ByteArray = imports.byteArray;
                const bodyText = ByteArray.toString(bytes.get_data());
                reject(new Error(`HTTP ${statusCode}: ${bodyText || 'Request failed'}`));
              }
            } catch (err) {
              reject(err);
            }
          });
        });

        session.abort(); // Clean up session

        if (json.text) {
          // Type the transcribed text
          this._typeText(json.text.trim());
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
        console.debug(`_typeText called with text length: ${text.length}, debug mode: ${this._debugMode}`);

        if (this._debugMode) {
          console.debug('Using debug mode typing');
          this._appendDebugLine(`[text] ${text}`);
          this._simulateDebugTyping(text);
          return;
        }

        console.debug('Trying ydotool typing...');
        if (this._tryTypeWithYdotool(text)) {
          console.debug('ydotool typing succeeded');
          this._lastTypeMethod = 'ydotool';
          return;
        }
        console.debug('ydotool typing failed, falling back to clipboard + paste');

        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
        clipboard.set_text(St.ClipboardType.PRIMARY, text);
        this._smartPaste(text);
      } catch (error) {
        console.error('Error typing text:', error);
        this._fallbackToClipboard(text);
      }
    }

    _smartPaste(text) {
      const enhancedTerminalSupport = this._settings.get_boolean('enhanced-terminal-support');
      console.debug(`_smartPaste called, enhanced terminal support: ${enhancedTerminalSupport}`);

      if (enhancedTerminalSupport) {
        const display = global.display;
        const focusWindow = display.get_focus_window();

        if (focusWindow && this._isTerminalApplication(focusWindow.get_wm_class(), focusWindow.get_title())) {
          console.debug('Detected terminal application, trying Ctrl+Shift+V');
          // Terminal: try Ctrl+Shift+V first
          if (this._trySyncSubprocess(['wtype', '-M', 'ctrl', '-M', 'shift', 'v', '-m', 'shift', '-m', 'ctrl'])) {
            console.debug('Ctrl+Shift+V succeeded');
            this._lastTypeMethod = 'wtype:ctrl-shift-v';
            return;
          }
          console.debug('Ctrl+Shift+V failed, trying middle click');
          // Then try middle click (Button2)
          if (this._trySyncSubprocess(['wtype', '-k', 'Button2'])) {
            console.debug('Middle click succeeded');
            this._lastTypeMethod = 'wtype:button2';
            return;
          }
          console.debug('Middle click failed');
        } else {
          console.debug('Not a terminal application or no focus window');
        }
      }

      console.debug('Trying standard Ctrl+V paste');
      // Standard paste: try Ctrl+V
      if (this._trySyncSubprocess(['wtype', '-M', 'ctrl', 'v', '-m', 'ctrl'])) {
        console.debug('Ctrl+V succeeded');
        this._lastTypeMethod = 'wtype:ctrl-v';
        return;
      }
      console.debug('Ctrl+V failed, falling back to clipboard notification');

      // Final fallback to clipboard
      this._fallbackToClipboard(text);
    }

    _trySyncSubprocess(commands) {
      try {
        const proc = Gio.Subprocess.new(commands, Gio.SubprocessFlags.NONE);
        return proc.wait_check(null);
      } catch (error) {
        console.debug(`Subprocess failed for ${commands[0]}:`, error.message);
        return false;
      }
    }

    // Check if a program is available in PATH
    _hasProgram(name) {
      try {
        return GLib.find_program_in_path(name) !== null;
      } catch (e) {
        console.debug('Program lookup failed:', e.message);
        return false;
      }
    }

    // Try to type text directly using ydotool (Wayland-friendly via uinput)
    _tryTypeWithYdotool(text) {
      try {
        if (!text || !this._hasProgram('ydotool')) return false;
        if (text.length > 180) return false; // large chunks faster via paste

        // Test if ydotool daemon is available by trying a simple command
        const testProc = Gio.Subprocess.new(['ydotool', '--help'], Gio.SubprocessFlags.NONE);
        if (!testProc.wait_check(null)) {
          console.debug('ydotool daemon not available');
          return false;
        }

        const delay = text.length > 60 ? 800 : 300; // microseconds between keys
        const args = ['ydotool', 'type', '-p', '0', '-d', String(delay), text];
        const proc = Gio.Subprocess.new(args, Gio.SubprocessFlags.NONE);
        const success = proc.wait_check(null);
        if (success) {
          this._lastTypeMethod = 'ydotool';
          return true;
        }
        return false;
      } catch (e) {
        console.debug('ydotool typing failed:', e.message);
        return false;
      }
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

    _fallbackToClipboard(text) {
      try {
        // Fallback: copy to both clipboards and notify user
        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
        clipboard.set_text(St.ClipboardType.PRIMARY, text);
        this._lastTypeMethod = 'clipboard';
        const enableNotifications = this._settings.get_boolean('enable-notifications');
        if (enableNotifications) {
          Main.notify(_('Voice Type Input'), _('Text copied to clipboard - paste with Ctrl+V or middle-click'));
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
      // Destroy debug window if present
      this._destroyDebugWindow();

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

    _ensureDebugWindow() {
      if (this._debugWindow) return;

      console.debug('Creating debug window...');
      const monitor = Main.layoutManager.primaryMonitor;
      console.debug(`Monitor: x=${monitor.x}, y=${monitor.y}, width=${monitor.width}, height=${monitor.height}`);

      const windowX = Math.floor(monitor.x + monitor.width * 0.05);
      const windowY = Math.floor(monitor.y + monitor.height * 0.1);
      const windowWidth = Math.floor(monitor.width * 0.4);
      const windowHeight = Math.floor(monitor.height * 0.25);

      console.debug(`Debug window position: x=${windowX}, y=${windowY}, width=${windowWidth}, height=${windowHeight}`);

      this._debugWindow = new St.BoxLayout({
        style_class: 'voice-type-input-debug-window',
        vertical: true,
        x: windowX,
        y: windowY,
        width: windowWidth,
        height: windowHeight
      });

      const title = new St.Label({ text: 'Voice Type Input (Debug Mode)', style_class: 'voice-type-input-debug-title' });
      this._debugLabel = new St.Label({ text: '', style_class: 'voice-type-input-debug-text' });

      // Temporarily add label directly without scroll view for debugging
      this._debugWindow.add_child(title);
      this._debugWindow.add_child(this._debugLabel);

      Main.uiGroup.add_child(this._debugWindow);

      // Ensure the window is visible
      this._debugWindow.show();
      console.debug('Debug window created and added to UI group');
    }

    _destroyDebugWindow() {
      if (this._debugTypeSource) {
        GLib.source_remove(this._debugTypeSource);
        this._debugTypeSource = 0;
      }
      if (this._debugWindow) {
        try { this._debugWindow.destroy(); } catch (e) { console.debug('Debug window destroy error:', e.message); }
      }
      this._debugWindow = null;
      this._debugLabel = null;
    }

    _appendDebugLine(line) {
      if (!this._debugLabel) {
        console.debug('Debug label not found, ensuring debug window...');
        this._ensureDebugWindow();
      }
      if (!this._debugLabel) {
        console.error('Failed to create debug label');
        return;
      }
      const existing = this._debugLabel.text || '';
      const newText = existing + (existing ? '\n' : '') + line;
      this._debugLabel.text = newText;
      console.debug(`Debug line appended: "${line}", total text length: ${newText.length}`);
    }

    _simulateDebugTyping(text) {
      if (!this._debugLabel) return;

      // Cancel any existing typing animation
      if (this._debugTypeSource) {
        GLib.source_remove(this._debugTypeSource);
        this._debugTypeSource = 0;
      }

      // Ensure debug window is visible
      this._ensureDebugWindow();

      // For debug mode, just append the text immediately to avoid UI rendering issues
      // The character-by-character animation was causing framebuffer errors
      const base = this._debugLabel.text ? this._debugLabel.text + '\n' : '';
      this._debugLabel.text = base + text;
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
