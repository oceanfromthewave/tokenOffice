npm# tokenOffice

A local virtual office for watching Claude Code sessions and subagents.

## Start

Run `npm start`, then open <http://127.0.0.1:47821>. Edits to the HTML, CSS and JS show up on refresh.

If the installed app is already running it owns that port. Either quit it from the tray, or preview on another port with `TOKEN_OFFICE_PORT=47900 npm start` (PowerShell: `$env:TOKEN_OFFICE_PORT=47900; npm start`). Hook events always go to 47821, so a preview on another port only shows the demo.

`npm run app` opens the Electron window instead of a browser tab. After changing sprites run `node tools/make-sprites.mjs`.

The server only listens on this computer. It keeps hook events in memory and does not write a session log to disk. The Claude Code hook forwards event names, session IDs, the project folder name, tool names, and subagent type. It does not forward prompts, tool inputs, notification text, file contents, or transcript paths.

## Install (Windows)

Run `npm install`, then `npm run dist`, then run `dist/tokenOffice Setup 0.1.0.exe`. The app lives in the tray and receives Claude Code hook events on 127.0.0.1:47821. `npm run app` runs it without installing.

## Claude Code connection

Copy `hook/token-office.cjs` to `~/.claude/hooks/` and register it in `~/.claude/settings.json` for these events: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Notification, SubagentStart, SubagentStop, TeammateIdle, Stop, StopFailure, SessionEnd.

Each entry looks like:

```json
{ "hooks": [{ "type": "command", "command": "node", "args": ["<home>/.claude/hooks/token-office.cjs"], "async": true }] }
```

This observes every project. Hooks are async and best-effort, so a stopped dashboard never interrupts Claude Code.

## Current scope

The office scene and task entry are a visual prototype. In demo mode, the scene uses simulated activity. With Claude Code connected, the app shows actual session, tool, permission-wait, and subagent events. The task entry does not send prompts to Claude Code.

## Credits

The pixel font is [Galmuri](https://github.com/quiple/galmuri) (SIL Open Font License, see `fonts/LICENSE.txt`).
