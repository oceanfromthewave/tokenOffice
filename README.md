# tokenOffice

A pixel-art office that shows your Claude Code and Codex sessions and subagents at work. Main sessions go to the lounge when resting and return to their own desk when they start working. They type while tools run and raise a speech bubble when they need your permission. Subagents come in through the door as robots and leave when they finish.

The app listens only on `127.0.0.1`. It saves the main-agent roster, session IDs, working directories and up to 200 recent activity events locally so they can be restored after a restart. At startup it also detects already-open CLI sessions from local process and session metadata, without reading conversation contents; those agents are labeled as waiting for a hook event to confirm their state. Entries expire after 30 days without activity. Chat history, meeting transcripts and live metrics stay in memory. Hooks send event names, session IDs, project and parent folder names, tool names, subagent type, a short project-path hash, and the working directory to the local receiver. Hook events do not include prompts, tool inputs, notification text, file contents or transcript paths. When you explicitly send a chat message or start a meeting, tokenOffice passes that text and, during meetings, earlier participant replies to the installed Claude Code or Codex CLI under your normal account and settings. The backup file includes agent session IDs and working directories; keep it in a safe place.

## Install (Windows)

```sh
npm install
npm run dist
```

Then run `dist/tokenOffice-Setup-<version>.exe`, or download it from [Releases](https://github.com/oceanfromthewave/tokenOffice/releases). The app lives in the tray. Closing the window keeps it running, so it keeps receiving events. Quit it from the tray menu, where you can also turn on starting with Windows.

From 0.2.1 the app updates itself. It checks GitHub Releases at start and every six hours, and downloads new versions in the background. A tray notice says when one is ready; it installs when you restart from the tray menu or the next time the app quits. Use "업데이트 확인" in the tray menu to check right away. The installer is not code-signed, so Windows SmartScreen may warn on first install.

## Connect Claude Code

Press "Claude Code 연결하기" in the app, or tick "Claude Code 연결" in the tray menu. The app copies its hook to `~/.claude/hooks/token-office.cjs` and adds one entry per event to `~/.claude/settings.json`. Your other settings and hooks are left as they are, and the previous file is kept as `settings.json.tokenoffice-backup`. "연결 해제" removes exactly those entries again. The hook runs with Node.js, so `node` must be on your PATH. The app warns you if it isn't. While connected, the app refreshes its copy of the hook script on every start, so fixes to the hook arrive with app updates.

To set it up by hand instead, copy `hook/token-office.cjs` to `~/.claude/hooks/` and register it in `~/.claude/settings.json` for these events: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Notification, SubagentStart, SubagentStop, TeammateIdle, Stop, StopFailure, SessionEnd.

Each entry looks like:

```json
{ "hooks": [{ "type": "command", "command": "node", "args": ["<home>/.claude/hooks/token-office.cjs"], "async": true }] }
```

The hook is async and best-effort, so a closed dashboard never slows Claude Code down. The office restores known main sessions as resting after an app restart and adds new sessions after their first hook event. Resting agents visit the vending machine and lounge; they return to work desks when a new task starts. Finished subagents leave the office.

## Connect Codex

Press "Codex 연결하기" in the app or tick "Codex 연결" in the tray menu. The app copies its hook to `~/.codex/hooks/token-office.cjs` and adds its lifecycle hooks to `~/.codex/hooks.json`. Existing Codex settings and other hook entries are preserved; the previous hooks file is backed up as `hooks.json.tokenoffice-backup`. "연결 해제" removes only tokenOffice's entries.

Codex requires you to review and trust a new or changed hook before it runs. After connecting, run `/hooks` in Codex CLI, then review and trust the tokenOffice hooks. New Codex sessions appear after that. The hook runs with Node.js, so `node` must be on your PATH.

For meetings, tokenOffice starts a fresh Codex CLI process. If it reports that it cannot find `codex`, install or update the standalone CLI with `npm install -g @openai/codex@latest`, then restart tokenOffice. tokenOffice prefers the npm `codex.cmd` shim when available. Updating also helps when an older CLI cannot read a model cache written by a newer Codex desktop app.

## Use

- Click a worker, in the office or the sidebar, to see what they are doing.
- Double-click a worker, or use ✎ in the sidebar, to rename them or pick another character. A session's name is remembered per project folder and a subagent's per subagent type, on this computer.
- Select an idle main session in the chat panel to message it. The message resumes that session through its installed CLI. Messaging is disabled while the agent is working or waiting for permission; subagents cannot be messaged separately. The installed CLI's account and permission policy applies, and tokenOffice cannot approve permission prompts.
- In the meeting room, select 2–4 idle main sessions, enter an agenda and start a meeting. Each CLI gives one response in order and receives earlier replies as context. Meeting turns use temporary, non-persistent CLI runs, so they do not resume or change the selected sessions' conversation history. Claude's meeting run has tools disabled; Codex runs read-only. Participants walk to the conference room while their turn is active.
- Use the sidebar backup controls to export or import names, characters, the saved agent roster and recent activity. The JSON backup also contains session IDs and working directories so idle sessions can be resumed; store it privately.
- Enable desktop notifications in the sidebar to get an operating-system alert when an agent needs approval or reports an error. Clicking the alert opens that agent's chat.
- The windows follow your local time of day. The whiteboard sorts everyone into working, waiting and resting. The printer runs when someone finishes a turn.

## Develop

| Command | What it does |
| --- | --- |
| `npm start` | Build, then serve the dashboard and hook receiver at <http://127.0.0.1:47821> |
| `npm run app` | Build, then open it in the Electron window |
| `npm run dev` | Vite dev server with hot reload. Its `/api` calls go to a receiver on 47821, so start one with `npm start` or the app |
| `npm test` | Unit and simulation tests (Node's built-in runner) |
| `npm run typecheck` | Type-check the renderer and the Node side |
| `npm run dist` | Typecheck, test, build and package the Windows installer |
| `npm run icon` | Redraw `build/icon.png` and the favicon from the pixel art |

To release, bump `version` in `package.json` and run `npm run dist`. Then create a GitHub release tagged `v<version>` and attach three files from `dist/`: the installer `.exe`, its `.blockmap` and `latest.yml`. Installed apps find the new version through `latest.yml`.

If the installed app is running, it owns port 47821. To run another copy side by side, set `TOKEN_OFFICE_PORT` first (PowerShell: `$env:TOKEN_OFFICE_PORT=47900; npm start`). Hook events still go to 47821.

### Layout

- `src/shared/` holds the pixel art as data (`pixels.ts`) and the types shared by both sides.
- `src/server/` holds the hook receiver and connection setup for both tools. `state.ts` is a pure reducer from hook events; `server.ts` is the local-only HTTP server.
- `src/main/` is the Electron tray shell.
- `src/renderer/` is the dashboard UI. Under `office/`:
  - `layout.ts`: the floor plan
  - `path.ts`: A* routing
  - `crowd.ts`: who walks where
  - `office.ts`: canvas drawing with depth sorting

The office is a 320×140 pixel world scaled by whole numbers, with a separate four-seat meeting room. Workers walk A* routes on a 2px grid. Furniture footprints are widened by half a body, so shoulders never clip a desk.

## Credits

The pixel font is [Galmuri](https://github.com/quiple/galmuri) by Lee Minseo, under the SIL Open Font License (`public/fonts/LICENSE.txt`).
