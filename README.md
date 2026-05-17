# Voice Type Input

A GNOME Shell extension that records your voice from the top panel, sends the audio to an OpenAI-compatible speech-to-text API, and types the transcribed text into the focused application.

Requires GNOME Shell 46+ (Wayland or X11).

## Privacy & network use

This extension **uploads recorded audio to a speech-to-text endpoint that you configure**. Nothing is sent anywhere by default — the default endpoint is `http://localhost:8675`, intended for a local Whisper server. If you point it at OpenAI, OpenRouter, or another remote provider, your audio is sent to that provider under their terms.

The extension also reads and writes the system clipboard when using the clipboard-paste fallback path (see below). Your existing clipboard content is restored after pasting, unless you enable "Keep transcription on clipboard".

## Features

- One-click microphone toggle in the top panel, with pulsing icon while recording.
- Configurable recording quality (8 kHz / 16 kHz / 44.1 kHz) and max recording length (5–300 s).
- Pauses MPRIS media players during recording, resumes them after.
- Configurable API provider: OpenAI, OpenRouter, or any custom OpenAI-compatible endpoint. API keys are stored in the system keyring via libsecret.
- Global keyboard shortcut (default `Ctrl+Alt+V`).
- Debug overlay mode for testing transcription without typing into the focused app.

## Installation

### From extensions.gnome.org

*(Pending review.)*

### From source

```bash
git clone https://github.com/kevinchappell/gnome-voice-type.git
cd gnome-voice-type
make install
```

On Wayland, log out and back in (or use `make nested` to test in a nested shell — see *Development*). On X11, `make reload` is enough.

### Runtime requirements

- A reachable speech-to-text endpoint (local or remote).
- `gstreamer1.0-plugins-good` (or equivalent) for WAV recording.
- Optional: `ydotool` or `wtype` as fallbacks for text insertion on non-GNOME Wayland compositors. Not needed on GNOME — the extension uses the built-in Clutter virtual keyboard.

## Configuration

Open preferences:

```bash
gnome-extensions prefs voice-type-input@kevinchappell.github.io
```

- **API provider** — OpenAI, OpenRouter, or Custom.
- **Base URL** — only used when provider is Custom. The extension appends `/v1/audio/transcriptions` automatically (or `/audio/transcriptions` if your URL already ends in `/v1`).
- **API key** — stored in the system keyring; not used for `localhost` endpoints.
- **Model** — defaults to `whisper-1`.
- **Recording quality** and **time limit**.
- **Pause media during recording** — toggles MPRIS pause/resume.
- **Enhanced terminal support** — uses `Ctrl+Shift+V` paste in detected terminal apps.
- **Keyboard shortcut** — defaults to `Ctrl+Alt+V`.
- **Debug mode** — shows transcribed text in a floating overlay instead of typing.

### Running a local Whisper server

Recommended: [`whisper.cpp`](https://github.com/ggerganov/whisper.cpp) — a single static binary with no Python dependencies. The `whisper-server` it builds exposes an OpenAI-compatible API that this extension talks to directly.

```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
make                                          # builds whisper-cli and whisper-server
sh ./models/download-ggml-model.sh base.en    # ~140 MB, runs faster than real-time on CPU
./build/bin/whisper-server -m models/ggml-base.en.bin
```

Then set the provider to *Custom* and the Base URL to `http://localhost:8080/v1`.

Larger models (`small.en`, `medium.en`) trade speed for accuracy; swap the model file in both the download and run commands.

Alternative: [`faster-whisper-server`](https://github.com/fedirz/faster-whisper-server) is CTranslate2-based and faster on GPU, but requires a Python environment.

## How text insertion works

1. **Clutter virtual keyboard** — primary path. Runs inside `gnome-shell`, so it works on GNOME Wayland without any external tools.
2. **`ydotool`** — fallback for non-GNOME compositors where the Clutter virtual device isn't available.
3. **Clipboard + simulated paste** — final fallback. Saves your current clipboard, writes the transcription, sends `Ctrl+V` (or `Ctrl+Shift+V` in terminals), then restores the previous clipboard contents.
4. **Clipboard only** — if even paste-simulation fails, the text is left on the clipboard and you get a notification to paste manually.

## Development

Repository layout:

```
extension.js     # Indicator, recording pipeline, text insertion
apiClient.js     # Provider abstraction over OpenAI-compatible APIs
prefs.js         # Adw preferences UI
stylesheet.css   # Recording-state styles, debug overlay
schemas/         # GSettings schema
metadata.json
```

Common workflows go through `./dev.sh` (also wrapped by `Makefile`):

```bash
./dev.sh install    # install + enable
./dev.sh nested     # launch nested GNOME Shell (required on Wayland)
./dev.sh test       # nested session with the extension auto-enabled
./dev.sh watch      # auto-reload on file changes (needs inotify-tools)
./dev.sh reload     # in-session reload (X11 only)
./dev.sh logs       # tail gnome-shell journal
./dev.sh prefs      # open preferences dialog
./validate.sh       # static validation
make pack           # build the distributable zip
```

There is no automated test suite; verification means running in a nested shell and exercising the UI.

See `AGENTS.md` for a deeper architectural tour.

## License

MIT — see [LICENSE](LICENSE).
