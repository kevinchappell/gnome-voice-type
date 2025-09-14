# Voice Type Input - GNOME Extension

A GNOME Shell extension that adds a microphone icon to the top bar for voice input functionality.

## Features

- Microphone icon in the GNOME top bar
- Click to access voice input menu (future functionality)
- Visual feedback for active/inactive states
- Compatible with GNOME 46

## Installation

### Manual Installation

1. Clone or download this repository
2. Copy the extension folder to your GNOME extensions directory:
   ```bash
   cp -r gnome-voice-type-input ~/.local/share/gnome-shell/extensions/voice-type-input@kevinchappell.github.io
   ```
3. Restart GNOME Shell (press `Alt+F2`, type `r`, and press Enter)
4. Enable the extension using GNOME Extensions app or via command line:
   ```bash
   gnome-extensions enable voice-type-input@kevinchappell.github.io
   ```

### Using GNOME Extensions App

1. Open the GNOME Extensions application
2. Find "Voice Type Input" in the list
3. Toggle the switch to enable the extension

## Usage

- The microphone icon will appear in the top bar
- Click the icon to open the menu (functionality will be expanded in future versions)
- The icon will change appearance when voice input is active

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
