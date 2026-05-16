# Configurable OpenAI-Compatible Transcription Endpoint

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider presets (OpenAI, OpenRouter, Custom), API key support via Secret Service, and a configurable model field to the Voice Type Input GNOME Extension.

**Architecture:** Extract transcription logic into a new `apiClient.js` module that handles URL construction, Secret Service key retrieval, and Soup HTTP requests. Update `prefs.js` with a provider dropdown and conditional UI. Update `extension.js` to delegate transcription to `ApiClient`.

**Tech Stack:** GNOME Shell Extension (GJS), GSettings, libsecret (Secret Service), Soup 3, Adwaita (Adw) preferences UI.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `schemas/org.gnome.shell.extensions.voice-type-input.gschema.xml` | Modify | Add `api-provider` and `api-model` keys |
| `apiClient.js` | Create | URL building, secret key retrieval, Soup HTTP request |
| `extension.js` | Modify | Replace inline `_transcribeAudio` with `ApiClient` usage |
| `prefs.js` | Modify | Add provider dropdown, API key field, model field, provider-switching logic |
| `metadata.json` | No change | — |
| `stylesheet.css` | No change | — |

---

## Chunk 1: Schema and Data Layer

### Task 1: Update GSettings Schema

**Files:**
- Modify: `schemas/org.gnome.shell.extensions.voice-type-input.gschema.xml`

- [ ] **Step 1: Add `api-provider` key after `endpoint-url`**

```xml
    <key name="api-provider" type="s">
      <default>'custom'</default>
      <summary>API provider</summary>
      <description>API provider preset: openai, openrouter, or custom</description>
    </key>
```

- [ ] **Step 2: Add `api-model` key after `api-provider`**

```xml
    <key name="api-model" type="s">
      <default>'whisper-1'</default>
      <summary>Transcription model</summary>
      <description>Model name sent to the transcription API</description>
    </key>
```

- [ ] **Step 3: Compile schema**

Run: `glib-compile-schemas schemas/`
Expected: No output (success).

- [ ] **Step 4: Commit**

```bash
git add schemas/org.gnome.shell.extensions.voice-type-input.gschema.xml
git commit -m "feat(settings): add api-provider and api-model keys"
```

---

### Task 2: Create apiClient.js

**Files:**
- Create: `apiClient.js`

- [ ] **Step 1: Create file with imports and URL builder**

```javascript
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Secret from 'gi://Secret';
import Soup from 'gi://Soup';

/**
 * Build the full transcription URL from a base URL.
 * Handles trailing slashes and optional /v1 suffix.
 */
function buildTranscriptionUrl(baseUrl) {
    const normalized = baseUrl.replace(/\/+$/, '');
    if (normalized.endsWith('/v1')) {
        return `${normalized}/audio/transcriptions`;
    }
    return `${normalized}/v1/audio/transcriptions`;
}
```

- [ ] **Step 2: Add provider defaults and factory method**

```javascript
const PROVIDER_DEFAULTS = {
    openai: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'whisper-1',
    },
    openrouter: {
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openai/whisper-1',
    },
    custom: {
        baseUrl: null,
        model: 'whisper-1',
    },
};

export default class ApiClient {
    constructor(baseUrl, model) {
        this.baseUrl = baseUrl;
        this.model = model || 'whisper-1';
    }

    static forProvider(provider, customBaseUrl, customModel) {
        const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.custom;
        const baseUrl = defaults.baseUrl || customBaseUrl;
        const model = customModel || defaults.model;
        return new ApiClient(baseUrl, model);
    }
```

- [ ] **Step 3: Add Secret Service key retrieval**

```javascript
    /**
     * Retrieve the API key from Secret Service (GNOME Keyring).
     * Returns null if no key is found or Secret Service is unavailable.
     */
    _getApiKey() {
        try {
            const schema = new Secret.Schema(
                'org.gnome.shell.extensions.voice-type-input',
                Secret.SchemaFlags.NONE,
                { 'key-type': Secret.SchemaAttributeType.STRING }
            );
            const key = Secret.password_lookup_sync(schema, { 'key-type': 'api-key' }, null);
            return key || null;
        } catch (e) {
            console.warn('Voice Type Input: Secret Service unavailable, proceeding without auth:', e.message);
            return null;
        }
    }
```

- [ ] **Step 4: Add transcription method with Soup HTTP request**

