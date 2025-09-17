import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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

        // Endpoint URL setting
        const endpointRow = new Adw.EntryRow({
            title: _('Endpoint URL'),
            text: this.getSettings().get_string('endpoint-url'),
        });
        endpointRow.connect('changed', () => {
            this.getSettings().set_string('endpoint-url', endpointRow.get_text());
        });
        apiGroup.add(endpointRow);

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

        // Create an info group with usage instructions
        const infoGroup = new Adw.PreferencesGroup({
            title: _('Usage'),
            description: _('How to use Voice Type Input'),
        });
        page.add(infoGroup);

        const usageRow = new Adw.ActionRow({
            title: _('Instructions'),
            subtitle: _('Click the microphone icon in the top panel to start/stop recording. Recording will automatically stop after the time limit. Transcribed text will be automatically typed at the cursor position.'),
        });
        infoGroup.add(usageRow);

        const endpointInfoRow = new Adw.ActionRow({
            title: _('Endpoint Format'),
            subtitle: _('Enter the base URL (e.g., http://localhost:8675). The extension will automatically append "/transcribe" to this URL.'),
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
    }
}
