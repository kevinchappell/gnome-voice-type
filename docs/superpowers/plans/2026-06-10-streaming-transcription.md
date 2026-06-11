# Streaming Transcription (SSE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in streamed transcription — the extension consumes OpenAI-compatible SSE `transcript.text.delta` events and types text incrementally with smooth pacing, with a silent non-streaming retry for incompatible endpoints.

**Architecture:** A new `transcribeStream()` method on `ApiClient` reads SSE lines from a `Gio.DataInputStream`; a new `StreamTyper` class (own file) paces deltas into chunked typing through a sticky insertion method (Clutter → ydotool); `extension.js` gates the streaming path on a new `stream-transcription` GSettings key and falls back to the existing non-streaming flow on pre-delta failure.

**Tech Stack:** GJS / GNOME Shell 46+ ES modules, Soup 3, Gio, GLib, Adw (prefs).

**Spec:** `docs/superpowers/specs/2026-06-10-streaming-transcription-design.md`

**Verification note:** This repo has no test suite (see CLAUDE.md). Each task is verified with `./validate.sh` (static validation + JS syntax) plus a final manual nested-shell task. There are no unit-test steps.

---

### Task 1: Add `stream-transcription` settings key

**Files:**
- Modify: `schemas/org.gnome.shell.extensions.voice-type-input.gschema.xml`

- [ ] **Step 1: Add the key**

In `schemas/org.gnome.shell.extensions.voice-type-input.gschema.xml`, after the `keep-clipboard-after-paste` key and before `</schema>`, add:

```xml
    <key name="stream-transcription" type="b">
      <default>false</default>
      <summary>Stream transcription results</summary>
      <description>Type text incrementally as the server transcribes it, using OpenAI-compatible SSE streaming. Requires a streaming-capable endpoint; incompatible endpoints automatically fall back to non-streaming. Default is off because the default OpenAI whisper-1 model does not support streaming.</description>
    </key>
```

- [ ] **Step 2: Compile schemas**

Run: `make schemas`
Expected: exits 0, `schemas/gschemas.compiled` updated.

- [ ] **Step 3: Validate**

Run: `./validate.sh`
Expected: all checks pass (green), no errors.

- [ ] **Step 4: Commit**

```bash
git add schemas/
git commit -m "feat: add stream-transcription settings key"
```

---

### Task 2: `ApiClient.transcribeStream()` (SSE client)

**Files:**
- Modify: `apiClient.js`

- [ ] **Step 1: Add a module-level SSE line reader**

In `apiClient.js`, after the `isConnectionError` function (around line 39), add:

```js
// Read one line from a DataInputStream; resolves null at EOF.
function readLineAsync(dataStream) {
    return new Promise((resolve, reject) => {
        dataStream.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
            try {
                const [line] = stream.read_line_finish_utf8(res);
                resolve(line);
            } catch (e) {
                reject(e);
            }
        });
    });
}
```

- [ ] **Step 2: Extract the multipart message builder**

Add this method to the `ApiClient` class (after `_loadAudioFile`):

```js
    _buildMultipartMessage(tempFile, fileContent, stream) {
        const fullUrl = buildTranscriptionUrl(this.baseUrl);
        const multipart = Soup.Multipart.new('multipart/form-data');
        multipart.append_form_file('file', GLib.path_get_basename(tempFile), 'audio/wav', fileContent);
        multipart.append_form_string('model', this.model);
        multipart.append_form_string('response_format', 'json');
        if (stream) {
            multipart.append_form_string('stream', 'true');
        }
        return Soup.Message.new_from_multipart(fullUrl, multipart);
    }
```

Then in `transcribe()`, replace the `else` branch of the provider check (the four lines building `multipart` and `message` — currently lines 138–142):

```js
        } else {
            message = this._buildMultipartMessage(tempFile, fileContent, false);
        }
```

(The `const fullUrl = buildTranscriptionUrl(this.baseUrl);` line in `transcribe()` stays — the OpenRouter branch still uses it.)

- [ ] **Step 3: Add `transcribeStream()`**

Add to the `ApiClient` class, after `transcribe()`:

