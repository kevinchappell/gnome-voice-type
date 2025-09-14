import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Voice Type Input'));

        // Create container for the icon and audio level indicators
        this.container = new St.BoxLayout({
            style_class: 'voice-type-input-container',
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Create the microphone icon
        this.icon = new St.Icon({
            icon_name: 'audio-input-microphone-symbolic',
            style_class: 'system-status-icon voice-type-input-icon',
        });

        // Create audio level indicators (3 bars)
        this.levelBars = [];
        this.levelContainer = new St.BoxLayout({
            style_class: 'voice-level-container',
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
        });

        for (let i = 0; i < 3; i++) {
            const bar = new St.Widget({
                style_class: `voice-level-bar voice-level-bar-${i + 1}`,
                width: 2,
                height: 8 + (i * 2), // Progressive height: 8, 10, 12
                opacity: 0,
            });
            this.levelBars.push(bar);
            this.levelContainer.add_child(bar);
        }

        this.container.add_child(this.icon);
        this.container.add_child(this.levelContainer);
        this.add_child(this.container);

        // Audio recording state
        this.isRecording = false;
        this.simulationTimer = null;
        this.levelBarsAnimationId = null;

        // Connect click event to toggle recording
        this.connect('button-press-event', this._onClicked.bind(this));

        // Create a simple popup menu
        let item = new PopupMenu.PopupMenuItem(_('Start Voice Input'));
        this.voiceMenuItem = item;
        item.connect('activate', () => {
            this._toggleRecording();
        });
        this.menu.addMenuItem(item);

        // Add a separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Add settings item
        let settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
        settingsItem.connect('activate', () => {
            Main.notify(_('Voice Type Input'), _('Settings coming soon!'));
        });
        this.menu.addMenuItem(settingsItem);
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
            this.voiceMenuItem.label.text = _('Stop Voice Input');
            
            // Start simulated audio level monitoring
            this._startSimulatedAudioLevelMonitoring();

            Main.notify(_('Voice Type Input'), _('Recording started - speak now!'));
        } catch (error) {
            Main.notify(_('Voice Type Input'), _('Failed to start recording: ') + error.message);
            console.error('Error starting recording:', error);
        }
    }

    _stopRecording() {
        // Stop simulation timer
        if (this.simulationTimer) {
            GLib.source_remove(this.simulationTimer);
            this.simulationTimer = null;
        }

        this.isRecording = false;
        this.setMicrophoneRecording(false);
        this.voiceMenuItem.label.text = _('Start Voice Input');
        
        // Stop audio level monitoring
        this._stopSimulatedAudioLevelMonitoring();

        Main.notify(_('Voice Type Input'), _('Recording stopped'));
    }

    _startSimulatedAudioLevelMonitoring() {
        // Simulate realistic audio level variations
        let time = 0;
        const updateLevels = () => {
            if (!this.isRecording) {
                return GLib.SOURCE_REMOVE;
            }

            time += 0.1;
            
            // Create realistic audio level simulation with varying patterns
            // Base level with some randomness
            const baseLevel = 0.3 + (Math.sin(time * 2) * 0.2) + (Math.random() * 0.3);
            // Add speech-like variations
            const speechPattern = Math.sin(time * 8) * 0.4;
            // Occasional peaks for emphasis
            const peaks = Math.random() < 0.1 ? 0.5 : 0;
            
            const level = Math.max(0, Math.min(1, baseLevel + speechPattern + peaks));
            
            // Update visual indicators based on simulated audio level
            this._updateAudioLevelBars(level);
            
            return GLib.SOURCE_CONTINUE;
        };

        // Update every 100ms for smooth animation
        this.simulationTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, updateLevels);
    }

    _stopSimulatedAudioLevelMonitoring() {
        if (this.simulationTimer) {
            GLib.source_remove(this.simulationTimer);
            this.simulationTimer = null;
        }
        
        // Reset all bars to inactive state
        this.levelBars.forEach(bar => {
            bar.opacity = 0;
        });
    }

    _updateAudioLevelBars(level) {
        // Define thresholds for each bar (0.1, 0.3, 0.6)
        const thresholds = [0.1, 0.3, 0.6];
        
        this.levelBars.forEach((bar, index) => {
            const shouldBeActive = level > thresholds[index];
            const targetOpacity = shouldBeActive ? (0.5 + (level * 0.5)) : 0.1;
            
            // Smooth opacity transition
            bar.ease({
                opacity: targetOpacity,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT,
            });
        });
    }

    // Update microphone state visual
    setMicrophoneRecording(recording) {
        if (recording) {
            this.icon.style_class = 'system-status-icon voice-type-input-icon recording';
            this.levelContainer.opacity = 255;
        } else {
            this.icon.style_class = 'system-status-icon voice-type-input-icon';
            this.levelContainer.opacity = 0;
        }
    }

    // Legacy method for compatibility
    setMicrophoneActive(active) {
        this.setMicrophoneRecording(active);
    }

    destroy() {
        // Stop recording first
        if (this.isRecording) {
            this._stopRecording();
        }
        
        // Clear any timers
        if (this.simulationTimer) {
            GLib.source_remove(this.simulationTimer);
            this.simulationTimer = null;
        }
        
        // Clean up references
        this.levelBars = null;
        
        super.destroy();
    }
});

export default class VoiceTypeInputExtension extends Extension {
    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
