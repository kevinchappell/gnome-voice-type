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

        // Create an info group with usage instructions
        const infoGroup = new Adw.PreferencesGroup({
            title: _('Usage'),
            description: _('How to use Voice Type Input'),
        });
        page.add(infoGroup);

        const usageRow = new Adw.ActionRow({
            title: _('Instructions'),
            subtitle: _('Click the microphone icon in the top panel to start/stop recording. Transcribed text will be automatically typed at the cursor position.'),
        });
        infoGroup.add(usageRow);

        const endpointInfoRow = new Adw.ActionRow({
            title: _('Endpoint Format'),
            subtitle: _('Enter the base URL (e.g., http://localhost:8675). The extension will automatically append "/transcribe" to this URL.'),
        });
        infoGroup.add(endpointInfoRow);
    }
}