```js
    /**
     * Transcribe a WAV file, streaming OpenAI-compatible SSE deltas.
     * Throws before any delta is delivered on HTTP/connection errors, so
     * the caller can safely retry with transcribe() without duplicating text.
     * Never used for the openrouter provider (no streaming support there);
     * the caller gates this.
     * @param {string} tempFile - Path to the WAV file
     * @param {(delta: string) => void} onDelta - Called per text delta
     * @returns {Promise<string|null>} - Final text, or null if no speech detected
     */
    async transcribeStream(tempFile, onDelta) {
        const fileContent = await this._loadAudioFile(tempFile);
        const apiKey = await this._getApiKey();

        const message = this._buildMultipartMessage(tempFile, fileContent, true);
        message.request_headers.append('accept', 'text/event-stream');
        if (apiKey) {
            message.request_headers.append('Authorization', `Bearer ${apiKey}`);
        }

        const session = Soup.Session.new();
        session.set_timeout(120);

        try {
            const inputStream = await new Promise((resolve, reject) => {
                session.send_async(message, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
                    try {
                        resolve(sess.send_finish(res));
                    } catch (err) {
                        reject(err);
                    }
                });
            });

            const dataStream = Gio.DataInputStream.new(inputStream);
            const statusCode = message.get_status();
            if (statusCode < 200 || statusCode >= 300) {
                const lines = [];
                for (;;) {
                    const line = await readLineAsync(dataStream);
                    if (line === null) break;
                    lines.push(line);
                }
                throw new Error(`HTTP ${statusCode}: ${lines.join('\n') || 'Request failed'}`);
            }

            let doneText = null;
            let accumulated = '';
            for (;;) {
                const line = await readLineAsync(dataStream);
                if (line === null) break; // EOF ends the stream
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                let event;
                try {
                    event = JSON.parse(payload);
                } catch (_e) {
                    continue; // tolerate keepalives / unknown payloads
                }
                if (event.type === 'transcript.text.delta' && typeof event.delta === 'string') {
                    accumulated += event.delta;
                    onDelta(event.delta);
                } else if (event.type === 'transcript.text.done' && typeof event.text === 'string') {
                    doneText = event.text;
                }
            }

            const text = (doneText !== null ? doneText : accumulated).trim();
            return text || null;
        } catch (err) {
            if (isConnectionError(err)) {
                const connErr = new Error('Transcription server unreachable');
                connErr.isConnectionError = true;
                throw connErr;
            }
            throw err;
        } finally {
            session.abort();
        }
    }
```

- [ ] **Step 4: Validate**

Run: `./validate.sh && node -c apiClient.js`
Expected: all checks pass, no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add apiClient.js
git commit -m "feat: add SSE streaming transcription to ApiClient"
```

---

### Task 3: `StreamTyper` (paced typing queue)

**Files:**
- Create: `streamTyper.js`
- Modify: `Makefile:42` (zip file list)
- Modify: `dev.sh:306` (required_files), `dev.sh:522-527` (watch_files)

- [ ] **Step 1: Create `streamTyper.js`**

```js
import GLib from 'gi://GLib';

// Drain cadence: a small chunk every tick reads as a smooth, very fast
// typist rather than network-rhythm bursts, while keeping up with
// real-time transcription streams.
const TICK_INTERVAL_MS = 70;
const MAX_CHARS_PER_TICK = 24;

// Paces streamed transcription deltas into smooth typed output.
//
// Deltas are pushed into a character buffer that a GLib timeout drains in
// small chunks. The insertion method is chosen on the first chunk (Clutter
// virtual keyboard, then ydotool) and stays sticky for the rest of the
// stream so output can't switch methods mid-utterance. ydotool is invoked
// once per chunk, never per character.
//
// Outcomes the caller must handle after finish():
//   - typedText === '' → no usable method; type/paste the full text itself.
//   - failed === true  → a working method died mid-stream; some text was
//                        typed, so re-typing would duplicate it.
export default class StreamTyper {
    /**
     * @param {object} methods
     * @param {(chunk: string) => boolean} methods.tryClutter - synchronous, returns success
     * @param {(chunk: string, cb: (ok: boolean) => void) => void} methods.tryYdotool
     */
    constructor({ tryClutter, tryYdotool }) {
        this._tryClutter = tryClutter;
        this._tryYdotool = tryYdotool;
        this._buffer = '';
        this._typed = '';
        this._method = null; // 'clutter' | 'ydotool' | 'none'
        this._failed = false;
        this._sourceId = 0;
        this._chunkInFlight = false;
        this._streamEnded = false;
        this._cancelled = false;
        this._drainResolvers = [];
    }

    get typedText() { return this._typed; }
    get failed() { return this._failed; }
    get method() { return this._method; }

