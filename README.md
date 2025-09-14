# Voice Type Input - GNOME Extension

A GNOME Shell extension that provides voice-to-text input with an audio reactive microphone indicator in the top panel.

## Features

### 🎤 Audio Reactive Microphone Icon
- **Real-time audio level visualization** with animated bars that respond to voice volume
- **Recording state indication** with pulsing animation when actively recording
- **Progressive level indicators** with color-coded bars:
  - 🟢 Green: Low audio levels
  - 🟡 Yellow: Medium audio levels  
  - 🔴 Red: High audio levels

### 🔊 Smart Audio Processing
- **Automatic echo cancellation** for cleaner audio input
- **Noise suppression** to filter background sounds
- **Auto gain control** for consistent volume levels
- **Smooth audio level transitions** with optimized visual feedback

### 🎯 Interactive Controls
- **Click to toggle** recording directly from the panel icon
- **Menu integration** with start/stop voice input options
- **Visual feedback** throughout the recording process
- **Accessibility support** with reduced motion options

## Installation

### Prerequisites
- GNOME Shell 46 or compatible version
- Microphone access permissions
- Audio support (PulseAudio/PipeWire)

### Quick Install
```bash
# Clone the repository
git clone https://github.com/kevinchappell/gnome-voice-type-input.git
cd gnome-voice-type-input

# Install the extension
make install

# For testing in a safe nested session (recommended)
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

## Usage

### Starting Voice Input
1. **Click the microphone icon** in the top panel, or
2. **Use the menu** by right-clicking the icon and selecting "Start Voice Input"

### During Recording
- The microphone icon will **pulse with a red glow** to indicate active recording
- **Three audio level bars** will appear next to the icon showing real-time voice levels:
  - Bars animate based on your speaking volume
  - Higher volume activates more bars with increased opacity
  - Colors progress from green → yellow → red for different volume levels

### Stopping Recording
1. **Click the microphone icon again**, or
2. **Use the menu** and select "Stop Voice Input"

## Audio Reactive Behavior

The extension provides rich visual feedback during voice input:

### Recording States
- **Idle**: Standard microphone icon
- **Recording**: Pulsing red background with animated audio level bars
- **Processing**: Visual feedback while audio is being processed

### Audio Level Visualization
- **Bar 1 (Green)**: Activates at 10% audio level - indicates voice detection
- **Bar 2 (Yellow)**: Activates at 30% audio level - normal speaking volume  
- **Bar 3 (Red)**: Activates at 60% audio level - loud/peak volume

### Smooth Animations
- Level bars use smooth opacity transitions (100ms)
- Recording state transitions with CSS animations
- Reduced motion support for accessibility

## Development

This extension is built for GNOME 46 and uses modern ES6 modules.

### Development Script (Wayland Compatible)

The project includes a development script (`dev.sh`) that works on Wayland and allows you to install and refresh the extension without logging out:

```bash
# Install and enable the extension
./dev.sh install

# Quick reload during development (most useful)
./dev.sh reload

# Watch for file changes and auto-reload
./dev.sh watch

# Show GNOME Shell logs
./dev.sh logs

# Check extension status
./dev.sh status

# Disable/enable
./dev.sh disable
./dev.sh enable

# Uninstall
./dev.sh uninstall
```

Alternative ways to run the development commands:

```bash
# Using Make
make install
make reload
make watch
make logs

# Using npm scripts
npm run install
npm run reload
npm run dev    # same as watch
npm run logs
```

### Development Workflow

**For Wayland (Recommended):**

1. **Test in nested session** (this is the official recommended approach):
   ```bash
   ./dev.sh nested
   ```
   This opens a new GNOME Shell window where you can test the extension safely.

2. **Auto-test in nested session:**
   ```bash
   ./dev.sh test
   ```
   This automatically enables the extension in a nested session.

3. **During development with nested testing:**
   ```bash
   # Install the extension
   ./dev.sh install
   
   # Test in nested session
   ./dev.sh nested
   
   # Inside the nested session terminal:
   gnome-extensions enable voice-type-input@kevinchappell.github.io
   ```

**For X11 Sessions:**

1. **Initial setup:**
   ```bash
   ./dev.sh install
   ```

2. **During development:**
   ```bash
   ./dev.sh watch
   ```
   This will automatically reload the extension whenever you modify files.

3. **Manual reload when needed:**
   ```bash
   ./dev.sh reload
   ```

**General Development:**

4. **Monitor logs for debugging:**
   ```bash
   ./dev.sh logs
   ```

### Requirements for Development

- For file watching: `inotify-tools` package
  ```bash
  # Ubuntu/Debian
  sudo apt install inotify-tools
  
  # Fedora
  sudo dnf install inotify-tools
  
  # Arch
  sudo pacman -S inotify-tools
  ```

### File Structure

```
gnome-voice-type-input/
├── metadata.json      # Extension metadata and compatibility info
├── extension.js       # Main extension logic
├── stylesheet.css     # Custom styles for the extension
├── dev.sh            # Development script for Wayland
├── Makefile          # Make targets for development
├── package.json      # npm scripts for development
└── README.md         # This file
```

### Future Enhancements

- Integration with speech recognition services
- Customizable keyboard shortcuts
- Settings panel for configuration
- Multiple language support
- Voice command recognition

## License

This project is open source. Please check the repository for license details.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.
