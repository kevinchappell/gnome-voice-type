# Makefile for GNOME Extension Development

.PHONY: install reload enable disable status watch nested test logs uninstall clean help

# Default target
install:
	@./dev.sh install

# Development targets
reload:
	@./dev.sh reload

enable:
	@./dev.sh enable

disable:
	@./dev.sh disable

status:
	@./dev.sh status

watch:
	@./dev.sh watch

nested:
	@./dev.sh nested

test:
	@./dev.sh test

logs:
	@./dev.sh logs

# Cleanup targets
uninstall:
	@./dev.sh uninstall

clean: uninstall

# Help
help:
	@./dev.sh help
	@echo ""
	@echo "Makefile targets:"
	@echo "  make install    # Install and enable extension"
	@echo "  make reload     # Quick reload during development"
	@echo "  make nested     # Test in nested GNOME Shell (recommended for Wayland)"
	@echo "  make test       # Auto-test in nested session"
	@echo "  make watch      # Auto-reload on file changes"
	@echo "  make logs       # Show GNOME Shell logs"
	@echo "  make status     # Check extension status"
	@echo "  make uninstall  # Remove extension"
