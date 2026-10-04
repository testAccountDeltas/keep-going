# keep-going

An [opencode](https://opencode.ai) v2 plugin that automatically retries a turn that
died on a **broken/empty model response** — so you don't have to type "continue" by hand.

## Why

Some models (notably Gemini via Antigravity) occasionally emit a malformed tool call.
The provider returns `finishReason = MALFORMED_FUNCTION_CALL`, opencode maps that to
`finish = "stop"`, and the turn ends with a bit of reasoning and **zero output** — no text,
no tool result. The task just stalls and you have to nudge it manually.

This plugin detects exactly that situation and sends a short continuation prompt back into
the same session, with guardrails so it never loops forever. It runs entirely inside
opencode and talks only to your local opencode server — it does **not** change your model
or provider.

## Install

Copy the plugin into opencode's auto-discovery folder:

```
# Windows
%USERPROFILE%\.config\opencode\plugin\keep-going.js

# macOS / Linux
~/.config/opencode/plugin/keep-going.js
```

Then fully restart opencode (plugins load when the background service starts).

## How it works

- Subscribes to the opencode event stream (`ctx.event.subscribe`).
- Tracks, **per step**, whether that step produced anything — a text delta
  (`session.text.delta`) or a successful tool call (`session.tool.success`).
- Flags a turn as broken when:
  - `session.step.ended` reports a bad `rawFinish` — `malformed_function_call`,
    `prohibited_content`, or `unexpected_tool_call`; or
  - `session.step.failed` looks like a transport cut-off (`stream ended without
    finish_reason`, `GOAWAY`, `ECONNRESET`, `socket hang up`, `premature close`).
- On turn end (`session.execution.succeeded` / `failed`): if the turn was flagged broken
  **and the last step produced nothing**, it calls `ctx.session.prompt({ sessionID, text })`
  to continue. If the step actually produced text or a tool result, it leaves things alone.

Because the broken state is tracked per *step*, a turn that ran three good tools and then
died on a malformed fourth call is still caught.

## Safety / stopping conditions

- **Max consecutive retries** (default `5`): after that it waits for you. The counter
  resets as soon as a turn completes normally.
- **Cooldown** (default `6000` ms) between retries.
- **Only broken turns**: it never nudges a turn that produced real output, so a plain
  conversational answer is never interrupted.
- **Hot-reload safe**: a generation guard in `globalThis` ensures only the latest loaded
  instance is live, so one break never triggers two continues.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `OPENCODE_KG_OFF` | off | Set to `1` to disable the plugin entirely |
| `OPENCODE_KG_MAX` | `5` | Max consecutive auto-continues per session |
| `OPENCODE_KG_COOLDOWN_MS` | `6000` | Cooldown between auto-continues (ms) |
| `OPENCODE_KG_TEXT` | `continue` | Text of the continuation prompt |
| `OPENCODE_KG_QUIET` | off | Set to `1` to suppress the diagnostic log (`plugin/_keep-going.log`) |

## Compatibility

Built for the opencode **v2** plugin API (`export default { id, setup }`). Uses
`ctx.event.subscribe`, `ctx.session.prompt`, and the `session.step.ended` /
`session.step.failed` events that carry `rawFinish` and error details.

## License

MIT
