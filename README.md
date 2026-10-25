# Sidekick

A voice-first companion for AI-assisted coding, built at Cal Hacks 13.0. While Claude Code (or you) edits a repo, Sidekick:

1. **Narrates** each change in plain spoken language, generated from the actual diff (never from Claude Code's own summary).
2. **Answers spoken questions** about the code, with file and line citations, and can be interrupted mid-sentence.
3. **Flags likely bugs** aloud in a second voice, and marks them in the editor (red = bug, orange = warn, blue = info), separate from the language server's squiggles.
4. **Keeps a live whiteboard** next to your code, like a colleague at a whiteboard beside you: a *Map* of the architecture, a *Detail* view that zooms from component to file to function, and a *Sketch* view where the narrator draws small hand-style diagrams step by step, only when a picture helps.

Each of the four modes (narrate, listen, review, whiteboard) toggles independently from the editor status bar. Target user: undergraduate researchers who use Claude Code to write analysis scripts and then have to defend the results. Everything runs from the editor: voice in, voice out, whiteboard and highlights all live in VS Code (macOS for voice; see limitations).

**See it working:** [`DEMO.md`](DEMO.md) is a three-beat run sheet (Claude builds a tiny shopping cart while Sidekick explains it, you edit by hand and the Reviewer catches the bug, you ask a follow-up out loud).

## Quick start

Requires Node 22+ and macOS for native voice (everything except voice works elsewhere).

```bash
npm install
cp .env.example .env            # add your keys (see Configuration)
npm run ext:package             # builds extension/sidekick-<version>.vsix
npm run demo:server             # builds the whiteboard page and starts the hub on :4317 for demo-fresh/
```

1. In VS Code: Extensions > **…** > **Install from VSIX…**, pick the file `ext:package` printed, then reload the window. macOS will ask to let VS Code use the microphone; allow it.
2. Open the folder `demo-fresh/`. The whiteboard opens beside the editor and the status bar shows **Talk**.
3. In the VS Code terminal inside that folder run `claude`, trust the folder (that loads the hooks; check with `/hooks`), and follow `DEMO.md`.

If `npx` or `npm run` picks up an older Node than you selected (a stray `node` package in a parent `node_modules/.bin` can cause this), call tools directly: `node node_modules/<pkg>/...`.

### Configuration (`.env`)

| Variable | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` | narration, review, answers, whiteboard |
| `CARTESIA_API_KEY`, `CARTESIA_NARRATOR_VOICE_ID`, `CARTESIA_REVIEWER_VOICE_ID` | all voice (TTS and STT) |
| `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY` | optional: semantic code search (otherwise keyword search) |
| `CONVEX_URL` | optional: Convex store and reactive whiteboard (otherwise in-memory); run `node node_modules/convex/bin/main.js dev` once to get one |
| `SIDEKICK_ROOT` | repo to index at startup (default `demo-repo/`; `npm run demo:server` sets `demo-fresh/`) |

Keys live only on the server. `.env` is gitignored; `.env.example` is committed.

### Editor commands and settings

| Command / setting | What it does |
|---|---|
| **Talk** status-bar button, `Cmd+Alt+T` | start listening (it also interrupts whatever is being said); stops when your question is committed or after 20 s |
| `Sidekick: Toggle Always-On Mic` | hands-free; while the voice plays only loud speech passes (barge-in) |
| `Cmd+Alt+S`, or click the Sidekick status item | skip the current narration |
| Narrate / Listen / Review / Board status-bar items | toggle each mode (Board opens/closes the whiteboard panel) |
| `Sidekick: Open Whiteboard`, `Show Log` | reopen the panel; show the extension's log |
| `sidekick.nativeAudio` (default on) | `false` + reload: use the browser tab for voice instead |

**Browser-tab fallback:** open http://localhost:4317, click **Enable audio + mic**, hold **Space** to talk. It has a mic picker and a "raw mic" option, and shows retrieval stats. Do not use it at the same time as native audio (the server then routes voice only to the native client).

## Architecture

```
Claude Code --HTTP hooks--> Server <--WebSocket--> Editor extension (VS Code / Cursor)
                              |                      |-- whiteboard panel (webview iframe of the server-served console page)
                              |                      '-- native audio helper (macOS): mic in, voice out
                              |--> Anthropic API   (narrate/review: claude-haiku-5-5; answers/graph: claude-sonnet-5-5)
                              |--> Cartesia        (TTS + STT WebSockets)
                              |--> Moss            (in-process semantic index; keyword fallback)
                              '--> Convex          (edits, narrations, issues, graph; in-memory fallback)
Browser console (optional) <--WebSocket--> Server        Console --useQuery--> Convex
```

| Dir | What |
|---|---|
| `server/` | Node + TypeScript hub: hook endpoints, WebSocket, Claude/Cartesia/Moss/Convex clients, serves the built console |
| `extension/` | VS Code/Cursor extension: edit capture, highlights, issue marks, whiteboard panel, Talk/audio; `native/` holds the Swift audio helper |
| `console/` | Vite + React + `@xyflow/react` + rough.js: whiteboard (Map/Detail/Sketch) and the browser-tab voice fallback |
| `convex/` | Schema and small mutations/queries (no Claude calls inside Convex) |
| `shared/` | TypeScript types and zod WebSocket schemas |
| `demo-fresh/` | the empty project used for the live demo, with the hooks config |
| `demo-repo/` | a 60-file pandas project used for retrieval, the eval and testing |
| `eval/` | 15-case narration honesty eval |
| `scripts/` | `new-demo.sh`, `reset-demo.sh`, `package-extension.sh` |

How a change flows: a Claude Code hook (or the editor extension, for human edits) reports an edit; the server diffs the file against its saved copy, groups edits (flush after ~1.5 s of quiet or on Stop), then in parallel narrates (Haiku, streamed sentence by sentence into Cartesia TTS), reviews (Haiku, strict JSON), and updates the whiteboard graph (Sonnet, strict JSON patch). Files Claude writes through shell commands are caught by re-scanning the project on Stop and after shell tools.

### Whiteboard views

The board switches itself as things happen (a green dot marks a tab with fresh content); clicking a tab pins your choice for 20 seconds.

- **Map:** the high-level architecture, built incrementally from patches. It appears for a few seconds whenever a new component is added. Click a component to hear about it and open its Detail.
- **Detail:** built deterministically from the code (definitions, imports and calls/references, for Python and TypeScript/JavaScript), so it is instant and cannot invent structure. It follows the file the narrator is discussing and, when the narrator is quiet, the file and function your cursor is in. Click a node to drill in (the editor jumps there), double-click to hear an explanation; recently changed functions are flagged.
- **Sketch:** the narrator and answerer emit `SKETCH` JSON lines (boxes, notes, tables, schematic plots) that are timed to the sentence being spoken and drawn hand-style with rough.js. Plots are schematic only and labelled so; the model is told never to invent numbers.

## How each sponsor is used

**Cartesia** is the only voice provider. TTS (`sonic-3.5-2026-05-04`, pinned snapshot) speaks narration, answers and warnings in two voices; STT (`ink-2`, turn-based endpoint) turns spoken questions into text and gives us barge-in. Both run over WebSockets from the server so the key stays server-side. *Why:* low-latency streaming TTS and turn detection are what make interrupting the narrator feel conversational.

**Anthropic** runs every language task, always fed from the real diff or retrieved code: Haiku (`claude-haiku-5-5`) narrates (`server/src/narrate.ts`) and reviews (`review.ts`); Sonnet (`claude-sonnet-5-5`) answers questions (`answer.ts`) and emits whiteboard patches (`graph.ts`). The output protocol shared by narration and answers (highlights, sketches, focus) is in `protocol.ts`. Extended thinking is off (Haiku) or `between_tools` (Sonnet, which rejects `disabled`); with it on, the small output budgets were consumed by thinking. All prompts pass through a secret redactor (`redact.ts`). *Why:* Haiku is fast enough for narration within seconds; Sonnet's answers are better grounded.

**Moss** is the in-process semantic index (`server/src/retriever.ts`, `MossRetriever` on `client.session()` with `moss-minilm`). Code is chunked at def/class/function boundaries with line numbers (`chunker.ts`) and re-indexed on every save and Claude edit; edits, narrations and graph summaries are indexed too (`codeindex.ts`). Top-5 chunks go into the answer prompt. *Why:* questions are about meaning ("where do we turn the results into a picture?"), not exact strings. It sits behind a `Retriever` interface with a TF-IDF keyword implementation as fallback. Measured on the 60-file demo repo (`npm run moss-test -w server`): session start about 8 s, indexing 104 chunks about 5 s, queries about 1 ms, single-chunk update about 7 ms.

**Convex** stores sessions, edits, narrations, issues and the graph (`convex/schema.ts`, `convex/sidekick.ts`, `ConvexStore` in `server/src/store.ts`). The whiteboard subscribes with `useQuery` (`console/src/main.tsx`), so graph updates arrive reactively. It sits behind a `Store` interface with an in-memory implementation.

### Cartesia features and where they live

| Feature | Where |
|---|---|
| TTS WebSocket, one `context_id` per utterance, `continue: true` chunks, empty final chunk closes the context | `server/src/cartesia.ts`, `server/src/speech.ts` |
| Streaming LLM output into TTS sentence by sentence | `server/src/narrate.ts`, `server/src/answer.ts`, `server/src/protocol.ts` |
| Two voices (Narrator, Reviewer) | `server/src/speech.ts`, `server/src/index.ts` (`reviewBatch`) |
| Context cancel on barge-in / skip | `server/src/cartesia.ts` (`cancel`), `server/src/speaker.ts` |
| Raw PCM s16le 24 kHz played natively (or via Web Audio in the browser fallback) | `extension/native/sidekick-audio.swift`, `extension/src/audio.ts`, `console/src/player.ts` |
| STT `ink-2` turn-based WebSocket, 16 kHz PCM s16le | `server/src/stt.ts`, `extension/src/audio.ts`, `console/src/mic.ts` |
| `turn.start` as barge-in; `turn.eager_end` for speculative retrieval, discarded on `turn.resume`; `turn.end` commits the question | `server/src/index.ts` (`onStt`) |
| Lazy reconnect after idle disconnects | `server/src/cartesia.ts`, `server/src/stt.ts` |

## Development

| Command | What |
|---|---|
| `npm run server` / `npm run server:built` | hub with file watching (the second builds the whiteboard page first) |
| `npm run console` | Vite dev server on :5173 (browser-tab development only; the editor panel uses the server-served build) |
| `npm run console:build` | build the whiteboard page the server serves |
| `npm run ext:package` | build and package the extension (bump `extension/package.json` version first so VS Code treats it as new) |
| `npm run audio:build` | recompile the Swift helper (works around a duplicate-module-map bug in some Xcode command-line tools) |
| `npm run eval`, `npm run moss-test` | narration honesty eval; Moss vs keyword retrieval |
| `npm run ask-test -w server -- "question"` (with `ROLE=audio` when native audio is connected) | send a synthesised spoken question through the whole pipeline |
| `scripts/new-demo.sh`, `scripts/reset-demo.sh` | empty `demo-fresh/`; restore `demo-repo/` |

`server/samples/*.example.json` are real, path-sanitised Claude Code hook payloads (`PostToolUse`, `UserPromptSubmit`, `Stop`); the server writes the latest of each as the (gitignored) `*.latest.json`. `extension/bin/sidekick-audio` is the compiled helper (arm64 macOS), committed so the VSIX builds without Xcode.

### Honesty eval

`npm run eval` replays 15 scripted diffs (applied to real `demo-repo` files, see `eval/cases.ts`; they are not live Claude Code edits) through the narrate prompt and writes `eval/narration-eval.csv`, with a hand-written "what actually changed" column and an empty score column for a human to fill with accurate / partly / wrong. **The committed CSV was generated from the final prompts but is unscored; no accuracy figure is claimed.** Narrations ran 14 to 26 words, so "terse" (target 20 words) is a soft limit.

## Known limitations

**Tested and not:**
- Tested manually and live on macOS in VS Code (install, status bar, highlights, issue marks, whiteboard panel, native mic and voice, the full demo). **Not tested in Cursor** or on Windows/Linux.
- Moss was verified in isolation and in a one-off comparison; quality is mixed against keyword search (it finds code by meaning, but sometimes ranks the exact-word match lower). The server takes about 8 s longer to start with Moss keys set. If Moss fails to start it falls back to keyword search.
- Latency is not benchmarked. One scripted run showed first answer audio about 2 s after the question ended; real timing depends on model and network.
- Review precision and sketch quality are not measured. The reviewer is an LLM and can miss bugs or flag non-bugs (only `bug` severity is spoken, and only the changed file is reviewed). Whether the narrator sketches, and how good the picture is, varies by change; complex sketches can look cramped.

**Voice:**
- Native audio is macOS only and needs microphone permission for the editor; VS Code webviews cannot open the mic (`getUserMedia` never resolves in them), which is why a helper process exists. Echo handling relies on macOS voice processing where available; headphones are safest for always-on mode, whose barge-in loudness threshold (0.08) is a guess.
- English only was considered. Sketch steps are timed to speech by estimating about 65 ms per character, not from real audio timestamps.

**Understanding the code:**
- The Detail view uses regex-based parsing, not a language server: it handles Python `def`/`class` and common function/class/arrow-function forms in TS/JS, resolves imports within the repo, and can miss dynamic calls, methods called through objects, and star imports.
- The Map is generated by Sonnet from file and symbol names (and later diffs), so it reflects structure, not behaviour; layout is recomputed on updates and nodes can shift. With Convex, each server start or project switch creates a new session and a fresh graph.
- Narration is neutral and based on the diff plus about 40 lines of context; it can describe what changed but not why Claude chose it unless the code shows it.

**Plumbing:**
- Before-text for edits comes from a server-side copy of the project taken when the first prompt or hook arrives; edits made earlier, files over 300 KB, binary files and ignored files are not diffed. The project root only widens or switches (Claude's shell `cd` can put a hook's `cwd` in a subfolder).
- Files matching `.env*`, `*.pem`, `*.key`, `id_rsa*` are never read for prompts, and common secret patterns (AWS keys, `sk-`, `sk_car_`, bearer tokens, private keys) are redacted before any API call; the pattern list is not exhaustive.
- The local WebSocket and the server-served console page have no authentication (localhost only).
- Not done: Cursor verification; a one-command installer for the server.
