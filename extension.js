import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gst from 'gi://Gst';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import ApiClient from './apiClient.js';

const Indicator = GObject.registerClass(
  class Indicator extends PanelMenu.Button {
    _init(extension) {
      // Pass dontCreateMenu=true: we don't want the popup menu and we attach
      // our own click gesture below, since the parent's gesture is wired to
      // open the (now nonexistent) menu.
      super._init(0.0, _('Voice Type Input'), true);

      // Store extension reference for settings access
      this._extension = extension;
      this._settings = extension.getSettings();

      // Track signal connections for cleanup
      this._signalConnections = [];

      // Cancellable for async subprocess calls (ydotool/wtype)
      this._subprocessCancellable = new Gio.Cancellable();

      // Initialize GStreamer
      Gst.init(null);

      // Create the microphone icon
      this.icon = new St.Icon({
        icon_name: 'audio-input-microphone-symbolic',
        style_class: 'system-status-icon voice-type-input-icon',
      });

      this.add_child(this.icon);

      // Track media players for pausing/resuming
      this._pausedPlayers = [];
      this._mediaPaused = false;

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

      // Shell 50's PanelMenu.Button handles clicks via Clutter.ClickGesture,
      // not button-press-event signals or vfunc_event. Attach our own gesture
      // that toggles recording.
      this._clickGesture = new Clutter.ClickGesture();
      this._clickGesture.set_recognize_on_press(true);
      this._clickGesture.connect('recognize', () => this._toggleRecording());
      this.add_action(this._clickGesture);

      // React to debug-mode toggling at runtime so the overlay closes immediately when disabled
      const debugModeConnection = this._settings.connect('changed::debug-mode', () => {
        this._debugMode = this._settings.get_boolean('debug-mode');
        if (!this._debugMode) {
          this._destroyDebugWindow();
        }
      });
      this._signalConnections.push({ object: this._settings, id: debugModeConnection });
    }

    _logDebug(...args) {
      if (this._debugMode) {
        console.debug(...args);
      }
    }

    _logError(...args) {
      if (this._debugMode) {
        console.error(...args);
      }
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
        this._logError('Error in _toggleRecording:', error);
      } finally {
        this._togglingRecording = false;
      }
    }

    async _startRecording() {
      try {
        this._logDebug('_startRecording called');
        this.isRecording = true;
        this.setMicrophoneRecording(true);

        // Refresh debug mode flag each start in case user changed it in prefs
        this._debugMode = this._settings.get_boolean('debug-mode');
        if (this._debugMode) {
          this._ensureDebugWindow();
          this._appendDebugLine('[info] Recording started');
        }

        // Pause media players to reduce background noise
        this._pauseMediaPlayers();

        // Force file-based recording only - streaming disabled
        this._logDebug('Starting file-based recording (streaming disabled)...');
        await this._startFileRecording();

      } catch (error) {
        this._logError('Error in _startRecording:', error);
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
        this._logError('Error starting recording:', error);
      }
    }

    async _startFileRecording() {
      // Create a private temporary directory for the recording. The filename
      // inside it is stable, but other users cannot access or pre-create it.
      this.tempDir = GLib.Dir.make_tmp('voice-type-input-XXXXXX');
      this.tempFile = GLib.build_filenamev([this.tempDir, 'recording.wav']);

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

      // Create GStreamer pipeline for audio recording without parsing a
      // string. The filesink path is assigned as a property, so it does not
      // need pipeline-syntax escaping.
      this.pipeline = Gst.Pipeline.new('voice-type-input-recording');
      const source = Gst.ElementFactory.make('autoaudiosrc', 'source');
      const convert = Gst.ElementFactory.make('audioconvert', 'convert');
      const resample = Gst.ElementFactory.make('audioresample', 'resample');
      const capsfilter = Gst.ElementFactory.make('capsfilter', 'capsfilter');
      const encoder = Gst.ElementFactory.make('wavenc', 'encoder');
      const sink = Gst.ElementFactory.make('filesink', 'sink');

      if (!this.pipeline || !source || !convert || !resample || !capsfilter || !encoder || !sink) {
        this.pipeline = null;
        this._cleanupTempFile();
        throw new Error('Failed to create GStreamer pipeline');
      }

      capsfilter.set_property('caps', Gst.Caps.from_string(`audio/x-raw,rate=${sampleRate},channels=1`));
      sink.set_property('location', this.tempFile);

      for (const element of [source, convert, resample, capsfilter, encoder, sink]) {
        this.pipeline.add(element);
      }

      if (!source.link(convert) || !convert.link(resample) || !resample.link(capsfilter) ||
          !capsfilter.link(encoder) || !encoder.link(sink)) {
        this.pipeline.set_state(Gst.State.NULL);
        this.pipeline = null;
        this._cleanupTempFile();
        throw new Error('Failed to link GStreamer pipeline');
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

        // Resume any paused media players
        this._resumeMediaPlayers();

      } catch (error) {
        const enableNotifications = this._settings.get_boolean('enable-notifications');
        if (enableNotifications) {
          Main.notify(_('Voice Type Input'), _('Error stopping recording: ') + error.message);
        }
        this._logError('Error stopping recording:', error);
      } finally {
        this._stoppingRecording = false;
      }
    }

    async _transcribeAudio() {
      try {
        const provider = this._settings.get_string('api-provider');
        const baseUrl = this._settings.get_string('endpoint-url');
        const model = this._settings.get_string('api-model');

        const client = ApiClient.forProvider(provider, baseUrl, model);
        const text = await client.transcribe(this.tempFile);

        const enableNotifications = this._settings.get_boolean('enable-notifications');

        if (text === null) {
          if (enableNotifications) {
            Main.notify(_('Voice Type Input'), _('No speech detected'));
          }
          return;
        }

        this._typeText(text, () => {
          if (enableNotifications) {
            Main.notify(_('Voice Type Input'), _('Text typed successfully!'));
          }
        });
      } catch (error) {
        const enableNotifications = this._settings.get_boolean('enable-notifications');
        if (enableNotifications) {
          Main.notify(_('Voice Type Input'), _('Transcription failed: ') + error.message);
        }
        this._logError('Transcription error:', error);
      } finally {
        this._cleanupTempFile();
      }
    }

    _typeText(text, onComplete) {
      try {
        this._logDebug(`_typeText called with text length: ${text.length}, debug mode: ${this._debugMode}`);

        if (this._debugMode) {
          this._logDebug('Using debug mode typing');
          this._appendDebugLine(`[text] ${text}`);
          this._simulateDebugTyping(text);
          if (onComplete) onComplete();
          return;
        }

        const autoInsert = this._settings.get_boolean('auto-insert');
        if (!autoInsert) {
          this._logDebug('Auto-insert disabled, copying to clipboard only');
          this._fallbackToClipboard(text);
          return;
        }

        // Prefer Clutter virtual-keyboard typing: it runs inside gnome-shell,
        // so it works on GNOME Wayland without ydotool/wtype.
        this._logDebug('Trying Clutter virtual-keyboard typing...');
        if (this._tryTypeWithClutter(text)) {
          this._logDebug('Clutter typing succeeded');
          this._lastTypeMethod = 'clutter:type';
          if (onComplete) onComplete();
          return;
        }

        this._logDebug('Clutter typing unavailable, trying ydotool...');
        this._tryTypeWithYdotool(text, (success) => {
          if (success) {
            this._logDebug('ydotool typing succeeded');
            this._lastTypeMethod = 'ydotool';
            if (onComplete) onComplete();
            return;
          }
          this._logDebug('ydotool typing failed, falling back to clipboard + paste');
          this._pasteViaClipboard(text, onComplete);
        });
      } catch (error) {
        this._logError('Error typing text:', error);
        this._fallbackToClipboard(text);
        if (onComplete) onComplete();
      }
    }

    // Save current clipboards, write the transcription, paste, then optionally
    // restore the previous clipboard text so we don't trample the user's copy buffer.
    // Non-text clipboard contents (images, files) can't be read back via
    // St.Clipboard.get_text and so can't be preserved — we resolve to null in
    // that case and skip the restore for that selection rather than wiping it
    // to an empty string.
    _pasteViaClipboard(text, onComplete) {
      const clipboard = St.Clipboard.get_default();
      const keepClipboard = this._settings.get_boolean('keep-clipboard-after-paste');
      const finish = () => { if (onComplete) onComplete(); };

      const readClipboard = (type) => new Promise((resolve) => {
        try {
          clipboard.get_text(type, (_cb, savedText) => resolve(savedText ?? null));
        } catch (_e) {
          resolve(null);
        }
      });

      Promise.all([
        readClipboard(St.ClipboardType.CLIPBOARD),
        readClipboard(St.ClipboardType.PRIMARY),
      ]).then(([savedClip, savedPrimary]) => {
        clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
        clipboard.set_text(St.ClipboardType.PRIMARY, text);

        const afterPaste = (pasteSucceeded) => {
          if (!pasteSucceeded) {
            // Nothing got pasted — leave the transcription on the clipboard so
            // the user can paste it manually, and notify.
            this._lastTypeMethod = 'clipboard';
            const enableNotifications = this._settings.get_boolean('enable-notifications');
            if (enableNotifications) {
              Main.notify(_('Voice Type Input'), _('Text copied to clipboard - paste with Ctrl+V or middle-click'));
            }
            finish();
            return;
          }

          if (keepClipboard) {
            finish();
            return;
          }

          // Give the target app a moment to consume the paste before restoring.
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            // Only restore if the selection still holds the transcription we
            // wrote — otherwise the user or app has put something newer there
            // and we shouldn't overwrite it.
            const maybeRestore = (type, saved) => {
              if (saved === null) return;
              try {
                clipboard.get_text(type, (_cb, current) => {
                  if (current !== text) return;
                  try {
                    clipboard.set_text(type, saved);
                  } catch (e) {
                    this._logDebug('Clipboard restore failed:', e.message);
                  }
                });
              } catch (e) {
                this._logDebug('Clipboard restore check failed:', e.message);
              }
            };
            maybeRestore(St.ClipboardType.CLIPBOARD, savedClip);
            maybeRestore(St.ClipboardType.PRIMARY, savedPrimary);
            finish();
            return GLib.SOURCE_REMOVE;
          });
        };

        this._smartPaste(text, afterPaste);
      }).catch((e) => {
        this._logError('Clipboard paste path failed:', e);
        this._fallbackToClipboard(text);
        finish();
      });
    }

    _smartPaste(text, onComplete) {
      const enhancedTerminalSupport = this._settings.get_boolean('enhanced-terminal-support');
      this._logDebug(`_smartPaste called, enhanced terminal support: ${enhancedTerminalSupport}`);

      if (enhancedTerminalSupport) {
        const display = global.display;
        const focusWindow = display.get_focus_window();

        if (focusWindow && this._isTerminalApplication(focusWindow.get_wm_class(), focusWindow.get_title())) {
          this._logDebug('Detected terminal application, trying Ctrl+Shift+V');
          if (this._simulateKeyCombo([Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_v])) {
            this._lastTypeMethod = 'clutter:ctrl-shift-v';
            if (onComplete) onComplete(true);
            return;
          }
          // Clutter failed, try wtype for non-GNOME compositors
          this._tryAsyncSubprocess(['wtype', '-M', 'ctrl', '-M', 'shift', 'v', '-m', 'shift', '-m', 'ctrl'], (success) => {
            if (success) {
              this._lastTypeMethod = 'wtype:ctrl-shift-v';
              if (onComplete) onComplete(true);
              return;
            }
            this._logDebug('Terminal paste failed, trying standard paste');
            this._tryStandardPaste(text, onComplete);
          });
          return;
        } else {
          this._logDebug('Not a terminal application or no focus window');
        }
      }

      this._tryStandardPaste(text, onComplete);
    }

    _tryStandardPaste(text, onComplete) {
      this._logDebug('Trying standard Ctrl+V paste');
      // Try Clutter first (works natively in GNOME Shell on both X11 and Wayland)
      if (this._simulateKeyCombo([Clutter.KEY_Control_L, Clutter.KEY_v])) {
        this._lastTypeMethod = 'clutter:ctrl-v';
        if (onComplete) onComplete(true);
        return;
      }
      // Fall back to wtype for non-GNOME compositors
      this._tryAsyncSubprocess(['wtype', '-M', 'ctrl', 'v', '-m', 'ctrl'], (success) => {
        if (success) {
          this._lastTypeMethod = 'wtype:ctrl-v';
          if (onComplete) onComplete(true);
          return;
        }
        this._logDebug('All paste methods failed');
        if (onComplete) onComplete(false);
      });
    }

    _simulateKeyCombo(keyvals) {
      try {
        const seat = Clutter.get_default_backend().get_default_seat();
        const virtualDevice = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const time = Clutter.get_current_event_time();

        // Press all keys
        for (let i = 0; i < keyvals.length; i++) {
          virtualDevice.notify_keyval(time + i, keyvals[i], Clutter.KeyState.PRESSED);
        }
        // Release all keys in reverse order
        for (let i = keyvals.length - 1; i >= 0; i--) {
          virtualDevice.notify_keyval(time + keyvals.length + (keyvals.length - 1 - i), keyvals[i], Clutter.KeyState.RELEASED);
        }
        return true;
      } catch (e) {
        this._logDebug('Clutter key simulation failed:', e.message);
        return false;
      }
    }

    _tryAsyncSubprocess(commands, callback) {
      try {
        if (!this._subprocessCancellable || this._destroying) {
          callback(false);
          return;
        }
        const proc = Gio.Subprocess.new(commands, Gio.SubprocessFlags.NONE);
        proc.wait_check_async(this._subprocessCancellable, (_proc, result) => {
          if (this._destroying) return;
          try {
            const success = _proc.wait_check_finish(result);
            callback(success);
          } catch (error) {
            this._logDebug(`Subprocess failed for ${commands[0]}:`, error.message);
            callback(false);
          }
        });
      } catch (error) {
        this._logDebug(`Subprocess launch failed for ${commands[0]}:`, error.message);
        callback(false);
      }
    }

    // Check if a program is available in PATH
    _hasProgram(name) {
      try {
        return GLib.find_program_in_path(name) !== null;
      } catch (e) {
        this._logDebug('Program lookup failed:', e.message);
        return false;
      }
    }

    // Type arbitrary text using the Clutter virtual keyboard device. This runs
    // inside gnome-shell, so it works on GNOME Wayland without ydotool/wtype
    // (which can't type into other windows because Mutter doesn't expose the
    // virtual-keyboard or input-method Wayland protocols).
    _tryTypeWithClutter(text) {
      try {
        if (!text) return false;
        const seat = Clutter.get_default_backend().get_default_seat();
        const virtualDevice = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        let time = Clutter.get_current_event_time();

        for (const ch of text) {
          const code = ch.codePointAt(0);
          let keyval;
          if (code === 0x0a) {
            keyval = Clutter.KEY_Return;
          } else if (code === 0x09) {
            keyval = Clutter.KEY_Tab;
          } else if (code === 0x08) {
            keyval = Clutter.KEY_BackSpace;
          } else if (code < 0x20 || code === 0x7f) {
            // Skip other control characters.
            continue;
          } else if (code <= 0xff) {
            // Latin-1 keysyms equal their codepoint; Mutter can map these to
            // a keycode via the current XKB layout.
            keyval = code;
          } else {
            // X11 Unicode keysym convention for everything above Latin-1.
            keyval = 0x01000000 | code;
          }
          virtualDevice.notify_keyval(time++, keyval, Clutter.KeyState.PRESSED);
          virtualDevice.notify_keyval(time++, keyval, Clutter.KeyState.RELEASED);
        }
        return true;
      } catch (e) {
        this._logDebug('Clutter typing failed:', e.message);
        return false;
      }
    }

    // Try to type text directly using ydotool (Wayland-friendly via uinput).
    // Used as a fallback for non-GNOME compositors where the Clutter virtual
    // device isn't available.
    _tryTypeWithYdotool(text, callback) {
      try {
        if (!text || !this._hasProgram('ydotool')) {
          callback(false);
          return;
        }

        const delay = text.length > 60 ? 800 : 300; // microseconds between keys
        // Sanitize text: remove null bytes and other control chars that crash ydotool
        const sanitized = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
        if (!sanitized) {
          callback(false);
          return;
        }
        // Use -- to prevent text starting with '-' from being parsed as flags
        // Use -p 1 instead of -p 0 to avoid SIGABRT in some ydotool versions
        const args = ['ydotool', 'type', '-p', '1', '-d', String(delay), '--', sanitized];
        this._tryAsyncSubprocess(args, callback);
      } catch (e) {
        this._logDebug('ydotool typing failed:', e.message);
        callback(false);
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
        this._logError('Clipboard fallback failed:', error);
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
          this._logDebug('Error cleaning up temp file:', error);
        }
        this.tempFile = null;
      }
      if (this.tempDir) {
        try {
          const dir = Gio.File.new_for_path(this.tempDir);
          if (dir.query_exists(null)) {
            dir.delete(null);
          }
        } catch (error) {
          this._logDebug('Error cleaning up temp directory:', error);
        }
        this.tempDir = null;
      }
    }

    // Pause MPRIS media players during recording to reduce background noise
    _pauseMediaPlayers() {
      const pauseMediaEnabled = this._settings.get_boolean('mute-media-during-recording');
      if (!pauseMediaEnabled) {
        this._logDebug('Media pause during recording disabled in settings');
        return;
      }

      try {
        this._logDebug('Voice Type Input: checking MPRIS media players to pause');

        const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);

        // List bus names to find MPRIS players
        const namesResult = bus.call_sync(
          'org.freedesktop.DBus',
          '/org/freedesktop/DBus',
          'org.freedesktop.DBus',
          'ListNames',
          null,
          new GLib.VariantType('(as)'),
          Gio.DBusCallFlags.NONE,
          -1,
          null
        );
        const busNames = namesResult.get_child_value(0).deep_unpack();

        this._pausedPlayers = [];

        for (const name of busNames) {
          if (!name.startsWith('org.mpris.MediaPlayer2.')) continue;

          // Query PlaybackStatus directly via Properties.Get instead of
          // relying on DBusProxy's cached properties. Some MPRIS
          // implementations (notably browser-based players like Firefox
          // and Chromium running YouTube Music) don't return all
          // properties from GetAll, so the cached value is null and the
          // "Playing" check silently fails.
          let playbackStatus = null;
          try {
            const statusResult = bus.call_sync(
              name,
              '/org/mpris/MediaPlayer2',
              'org.freedesktop.DBus.Properties',
              'Get',
              new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'PlaybackStatus']),
              new GLib.VariantType('(v)'),
              Gio.DBusCallFlags.NONE,
              -1,
              null
            );
            const innerVariant = statusResult.get_child_value(0).get_variant();
            playbackStatus = innerVariant.get_string()[0];
          } catch (e) {
            this._logDebug(`Voice Type Input: failed to query PlaybackStatus for ${name}: ${e.message}`);
            continue;
          }

          this._logDebug(`Voice Type Input: MPRIS player ${name} status=${playbackStatus}`);

          if (playbackStatus !== 'Playing') continue;

          try {
            bus.call_sync(
              name,
              '/org/mpris/MediaPlayer2',
              'org.mpris.MediaPlayer2.Player',
              'Pause',
              null,
              null,
              Gio.DBusCallFlags.NONE,
              -1,
              null
            );
            this._pausedPlayers.push(name);
            this._logDebug(`Voice Type Input: paused ${name}`);
          } catch (e) {
            this._logDebug(`Voice Type Input: failed to pause ${name}: ${e.message}`);
          }
        }

        if (this._pausedPlayers.length > 0) {
          this._mediaPaused = true;
        } else {
          this._logDebug('Voice Type Input: no playing MPRIS media players found');
        }

      } catch (error) {
        this._logError('Voice Type Input: error pausing media players:', error);
      }
    }

    // Resume previously paused media players
    _resumeMediaPlayers() {
      if (!this._mediaPaused || this._pausedPlayers.length === 0) {
        return;
      }

      try {
        const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);

        for (const playerName of this._pausedPlayers) {
          try {
            bus.call_sync(
              playerName,
              '/org/mpris/MediaPlayer2',
              'org.mpris.MediaPlayer2.Player',
              'Play',
              null,
              null,
              Gio.DBusCallFlags.NONE,
              -1,
              null
            );
            this._logDebug(`Voice Type Input: resumed ${playerName}`);
          } catch (e) {
            this._logDebug(`Voice Type Input: failed to resume ${playerName}: ${e.message}`);
          }
        }

        this._pausedPlayers = [];
        this._mediaPaused = false;

      } catch (error) {
        this._logError('Voice Type Input: error resuming media players:', error);
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

      // Cancel any in-flight async subprocess calls
      if (this._subprocessCancellable) {
        this._subprocessCancellable.cancel();
        this._subprocessCancellable = null;
      }

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
            this._logDebug('Signal disconnect failed:', e.message);
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
        this._logDebug('Icon cleanup failed:', e.message);
      }
      this.icon = null;

      // Finally call parent destroy safely
      try {
        super.destroy();
      } catch (e) {
        this._logDebug('Parent destroy failed:', e.message);
      }
    }

    _ensureDebugWindow() {
      if (this._debugWindow) return;

      this._logDebug('Creating debug window...');
      const monitor = Main.layoutManager.primaryMonitor;
      this._logDebug(`Monitor: x=${monitor.x}, y=${monitor.y}, width=${monitor.width}, height=${monitor.height}`);

      const windowX = Math.floor(monitor.x + monitor.width * 0.05);
      const windowY = Math.floor(monitor.y + monitor.height * 0.1);
      const windowWidth = Math.floor(monitor.width * 0.4);
      const windowHeight = Math.floor(monitor.height * 0.25);

      this._logDebug(`Debug window position: x=${windowX}, y=${windowY}, width=${windowWidth}, height=${windowHeight}`);

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
      this._logDebug('Debug window created and added to UI group');
    }

    _destroyDebugWindow() {
      if (this._debugTypeSource) {
        GLib.source_remove(this._debugTypeSource);
        this._debugTypeSource = 0;
      }
      if (this._debugWindow) {
        try { this._debugWindow.destroy(); } catch (e) { this._logDebug('Debug window destroy error:', e.message); }
      }
      this._debugWindow = null;
      this._debugLabel = null;
    }

    _appendDebugLine(line) {
      if (!this._debugLabel) {
        this._logDebug('Debug label not found, ensuring debug window...');
        this._ensureDebugWindow();
      }
      if (!this._debugLabel) {
        this._logError('Failed to create debug label');
        return;
      }
      const existing = this._debugLabel.text || '';
      const newText = existing + (existing ? '\n' : '') + line;
      this._debugLabel.text = newText;
      this._logDebug(`Debug line appended: "${line}", total text length: ${newText.length}`);
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
    this._settings = this.getSettings();
    this._migrateEndpointUrl();

    this._indicator = new Indicator(this);
    Main.panel.addToStatusArea(this.uuid, this._indicator);

    // Register keyboard shortcut for toggling recording
    Main.wm.addKeybinding(
      'toggle-recording-shortcut',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
      () => {
        this._indicator._toggleRecording();
      }
    );
  }

  // One-shot migration: earlier versions stored endpoint-url without the
  // API version (e.g. "http://localhost:8675"). The current contract is
  // that the base URL must include "/v1", so any path component is fine
  // as long as it ends in "/v1". Append it if it's missing.
  _migrateEndpointUrl() {
    const current = this._settings.get_string('endpoint-url');
    if (!current) return;
    const normalized = current.replace(/\/+$/, '');
    if (/\/v1$/.test(normalized)) return;
    this._settings.set_string('endpoint-url', `${normalized}/v1`);
  }

  disable() {
    // Remove keybinding
    Main.wm.removeKeybinding('toggle-recording-shortcut');

    if (this._indicator) {
      // Remove from panel first to prevent further interactions
      if (Main.panel?.statusArea?.[this.uuid]) {
        delete Main.panel.statusArea[this.uuid];
      }

      // Then destroy the indicator
      try {
        this._indicator.destroy();
      } catch (e) {
        this._indicator._logDebug('Indicator destroy failed during disable:', e.message);
      }

      this._indicator = null;
    }

    this._settings = null;
  }
}