    push(delta) {
        if (this._cancelled || this._failed || this._method === 'none' || !delta) return;
        this._buffer += delta;
        if (!this._sourceId) {
            this._sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_INTERVAL_MS, () => this._onTick());
        }
    }

    // Resolves once every buffered character has been typed (or typing has
    // stopped for good). Call after the stream delivered its last delta.
    finish() {
        this._streamEnded = true;
        if (this._isSettled()) return Promise.resolve();
        return new Promise((resolve) => this._drainResolvers.push(resolve));
    }

    cancel() {
        this._cancelled = true;
        this._buffer = '';
        if (this._sourceId) {
            GLib.source_remove(this._sourceId);
            this._sourceId = 0;
        }
        this._resolveDrain();
    }

    _isSettled() {
        if (this._cancelled || this._failed || this._method === 'none') return true;
        return this._buffer === '' && !this._chunkInFlight;
    }

    _resolveDrain() {
        const resolvers = this._drainResolvers;
        this._drainResolvers = [];
        resolvers.forEach((resolve) => resolve());
    }

    _onTick() {
        if (this._cancelled || this._failed || this._method === 'none') {
            this._sourceId = 0;
            return GLib.SOURCE_REMOVE;
        }
        if (this._chunkInFlight) return GLib.SOURCE_CONTINUE;
        if (this._buffer === '') {
            this._sourceId = 0;
            if (this._streamEnded) this._resolveDrain();
            return GLib.SOURCE_REMOVE;
        }

        const chunk = this._takeChunk();
        this._chunkInFlight = true;
        this._typeChunk(chunk, (ok) => {
            this._chunkInFlight = false;
            if (ok) {
                this._typed += chunk;
            } else if (this._typed === '') {
                // Nothing typed yet: no usable method at all. Stop consuming;
                // the caller handles the complete text after finish().
                this._method = 'none';
                this._buffer = '';
                this._resolveDrain();
            } else {
                // A method that was working stopped working mid-stream.
                this._failed = true;
                this._buffer = '';
                this._resolveDrain();
            }
        });
        return GLib.SOURCE_CONTINUE;
    }

    // Pick the method on the first chunk; sticky afterwards.
    _typeChunk(chunk, done) {
        if (this._method === null || this._method === 'clutter') {
            if (this._tryClutter(chunk)) {
                this._method = 'clutter';
                done(true);
                return;
            }
            if (this._method === 'clutter') {
                done(false); // was working, now isn't — no cross-method retry
                return;
            }
        }
        this._method = 'ydotool';
        this._tryYdotool(chunk, done);
    }

    _takeChunk() {
        let end = Math.min(MAX_CHARS_PER_TICK, this._buffer.length);
        // Don't split a surrogate pair at the chunk boundary.
        const last = this._buffer.charCodeAt(end - 1);
        if (last >= 0xd800 && last <= 0xdbff && end < this._buffer.length) end += 1;
        const chunk = this._buffer.slice(0, end);
        this._buffer = this._buffer.slice(end);
        return chunk;
    }
}
```

- [ ] **Step 2: Register the new file in packaging**

In `Makefile` line 42, add `streamTyper.js` to the zip list after `apiClient.js`:

```make
	@zip -r $(UUID).zip extension.js prefs.js apiClient.js streamTyper.js metadata.json stylesheet.css schemas/org.gnome.shell.extensions.voice-type-input.gschema.xml LICENSE README.md
```

In `dev.sh` line 306, add to `required_files`:

```bash
    local required_files=("metadata.json" "extension.js" "apiClient.js" "streamTyper.js" "stylesheet.css")
```

In `dev.sh` lines 522–527, add to `watch_files`:

```bash
    local watch_files=(
        "$SOURCE_DIR/extension.js"
        "$SOURCE_DIR/apiClient.js"
        "$SOURCE_DIR/streamTyper.js"
        "$SOURCE_DIR/metadata.json"
        "$SOURCE_DIR/stylesheet.css"
    )
```

- [ ] **Step 3: Validate**

Run: `./validate.sh && node -c streamTyper.js`
Expected: all checks pass, no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add streamTyper.js Makefile dev.sh
git commit -m "feat: add StreamTyper paced typing queue"
```

---

### Task 4: Wire streaming into `extension.js`

**Files:**
- Modify: `extension.js` (import block, `_startRecording` ~line 112, `_transcribeAudio` ~line 282, new `_streamTranscription` method, new `_appendDebugChunk` method near `_appendDebugLine` ~line 951, `destroy()` ~line 854)

- [ ] **Step 1: Import StreamTyper**

At the top of `extension.js`, after the existing `import ApiClient from './apiClient.js';` line, add:

```js
import StreamTyper from './streamTyper.js';
```

- [ ] **Step 2: Cancel a leftover typer on new recording**

