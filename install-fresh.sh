#!/bin/bash

# Install fresh test extension

EXTENSION_UUID="voice-type-fresh@gnome.org"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing fresh voice type extension..."

# Remove existing extension directory
rm -rf "$EXTENSION_DIR"

# Create extension directory
mkdir -p "$EXTENSION_DIR"

# Copy only the fresh extension files
cp "$SCRIPT_DIR/fresh-test/extension.js" "$EXTENSION_DIR/"
cp "$SCRIPT_DIR/fresh-test/metadata.json" "$EXTENSION_DIR/"
cp -r "$SCRIPT_DIR/fresh-test/icons" "$EXTENSION_DIR/"

# Set permissions
chmod -R 755 "$EXTENSION_DIR"

echo "Fresh extension installed to $EXTENSION_DIR"
echo "Now run: gnome-extensions enable $EXTENSION_UUID"