```javascript
    /**
     * Transcribe a WAV audio file using the configured endpoint.
     * @param {string} tempFile - Path to the WAV file
     * @returns {Promise<string>} - The transcribed text
     */
    async transcribe(tempFile) {
        const file = Gio.File.new_for_path(tempFile);
        if (!file.query_exists(null)) {
            throw new Error('Audio file not found');
        }

        const fileInfo = file.query_info('standard::*', Gio.FileQueryInfoFlags.NONE, null);
        const [success, fileContent] = file.load_contents(null);
        if (!success) {
            throw new Error('Failed to load audio file');
        }

        const fullUrl = buildTranscriptionUrl(this.baseUrl);
        const apiKey = this._getApiKey();

        const multipart = Soup.Multipart.new('multipart/form-data');
        multipart.append_form_file('file', fileInfo.get_name(), 'audio/wav', fileContent);
        multipart.append_form_string('model', this.model);
        multipart.append_form_string('response_format', 'json');

        const message = Soup.Message.new_from_multipart(fullUrl, multipart);
        message.request_headers.append('accept', 'application/json');
        if (apiKey) {
            message.request_headers.append('Authorization', `Bearer ${apiKey}`);
        }

        const session = Soup.Session.new();
        const json = await new Promise((resolve, reject) => {
            session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
                try {
                    const bytes = sess.send_and_read_finish(res);
                    const statusCode = message.get_status();
                    if (statusCode >= 200 && statusCode < 300) {
                        const decoder = new TextDecoder('utf-8');
                        const bodyText = decoder.decode(bytes.get_data());
                        try {
                            resolve(JSON.parse(bodyText));
                        } catch (e) {
                            console.debug('JSON parse failed:', e.message);
                            reject(new Error('Invalid JSON response'));
                        }
                    } else {
                        const decoder = new TextDecoder('utf-8');
                        const bodyText = decoder.decode(bytes.get_data());
                        reject(new Error(`HTTP ${statusCode}: ${bodyText || 'Request failed'}`));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        });

        session.abort();

        if (!json.text) {
            return null;
        }
        return json.text.trim();
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add apiClient.js
git commit -m "feat(api): create ApiClient with URL builder, secret key retrieval, and transcription"
```

---

## Chunk 2: Extension Logic

### Task 3: Refactor extension.js to use ApiClient

**Files:**
- Modify: `extension.js`

- [ ] **Step 1: Add import for ApiClient**

At the top of `extension.js`, after existing imports, add:

```javascript
import ApiClient from './apiClient.js';
```

- [ ] **Step 2: Replace `_transcribeAudio` method**

Find the existing `_transcribeAudio` method (lines ~230–309) and replace it entirely with:

```javascript
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
            console.error('Transcription error:', error);
        } finally {
            this._cleanupTempFile();
        }
    }
```

- [ ] **Step 3: Verify no old variables are referenced and clean up imports**

Check that `endpointUrl` and `fullUrl` are no longer used anywhere else in `extension.js`. Remove any stale references. Also remove the `Soup` import from `extension.js` since HTTP logic now lives in `apiClient.js`.

- [ ] **Step 4: Commit**

```bash
git add extension.js
git commit -m "refactor(extension): delegate transcription to ApiClient"
```

---

## Chunk 3: Preferences UI

### Task 4: Update prefs.js with provider, key, and model fields

**Files:**
- Modify: `prefs.js`

- [ ] **Step 1: Add Secret import**

At the top of `prefs.js`, after the existing imports, add:

```javascript
import Secret from 'gi://Secret';
```

- [ ] **Step 2: Add provider preset definitions and helper**

At the top of the `fillPreferencesWindow` method, after the `page` creation, add:

```javascript
        const PROVIDER_PRESETS = {
            openai: { baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' },
            openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/whisper-1' },
            custom: { baseUrl: null, model: 'whisper-1' },
        };
```

- [ ] **Step 3: Add provider ComboRow**

Inside the `apiGroup`, before the `endpointRow`, add:

```javascript
        // Provider preset
        const providerRow = new Adw.ComboRow({
            title: _('Provider'),
            subtitle: _('Select a preset or use custom settings'),
        });
        const providerModel = new Gtk.StringList();
        providerModel.append(_('OpenAI'));
        providerModel.append(_('OpenRouter'));
        providerModel.append(_('Custom'));
        providerRow.set_model(providerModel);

        const providerMap = ['openai', 'openrouter', 'custom'];
        const currentProvider = this.getSettings().get_string('api-provider');
        providerRow.set_selected(providerMap.indexOf(currentProvider) !== -1 ? providerMap.indexOf(currentProvider) : 2);

        providerRow.connect('notify::selected', () => {
            const selected = providerMap[providerRow.get_selected()];
            this.getSettings().set_string('api-provider', selected);

            const preset = PROVIDER_PRESETS[selected];
            if (preset.baseUrl) {
                this.getSettings().set_string('endpoint-url', preset.baseUrl);
                endpointRow.set_text(preset.baseUrl);
                endpointRow.set_sensitive(false);
            } else {
                endpointRow.set_sensitive(true);
            }
            if (preset.model) {
                this.getSettings().set_string('api-model', preset.model);
                modelRow.set_text(preset.model);
            }
        });
        apiGroup.add(providerRow);
```

- [ ] **Step 4: Make endpointRow conditionally sensitive**

Update the existing `endpointRow` creation to set sensitivity based on provider:

```javascript
        // Endpoint URL setting
        const endpointRow = new Adw.EntryRow({
            title: _('Base URL'),
            text: this.getSettings().get_string('endpoint-url'),
            sensitive: currentProvider === 'custom',
        });
        endpointRow.connect('changed', () => {
            this.getSettings().set_string('endpoint-url', endpointRow.get_text());
        });
        apiGroup.add(endpointRow);
```

- [ ] **Step 5: Add API key field with Secret Service storage**

After `endpointRow`, add:

```javascript
        // API Key setting (stored in Secret Service)
        const apiKeyRow = new Adw.PasswordEntryRow({
            title: _('API Key'),
            text: '',
            show-apply-button: true,
        });
        apiKeyRow.set_text(''); // Never show stored key
        apiKeyRow.connect('apply', () => {
            const key = apiKeyRow.get_text();
            try {
                const schema = new Secret.Schema(
                    'org.gnome.shell.extensions.voice-type-input',
                    Secret.SchemaFlags.NONE,
                    { 'key-type': Secret.SchemaAttributeType.STRING }
                );
                if (key && key.length > 0) {
                    Secret.password_store_sync(
                        schema,
                        { 'key-type': 'api-key' },
                        Secret.COLLECTION_DEFAULT,
                        'Voice Type Input API Key',
                        key,
                        null
                    );
                } else {
                    Secret.password_clear_sync(schema, { 'key-type': 'api-key' }, null);
                }
                apiKeyRow.set_text(''); // Clear after save
            } catch (e) {
                console.error('Failed to store API key:', e.message);
            }
        });
        apiGroup.add(apiKeyRow);
```

- [ ] **Step 6: Add model field**

After `apiKeyRow`, add:

```javascript
        // Model setting
        const modelRow = new Adw.EntryRow({
            title: _('Model'),
            text: this.getSettings().get_string('api-model'),
        });
        modelRow.connect('changed', () => {
            this.getSettings().set_string('api-model', modelRow.get_text());
        });
        apiGroup.add(modelRow);
```

- [ ] **Step 7: Update info rows**

Update the `endpointInfoRow` subtitle to:

```javascript
            subtitle: _('For OpenAI and OpenRouter, the base URL is set automatically. For Custom, enter your base URL (e.g., http://localhost:8675). The extension appends the transcription path automatically.'),
```

- [ ] **Step 8: Commit**

```bash
git add prefs.js
git commit -m "feat(prefs): add provider dropdown, API key, and model fields"
```

---

## Chunk 4: Validation and Testing

### Task 5: Validate Extension

**Files:**
- All modified files

- [ ] **Step 1: Run validation script**

Run: `./validate.sh`
Expected: No errors, extension passes validation.

- [ ] **Step 2: Compile schema again**

Run: `glib-compile-schemas schemas/`
Expected: No output.

- [ ] **Step 3: Install extension**

Run: `./dev.sh install`
Expected: Extension installs successfully.

- [ ] **Step 4: Enable and test**

Run: `./dev.sh logs` in one terminal, then enable the extension in GNOME Tweaks or via:
`gnome-extensions enable voice-type-input@kevinchappell.github.io`

Check logs for any import errors or runtime issues.

- [ ] **Step 5: Test provider switching**

Open the extension preferences.
- Switch to "OpenAI" — verify Base URL becomes `https://api.openai.com/v1` and is read-only.
- Switch to "OpenRouter" — verify Base URL becomes `https://openrouter.ai/api/v1` and Model becomes `openai/whisper-1`.
- Switch to "Custom" — verify Base URL is editable.

- [ ] **Step 6: Test API key storage**

In preferences, enter a fake API key in the API Key field and press Enter.
Verify no crash. Check with:
`secret-tool lookup key-type api-key`
(If `secret-tool` is unavailable, verify via logs that Secret Service is used.)

- [ ] **Step 7: Test debug mode**

Enable debug mode in preferences.
Click the microphone icon, speak (or let it timeout), and verify the debug window shows transcribed text (or an error if no endpoint is running).

- [ ] **Step 8: Commit final changes**

```bash
git add -A
git commit -m "feat: configurable openai-compatible transcription endpoint

- Add provider presets: OpenAI, OpenRouter, Custom
- Store API key in Secret Service (GNOME Keyring)
- Add configurable model field
- Extract transcription logic into apiClient.js
- Update prefs UI with provider dropdown and conditional fields"
```

---

## Notes for Implementer

- The `Adw.PasswordEntryRow` may not exist in older Adwaita versions. If it causes issues, fallback to `Gtk.PasswordEntry` inside an `Adw.ActionRow`.
- `Secret.password_lookup_sync` and `Secret.password_store_sync` are synchronous and may block briefly. In GNOME Shell's main thread this is acceptable for a one-time settings save, but avoid calling them frequently.
- The `ApiClient` is instantiated per-transcription. If performance becomes an issue, the `Soup.Session` could be cached, but for now we recreate it per-request (matching existing behavior).
- The existing `endpoint-url` setting is reused for Custom provider base URLs. Its default remains `http://localhost:8675` for backward compatibility.