In `_startRecording()` (line 112), immediately after `this._logDebug('_startRecording called');`, add:

```js
        // A previous streamed transcription may still be draining — stop it
        // so old text doesn't interleave with the new recording's output.
        if (this._streamTyper) {
          this._streamTyper.cancel();
          this._streamTyper = null;
        }
```

- [ ] **Step 3: Gate the streaming path in `_transcribeAudio()`**

In `_transcribeAudio()` (line 282), after `const client = ApiClient.forProvider(provider, baseUrl, model);` and before `const text = await client.transcribe(this.tempFile);`, add:

```js
        // Streamed path: type deltas as they arrive. OpenRouter has no
        // streaming transcription support, and with auto-insert off there
        // is nothing to stream into.
        const streamEnabled = this._settings.get_boolean('stream-transcription');
        const autoInsert = this._settings.get_boolean('auto-insert');
        if (streamEnabled && provider !== 'openrouter' && (autoInsert || this._debugMode)) {
          const handled = await this._streamTranscription(client);
          if (handled) return;
          // Streaming failed before any text arrived (e.g. the endpoint
          // rejects stream=true) — retry non-streaming below.
          this._logDebug('Streaming unavailable, retrying without streaming');
        }
```

The rest of `_transcribeAudio()` (non-streaming `transcribe()` call, null check, `_typeText`, catch/finally) is unchanged. Note the `finally { this._cleanupTempFile(); }` already covers the streaming path because `_streamTranscription` is awaited inside the `try`.

- [ ] **Step 4: Add `_streamTranscription()`**

Add this method directly after `_transcribeAudio()`:

```js
    // Run one streamed transcription attempt. Returns true if the attempt
    // was handled to completion (success, no-speech, or an unrecoverable
    // mid-stream failure that has already been reported); returns false if
    // it failed before any text arrived and the caller should retry
    // non-streaming.
    async _streamTranscription(client) {
      const enableNotifications = this._settings.get_boolean('enable-notifications');

      if (this._debugMode) this._appendDebugLine('[stream]');
      const typer = new StreamTyper(this._debugMode ? {
        tryClutter: (chunk) => { this._appendDebugChunk(chunk); return true; },
        tryYdotool: (_chunk, cb) => cb(false),
      } : {
        tryClutter: (chunk) => this._tryTypeWithClutter(chunk),
        tryYdotool: (chunk, cb) => this._tryTypeWithYdotool(chunk, cb),
      });
      this._streamTyper = typer;

      let accumulated = '';
      let finalText;
      try {
        finalText = await client.transcribeStream(this.tempFile, (delta) => {
          accumulated += delta;
          typer.push(delta);
        });
      } catch (error) {
        typer.cancel();
        this._streamTyper = null;
        if (accumulated === '') {
          this._logDebug('Streaming failed before any delta:', error.message);
          return false;
        }
        // Some text may already be typed — retrying would duplicate it.
        this._logError('Stream interrupted:', error);
        if (enableNotifications) {
          Main.notify(_('Voice Type Input'), _('Transcription interrupted - partial text copied to clipboard'));
        }
        this._fallbackToClipboard(accumulated);
        return true;
      }

      await typer.finish();
      this._streamTyper = null;

      if (finalText === null) {
        if (enableNotifications) {
          Main.notify(_('Voice Type Input'), _('No speech detected'));
        }
        return true;
      }

      if (typer.typedText === '') {
        // No streaming-capable insertion method — use the regular fallback
        // chain (which ends in clipboard+paste) with the complete text.
        this._typeText(finalText, () => {
          if (enableNotifications) {
            Main.notify(_('Voice Type Input'), _('Text typed successfully!'));
          }
        });
        return true;
      }

      if (typer.failed) {
        // Typing died partway through — leave the full text on the
        // clipboard so nothing is lost.
        this._fallbackToClipboard(finalText);
        return true;
      }

      this._lastTypeMethod = `stream:${typer.method}`;
      if (enableNotifications) {
        Main.notify(_('Voice Type Input'), _('Text typed successfully!'));
      }
      return true;
    }
```

- [ ] **Step 5: Add `_appendDebugChunk()`**

Add directly after `_appendDebugLine()` (line 951–964):

```js
    // Append streamed characters to the debug overlay without a newline,
    // so a streamed utterance renders as one growing line.
    _appendDebugChunk(chunk) {
      if (!this._debugLabel) this._ensureDebugWindow();
      if (!this._debugLabel) return;
      this._debugLabel.text = (this._debugLabel.text || '') + chunk;
    }
```

