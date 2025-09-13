#!/bin/bash

# GNOME Voice Type Extension Development Tools
# Better testing workflow for Wayland and X11

set -e

EXTENSION_UUID="voice-type@gnome.org"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if running in Wayland
is_wayland() {
    [ "$XDG_SESSION_TYPE" = "wayland" ]
}

# Function to install extension
install_extension() {
    log_info "Installing extension..."
    
    # Create extension directory
    mkdir -p "$EXTENSION_DIR"
    
    # Copy files
    cp -r "$SCRIPT_DIR"/* "$EXTENSION_DIR/"
    
    # Remove development files
    rm -f "$EXTENSION_DIR/dev-tools.sh"
    rm -f "$EXTENSION_DIR/install.sh"
    
    # Set permissions
    chmod -R 755 "$EXTENSION_DIR"
    
    log_success "Extension installed to $EXTENSION_DIR"
}

# Function to enable extension
enable_extension() {
    log_info "Enabling extension..."
    
    if command -v gnome-extensions &> /dev/null; then
        gnome-extensions enable "$EXTENSION_UUID"
        log_success "Extension enabled"
    else
        log_warning "gnome-extensions command not found. Enable manually through Extensions app."
    fi
}

# Function to disable extension
disable_extension() {
    log_info "Disabling extension..."
    
    if command -v gnome-extensions &> /dev/null; then
        gnome-extensions disable "$EXTENSION_UUID"
        log_success "Extension disabled"
    else
        log_warning "gnome-extensions command not found. Disable manually through Extensions app."
    fi
}

# Function to restart GNOME Shell (X11 only)
restart_shell() {
    if is_wayland; then
        log_warning "Cannot restart GNOME Shell on Wayland. Use 'quick-reload' instead."
        return 1
    else
        log_info "Restarting GNOME Shell..."
        # This works on X11
        busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Restarting...")'
        log_success "GNOME Shell restarted"
    fi
}

# Function to simulate extension reload (disable + enable)
quick_reload() {
    log_info "Quick reloading extension..."
    
    # Disable and re-enable the extension
    disable_extension
    sleep 1
    enable_extension
    
    log_success "Extension quick-reloaded"
}

# Function to show extension logs
show_logs() {
    log_info "Showing extension logs (press Ctrl+C to stop)..."
    
    # Use journalctl to show logs from the extension
    journalctl -f -o cat /usr/bin/gnome-shell | grep -i "voice-type\|Voice Type"
}

# Function to test individual components
test_components() {
    log_info "Testing extension components..."
    
    # Test 1: Check syntax
    log_info "Testing JavaScript syntax..."
    if node -c "$SCRIPT_DIR/extension.js" && node -c "$SCRIPT_DIR/src/extension.js"; then
        log_success "JavaScript syntax is valid"
    else
        log_error "JavaScript syntax errors found"
        return 1
    fi
    
    # Test 2: Check dependencies
    log_info "Testing dependencies..."
    if ! command -v gst-launch-1.0 &> /dev/null; then
        log_error "GStreamer not found"
        return 1
    fi
    
    if ! gst-inspect-1.0 pulsesrc &> /dev/null; then
        log_error "GStreamer pulsesrc plugin not found"
        return 1
    fi
    
    log_success "Dependencies are available"
    
    # Test 3: Test STT endpoint
    log_info "Testing STT endpoint..."
    if curl -s "http://localhost:8675/transcribe" > /dev/null; then
        log_success "STT endpoint is reachable"
    else
        log_warning "STT endpoint not reachable at localhost:8675"
    fi
}

# Function to create a development environment setup
dev_setup() {
    log_info "Setting up development environment..."
    
    # Install extension
    install_extension
    
    # Test components
    test_components
    
    if is_wayland; then
        log_info "Wayland detected. Quick-reload will be used instead of shell restart."
        log_info "Use './dev-tools.sh quick-reload' to reload extension after changes."
    else
        log_info "X11 detected. You can use './dev-tools.sh restart' to restart GNOME Shell."
    fi
    
    log_success "Development environment ready!"
}

# Function to create a simple test recording
test_recording() {
    log_info "Testing audio recording..."
    
    # Create a test recording
    TEMP_FILE=$(mktemp --suffix=.wav)
    
    log_info "Recording 3 seconds of audio..."
    timeout 3 gst-launch-1.0 -e pulsesrc ! audioconvert ! audioresample ! audio/x-raw,rate=16000,channels=1 ! wavenc ! filesink location="$TEMP_FILE" || true
    
    if [ -f "$TEMP_FILE" ] && [ -s "$TEMP_FILE" ]; then
        log_success "Audio recording successful"
        log_info "Recorded file size: $(stat -c%s "$TEMP_FILE") bytes"
    else
        log_error "Audio recording failed"
    fi
    
    # Clean up
    rm -f "$TEMP_FILE"
}

# Function to monitor extension status
monitor_status() {
    log_info "Monitoring extension status..."
    
    while true; do
        clear
        echo "=== GNOME Voice Type Extension Status ==="
        echo
        
        # Check if extension is installed
        if [ -d "$EXTENSION_DIR" ]; then
            log_success "Extension is installed"
        else
            log_error "Extension is not installed"
        fi
        
        # Check if extension is enabled
        if command -v gnome-extensions &> /dev/null; then
            if gnome-extensions list --enabled | grep -q "$EXTENSION_UUID"; then
                log_success "Extension is enabled"
            else
                log_error "Extension is disabled"
            fi
        fi
        
        # Show recent logs
        echo
        log_info "Recent extension activity:"
        journalctl -n 10 -o cat /usr/bin/gnome-shell | grep -i "voice-type\|Voice Type" | tail -5
        
        echo
        echo "Press Ctrl+C to stop monitoring"
        sleep 5
    done
}

# Main menu
show_help() {
    echo "GNOME Voice Type Extension Development Tools"
    echo
    echo "Usage: $0 [COMMAND]"
    echo
    echo "Commands:"
    echo "  install      Install the extension"
    echo "  enable       Enable the extension"
    echo "  disable      Disable the extension"
    echo "  quick-reload Quick reload extension (disable + enable)"
    echo "  restart      Restart GNOME Shell (X11 only)"
    echo "  logs         Show extension logs"
    echo "  test         Test extension components"
    echo "  dev-setup    Set up development environment"
    echo "  test-record  Test audio recording"
    echo "  monitor      Monitor extension status"
    echo "  help         Show this help message"
    echo
    echo "Examples:"
    echo "  $0 dev-setup     # Initial setup"
    echo "  $0 quick-reload  # After making changes"
    echo "  $0 logs          # View logs"
    echo "  $0 test          # Test components"
}

# Main script logic
case "${1:-help}" in
    install)
        install_extension
        ;;
    enable)
        enable_extension
        ;;
    disable)
        disable_extension
        ;;
    quick-reload)
        quick_reload
        ;;
    restart)
        restart_shell
        ;;
    logs)
        show_logs
        ;;
    test)
        test_components
        ;;
    dev-setup)
        dev_setup
        ;;
    test-record)
        test_recording
        ;;
    monitor)
        monitor_status
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac