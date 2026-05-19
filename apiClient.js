import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

// Conditionally load Secret - if unavailable, auth will be skipped
let _secret = null;
try {
    _secret = (await import('gi://Secret')).default;
} catch (_e) {
    _secret = null;
}

// Base URL is expected to already include the API version (e.g. ".../v1"),
// matching what OpenAI and OpenRouter publish in their docs. The extension
// only appends the resource path.
function buildTranscriptionUrl(baseUrl) {
    return `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;
}

export const PROVIDER_DEFAULTS = {
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
    constructor(baseUrl, model, provider) {
        if (!baseUrl) {
            throw new Error('baseUrl is required. Provide a customBaseUrl for custom provider.');
        }
        this.baseUrl = baseUrl;
        this.model = model || 'whisper-1';
        this.provider = provider || 'custom';
    }

    static forProvider(provider, customBaseUrl, customModel) {
        const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.custom;
        const baseUrl = defaults.baseUrl || customBaseUrl;
        const model = customModel || defaults.model;
        return new ApiClient(baseUrl, model, provider);
    }

    /**
     * Retrieve the API key from Secret Service (GNOME Keyring).
     * Returns null if no key is found or Secret Service is unavailable.
     */
    _getApiKey() {
        if (!_secret) return null;
        try {
            const schema = new _secret.Schema(
                'org.gnome.shell.extensions.voice-type-input',
                _secret.SchemaFlags.NONE,
                { 'key-type': _secret.SchemaAttributeType.STRING, 'provider': _secret.SchemaAttributeType.STRING }
            );
            const key = _secret.password_lookup_sync(schema, { 'key-type': 'api-key', 'provider': this.provider }, null);
            return key || null;
        } catch (_e) {
            return null;
        }
    }

    _loadAudioFile(tempFile) {
        const file = Gio.File.new_for_path(tempFile);

        return new Promise((resolve, reject) => {
            file.load_contents_async(null, (source, result) => {
                try {
                    const [success, contents] = source.load_contents_finish(result);
                    if (!success) {
                        reject(new Error('Failed to load audio file'));
                        return;
                    }
                    resolve(contents);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     * Transcribe a WAV audio file using the configured endpoint.
     * @param {string} tempFile - Path to the WAV file
     * @returns {Promise<string|null>} - The transcribed text, or null if no speech detected
     */
    async transcribe(tempFile) {
        const fileContent = await this._loadAudioFile(tempFile);

        const fullUrl = buildTranscriptionUrl(this.baseUrl);
        const apiKey = this._getApiKey();

        let message;
        if (this.provider === 'openrouter') {
            // OpenRouter uses JSON with base64-encoded audio, not multipart.
            const bytes = fileContent instanceof GLib.Bytes ? fileContent.get_data() : fileContent;
            const base64 = GLib.base64_encode(bytes);
            const body = JSON.stringify({
                model: this.model,
                input_audio: { data: base64, format: 'wav' },
            });
            message = Soup.Message.new('POST', fullUrl);
            message.set_request_body_from_bytes(
                'application/json',
                new GLib.Bytes(new TextEncoder().encode(body))
            );
        } else {
            const multipart = Soup.Multipart.new('multipart/form-data');
            multipart.append_form_file('file', GLib.path_get_basename(tempFile), 'audio/wav', fileContent);
            multipart.append_form_string('model', this.model);
            multipart.append_form_string('response_format', 'json');
            message = Soup.Message.new_from_multipart(fullUrl, multipart);
        }
        message.request_headers.append('accept', 'application/json');
        if (apiKey) {
            message.request_headers.append('Authorization', `Bearer ${apiKey}`);
        }

        const session = Soup.Session.new();
        session.set_timeout(120);

        let json;
        try {
            json = await new Promise((resolve, reject) => {
                session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
                    try {
                        const bytes = sess.send_and_read_finish(res);
                        const statusCode = message.get_status();
                        const decoder = new TextDecoder('utf-8');
                        const bodyText = decoder.decode(bytes.get_data());
                        if (statusCode >= 200 && statusCode < 300) {
                            try {
                                resolve(JSON.parse(bodyText));
                            } catch (_e) {
                                reject(new Error('Invalid JSON response'));
                            }
                        } else {
                            reject(new Error(`HTTP ${statusCode}: ${bodyText || 'Request failed'}`));
                        }
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        } finally {
            session.abort();
        }

        if (!json.text) {
            return null;
        }
        return json.text.trim();
    }
}
