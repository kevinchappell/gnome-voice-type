# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GNOME Shell 46+ extension (ES6 modules, GJS).

See `AGENTS.md` for a longer tour of the codebase. README.md covers user-facing setup.

## Common commands

All workflows go through `./dev.sh` (also wrapped by `Makefile` and `package.json` scripts).

```bash
./dev.sh install      # install + enable
./dev.sh reload       # quick reload during dev
./dev.sh watch        # auto-reload on file changes (needs inotify-tools)
./dev.sh nested       # launch devkit GNOME Shell (falls back to --nested --wayland on Shell 45-48)
./dev.sh test         # devkit/nested session with the extension auto-enabled
./dev.sh logs         # journalctl tail for gnome-shell
./dev.sh debug        # validation + state dump
./dev.sh prefs        # open preferences dialog
./validate.sh         # static validation without launching GNOME Shell

make pack             # build the distributable zip (recompiles schemas first)
make schemas          # glib-compile-schemas schemas/
```

There is no test suite. "Testing" means running in a nested shell and exercising the UI; `./validate.sh` is the closest thing to a lint check.

## Architecture

Three runtime files plus a settings schema:

- **`extension.js`** — single `Indicator extends PanelMenu.Button` owns the entire lifecycle: click→record, GStreamer pipeline that writes a temp WAV, Soup multipart POST to `${endpoint-url}/transcribe`, then text insertion. Also handles MPRIS media muting during recording and the floating debug-mode overlay.
- **`prefs.js`** — Adwaita (Adw) preferences UI bound to GSettings.
- **`stylesheet.css`** — recording-state classes (`voice-type-input-*`), pulsing animation, debug window styling.
- **`schemas/org.gnome.shell.extensions.voice-type-input.gschema.xml`** — every user-visible setting. After editing, run `glib-compile-schemas schemas/` (or `make schemas`) before reload, otherwise the extension reads stale defaults.

### Text insertion fallback chain

This is the trickiest part of the extension. In order:
1. `ydotool` direct typing (Wayland-compatible primary path).
2. Terminal-specific paste — `_isTerminalApplication()` gates this; uses `Ctrl+Shift+V` or middle-click primary selection.
3. Clipboard fallback with a user notification asking them to paste manually.

When changing insertion logic, touch `_tryTypeWithYdotool()`, `_isTerminalApplication()`, and `_fallbackToClipboard()` together — they share state about which path was attempted, and debug mode surfaces that in the overlay.

### Transcription contract

`POST ${endpoint-url}/transcribe`, `multipart/form-data`, `file` field = WAV bytes. Response: `{"text": "..."}`. The endpoint URL comes from the `endpoint-url` GSettings key; the extension appends `/transcribe` itself.

### Adding a setting

1. Add the key to `schemas/*.gschema.xml`.
2. `glib-compile-schemas schemas/`.
3. Add an Adw row in `prefs.js`.
4. Read via `this._settings.get_*('key-name')` in `extension.js`. Connect to `changed::key-name` if the runtime needs to react live.

## Wayland note

You cannot reload the extension into the running shell on Wayland (Shell 49+ disabled `Meta.restart()` and `ReloadExtension`) — always use `./dev.sh nested` (which runs `gnome-shell --devkit` on Shell 49+, or `--nested --wayland` on Shell 45-48). On X11, `./dev.sh reload` works in-session.


Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
