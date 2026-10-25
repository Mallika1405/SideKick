# Sidekick

A voice-first companion for AI-assisted coding, built at Cal Hacks 13.0. While Claude Code (or you) edits a repo, Sidekick:

1. **Narrates** each change in plain spoken language, generated from the actual diff (never from Claude Code's own summary).
2. **Answers spoken questions** about the code, with file and line citations, and can be interrupted mid-sentence.
3. **Flags likely bugs** aloud in a second voice, and marks them in the editor (red = bug, orange = warn, blue = info), separate from the language server's squiggles.
4. **Keeps a live whiteboard** next to your code, like a colleague at a whiteboard beside you: a *Map* of the architecture, a *Detail* view that zooms from component to file to function, and a *Sketch* view where the narrator draws small hand-style diagrams step by step, only when a picture helps.

Each of the four modes (narrate, listen, review, whiteboard) toggles independently from the editor status bar. Everything runs from the editor: voice in, voice out, captions, whiteboard and highlights all live in VS Code (macOS for voice; see limitations). Built during Cal Hacks 13.0 with Claude Code; the first commit is Sat Oct 24, 7:40 PM.

**See it working:** [`DEMO.md`](DEMO.md) is the run sheet: Claude builds a tiny shopping cart while Sidekick explains it and the Map grows from nothing, you edit by hand and the Reviewer catches the bug, you ask a follow-up out loud, and a short clip shows the same tool on a real 60-file research project.

## Who it's for

**Undergraduate researchers who let Claude Code write their analysis scripts and then have to defend the results** to a PI, a labmate or a reviewer. AI-written changes are often not obvious: a one-line edit can leak test data into training, hard-code a threshold that used to come from config, or drop a cap on a corrected p-value. Reading every diff is slow, and a bad change looks the same as a good one.

Our own test case is a real Claude Code hook payload (`server/samples/post-tool-use.example.json`): Claude standardises the features using the whole dataset *before* the train/test split in `sleepstudy/models/split.py`. The narrator says exactly that in one spoken sentence (it is case `split-leakage` in the eval, scored accurate), and the Reviewer is there to flag it as a bug. That is the moment the tool exists for.

<!-- TODO (Mallika): add 2-3 first-person sentences here about a time you or a labmate had to explain or defend AI-written analysis code, plus one short quote from someone else. Judges (Anthropic track, Microsoft Customer Impact) look for a real person with a real problem. Delete this comment when done. -->

## Judging at a glance

| Track | What to look at |
|---|---|
| **Cartesia** | Streaming TTS in two voices, `ink-2` turn-based STT with barge-in, context cancel: [Cartesia features](#cartesia-features-and-where-they-live). Voice is the product, and nothing important is voice-only: [Accessibility](#accessibility-and-responsible-design) |
| **Anthropic** | Haiku narrates and reviews, Sonnet answers and draws; always grounded in the real diff. 15-case honesty eval, 15/15 accurate, with caveats: [Honesty eval](#honesty-eval), [Known limitations](#known-limitations) |
| **Moss** | Real-time semantic retrieval behind every spoken answer, re-indexed on every save and Claude edit; measured latency and an honest comparison with keyword search: [How each sponsor is used](#how-each-sponsor-is-used) |
| **Convex** | Reactive backend: the whiteboard updates through `useQuery`, six tables, six functions: `convex/` |
| **Notability** | Ideation note, pivots and the four-setting mapping to shipped code: [Notability](#notability) |
| **Microsoft** (Grand Prize, Customer Impact) | Named user and problem, measurable accuracy, responsible design, path to production: [Who it's for](#who-its-for), [Honesty eval](#honesty-eval), [Accessibility](#accessibility-and-responsible-design), [From hackathon to product](#from-hackathon-to-product) |

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
| `sidekick.nativeAudio` (default on) | `false` + reload: use the browser for voice instead (fallback only) |

## Architecture

```
Claude Code --HTTP hooks--> Server <--WebSocket--> Editor extension (VS Code)
                              |                      |-- whiteboard panel (webview iframe of the server-served console page)
                              |                      '-- native audio helper (macOS): mic in, voice out
                              |--> Anthropic API   (narrate/review: claude-haiku-5-5; answers/graph: claude-sonnet-5-5)
                              |--> Cartesia        (TTS + STT WebSockets)
                              |--> Moss            (in-process semantic index; keyword fallback)
                              '--> Convex          (edits, narrations, issues, graph; in-memory fallback)
Whiteboard page <--WebSocket--> Server        Whiteboard page --useQuery--> Convex
```

| Dir | What |
|---|---|
| `server/` | Node + TypeScript hub: hook endpoints, WebSocket, Claude/Cartesia/Moss/Convex clients, serves the built console |
| `extension/` | VS Code extension (Cursor untested): edit capture, highlights, issue marks, whiteboard panel, Talk/audio; `native/` holds the Swift audio helper |
| `console/` | Vite + React + `@xyflow/react` + rough.js: whiteboard (Map/Detail/Sketch) |
| `convex/` | Schema and small mutations/queries (no Claude calls inside Convex) |
| `shared/` | TypeScript types and zod WebSocket schemas |
| `demo-fresh/` | the empty project used for the live demo, with the hooks config |
| `demo-repo/` | a 60-file pandas project used for retrieval, the eval and testing |
| `eval/` | 15-case narration honesty eval, scored |
| `docs/` | Notability note export (`notability.pdf`) |
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

## Accessibility and responsible design

**Nothing important is voice-only.**
- Everything spoken also appears as live captions in the editor, so the narrator, the Reviewer and spoken answers can be read as well as heard.
- Reviewer findings are marked on the line (red = bug, orange = warn, blue = info) with the issue text, not just spoken.
- The narrator highlights the lines it is describing and jumps the editor to them.
- You can skip any narration with a key (`Cmd+Alt+S`), toggle narrate, listen, review and whiteboard independently, and ask questions with a shortcut (`Cmd+Alt+T`) instead of always-on listening.

**Honest by construction.** Narration is generated from the actual diff, never from Claude Code's own summary of what it did; the whiteboard Detail view is built deterministically from the code so it cannot invent structure; sketch plots are schematic and labelled, and the model is told never to invent numbers; the Reviewer only speaks `bug` severity so it does not nag.

**Privacy.** API keys stay on the local server. `.env*`, `*.pem`, `*.key` and `id_rsa*` are never read for prompts, and common secret patterns are redacted before any API call (the list is not exhaustive). Moss search runs in-process. Convex is optional; without it nothing is persisted. With it, edits, narrations and issues are stored in your own Convex deployment.

## From hackathon to product

Today: a packaged VSIX, a macOS audio helper, a local server you start yourself. To ship it to labs:
1. Publish the extension to the VS Code Marketplace and add a one-command installer for the server.
2. Port the audio helper to Windows and Linux (VS Code webviews cannot open the mic, which is why a helper exists).
3. Put an auth token on the local WebSocket and the served page (both are localhost-only and unauthenticated today).
4. Grow the honesty eval and add a Reviewer eval so accuracy is tracked on every prompt change, and add real Claude Code runs to the cases.
5. Verify Cursor and other VS Code forks.

## Notability

The idea started as a Notability note, and the build follows it closely. The note (link below, exported to [`docs/notability.pdf`](docs/notability.pdf)) contains four handwritten ideation pages, a hand-drawn sketch of the architecture and an audio recording walking through the idea. Sketches and audio may not appear in the PDF export, so open the link for the full note.

Note link: https://notability.com/app/note/ae96014d-8664-420a-85fa-d5a0654ee037

**The note's four independently toggleable settings, and what they became:**

| From the note | Shipped as | Where |
|---|---|---|
| 1. Explains line by line, in simple language, the changes Claude is making, by voice | **Narrate** | `server/src/narrate.ts`, `speech.ts`, `cartesia.ts` |
| 2. Always listening; ask anything about the code at any time and it answers by voice | **Listen** | `server/src/stt.ts`, `answer.ts`, `retriever.ts` |
| 3. Monitors for issues, flags them aloud or marks them in the code as you type | **Review** (second voice plus line highlights) | `server/src/review.ts`, `extension/src/extension.ts` |
| 4. Side-panel whiteboard that sketches the architecture live and goes deeper on any concept, by voice | **Whiteboard** (Map, Detail, Sketch) | `server/src/graph.ts`, `console/src/` |
| "You ask Claude to write code OR type manually; the extension passively tracks both" | Claude Code hooks plus editor edit capture | `demo-fresh/.claude/settings.json`, `extension/src/extension.ts` |

**Where the build diverged from the note.** The note has "VS Code / ~~Cursor~~" and "Claude Code? → Maybe": we committed to VS Code with Claude Code hooks. Real timestamps from `git log`:

| When | What changed |
|---|---|
| Sat 8:02 PM to 8:33 PM | Narration, then spoken Q&A with barge-in, then the first whiteboard (settings 1, 2, 4) |
| Sat 8:51 PM | Reviewer added (setting 3); thinking disabled on all calls |
| Sat 10:38 PM | Sonnet rejects `thinking: disabled`, so it moved to `between_tools` |
| Sat 11:38 PM | Review issues became red/orange/blue line highlights instead of language-server squiggles |
| Sat 11:43 PM | Whiteboard moved into a panel inside VS Code |
| Sat 11:52 PM | Claude was writing files through shell commands and we missed them; hooks broadened and the project is re-scanned on Stop |
| Sun 12:33 AM | Whiteboard v2: Map, Detail and the hand-drawn Sketch view timed to speech |
| Sun 2:54 AM to 3:01 AM | VS Code webviews cannot open the mic, so we built a native audio helper |
| Sun 6:10 AM | Moss measured against keyword search; results were mixed, and we say so above |

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

`npm run eval` replays 15 scripted diffs (applied to real `demo-repo` files, see `eval/cases.ts`; they are not live Claude Code edits) through the narrate prompt and writes `eval/narration-eval.csv`: the diff, a hand-written "what actually changed", the narration and the highlighted lines. We scored every narration by hand as accurate / partly / wrong against the diff.

**Result: 15 of 15 accurate** (0 partly, 0 wrong). Narrations ran 14 to 26 words, so "terse" (target 20 words) is a soft limit.

What the cases cover: mostly the silent, easy-to-miss kind of change that matters in research code (standardising before the split, a threshold hard-coded instead of read from config, an upper bound that now lets impossible values through, a ridge search cut to one value, a forest cut from 200 trees to 5, a scaler that now returns data instead of itself, a Bonferroni cap removed, a t-test switched off Welch correction), plus benign controls (a plot title, an added metric, a changed fold count) to check the narrator does not invent drama.

How much to trust the number: it is 15 cases, scripted, scored by us (the authors), and about narration only. It says the narrator describes what a diff does without inventing or omitting the key fact; it does not say the narrator understands *why* Claude made a change, and it says nothing about the Reviewer. Review precision, sketch quality and latency are not measured (see below).

## Known limitations

**Tested and not:**
- Tested manually and live on macOS in VS Code (install, status bar, highlights, issue marks, whiteboard panel, native mic and voice, the full demo). **Not tested in Cursor** or on Windows/Linux.
- Moss was verified in isolation and in a one-off comparison; quality is mixed against keyword search (it finds code by meaning, but sometimes ranks the exact-word match lower). The server takes about 8 s longer to start with Moss keys set. If Moss fails to start it falls back to keyword search.
- Latency is not benchmarked. One scripted run showed first answer audio about 2 s after the question ended; real timing depends on model and network.
- Review precision and sketch quality are not measured; the eval above covers narration only. The reviewer is an LLM and can miss bugs or flag non-bugs (only `bug` severity is spoken, and only the changed file is reviewed). Whether the narrator sketches, and how good the picture is, varies by change; complex sketches can look cramped.

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
- Not done: Cursor verification (we claim VS Code only); a one-command installer for the server; Windows/Linux voice.