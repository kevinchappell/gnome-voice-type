#!/bin/bash

# Check Wayland compatibility for Voice Type extension

echo "Checking Wayland compatibility..."
echo

# Check display server
SESSION_TYPE="$XDG_SESSION_TYPE"
echo "Display Server: $SESSION_TYPE"

if [ "$SESSION_TYPE" = "wayland" ]; then
    echo "✓ Running on Wayland"
else
    echo "✓ Running on X11"
fi

echo

# Check for required dependencies
echo "Checking dependencies..."

# Check for GNOME Shell
if command -v gnome-shell &> /dev/null; then
    echo "✓ GNOME Shell found"
    gnome-shell --version
else
    echo "✗ GNOME Shell not found"
fi

echo

# Check for GStreamer
if command -v gst-launch-1.0 &> /dev/null; then
    echo "✓ GStreamer found"
    gst-launch-1.0 --version | head -n1
else
    echo "✗ GStreamer not found"
fi

echo

# Check for required GStreamer plugins
echo "Checking GStreamer plugins..."
if gst-inspect-1.0 pulsesrc &> /dev/null; then
    echo "✓ pulsesrc plugin found"
else
    echo "✗ pulsesrc plugin not found - install gstreamer1.0-pulseaudio"
fi

if gst-inspect-1.0 wavenc &> /dev/null; then
    echo "✓ wavenc plugin found"
else
    echo "✗ wavenc plugin not found - install gstreamer1.0-plugins-good"
fi

echo

# Check extension directory
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/voice-type@gnome.org"
if [ -d "$EXTENSION_DIR" ]; then
    echo "✓ Extension directory exists: $EXTENSION_DIR"
else
    echo "✗ Extension directory not found: $EXTENSION_DIR"
fi

echo

# Check if extension is installed
if command -v gnome-extensions &> /dev/null; then
    if gnome-extensions list | grep -q "voice-type@gnome.org"; then
        echo "✓ Extension is installed"
        gnome-extensions info voice-type@gnome.org
    else
        echo "✗ Extension is not installed"
    fi
else
    echo "? Cannot check extension status - gnome-extensions command not found"
fi

echo

# Provide recommendations
echo "Recommendations:"
if [ "$SESSION_TYPE" = "wayland" ]; then
    echo "- For Wayland: After installation, log out and log back in"
    echo "- Some applications may block synthetic input on Wayland"
    echo "- Test with a simple text editor first (like gedit)"
else
    echo "- For X11: Use Alt+F2 → 'r' → Enter to restart GNOME Shell"
fi

echo "- Ensure microphone permissions are enabled in Settings → Privacy → Microphone"
echo "- Test your STT endpoint: ./test-stt.sh"