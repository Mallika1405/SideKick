# Sidekick demo: a shopping cart in three small steps

Premise: a tiny cart that adds up prices, applies a discount, then tax. Nobody has to think about the problem, so judges watch the tool.
Covers: **narrator, reviewer, listener**, and the whiteboard's **Map, Detail and Sketch** views.

## Before you start (once)

1. Reset the project and start the server (leave it running):
   ```bash
   cd /Users/mallika/SideKick && ./scripts/reset-demo.sh >/dev/null; ./scripts/new-demo.sh && npm run demo:server
   ```
2. In VS Code (extension 0.0.5+, `sidekick.nativeAudio` on): **File > Open Folder** `/Users/mallika/SideKick/demo-fresh`. The whiteboard panel opens beside the editor. Status bar should show **Talk** (not "Mic off").
3. Only if you use the browser tab instead of native audio: `npm run console`, open http://localhost:5173, click **Enable audio + mic**.
4. In VS Code's terminal, in `demo-fresh`, start Claude Code and check the hooks loaded:
   ```bash
   claude
   ```
   then type `/hooks` and look for PostToolUse, UserPromptSubmit, Stop. (`CLAUDE.md` in this folder keeps Claude's output tiny: only the files you ask for, under 15 lines, no running code.)
5. Do a 10-second mic check: press **Cmd+Alt+T**, say "hello", and watch the status bar.

Between rehearsals: close Claude (`/exit`), run `./scripts/new-demo.sh`, restart the server (Ctrl+C, `npm run demo:server`), reload the VS Code window.

## Beat 1: Claude writes code, Sidekick explains it (about 1 minute)

Type these two prompts into Claude Code, one after the other (wait for the narrator to finish the first before sending the second):

1. `Create cart.py with add_item(cart, name, price) and subtotal(cart).`
2. `Now create pricing.py with apply_discount(price, percent) and add_tax(price, rate), and main.py that builds a cart with two items, applies a 10 percent discount and 8 percent tax, and prints the total.`

What should happen (say it as it happens):
- The editor jumps to each new file and highlights what the narrator is describing: **"it follows what it's talking about."**
- The whiteboard flips to the **Map** for a few seconds each time a new component appears (Cart, then Pricing, then Main), then zooms into the **Detail** view of the file being discussed (functions and what calls what).
- When it explains `main.py`, it draws a small flow **Sketch** (cart subtotal, discount, tax, total).

## Beat 2: you edit by hand, the Reviewer catches it (about 30 seconds)

Open `pricing.py`. In `apply_discount`, change the `100` to `10` (so `percent / 100` becomes `percent / 10`). Pause for a couple of seconds.

What should happen:
- The line turns **red** with the issue text next to it almost immediately.
- The narrator says what changed, then a **different voice (the Reviewer)** jumps to the line and says what goes wrong ("a 10 percent discount would remove the entire price").

Then change it back to `100` (the red mark clears on the next review).

## Beat 3: ask a follow-up out loud (about 30 seconds)

Press **Cmd+Alt+T** and ask: **"How does an item end up in the final total?"**
(Alternative: **"Where is the discount applied?"**)

What should happen:
- Pressing Talk interrupts anything being said, so you can cut in at any moment.
- The answer is spoken with file and line citations while the editor jumps to those lines and a **Sketch** builds up the path from item to total.
- A judge can ask the next question themselves.

## If something goes wrong

- **No voice / "Mic off":** hover the status-bar item for the reason. macOS may need mic access for VS Code (System Settings > Privacy & Security > Microphone), then reload the window. Fallback: set `sidekick.nativeAudio` to false, reload, and use the browser tab.
- **Whiteboard panel blank:** `npm run console` must be running (the panel loads from it).
- **Narrator seems behind:** it merges changes if Claude is faster than speech; just wait a few seconds.
- **Claude wrote more than asked:** `/exit`, `./scripts/new-demo.sh`, restart the server and try again.
- Safety net: record one clean run beforehand.
