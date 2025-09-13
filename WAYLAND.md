# Wayland Installation Guide

This guide provides specific instructions for installing and using the Voice Type extension on Wayland.

## Key Differences from X11

### Restart Method
- **X11**: Can restart GNOME Shell with Alt+F2 → 'r' → Enter
- **Wayland**: Must log out and log back in (no live restart available)

### Installation Steps

1. **Install the extension**:
   ```bash
   ./install.sh
   ```

2. **Log out completely**:
   - Click system menu → Power → Log Out
   - Or use terminal: `gnome-session-quit --logout`

3. **Log back in**

4. **Enable the extension**:
   - Open Extensions app (install if needed: `sudo apt install gnome-shell-extension-manager`)
   - Toggle "Voice Type" to ON

## Troubleshooting

### Extension Not Appearing
- Ensure you're logged back in after installation
- Check Extensions app for any error messages
- Verify extension is in correct directory: `~/.local/share/gnome-shell/extensions/voice-type@gnome.org`

### Recording Issues
- Check microphone permissions in Settings → Privacy → Microphone
- Verify GStreamer is installed: `gst-launch-1.0 --version`
- Test audio recording manually: `gst-launch-1.0 pulsesrc ! audioconvert ! audioresample ! audio/x-raw,rate=16000,channels=1 ! wavenc ! filesink location=test.wav`

### Text Insertion Issues
- Wayland has stricter security - ensure the application you're typing into allows synthetic input
- Some applications may block virtual keyboard input for security
- Try testing with a simple text editor first (like gedit)

### Alternative Installation Methods

#### Using GNOME Extension Manager (Recommended for Wayland)
```bash
sudo apt install gnome-shell-extension-manager
```
Then use the GUI to browse and install extensions without restart.

#### Manual Verification
```bash
# Check if extension is properly installed
gnome-extensions list | grep voice-type

# Enable manually
gnome-extensions enable voice-type@gnome.org

# Check for errors
gnome-extensions info voice-type@gnome.org
```

## Known Limitations

1. **No Live Restart**: Unlike X11, you cannot restart GNOME Shell while logged in
2. **Security Restrictions**: Some applications may block synthetic input more aggressively
3. **Permission Prompts**: Wayland may require additional permissions for certain operations

## Testing Your Installation

After installation and login:

1. Check that the microphone icon appears in the top panel
2. Click the icon - it should turn red
3. Speak a few words
4. Click again to stop
5. Open a text editor and verify text appears

If you encounter issues, check the system logs:
```bash
journalctl -f -o cat /usr/bin/gnome-shell
```