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

    /**
     * Transcribe a WAV audio file using the configured endpoint.
     * @param {string} tempFile - Path to the WAV file
     * @returns {Promise<string|null>} - The transcribed text, or null if no speech detected
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
