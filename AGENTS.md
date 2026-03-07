# AGENTS.md - Development Guide for AI Tools

This document provides guidance for AI development tools (like OpenAI's Codex, GitHub Copilot, OpenCode, etc.) working on the Voice Type Input GNOME Extension project.

## Project Overview

**Project Type**: GNOME Shell Extension  
**Primary Language**: JavaScript (ES6 modules)  
**Target Platform**: GNOME Shell 46+ (Wayland/X11)  
**Architecture**: Event-driven extension with GStreamer audio pipeline  
**Main Purpose**: Voice-to-text transcription with intelligent text insertion

## Key Files and Their Purposes

### Core Extension Files
- **`extension.js`** - Main extension logic, contains the `Indicator` class and extension lifecycle
- **`metadata.json`** - Extension metadata, version compatibility, and UUID definition
- **`prefs.js`** - Settings UI using Adwaita (Adw) components for user preferences
- **`stylesheet.css`** - Visual styling for recording states, animations, and debug window

### Configuration and Schema
- **`schemas/org.gnome.shell.extensions.voice-type-input.gschema.xml`** - GSettings schema for user preferences
- **Settings Keys**: `endpoint-url`, `recording-quality`, `recording-limit-seconds`, `debug-mode`, etc.

### Development Tools
- **`dev.sh`** - Primary development script with commands for install, reload, watch, nested testing
- **`Makefile`** - Make targets that wrap dev.sh commands
- **`package.json`** - npm scripts and project metadata
- **`validate.sh`** - Extension validation without starting GNOME Shell

## Architecture Overview

### Main Components

1. **Indicator Class** (`extension.js`)
   - Extends `PanelMenu.Button` 
   - Handles click events for recording toggle
   - Manages GStreamer audio pipeline
   - Controls text insertion methods

2. **Audio Pipeline** (GStreamer)
   - Records audio to temporary WAV files
   - Configurable quality: 8kHz/16kHz/44.1kHz
   - Auto-cleanup of temporary files

3. **Transcription API**
   - HTTP POST to `/transcribe` endpoint
   - Multipart file upload using Soup library
   - Expected JSON response: `{"text": "transcribed content"}`

4. **Text Insertion System**
   - Primary: `ydotool` for direct typing (Wayland-compatible)
   - Terminal detection with specialized paste methods
   - Clipboard fallback with user notification

### Key Libraries and APIs Used
- **GObject Introspection**: St, Clutter, Gio, GLib
- **GStreamer**: Audio recording pipeline
- **Soup**: HTTP client for API requests
- **D-Bus**: Media player control (MPRIS)
- **GSettings**: User preference storage

## Development Workflow

### Quick Start Commands
```bash
# Install and enable extension
./dev.sh install

# Auto-reload during development
./dev.sh watch

# Test safely on Wayland
./dev.sh nested

# View logs for debugging
./dev.sh logs

# Validate without GNOME Shell
./validate.sh
```

### Testing Strategy
1. **Nested sessions** for Wayland safety (`./dev.sh nested`)
2. **Debug mode** for transcription testing without text insertion
3. **File watching** for automatic reload during development
4. **Log monitoring** for runtime debugging

## Common Development Tasks

### Adding New Settings
1. Add key to `schemas/*.gschema.xml`
2. Compile schema: `glib-compile-schemas schemas`
3. Add UI element in `prefs.js` using Adw components
4. Access in `extension.js` via `this._settings.get_*('key-name')`

### Modifying Audio Pipeline
- Edit GStreamer pipeline string in `_startFileRecording()`
- Consider quality setting from `recording-quality` preference
- Ensure proper cleanup in error cases

### Changing Text Insertion Logic
- Primary method in `_tryTypeWithYdotool()`
- Terminal detection in `_isTerminalApplication()`
- Fallback handling in `_fallbackToClipboard()`

### Adding Visual Elements
- Styles in `stylesheet.css` with class names like `voice-type-input-*`
- Animation support with CSS keyframes
- Accessibility considerations (reduced motion support)

## Important Patterns and Conventions

### Error Handling
- Use try/catch blocks around async operations
- Log errors with `console.error()` for debugging
- Provide user feedback via notifications when enabled
- Graceful degradation when dependencies unavailable

### Resource Management
- Clean up GStreamer pipelines on stop/destroy
- Remove temporary files after transcription
- Disconnect signal handlers in destroy()
- Cancel timeouts and async operations

### Settings Integration
- All user preferences stored in GSettings schema
- Settings accessed via `this._settings.get_*()`
- UI updates should connect to setting changes
- Validate settings before use (URL format, ranges)

## Testing and Debugging

### Debug Mode Features
- Enable via preferences: `debug-mode` boolean setting
- Shows floating window instead of typing text
- Displays recording status and transcription results
- Safe for development and API testing

### Common Issues and Solutions
- **Extension not loading**: Check `./dev.sh debug` for validation errors
- **No transcription**: Verify API endpoint in settings, check logs
- **Text not inserting**: Install ydotool, check daemon status
- **Wayland issues**: Use nested sessions for safe testing

### Log Analysis
```bash
# Extension-specific logs
./dev.sh logs

# General GNOME Shell logs
journalctl -f /usr/bin/gnome-shell

# Settings inspection
gsettings list-recursively org.gnome.shell.extensions.voice-type-input
```

## API Integration

### Transcription Endpoint Requirements
- **Method**: HTTP POST to `${endpoint-url}/transcribe`
- **Content-Type**: `multipart/form-data`
- **File field**: `file` containing WAV audio
- **Response**: JSON with `text` field

### Example Integration
```javascript
// Extension sends:
POST /transcribe
Content-Type: multipart/form-data
file: [WAV audio data]

// Expected response:
{
  "text": "transcribed speech content"
}
```

## Security Considerations

- Temporary files created in system temp directory
- Automatic cleanup prevents audio file leakage
- Settings stored in user's GSettings (not world-readable)
- Network requests only to user-configured endpoints
- Media player control requires session D-Bus access

## Performance Notes

- File-based recording (not streaming) for compatibility
- Configurable quality settings balance speed vs accuracy
- Media muting reduces background noise for better results
- Short text uses direct typing, longer text uses clipboard

## Future Enhancement Areas

- Streaming audio support for real-time transcription
- Multiple language support via API parameters
- Custom keyboard shortcuts for recording
- Voice command recognition beyond transcription
- Integration with system speech settings

## Compatibility

- **GNOME Shell**: 46+
- **Display Servers**: Wayland (preferred), X11 
- **Audio Systems**: PulseAudio, PipeWire
- **Dependencies**: GStreamer, optional ydotool for Wayland typing

This guide should help AI development tools understand the project structure and make effective contributions while respecting the extension's architecture and GNOME Shell conventions.
