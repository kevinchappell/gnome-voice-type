# GNOME Voice Type Extension - Development Guide

## 🚀 Quick Development Setup

The traditional Wayland development workflow (logout/login) is painful. Here are better approaches:

### Method 1: Auto-reload on file changes (Recommended)
```bash
# Start the file watcher - it will auto-reload when you save files
./watch-and-reload.sh
```

This script:
- Watches your source files for changes
- Automatically copies files to the extension directory
- Disables and re-enables the extension (no logout needed!)
- Shows logs in real-time

### Method 2: Manual quick-reload
```bash
# Use the development tools for manual control
./dev-tools.sh quick-reload  # After making changes
./dev-tools.sh logs           # View logs
./dev-tools.sh test           # Test components
```

### Method 3: Extension Manager GUI
Install GNOME Shell Extension Manager:
```bash
sudo apt install gnome-shell-extension-manager  # Ubuntu/Debian
sudo dnf install gnome-shell-extension-manager  # Fedora
```

Then use the GUI to disable/enable extensions without logout.

## 🛠️ Development Tools

### Available Commands
```bash
./dev-tools.sh install      # Install extension
./dev-tools.sh enable       # Enable extension
./dev-tools.sh disable      # Disable extension
./dev-tools.sh quick-reload # Quick reload (disable + enable)
./dev-tools.sh restart      # Restart GNOME Shell (X11 only)
./dev-tools.sh logs         # Show extension logs
./dev-tools.sh test         # Test extension components
./dev-tools.sh dev-setup    # Initial development setup
./dev-tools.sh test-record  # Test audio recording
./dev-tools.sh monitor      # Monitor extension status
```

### File Watcher (Best for Wayland)
```bash
./watch-and-reload.sh       # Auto-reload on file changes
```

## 🔍 Testing Workflow

### 1. Initial Setup
```bash
# Set up development environment
./dev-tools.sh dev-setup

# Start file watcher for auto-reload
./watch-and-reload.sh
```

### 2. Make Changes
Edit your files normally. The watcher will automatically:
- Detect file changes
- Copy files to extension directory
- Reload the extension
- Show you the logs

### 3. Test Components
```bash
# Test syntax and dependencies
./dev-tools.sh test

# Test audio recording
./dev-tools.sh test-record

# Test STT endpoint
./test-stt.sh
```

### 4. Monitor Logs
```bash
# View extension logs
./dev-tools.sh logs

# Monitor extension status
./dev-tools.sh monitor
```

## 🐛 Debugging Tips

### View Extension Logs
```bash
# Real-time logs
./dev-tools.sh logs

# Recent logs only
journalctl -n 50 /usr/bin/gnome-shell | grep -i voice
```

### Common Issues

1. **Extension not loading**: Check syntax with `./dev-tools.sh test`
2. **Audio not recording**: Test with `./dev-tools.sh test-record`
3. **STT not working**: Test endpoint with `./test-stt.sh`
4. **Text not inserting**: Check Wayland permissions and focused window

### Enable Debug Mode
Add this to your code for more verbose logging:
```javascript
// Enable debug logging
const DEBUG = true;
function debugLog(msg) {
    if (DEBUG) log('[VOICE-TYPE-DEBUG] ' + msg);
}
```

## 🧪 Testing Different Scenarios

### Test Audio Recording
```bash
./dev-tools.sh test-record
```

### Test STT Endpoint
```bash
./test-stt.sh
```

### Test Extension Components
```bash
./dev-tools.sh test
```

### Test on Different Display Servers
```bash
# Check current display server
echo $XDG_SESSION_TYPE

# For X11 - can restart shell
./dev-tools.sh restart

# For Wayland - use quick-reload
./dev-tools.sh quick-reload
```

## 📁 Development File Structure
```
gnome-voice-type/
├── extension.js              # Main extension entry point
├── src/
│   ├── extension.js          # Core microphone toggle logic
│   └── stylesheet.css        # Custom styles
├── icons/                    # SVG icons
├── dev-tools.sh              # Development tools
├── watch-and-reload.sh       # Auto-reload watcher
├── test-stt.sh               # STT endpoint tester
├── check-wayland.sh          # Compatibility checker
└── DEVELOPMENT.md            # This file
```

## 🔄 Rapid Development Cycle

1. **Start watcher**: `./watch-and-reload.sh`
2. **Edit files**: Make your changes in your editor
3. **Auto-reload**: Extension automatically reloads when you save
4. **Test**: Use the extension immediately
5. **Check logs**: Monitor the terminal for errors
6. **Repeat**: Continue editing and testing

## 🚨 Wayland-Specific Tips

### Why Logout/Login is Required
Wayland doesn't allow restarting the GNOME Shell like X11 does for security reasons.

### Workarounds
1. **Use the file watcher** (`./watch-and-reload.sh`) - best option
2. **Use Extension Manager GUI** - disable/enable with clicks
3. **Use gnome-extensions command** - `./dev-tools.sh quick-reload`

### Wayland Testing Considerations
- Some applications may block synthetic input
- Test with simple text editors first (gedit, mousepad)
- Check system permissions for microphone access
- Virtual keyboard input may behave differently

## 🎯 Best Practices

1. **Always use the file watcher** for development
2. **Test components regularly** with `./dev-tools.sh test`
3. **Monitor logs continuously** to catch issues early
4. **Test on both X11 and Wayland** if possible
5. **Keep the STT service running** during development
6. **Use version control** to track changes and rollback if needed

## 🐞 Troubleshooting

### Extension Won't Reload
- Check if `gnome-extensions` command is available
- Ensure extension directory permissions are correct
- Look for syntax errors in the logs

### File Watcher Not Working
- Install `inotify-tools` if missing
- Check file permissions
- Ensure the script is executable

### Logs Not Showing
- Check if extension is actually loaded
- Look in system journal: `journalctl -f /usr/bin/gnome-shell`
- Enable debug logging in your code

### Audio Issues
- Test microphone permissions in Settings → Privacy → Microphone
- Use `./dev-tools.sh test-record` to isolate audio problems
- Check GStreamer plugin availability

---

**Happy coding!** 🎉 The file watcher should make your development experience much smoother on Wayland.