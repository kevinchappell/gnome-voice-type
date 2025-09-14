import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
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
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.source = null;
        this.animationId = null;

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
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });

            // Set up audio context for level analysis
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.source = this.audioContext.createMediaStreamSource(stream);
            
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            this.source.connect(this.analyser);
            
            const bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(bufferLength);

            this.isRecording = true;
            this.setMicrophoneRecording(true);
            this.voiceMenuItem.label.text = _('Stop Voice Input');
            
            // Start audio level monitoring
            this._startAudioLevelMonitoring();

            Main.notify(_('Voice Type Input'), _('Recording started - speak now!'));
        } catch (error) {
            Main.notify(_('Voice Type Input'), _('Failed to access microphone: ') + error.message);
            console.error('Error accessing microphone:', error);
        }
    }

    _stopRecording() {
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.source?.mediaStream) {
            this.source.mediaStream.getTracks().forEach(track => track.stop());
        }

        this.isRecording = false;
        this.setMicrophoneRecording(false);
        this.voiceMenuItem.label.text = _('Start Voice Input');
        
        // Stop audio level monitoring
        this._stopAudioLevelMonitoring();

        Main.notify(_('Voice Type Input'), _('Recording stopped'));
    }

    _startAudioLevelMonitoring() {
        const updateLevels = () => {
            if (!this.isRecording || !this.analyser) {
                return;
            }

            this.analyser.getByteFrequencyData(this.dataArray);
            
            // Calculate average volume level
            let sum = 0;
            for (const value of this.dataArray) {
                sum += value;
            }
            const average = sum / this.dataArray.length;
            
            // Normalize to 0-1 range (0-255 -> 0-1)
            const normalizedLevel = Math.min(average / 128, 1);
            
            // Update visual indicators based on audio level
            this._updateAudioLevelBars(normalizedLevel);
            
            // Continue monitoring
            this.animationId = requestAnimationFrame(updateLevels);
        };

        updateLevels();
    }

    _stopAudioLevelMonitoring() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
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
        if (this.isRecording) {
            this._stopRecording();
        }
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
