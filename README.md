# tokenOffice

A pixel-art office that shows your Claude Code and Codex sessions and subagents at work. Each session is a worker at a desk. They type while tools run and raise a speech bubble when they need your permission. When a turn ends they walk to the lounge. Subagents come in through the door as robots and leave when they finish.

Everything stays on this computer. The app listens only on `127.0.0.1` and keeps hook events in memory. The hooks forward event names, session IDs, the project folder name, tool names and subagent type. They never send prompts, tool inputs, notification text, file contents or transcript paths.

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

The hook is async and best-effort, so a closed dashboard never slows Claude Code down. The office shows a demo until the first event arrives. It switches to "Claude Code 연결됨" as soon as a session sends anything.

## Connect Codex

Press "Codex 연결하기" in the app or tick "Codex 연결" in the tray menu. The app copies its hook to `~/.codex/hooks/token-office.cjs` and adds its lifecycle hooks to `~/.codex/hooks.json`. Existing Codex settings and other hook entries are preserved; the previous hooks file is backed up as `hooks.json.tokenoffice-backup`. "연결 해제" removes only tokenOffice's entries.

Codex requires you to review and trust a new or changed hook before it runs. After connecting, run `/hooks` in Codex CLI, then review and trust the tokenOffice hooks. New Codex sessions appear after that. The hook runs with Node.js, so `node` must be on your PATH.

## Use

- Click a worker, in the office or the sidebar, to see what they are doing.
- Double-click a worker, or use ✎ in the sidebar, to rename them or pick another character. A session's name is remembered per project folder and a subagent's per subagent type, on this computer.
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

The office is a 240×140 pixel world scaled by whole numbers. Workers walk A* routes on a 2px grid. Furniture footprints are widened by half a body, so shoulders never clip a desk. The crowd tests simulate full trips and fail if anyone steps into furniture or ends up on top of someone else.

## Credits

The pixel font is [Galmuri](https://github.com/quiple/galmuri) by Lee Minseo, under the SIL Open Font License (`public/fonts/LICENSE.txt`).
