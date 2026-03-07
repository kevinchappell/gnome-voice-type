# Voice Type Input - GNOME Extension

A GNOME Shell extension that provides voice-to-text transcription with seamless text input for GNOME 46+ environments. Featuring an intuitive microphone indicator in the top panel with visual recording feedback and intelligent text insertion.

## Features

### 🎤 One-Click Voice Input
- **Click-to-record** microphone icon in the top panel
- **Visual recording feedback** with pulsing animation during active recording
- **Configurable recording time limits** (5-300 seconds) with automatic stop
- **Smart text insertion** using multiple fallback methods for maximum compatibility

### 🔊 Advanced Audio Processing
- **High-quality audio capture** using GStreamer with configurable quality settings (8kHz to 44.1kHz)
- **Automatic media muting** during recording to reduce background noise interference
- **Temporary file-based recording** with automatic cleanup after transcription
- **Multiple audio quality presets** to balance accuracy vs. bandwidth usage

### 🎯 Intelligent Text Integration
- **Direct typing simulation** using ydotool for Wayland compatibility
- **Enhanced terminal support** with specialized paste methods (Ctrl+Shift+V, middle-click)
- **Smart application detection** to choose optimal text insertion method
- **Clipboard fallback** with user notifications when direct typing fails
- **Debug mode** for testing and validation without affecting active applications

## Installation

### Prerequisites
- **GNOME Shell 46+** (Wayland or X11 session)
- **Speech-to-text API endpoint** (local or remote server)
- **Microphone access** permissions
- **Audio support** (PulseAudio/PipeWire)
- **Optional dependencies**:
  - `ydotool` for direct typing on Wayland (recommended)
  - `wtype` for enhanced text insertion
  - `inotify-tools` for development file watching

### Quick Install
```bash
# Clone the repository
git clone https://github.com/kevinchappell/gnome-voice-type-input.git
cd gnome-voice-type-input

# Install the extension
make install

# For testing in a safe nested session (recommended for Wayland)
make nested
```

### Manual Installation
```bash
# Create extension directory
mkdir -p ~/.local/share/gnome-shell/extensions/voice-type-input@kevinchappell.github.io

# Copy extension files
cp -r * ~/.local/share/gnome-shell/extensions/voice-type-input@kevinchappell.github.io/

# Enable extension (requires logout/restart on Wayland)
gnome-extensions enable voice-type-input@kevinchappell.github.io
```

## Configuration

### Required Setup
Before using the extension, configure your speech-to-text API endpoint:

1. **Open extension preferences**:
   ```bash
   ./dev.sh prefs
   # OR
   gnome-extensions prefs voice-type-input@kevinchappell.github.io
   ```

2. **Set API Endpoint URL**:
   - Enter your transcription service URL (e.g., `http://localhost:8675`)
   - The extension automatically appends `/transcribe` to this URL
   - Supports local servers (Whisper, OpenAI-compatible APIs) or remote services

3. **Configure recording settings**:
   - **Recording quality**: Low (8kHz), Medium (16kHz), High (44.1kHz)
   - **Time limit**: 5-300 seconds (default: 30 seconds)
   - **Media muting**: Auto-pause media players during recording
   - **Terminal support**: Enhanced paste methods for terminal apps

## Usage

### Basic Operation
1. **Click the microphone icon** in the top panel to start recording
2. **Speak clearly** - the icon will pulse red during recording
3. **Click again to stop** or wait for automatic timeout
4. **Text appears automatically** at the cursor position in the active application

### Recording Behavior
- **Visual feedback**: Pulsing red background indicates active recording
- **Automatic stop**: Recording stops after configured time limit
- **Background noise reduction**: Media players are automatically paused
- **Smart text insertion**: Uses optimal method based on target application

## Text Insertion Methods

The extension uses intelligent text insertion with multiple fallback methods:

### Primary Method: Direct Typing
- **ydotool**: Direct input simulation (recommended for Wayland)
- **Advantages**: Works in all applications, preserves formatting
- **Requirements**: `ydotool` package and daemon running

### Terminal Applications
- **Enhanced detection**: Automatically identifies terminal applications
- **Specialized paste methods**:
  - `Ctrl+Shift+V` for terminal paste
  - Middle-click for primary selection
  - Direct typing for short text

### Fallback: Clipboard
- **Automatic fallback**: When direct typing fails
- **Dual clipboard**: Sets both primary and clipboard selections
- **User notification**: Prompts to manually paste with `Ctrl+V`

### Debug Mode
- **Testing environment**: Displays transcribed text in overlay window
- **Development tool**: Verify transcription without affecting active apps
- **Method tracking**: Shows which insertion method was used

## Development

This extension is built for GNOME 46+ and uses modern ES6 modules with GStreamer for audio capture.

### Project Structure
```
gnome-voice-type-input/
├── extension.js       # Main extension logic with Indicator class
├── prefs.js          # Settings UI using Adwaita (Adw) components
├── metadata.json     # Extension metadata and GNOME Shell compatibility
├── stylesheet.css    # Custom styles for recording states and animations
├── dev.sh           # Development script for Wayland-compatible workflows
├── Makefile         # Make targets for common development tasks
├── package.json     # npm scripts and project metadata
├── validate.sh      # Extension validation without GNOME Shell
└── schemas/         # GSettings schema for user preferences
    └── org.gnome.shell.extensions.voice-type-input.gschema.xml
```

