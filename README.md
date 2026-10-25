# Sidekick

A voice-first companion for AI-assisted coding, built at Cal Hacks 13.0. While Claude Code (or you) edits a repo, Sidekick:

1. **Narrates** each change in plain spoken language, generated from the actual diff.
2. **Answers spoken questions** about the code, with file and line citations.
3. **Flags likely bugs** aloud (second voice) and as colored line highlights in the editor (red = bug, orange = warn, blue = info), separate from the language server's squiggles.
4. **Keeps a live whiteboard** that behaves like a colleague at a whiteboard next to you: a *Map* of the architecture, a *Detail* view that zooms from component to file to function (following what the narrator is discussing or the file you are on), and a *Sketch* view where the narrator draws hand-style diagrams step by step, in time with each sentence, but only when a picture actually helps.

Each mode toggles independently (editor status bar and console header). Target user: undergraduate researchers who use Claude Code for analysis scripts and have to defend the results. The demo repo (`demo-repo/`) is a 60-file pandas/scikit-learn project on sleep vs exam scores.

## Architecture

```
Claude Code --HTTP hooks--> Server <--WebSocket--> Editor extension (VS Code / Cursor)
                              |  <--WebSocket--> Console (browser tab: mic, audio out, whiteboard)
                              |--> Anthropic API   (narrate/review: claude-haiku-5-5; answers/graph: claude-sonnet-5-5)
                              |--> Cartesia        (TTS + STT WebSockets)
                              |--> Moss            (in-process semantic index; keyword fallback)
                              |--> Convex          (edits, narrations, issues, graph; in-memory fallback)
Console --useQuery--> Convex
```

| Dir | What |
|---|---|
| `server/` | Node 22 + TypeScript hub: hook endpoints, WebSocket, Claude/Cartesia/Moss/Convex clients |
| `console/` | Vite + React + `@xyflow/react`: mic, player, captions, whiteboard |
| `extension/` | VS Code/Cursor extension: edit capture, highlights, issue marks, whiteboard panel, toggles |
| `convex/` | Schema and small mutations/queries (no Claude calls inside Convex) |
| `shared/` | TypeScript types and zod WebSocket schemas |
| `demo-repo/` | The project Sidekick narrates, with `.claude/settings.json` hooks |
| `eval/` | 15-case narration honesty eval |

## Setup

Requires Node 22+. If `npx` resolves an older Node (a stray `node` package in a parent `node_modules/.bin` can do this), call tools with `node node_modules/<pkg>/...` instead.

```bash
npm install
cp .env.example .env        # fill in the keys below
npm run server              # hub on :4317
npm run console             # console on http://localhost:5173
```

`.env`: `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, `CARTESIA_NARRATOR_VOICE_ID`, `CARTESIA_REVIEWER_VOICE_ID`; optional `MOSS_PROJECT_ID`/`MOSS_PROJECT_KEY` (else keyword retrieval), `CONVEX_URL` (else in-memory store), `SIDEKICK_ROOT` (repo to index at startup; defaults to `demo-repo`). Keys never leave the server.

**Convex (optional):** `node node_modules/convex/bin/main.js dev`, then put the printed URL in `.env` as `CONVEX_URL`.

**Editor extension:** `npm run ext:build -w extension`, then either press F5 on the `extension/` folder in VS Code, or install `extension/sidekick-0.0.4.vsix` (built with `vsce package`).

**Whiteboard views:** the board switches itself as things happen (a green dot marks a tab with fresh content), and clicking a tab pins your choice for 20 seconds.
- *Map*: click a component to hear about it and open its Detail.
- *Detail*: built deterministically from the code (definitions, imports, calls/references; Python and TypeScript/JavaScript), so it is instant and does not invent structure. Click a file or function to drill in (the editor jumps there too), double-click to hear an explanation. Recently changed functions are flagged. It follows the narrator's highlights and, when the narrator is quiet, the file and function your cursor is in.
- *Sketch*: the narrator/answerer emits `SKETCH` JSON lines (boxes, notes, schematic plots, small tables) that are drawn with rough.js and laid out with dagre. Plots are schematic only and labelled as such; the model is told never to invent numbers.

**Whiteboard in the editor:** the extension opens the whiteboard as a panel beside your code (command `Sidekick: Open Whiteboard`; the Board status-bar toggle opens/closes it). The panel embeds the console's board-only view (`http://localhost:5173/?board=1`), so `npm run console` must be running. Mic and audio output stay in the main console tab (editor webviews have unreliable mic access); that tab can sit in the background.

**Use it:** open the console, click **Enable audio + mic**, then in `demo-repo/` run `claude` (trust the folder so the hooks load, confirm with `/hooks`). Edit code and listen. Hold **Space** in the console to ask a question; speaking over the narrator stops it. `scripts/reset-demo.sh` restores the demo repo.

## How each sponsor is used

**Cartesia** is the only voice provider. TTS (`sonic-3.5-2026-05-04`, pinned snapshot) speaks narration, answers and warnings; STT (`ink-2`) turns spoken questions into text. Both run over WebSockets from the server so the key stays server-side. See the feature table below. *Why:* low-latency streaming TTS and turn detection are what make barge-in feel conversational.

