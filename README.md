# tokenOffice

A pixel-art office that shows your Claude Code sessions and subagents at work. Each session is a worker at a desk. They type while tools run and raise a speech bubble when they need your permission. When a turn ends they walk to the lounge. Subagents come in through the door as robots and leave when they finish.

Everything stays on this computer. The app listens only on `127.0.0.1` and keeps hook events in memory. The hook forwards event names, session IDs, the project folder name, tool names and subagent type. It never sends prompts, tool inputs, notification text, file contents or transcript paths.

## Install (Windows)

```sh
npm install
npm run dist
```

Then run `dist/tokenOffice Setup <version>.exe`. The app lives in the tray. Closing the window keeps it running, so it keeps receiving events. Quit it from the tray menu, where you can also turn on starting with Windows.

## Connect Claude Code

Copy `hook/token-office.cjs` to `~/.claude/hooks/` and register it in `~/.claude/settings.json` for these events: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Notification, SubagentStart, SubagentStop, TeammateIdle, Stop, StopFailure, SessionEnd.

Each entry looks like:

```json
{ "hooks": [{ "type": "command", "command": "node", "args": ["<home>/.claude/hooks/token-office.cjs"], "async": true }] }
```

The hook is async and best-effort, so a closed dashboard never slows Claude Code down. The office shows a demo until the first event arrives. It switches to "Claude Code 연결됨" as soon as a session sends anything.

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

If the installed app is running, it owns port 47821. To run another copy side by side, set `TOKEN_OFFICE_PORT` first (PowerShell: `$env:TOKEN_OFFICE_PORT=47900; npm start`). Hook events still go to 47821.

### Layout

- `src/shared/` holds the pixel art as data (`pixels.ts`) and the types shared by both sides.
- `src/server/` holds the hook receiver. `state.ts` is a pure reducer from hook events; `server.ts` is the local-only HTTP server.
- `src/main/` is the Electron tray shell.
- `src/renderer/` is the dashboard UI. Under `office/`:
  - `layout.ts`: the floor plan
  - `path.ts`: A* routing
  - `crowd.ts`: who walks where
  - `office.ts`: canvas drawing with depth sorting

The office is a 240×140 pixel world scaled by whole numbers. Workers walk A* routes on a 2px grid. Furniture footprints are widened by half a body, so shoulders never clip a desk. The crowd tests simulate full trips and fail if anyone steps into furniture or ends up on top of someone else.

## Credits

The pixel font is [Galmuri](https://github.com/quiple/galmuri) by Lee Minseo, under the SIL Open Font License (`public/fonts/LICENSE.txt`).
