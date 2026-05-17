import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Secret from 'gi://Secret';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { PROVIDER_DEFAULTS } from './apiClient.js';

export default class VoiceTypeInputPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // Create a preferences page
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);

        // Create a preferences group for API settings
        const apiGroup = new Adw.PreferencesGroup({
            title: _('API Settings'),
            description: _('Configure the speech-to-text service'),
        });
        page.add(apiGroup);

        const currentProvider = this.getSettings().get_string('api-provider');

        // Endpoint URL setting
        const endpointRow = new Adw.EntryRow({
            title: _('Base URL'),
            text: this.getSettings().get_string('endpoint-url'),
            sensitive: currentProvider === 'custom',
        });
        const endpointChangedId = endpointRow.connect('changed', () => {
            this.getSettings().set_string('endpoint-url', endpointRow.get_text());
        });

        // Model setting
        const modelRow = new Adw.EntryRow({
            title: _('Model'),
            text: this.getSettings().get_string('api-model'),
        });
        const modelChangedId = modelRow.connect('changed', () => {
            this.getSettings().set_string('api-model', modelRow.get_text());
        });

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
        providerRow.set_selected(providerMap.indexOf(currentProvider) !== -1 ? providerMap.indexOf(currentProvider) : 2);

        providerRow.connect('notify::selected', () => {
            const selected = providerMap[providerRow.get_selected()];
            this.getSettings().set_string('api-provider', selected);

            const preset = PROVIDER_DEFAULTS[selected];
            if (preset.baseUrl) {
                endpointRow.block_signal_handler(endpointChangedId);
                endpointRow.set_text(preset.baseUrl);
                endpointRow.unblock_signal_handler(endpointChangedId);
                endpointRow.set_sensitive(false);
            } else {
                endpointRow.block_signal_handler(endpointChangedId);
                endpointRow.set_text(this.getSettings().get_string('endpoint-url'));
                endpointRow.unblock_signal_handler(endpointChangedId);
                endpointRow.set_sensitive(true);
            }
            modelRow.block_signal_handler(modelChangedId);
            if (selected === 'custom') {
                modelRow.set_text(this.getSettings().get_string('api-model'));
            } else {
                modelRow.set_text(preset.model);
                this.getSettings().set_string('api-model', preset.model);
            }
            modelRow.unblock_signal_handler(modelChangedId);
        });
        apiGroup.add(providerRow);

        apiGroup.add(endpointRow);

        // API Key setting (stored in Secret Service)
        const apiKeyRow = new Adw.PasswordEntryRow({
            title: _('API Key'),
            text: '',
            show_apply_button: true,
        });
        apiKeyRow.set_text(''); // Never show stored key
        apiKeyRow.connect('apply', () => {
            const key = apiKeyRow.get_text();
            const provider = this.getSettings().get_string('api-provider');
            try {
                const schema = new Secret.Schema(
                    'org.gnome.shell.extensions.voice-type-input',
                    Secret.SchemaFlags.NONE,
                    { 'key-type': Secret.SchemaAttributeType.STRING, 'provider': Secret.SchemaAttributeType.STRING }
                );
                if (key && key.length > 0) {
                    Secret.password_store_sync(
                        schema,
                        { 'key-type': 'api-key', 'provider': provider },
                        Secret.COLLECTION_DEFAULT,
                        'Voice Type Input API Key',
                        key,
                        null
                    );
                } else {
                    Secret.password_clear_sync(schema, { 'key-type': 'api-key', 'provider': provider }, null);
                }
                apiKeyRow.set_text(''); // Clear after save
            } catch (e) {
                console.error('Failed to store API key:', e.message);
            }
        });
        apiGroup.add(apiKeyRow);

        apiGroup.add(modelRow);

        // Create a preferences group for recording settings
        const recordingGroup = new Adw.PreferencesGroup({
            title: _('Recording Settings'),
            description: _('Configure audio recording options'),
        });
        page.add(recordingGroup);

        // Recording quality setting
        const qualityRow = new Adw.ComboRow({
            title: _('Recording Quality'),
            subtitle: _('Higher quality may improve accuracy but uses more bandwidth'),
        });

        const qualityModel = new Gtk.StringList();
        qualityModel.append(_('Low'));
        qualityModel.append(_('Medium'));
        qualityModel.append(_('High'));
        qualityRow.set_model(qualityModel);

        // Set current selection
        const currentQuality = this.getSettings().get_string('recording-quality');
        const qualityMap = { 'low': 0, 'medium': 1, 'high': 2 };
        qualityRow.set_selected(qualityMap[currentQuality] || 1);

        qualityRow.connect('notify::selected', () => {
            const selectedIndex = qualityRow.get_selected();
            const qualityValues = ['low', 'medium', 'high'];
            this.getSettings().set_string('recording-quality', qualityValues[selectedIndex]);
        });
        recordingGroup.add(qualityRow);

        // Recording time limit setting
        const timeLimitRow = new Adw.SpinRow({
            title: _('Recording Time Limit'),
            subtitle: _('Maximum recording duration in seconds'),
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 300,
                step_increment: 5,
                page_increment: 10,
                value: this.getSettings().get_int('recording-limit-seconds'),
            }),
        });
        timeLimitRow.connect('notify::value', () => {
            this.getSettings().set_int('recording-limit-seconds', timeLimitRow.get_value());
        });
        recordingGroup.add(timeLimitRow);

        // Create a preferences group for UI settings
        const uiGroup = new Adw.PreferencesGroup({
            title: _('Interface Settings'),
            description: _('Configure user interface options'),
        });
        page.add(uiGroup);

        // Notifications setting
        const notificationsRow = new Adw.SwitchRow({
            title: _('Enable Notifications'),
            subtitle: _('Show notifications for recording status and transcription results'),
            active: this.getSettings().get_boolean('enable-notifications'),
        });
        notificationsRow.connect('notify::active', () => {
            this.getSettings().set_boolean('enable-notifications', notificationsRow.get_active());
        });
        uiGroup.add(notificationsRow);

        // Enhanced terminal support setting
        const terminalSupportRow = new Adw.SwitchRow({
            title: _('Enhanced Terminal Support'),
            subtitle: _('Use specialized paste methods for terminal applications (recommended)'),
            active: this.getSettings().get_boolean('enhanced-terminal-support'),
        });
        terminalSupportRow.connect('notify::active', () => {
            this.getSettings().set_boolean('enhanced-terminal-support', terminalSupportRow.get_active());
        });
        uiGroup.add(terminalSupportRow);

        // Mute media during recording setting
        const muteMediaRow = new Adw.SwitchRow({
            title: _('Mute Media During Recording'),
            subtitle: _('Automatically pause playing media players to reduce background noise during voice recording'),
            active: this.getSettings().get_boolean('mute-media-during-recording'),
        });
        muteMediaRow.connect('notify::active', () => {
            this.getSettings().set_boolean('mute-media-during-recording', muteMediaRow.get_active());
        });
        uiGroup.add(muteMediaRow);

        // Auto-insert setting
        const autoInsertRow = new Adw.SwitchRow({
            title: _('Auto-Insert Text'),
            subtitle: _('Automatically type or paste transcribed text into the focused application. When disabled, text is only copied to the clipboard.'),
            active: this.getSettings().get_boolean('auto-insert'),
        });
        autoInsertRow.connect('notify::active', () => {
            this.getSettings().set_boolean('auto-insert', autoInsertRow.get_active());
        });
        uiGroup.add(autoInsertRow);

        // Keep clipboard after paste setting
        const keepClipboardRow = new Adw.SwitchRow({
            title: _('Keep Transcription on Clipboard'),
            subtitle: _('When auto-insert falls back to clipboard+paste, leave the transcribed text on the clipboard. When off, the previous clipboard text is restored (non-text clipboard contents such as images cannot be preserved).'),
            active: this.getSettings().get_boolean('keep-clipboard-after-paste'),
        });
        keepClipboardRow.connect('notify::active', () => {
            this.getSettings().set_boolean('keep-clipboard-after-paste', keepClipboardRow.get_active());
        });
        uiGroup.add(keepClipboardRow);

        // Debug mode setting
        const debugModeRow = new Adw.SwitchRow({
            title: _('Debug Mode'),
            subtitle: _('Show a test window to display and simulate typed transcription instead of sending it to the active application'),
            active: this.getSettings().get_boolean('debug-mode'),
        });
        debugModeRow.connect('notify::active', () => {
            this.getSettings().set_boolean('debug-mode', debugModeRow.get_active());
        });
        uiGroup.add(debugModeRow);

        // Create a preferences group for keyboard shortcuts
        const shortcutGroup = new Adw.PreferencesGroup({
            title: _('Keyboard Shortcut'),
            description: _('Configure a keyboard shortcut to toggle voice recording'),
        });
        page.add(shortcutGroup);

        // Toggle recording shortcut
        const shortcutRow = new Adw.ActionRow({
            title: _('Toggle Recording'),
            subtitle: _('Press the shortcut key combination to start/stop recording'),
        });

        const currentShortcuts = this.getSettings().get_strv('toggle-recording-shortcut');
        const shortcutLabel = new Gtk.ShortcutLabel({
            accelerator: currentShortcuts.length > 0 ? currentShortcuts[0] : '',
            disabled_text: _('Disabled'),
            valign: Gtk.Align.CENTER,
        });

        const editButton = new Gtk.Button({
            label: _('Set'),
            valign: Gtk.Align.CENTER,
        });

        const clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Clear shortcut'),
        });

        clearButton.connect('clicked', () => {
            this.getSettings().set_strv('toggle-recording-shortcut', []);
            shortcutLabel.set_accelerator('');
        });

        editButton.connect('clicked', () => {
            const dialog = new Gtk.Dialog({
                title: _('Set Shortcut'),
                modal: true,
                transient_for: window,
                default_width: 400,
                default_height: 200,
            });

            const contentArea = dialog.get_content_area();
            contentArea.set_spacing(12);
            contentArea.append(new Gtk.Label({
                label: _('Press the desired key combination for toggling voice recording.\n\nPress Escape to cancel or Backspace to disable the shortcut.'),
                wrap: true,
                margin_top: 20,
                margin_start: 20,
                margin_end: 20,
            }));

            const controller = new Gtk.EventControllerKey();
            controller.connect('key-pressed', (_ctrl, keyval, keycode, state) => {
                // Filter out modifier-only presses
                const modifiers = state & Gtk.accelerator_get_default_mod_mask();

                if (keyval === Gtk.accelerator_name_with_keycode(null, keyval, keycode, 0) === 'Escape' || keyval === 0xff1b) {
                    dialog.close();
                    return true;
                }

                if (keyval === 0xff08) { // Backspace - disable shortcut
                    this.getSettings().set_strv('toggle-recording-shortcut', []);
                    shortcutLabel.set_accelerator('');
                    dialog.close();
                    return true;
                }

                // Require at least one modifier for the shortcut
                if (modifiers === 0) return true;

                const accel = Gtk.accelerator_name(keyval, modifiers);
                if (accel) {
                    this.getSettings().set_strv('toggle-recording-shortcut', [accel]);
                    shortcutLabel.set_accelerator(accel);
                    dialog.close();
                }
                return true;
            });

            dialog.add_controller(controller);
            dialog.present();
        });

        shortcutRow.add_suffix(shortcutLabel);
        shortcutRow.add_suffix(editButton);
        shortcutRow.add_suffix(clearButton);
        shortcutGroup.add(shortcutRow);

        // Create an info group with usage instructions
        const infoGroup = new Adw.PreferencesGroup({
            title: _('Usage'),
            description: _('How to use Voice Type Input'),
        });
        page.add(infoGroup);

        const usageRow = new Adw.ActionRow({
            title: _('Instructions'),
            subtitle: _('Click the microphone icon in the top panel or use the keyboard shortcut to start/stop recording. Recording will automatically stop after the time limit. Transcribed text will be automatically typed at the cursor position.'),
        });
        infoGroup.add(usageRow);

        const endpointInfoRow = new Adw.ActionRow({
            title: _('Endpoint Format'),
            subtitle: _('For OpenAI and OpenRouter, the base URL is set automatically. For Custom, enter your base URL (e.g., http://localhost:8675). The extension appends the transcription path automatically.'),
        });
        infoGroup.add(endpointInfoRow);

        const timeLimitInfoRow = new Adw.ActionRow({
            title: _('Recording Limit'),
            subtitle: _('Set between 5-300 seconds. Longer recordings may use more memory and bandwidth.'),
        });
        infoGroup.add(timeLimitInfoRow);

        const terminalInfoRow = new Adw.ActionRow({
            title: _('Terminal Support'),
            subtitle: _('Enhanced terminal support detects terminal applications and uses Ctrl+Shift+V, middle-click, or direct typing for better compatibility.'),
        });
        infoGroup.add(terminalInfoRow);

        const mediaMuteInfoRow = new Adw.ActionRow({
            title: _('Media Muting'),
            subtitle: _('When enabled, playing media players are automatically paused during recording to reduce background noise and improve transcription accuracy.'),
        });
        infoGroup.add(mediaMuteInfoRow);
    }
}
