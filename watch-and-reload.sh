#!/bin/bash

# Watch and reload extension on file changes
# Perfect for development on Wayland

EXTENSION_UUID="voice-type@gnome.org"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== GNOME Voice Type Extension Development Watcher ===${NC}"
echo

# Check if inotify-tools is available
if ! command -v inotifywait &> /dev/null; then
    echo "Installing inotify-tools for file watching..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get install -y inotify-tools
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y inotify-tools
    elif command -v pacman &> /dev/null; then
        sudo pacman -S --noconfirm inotify-tools
    else
        echo "Please install inotify-tools manually for your distribution"
        exit 1
    fi
fi

# Function to reload extension
reload_extension() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] Changes detected, reloading extension...${NC}"
    
    # Copy files to extension directory
    cp -r "$SCRIPT_DIR"/* "$EXTENSION_DIR/"
    rm -f "$EXTENSION_DIR/watch-and-reload.sh"
    rm -f "$EXTENSION_DIR/dev-tools.sh"
    rm -f "$SCRIPT_DIR/install.sh"
    
    # Quick reload (disable + enable)
    if command -v gnome-extensions &> /dev/null; then
        gnome-extensions disable "$EXTENSION_UUID" 2>/dev/null
        sleep 0.5
        gnome-extensions enable "$EXTENSION_UUID" 2>/dev/null
        echo -e "${GREEN}[$(date '+%H:%M:%S')] Extension reloaded successfully${NC}"
    else
        echo -e "${YELLOW}[$(date '+%H:%M:%S')] gnome-extensions not found, reload manually${NC}"
    fi
    
    echo -e "${BLUE}Watching for changes...${NC}"
}

# Initial setup
echo "Setting up initial extension..."
mkdir -p "$EXTENSION_DIR"
reload_extension

# Show logs in background
echo "Starting log monitor..."
gnome-extensions disable "$EXTENSION_UUID" 2>/dev/null
sleep 0.5
gnome-extensions enable "$EXTENSION_UUID" 2>/dev/null

# Watch for file changes
echo -e "${BLUE}Watching for file changes in $SCRIPT_DIR...${NC}"
echo "Press Ctrl+C to stop watching"
echo

# Use inotifywait to watch for changes
inotifywait -m -r -e modify,create,delete,move \
    --include '.*\.(js|json|css|svg)$' \
    "$SCRIPT_DIR" \
    --format '%w%f %e' |
while read file event; do
    # Ignore temporary files and hidden files
    if [[ "$file" != *"~" ]] && [[ "$file" != *".#"* ]] && [[ "$file" != *"#"*"#" ]]; then
        echo -e "${YELLOW}File changed: $file ($event)${NC}"
        reload_extension
    fi
done