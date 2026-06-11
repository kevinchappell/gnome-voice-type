# Streaming Transcription (SSE) — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

Add opt-in streamed transcription: instead of waiting for the full
transcription response, the extension consumes OpenAI-compatible SSE
`transcript.text.delta` events and types the text incrementally as it
arrives, with the smooth pacing of a high-end transcription app.

The record→temp-WAV→upload pipeline is unchanged. The WebSocket Realtime
API (type-as-you-speak while recording) is explicitly **out of scope** —
it is a candidate for a separate future feature.

## Compatibility matrix

| Provider | Streaming support |
|----------|-------------------|
| talker (self-hosted) | `stream=true` accepted for any model |
| OpenAI | `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` only; `whisper-1` rejects `stream=true` |
| OpenRouter | None — the extension uses OpenRouter's JSON `input_audio` format, which has no streaming transcription |
| Other OpenAI-compatible servers (speaches, LocalAI, …) | Varies; handled by the auto-retry fallback |

Because the extension's default config is OpenAI + `whisper-1`, the new
setting defaults to **off**.

## Wire protocol

`POST {base-url}/audio/transcriptions`, multipart/form-data, with the
existing `file`, `model`, `response_format=json` fields plus
`stream=true`. Response is `text/event-stream`:

```
data: {"type": "transcript.text.delta", "delta": "Hello"}
data: {"type": "transcript.text.delta", "delta": " world."}
data: {"type": "transcript.text.done", "text": "Hello world."}
```

## Changes by file

### `schemas/org.gnome.shell.extensions.voice-type-input.gschema.xml`

New key:

```xml
<key name="stream-transcription" type="b">
  <default>false</default>
</key>
```

(Recompile with `make schemas` after editing.)

### `apiClient.js`

New method `transcribeStream(tempFile, onDelta)` alongside `transcribe()`:

- Builds the same multipart message as the non-streaming path, plus a
  `stream=true` form string.
- Uses `session.send_async()` (not `send_and_read_async`) to obtain the
  response `GInputStream`, wraps it in `Gio.DataInputStream`, and reads
  lines asynchronously.
- Parses `data: {...}` lines; ignores blank lines, comments, and unknown
  event types. Each `transcript.text.delta` invokes `onDelta(delta)`.
- Resolves with the final text from `transcript.text.done`; if the server
  closes the stream without a `done` event, resolves with the
  concatenation of received deltas.
- A non-2xx HTTP status throws **before any delta is delivered** (the
  status is known from response headers, ahead of body reading), so the
  caller can safely retry without risk of duplicated text.
- Reuses the existing `isConnectionError` flagging.
- `transcribeStream` is never used for `provider === 'openrouter'`; the
  caller gates this.

### `extension.js`

`_transcribeAudio()` branches:

- **Streaming path** (setting on, provider ≠ openrouter, auto-insert on,
  debug mode or a typing method available): call
  `transcribeStream(tempFile, delta => streamTyper.push(delta))`.
- **Fallback / retry:** if the streaming request fails before any delta
  arrived, retry once via the existing non-streaming `transcribe()` —
  invisible to the user. If the stream fails *after* deltas were typed,
  do not retry (it would duplicate text); notify the error and copy the
  accumulated text to the clipboard as a recovery path.
- **Auto-insert off:** skip streaming entirely; behave exactly as today
  (clipboard the final text).
- **Debug mode:** deltas append live to the debug overlay via the
  existing `_appendDebugLine` / `_simulateDebugTyping` machinery.

#### Stream typer (typing queue)

A small unit (class or method cluster on `Indicator`) responsible for
smooth paced output:

- `push(delta)` appends to an internal character buffer.
- A `GLib.timeout_add` source ticks every ~60–80 ms and types the pending
  chunk (everything buffered, or a capped slice) through **one** insertion
  method.
- The insertion method (Clutter virtual keyboard → ydotool) is selected
  on the first non-empty chunk and stays **sticky** for the rest of the
  utterance — no mid-stream method switching.
- ydotool is invoked per-chunk (one spawn per tick), never per-character.
- If neither Clutter nor ydotool is available, the typer buffers
  everything and the caller falls back to the existing clipboard+paste
  path once the final text is known.
- `finish()` returns a promise that resolves when the buffer is fully
  drained after the stream ends, so completion notifications fire only
  after the last character is typed.
- The typer is cancelled and its GLib source removed on `disable()` and
  on new-recording start.

No diffing of the `done` text against typed text: OpenAI delta events
are append-only, so no retraction/correction pass is needed.

### `prefs.js`

New `Adw.SwitchRow` "Stream transcription" in the API section, bound to
`stream-transcription`. Subtitle flags compatibility:

> Types text as it arrives. Requires a streaming-capable endpoint
> (OpenAI: gpt-4o-transcribe models; not available with OpenRouter).

The row is made insensitive when `api-provider` is `openrouter`
(reacting live to provider changes).

## Error handling summary

| Failure | Behavior |
|---------|----------|
| HTTP error before any delta (e.g., OpenAI + whisper-1) | Silent single retry without `stream=true` |
| Connection error | Existing "server unreachable" notification |
| Stream drops mid-typing | No retry; error notification + accumulated text copied to clipboard |
| No `done` event | Treat concatenated deltas as final text |

## Testing

There is no automated test suite; verification is manual:

1. `./validate.sh` passes.
2. Nested shell (`./dev.sh test`) against a talker instance with
   streaming on: debug mode shows live deltas and the chosen method;
   text appears smoothly in a target app.
3. Forced incompatibility (OpenAI + `whisper-1` + streaming on, or any
   non-streaming server): transcription still succeeds via the silent
   retry.
4. Streaming off: behavior identical to today.
5. OpenRouter selected: prefs switch is insensitive; flow unchanged.
