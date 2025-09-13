# GNOME Voice Type Extension

A GNOME 46 extension that adds voice-to-text functionality to your desktop. Click the microphone icon to record your voice, and the transcribed text will be automatically inserted into the active window.

## Features

- **Voice Recording**: Click the microphone icon to start/stop recording
- **Speech-to-Text**: Automatically sends recorded audio to STT endpoint
- **Text Insertion**: Transcribed text is automatically typed into the active window
- **Visual Feedback**: Icon changes color during recording
- **WAV Format**: Records audio in WAV format for compatibility

## Requirements

- GNOME Shell 46+
- GStreamer 1.0 with pulseaudio support
- gst-launch-1.0 command available
- STT endpoint running at `http://localhost:8675/transcribe`

## Installation

### For X11 (Traditional Method)

1. Clone or download this repository
2. Copy the extension folder to `~/.local/share/gnome-shell/extensions/voice-type@gnome.org`
3. Restart GNOME Shell (Alt+F2, type 'r', press Enter)
4. Enable the extension through Extensions app or GNOME Tweaks

### For Wayland

**Wayland does not support the Alt+F2 restart method.** Use one of these alternatives:

#### Option 1: Log Out/In
1. Log out of your current session
2. Log back in
3. Enable the extension through Extensions app

#### Option 2: Use the install script
```bash
./install.sh
```
This script will handle the installation and prompt you to log out/in.

#### Option 3: GNOME Shell Extension Manager
1. Install GNOME Shell Extension Manager: `sudo apt install gnome-shell-extension-manager`
2. Use the GUI to install and enable extensions without restart

### Quick Install (Both X11 and Wayland)
```bash
./install.sh
```

**Note for Wayland users**: After running the install script, you **must** log out and log back in for the extension to be recognized.

## Usage

1. Click the microphone icon in the top panel to start recording
2. Speak clearly into your microphone
3. Click the microphone icon again to stop recording
4. The transcribed text will be automatically inserted into the active window

## Configuration

The extension expects a speech-to-text endpoint at `http://localhost:8675/transcribe` that accepts multipart/form-data with a WAV file and returns JSON with a `text` field.

## Development

The extension is written in JavaScript using GNOME Shell's extension framework.

### File Structure
- `metadata.json` - Extension metadata
- `extension.js` - Main extension entry point
- `src/extension.js` - Core microphone toggle and recording logic
- `src/stylesheet.css` - Custom styles
- `icons/` - SVG icons for both states

### Dependencies
- GObject introspection bindings for GStreamer
- Soup library for HTTP requests
- GLib for file operations

## License

MIT