### Key Technologies
- **GObject Introspection**: St, Clutter, Gio, GLib integration
- **GStreamer**: High-quality audio recording with configurable pipelines
- **Soup**: HTTP multipart file uploads for transcription API calls
- **D-Bus**: Media player control and system integration
- **GSettings**: User preferences with compiled schema validation

### Development Workflow

**Quick Start:**
```bash
# Install dependencies (Ubuntu/Debian)
sudo apt install inotify-tools libglib2.0-dev ydotool

# Clone and setup
git clone https://github.com/kevinchappell/gnome-voice-type-input.git
cd gnome-voice-type-input

# Install extension
./dev.sh install

# Start development with auto-reload
./dev.sh watch
```

**Available Commands:**
```bash
# Development
./dev.sh install    # Install and enable extension
./dev.sh reload     # Quick reload during development
./dev.sh watch      # Auto-reload on file changes
./dev.sh nested     # Test in nested GNOME Shell (Wayland-safe)
./dev.sh test       # Auto-enable in nested session

# Debugging
./dev.sh logs       # Show GNOME Shell logs
./dev.sh status     # Check extension status
./dev.sh prefs      # Open preferences dialog
./dev.sh debug      # Detailed validation and troubleshooting

# Management
./dev.sh enable     # Enable extension
./dev.sh disable    # Disable extension
./dev.sh uninstall  # Remove extension
./dev.sh validate   # Validate without running GNOME Shell
```

**Make Targets (Alternative):**
```bash
make install   # Same as ./dev.sh install
make watch     # Same as ./dev.sh watch
make nested    # Same as ./dev.sh nested
make logs      # Same as ./dev.sh logs
```

**NPM Scripts (Alternative):**
```bash
npm run install    # ./dev.sh install
npm run dev        # ./dev.sh watch
npm run logs       # ./dev.sh logs
```

### Testing Workflows

**For Wayland (Recommended):**
```bash
# Test in safe nested session
./dev.sh nested
# Inside nested session: enable extension and test

# Auto-test with extension enabled
./dev.sh test
```

**For X11 Sessions:**
```bash
# Install and auto-reload during development
./dev.sh watch

# Manual reload when needed
./dev.sh reload
```

**Validation and Debugging:**
```bash
# Validate extension without starting GNOME Shell
./validate.sh

# Debug extension state and compatibility
./dev.sh debug

# Monitor real-time logs
./dev.sh logs
```

## API Requirements

### Speech-to-Text Endpoint
The extension requires a compatible transcription API endpoint that:

1. **Accepts HTTP POST** requests to `/transcribe` endpoint
2. **Supports multipart/form-data** file uploads with `file` field
3. **Returns JSON response** with `text` field containing transcribed text
4. **Audio format**: WAV files (configurable sample rates: 8kHz, 16kHz, 44.1kHz)

### Example API Response
```json
{
  "text": "Hello world, this is the transcribed text."
}
```

### Compatible Services
- **Local Whisper servers** (OpenAI Whisper, faster-whisper, whisper.cpp)
- **OpenAI-compatible APIs** with transcription endpoints
- **Custom transcription services** following the expected format
- **Self-hosted solutions** like Vosk, wav2vec2, or similar

### Example Local Setup
```bash
# Using faster-whisper server
pip install faster-whisper-server
faster-whisper-server --port 8675

# Configure extension endpoint to: http://localhost:8675
```

## Debug Mode

Enable Debug Mode from the extension preferences to test transcription without affecting active applications.

### Features
- **Floating overlay window** displays transcribed text instead of typing into active application
- **Status tracking** shows recording lifecycle events (`[info] Recording started`, `[info] Processing audio`)
- **Method verification** internally tracks which text insertion method would have been used
- **Safe testing** prevents unintended text insertion during development

### Usage
1. **Enable in preferences**: Open extension preferences and toggle "Debug Mode"
2. **Start recording**: Click microphone icon as normal
3. **View results**: Debug window appears showing transcribed text and status
4. **Disable when done**: Toggle off to resume normal text insertion

### When to Use
- **Testing transcription accuracy** without risking text insertion in important applications
- **Development and debugging** of the extension itself
- **Nested session testing** where normal typing might not work as expected
- **API endpoint validation** to verify transcription service is working

### CLI Toggle
```bash
# Enable debug mode
gsettings set org.gnome.shell.extensions.voice-type-input debug-mode true

# Disable debug mode  
gsettings set org.gnome.shell.extensions.voice-type-input debug-mode false

# Recompile schema if needed
glib-compile-schemas schemas
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

### Development Setup
1. **Fork the repository** on GitHub
2. **Clone your fork**: `git clone https://github.com/YOUR_USERNAME/gnome-voice-type-input.git`
3. **Create a feature branch**: `git checkout -b feature/your-feature-name`
4. **Make your changes** and test with `./dev.sh nested`
5. **Validate your changes**: `./validate.sh`
6. **Commit and push**: `git commit -m "Add your feature" && git push origin feature/your-feature-name`
7. **Submit a pull request** on GitHub

### Code Guidelines
- **Follow ES6 standards** for JavaScript code
- **Use GObject patterns** for GNOME Shell integration
- **Test in nested sessions** before submitting
- **Validate with provided scripts** (`./validate.sh`, `./dev.sh debug`)
- **Update documentation** for any new features or configuration options

### Reporting Issues
When reporting issues, please include:
- **GNOME Shell version**: `gnome-shell --version`
- **Extension logs**: Output from `./dev.sh logs`
- **System information**: OS, display server (Wayland/X11), audio system
- **Steps to reproduce** the issue
- **Expected vs actual behavior**