**Anthropic** runs every language task, always fed from the real diff or retrieved code: Haiku (`claude-haiku-5-5`) narrates (`server/src/narrate.ts`) and reviews (`review.ts`); Sonnet (`claude-sonnet-5-5`) answers questions (`answer.ts`) and emits whiteboard patches (`graph.ts`). Extended thinking is disabled on all calls (it consumed the small output budgets and added latency). *Why:* Haiku is fast enough for sub-few-second narration; Sonnet's answers are better grounded.

**Moss** is the in-process semantic index (`server/src/retriever.ts`, `MossRetriever`, `client.session()` with `moss-minilm`). Code is chunked at def/class/function boundaries with line numbers (`chunker.ts`), re-indexed on every save and Claude edit, and edits, narrations and graph node summaries are indexed too (`codeindex.ts`). Top-5 retrieval time is shown as a badge in the console. *Why:* questions are about meaning ("where do we handle missing data?"), not exact strings. It sits behind a `Retriever` interface with a TF-IDF keyword implementation as fallback.

**Convex** stores sessions, edits, narrations, issues and the graph (`convex/schema.ts`, `convex/sidekick.ts`, `ConvexStore` in `server/src/store.ts`). The console's whiteboard subscribes with `useQuery` (`console/src/main.tsx`), so graph updates arrive reactively. It sits behind a `Store` interface with an in-memory implementation.

### Cartesia features and where they live

| Feature | Where |
|---|---|
| TTS WebSocket, one `context_id` per utterance, `continue: true` chunks, empty final chunk closes the context | `server/src/cartesia.ts`, `server/src/speech.ts` |
| Streaming LLM output into TTS sentence by sentence | `server/src/narrate.ts`, `server/src/answer.ts` |
| Two voices (Narrator, Reviewer) | `server/src/speech.ts`, `server/src/index.ts` (`reviewBatch`) |
| Context cancel on barge-in / skip | `server/src/cartesia.ts` (`cancel`), `server/src/speaker.ts` |
| Raw PCM s16le 24 kHz streamed to Web Audio | `console/src/player.ts` |
| STT `ink-2` turn-based WebSocket, 16 kHz PCM s16le | `server/src/stt.ts`, `console/src/mic.ts` |
| `turn.start` as barge-in; `turn.eager_end` for speculative retrieval, discarded on `turn.resume`; `turn.end` commits the question | `server/src/index.ts` (`onStt`) |
| Lazy reconnect after idle disconnects | `server/src/cartesia.ts`, `server/src/stt.ts` |

## Honesty eval

`npm run eval -w server` replays 15 scripted diffs (applied to real demo-repo files, see `eval/cases.ts`) through the narrate prompt and writes `eval/narration-eval.csv`, with a hand-written "what actually changed" column and an empty score column for a human to fill with accurate / partly / wrong. **The committed CSV is unscored.** No accuracy figure is claimed.

## Known limitations

- **Editor extension is untested in a live editor.** It compiles and packages to a VSIX, but neither VS Code nor Cursor was installed on the development machine, so install, status-bar toggles, highlights and issue marks have not been exercised. The server side of those messages was tested with scripted WebSocket clients.
- **Hook payloads:** `PostToolUse` handling relies only on `tool_input.file_path`; before-text comes from a server-side shadow copy of the repo taken when the first prompt/hook arrives. Edits made before that snapshot, files over 300 KB, binary files and ignored files are not diffed. The Edit tool's input fields (`file_path`, `old_string`, `new_string`, `replace_all`) were read from a real session transcript, not from a saved hook payload.
- **Moss is untested.** It needs project keys that were not available; all retrieval testing used the keyword fallback. The Moss code is typed against the installed SDK but has never run.
- **Voice:** tested end to end with a scripted, synthesised question and with a live microphone in one session. Always-on mode uses a guessed loudness threshold (0.08) to detect barge-in over playback, and may need tuning per room/mic. Narration is not interruptible mid-sentence by anything but speech, skip, or a new question. Only English was considered.
- **Latency is not benchmarked.** One scripted run showed first answer audio about 2 s after the question ended; narration timing depends on model and network.
- **Review precision is unmeasured.** The reviewer is an LLM and can miss bugs or flag non-bugs; only `bug` severity is spoken. It reviews the changed file only.
- **Sketches** are generated by an LLM from the prompt rules in `server/src/protocol.ts`; whether it sketches (and how good the picture is) varies by change and is not measured. Layout is automatic, so complex sketches can look cramped. Sketch steps are timed to speech by estimating about 65 ms per character, not from real audio timestamps.
- **Detail view** uses regex-based parsing, not a full language server: it handles top-level and nested `def`/`class` in Python and common function/class/arrow-function forms in TS/JS, resolves relative and package imports within the repo, and can miss dynamic calls, methods called through objects, and star imports.
- **Whiteboard (Map):** the initial graph is generated by one Sonnet call from file and symbol names, so it reflects structure, not behaviour. Layout is recomputed on every update and nodes can shift. With Convex, each server start creates a new session and a fresh graph.
- **Narration quality:** summaries come from the diff plus about 40 lines of context; the model can still describe intent it cannot see. Verbosity "terse" is a prompt, not a hard limit.
- **Security:** files matching `.env*`, `*.pem`, `*.key`, `id_rsa*` are never read for prompts, and common secret patterns are redacted before any API call, but the regex list is not exhaustive.
- **Not done:** Cursor verification, authentication for the local WebSocket (it listens on localhost only), packaging the server and console for one-command start.