- [ ] **Step 6: Cancel the typer in `destroy()`**

In `destroy()` (line 854), after the `_clipboardRestoreTimeout` cleanup block, add:

```js
      // Cancel any in-progress streamed typing
      if (this._streamTyper) {
        this._streamTyper.cancel();
        this._streamTyper = null;
      }
```

- [ ] **Step 7: Validate**

Run: `./validate.sh && node -c extension.js`
Expected: all checks pass, no syntax errors.

- [ ] **Step 8: Commit**

```bash
git add extension.js
git commit -m "feat: stream transcription deltas into paced typing"
```

---

### Task 5: Preferences switch

**Files:**
- Modify: `prefs.js` (API Settings group, ~lines 36–122)

- [ ] **Step 1: Add the switch row**

In `fillPreferencesWindow()`, after the `modelRow` definition + its `changed` handler (lines 37–43) and **before** the `providerRow` definition (the provider handler references the new row), add:

```js
        // Stream transcription setting
        const streamRow = new Adw.SwitchRow({
            title: _('Stream Transcription'),
            subtitle: _('Type text as it arrives instead of all at once. Requires a streaming-capable endpoint (OpenAI: gpt-4o-transcribe models; not available with OpenRouter). Incompatible endpoints automatically fall back to non-streaming.'),
            active: settings.get_boolean('stream-transcription'),
            sensitive: currentProvider !== 'openrouter',
        });
        streamRow.connect('notify::active', () => {
            settings.set_boolean('stream-transcription', streamRow.get_active());
        });
```

- [ ] **Step 2: React to provider changes**

Inside the existing `providerRow.connect('notify::selected', ...)` callback, after `settings.set_string('api-provider', selected);`, add:

```js
            streamRow.set_sensitive(selected !== 'openrouter');
```

- [ ] **Step 3: Add the row to the group**

After the existing `apiGroup.add(modelRow);` line, add:

```js
        apiGroup.add(streamRow);
```

- [ ] **Step 4: Validate**

Run: `./validate.sh && node -c prefs.js`
Expected: all checks pass, no syntax errors.

- [ ] **Step 5: Visually check the dialog**

Run: `./dev.sh prefs`
Expected: "Stream Transcription" switch appears in API Settings; switching provider to OpenRouter greys it out; switching back re-enables it.

- [ ] **Step 6: Commit**

```bash
git add prefs.js
git commit -m "feat: add stream transcription preference"
```

---

### Task 6: Document the setting

**Files:**
- Modify: `README.md` (Configuration list, ~lines 54–62)

- [ ] **Step 1: Add a Configuration bullet**

In the README Configuration list, after the `**Model**` bullet, add:

```markdown
- **Stream transcription** — types text incrementally as the server transcribes (OpenAI-compatible SSE). Needs a streaming-capable endpoint (OpenAI: `gpt-4o-transcribe` models; not available with OpenRouter). Endpoints that reject streaming automatically fall back to a normal one-shot transcription.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document stream transcription setting"
```

---

### Task 7: Manual verification (nested shell)

No file changes — this task exercises the feature end-to-end per the spec's testing section. Requires a running talker instance (or other streaming-capable endpoint).

- [ ] **Step 1: Install and launch**

Run: `./dev.sh install` then `./dev.sh test`
Expected: nested/devkit GNOME Shell launches with the extension enabled.

- [ ] **Step 2: Streaming happy path (debug mode)**

In the nested shell: enable Debug Mode and Stream Transcription in prefs, set provider Custom + talker base URL, record a sentence.
Expected: debug overlay shows a `[stream]` line that grows smoothly as deltas arrive; "Text typed successfully!" notification after the last character.

- [ ] **Step 3: Streaming happy path (real typing)**

Disable Debug Mode, focus a text editor, record a sentence.
Expected: text appears smoothly (fast-typist pacing, not one burst); final text matches the spoken sentence.

- [ ] **Step 4: Auto-retry on incompatible endpoint**

Set provider OpenAI + model `whisper-1` (or point at a non-streaming server) with streaming ON, record a sentence.
Expected: transcription still succeeds (silently retried non-streaming); journal (`./dev.sh logs`) shows "Streaming unavailable, retrying without streaming" when debug logging is on.

- [ ] **Step 5: Streaming off — regression check**

Turn Stream Transcription OFF, record a sentence.
Expected: behavior identical to before this feature (text typed in one pass).

- [ ] **Step 6: OpenRouter gating**

In prefs select OpenRouter.
Expected: Stream Transcription switch is insensitive; transcription flow unchanged.
