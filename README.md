# keep-going

An [opencode](https://opencode.ai) v2 plugin that automatically continues a session
when the agent stops mid-task — so you don't have to type "continue" every time.

When a turn finishes (`session.execution.succeeded`) but the task isn't actually done,
the plugin sends a short continuation prompt back into the same session. It runs entirely
inside opencode and talks only to your local opencode server — it does not change your
model or provider in any way.

## Why

Some models end their turn after a single logical step instead of carrying a multi-step
task to the end. On long tasks that means constantly nudging the agent by hand. This plugin
does that nudging for you, with guardrails so it never loops forever or burns tokens blindly.

## Install

Copy the plugin into opencode's auto-discovery folder:

```
# Windows
%USERPROFILE%\.config\opencode\plugin\keep-going.js

# macOS / Linux
~/.config/opencode/plugin/keep-going.js
```

Then fully restart opencode (the plugin loads when the background service starts).

## How it works

- Subscribes to the opencode event stream (`ctx.event.subscribe`).
- On `session.execution.succeeded` it inspects the last turn and, if warranted, calls
  `ctx.session.prompt({ sessionID, text })` to continue.
- It never touches the remote model/provider — it just triggers another local turn.


## Only continues real work

The plugin nudges **only after turns that used tools** (file edits, commands, etc.).
A plain conversational answer (e.g. "what can you do?") is left alone — it never
spams "continue" when there is nothing to continue.

## Safety / stopping conditions

- **Max consecutive continues** (default `5`): after that it waits for you. The counter
  resets when you start a turn yourself.
- **Cooldown** (default `8000` ms) between auto-continues.
- **DONE sentinel**: the continuation prompt asks the model to reply exactly `DONE` when the
  task is truly finished and verified; on `DONE` the plugin stops.
- **Question guard**: if the last output ends with `?`, the plugin stays out of the way.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `OPENCODE_AUTOCONT_MAX` | `5` | Max consecutive auto-continues per session |
| `OPENCODE_AUTOCONT_COOLDOWN_MS` | `8000` | Cooldown between auto-continues (ms) |
| `OPENCODE_AUTOCONT_NUDGE` | built-in | Override the continuation prompt text |
| `OPENCODE_AUTOCONT_DEBUG` | off | Set to `1` to log actions to `plugin/_keep-going.log` |

## Compatibility

Built for the opencode **v2** plugin API (`export default { id, setup }`). The turn-end
signal is `session.execution.succeeded`; `sessionID` is read from `event.data.sessionID`.

## License

MIT
