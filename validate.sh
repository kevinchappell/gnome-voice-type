#!/bin/bash

# Quick extension validation script
# This script validates the extension files without running GNOME Shell

EXTENSION_UUID="voice-type-input@kevinchappell.github.io"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🔍 GNOME Extension Validation"
echo "=============================="

# Check if extension is installed
if [ -d "$EXTENSION_DIR" ]; then
    echo -e "${GREEN}✓${NC} Extension directory exists"
else
    echo -e "${RED}✗${NC} Extension directory missing"
    exit 1
fi

# Check required files
for file in metadata.json extension.js; do
    if [ -f "$EXTENSION_DIR/$file" ]; then
        echo -e "${GREEN}✓${NC} $file exists"
    else
        echo -e "${RED}✗${NC} $file missing"
        exit 1
    fi
done

# Validate metadata.json
if python3 -m json.tool "$EXTENSION_DIR/metadata.json" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} metadata.json is valid JSON"
    
    # Check UUID matches
    uuid=$(python3 -c "import json; print(json.load(open('$EXTENSION_DIR/metadata.json'))['uuid'])")
    if [ "$uuid" = "$EXTENSION_UUID" ]; then
        echo -e "${GREEN}✓${NC} UUID matches: $uuid"
    else
        echo -e "${RED}✗${NC} UUID mismatch: expected $EXTENSION_UUID, got $uuid"
    fi
    
    # Check GNOME Shell version compatibility
    gnome_version=$(gnome-shell --version | grep -o '[0-9]\+' | head -1)
    shell_versions=$(python3 -c "import json; print(' '.join(json.load(open('$EXTENSION_DIR/metadata.json'))['shell-version']))")
    if echo "$shell_versions" | grep -q "$gnome_version"; then
        echo -e "${GREEN}✓${NC} Compatible with GNOME Shell $gnome_version"
    else
        echo -e "${YELLOW}⚠${NC} May not be compatible with GNOME Shell $gnome_version (supports: $shell_versions)"
    fi
else
    echo -e "${RED}✗${NC} metadata.json has invalid JSON syntax"
    exit 1
fi

# Validate extension.js syntax
if command -v node > /dev/null; then
    if node -c "$EXTENSION_DIR/extension.js" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} extension.js syntax is valid"
    else
        echo -e "${RED}✗${NC} extension.js has syntax errors:"
        node -c "$EXTENSION_DIR/extension.js"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠${NC} Node.js not available - skipping JS syntax check"
fi

# Check if GNOME Shell recognizes the extension
if gnome-extensions list | grep -q "$EXTENSION_UUID"; then
    status=$(gnome-extensions info "$EXTENSION_UUID" | grep "State:" | awk '{print $2}')
    echo -e "${GREEN}✓${NC} Extension recognized by GNOME Shell (status: $status)"
    
    if [ "$status" = "ENABLED" ]; then
        echo -e "${GREEN}✅ Extension is enabled and ready!${NC}"
    else
        echo -e "${YELLOW}ℹ${NC} Extension can be enabled with: gnome-extensions enable $EXTENSION_UUID"
    fi
else
    echo -e "${YELLOW}⚠${NC} Extension not recognized by GNOME Shell"
    echo "   This is normal on Wayland. Try:"
    echo "   1. Log out and back in"
    echo "   2. Use nested session: ./dev.sh nested"
    echo "   3. Restart display manager: sudo systemctl restart gdm"
fi

echo ""
echo "📝 Summary:"
echo "- Extension files are properly structured"
echo "- Ready for testing in nested GNOME Shell session"
echo ""
echo "🚀 Next steps:"
echo "   ./dev.sh nested    # Test in safe nested session"
echo "   ./dev.sh install   # Install in main session (requires logout/restart)"
