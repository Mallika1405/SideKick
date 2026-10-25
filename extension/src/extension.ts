import * as vscode from 'vscode';
import WebSocket from 'ws';

type Mode = 'narrate' | 'listen' | 'review' | 'whiteboard';
const MODES: Mode[] = ['narrate', 'listen', 'review', 'whiteboard'];
const LABEL: Record<Mode, string> = { narrate: 'Narrate', listen: 'Listen', review: 'Review', whiteboard: 'Board' };

let ws: WebSocket | undefined;
let online = false;
const timers = new Map<string, NodeJS.Timeout>();
const shadow = new Map<string, string>();
const toggles: Record<Mode, boolean> = { narrate: true, listen: true, review: true, whiteboard: true };
const items = new Map<Mode, vscode.StatusBarItem>();
let connItem: vscode.StatusBarItem;
let clearTimer: NodeJS.Timeout | undefined;
let boardPanel: vscode.WebviewPanel | undefined;
const CONSOLE_URL = 'http://localhost:5173/?board=1';

/** Whiteboard inside the editor: the console's board-only view in a webview iframe (mic/audio stay in the browser tab). */
async function openBoard() {
  if (boardPanel) { boardPanel.reveal(vscode.ViewColumn.Beside, true); return; }
  const src = (await vscode.env.asExternalUri(vscode.Uri.parse(CONSOLE_URL))).toString(true);
  boardPanel = vscode.window.createWebviewPanel('sidekickBoard', 'Sidekick Whiteboard', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true });
  boardPanel.onDidDispose(() => (boardPanel = undefined));
  boardPanel.webview.html = `<!doctype html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:* http://127.0.0.1:* https:; style-src 'unsafe-inline';">
<style>html,body{margin:0;height:100%;background:#fff}iframe{border:0;width:100%;height:100%}</style></head>
<body><iframe src="${src}"></iframe></body></html>`;
}
function closeBoard() { boardPanel?.dispose(); }
const highlightType = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
  isWholeLine: true,
  overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
});

type Issue = { file: string; line: number; severity: 'info' | 'warn' | 'bug'; message: string };
const deco = (rgb: string) => vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: `rgba(${rgb}, 0.18)`,
  borderWidth: '0 0 0 3px', borderStyle: 'solid', borderColor: `rgb(${rgb})`, // left bar
  overviewRulerColor: `rgb(${rgb})`, overviewRulerLane: vscode.OverviewRulerLane.Right,
});
const issueTypes: Record<Issue['severity'], vscode.TextEditorDecorationType> = {
  bug: deco('229, 57, 53'), warn: deco('245, 166, 35'), info: deco('66, 133, 244'),
};
let issues: Issue[] = [];

// Issues are drawn as line highlights (not diagnostics) so they never collide with the language server's squiggles.
function renderIssues(editor: vscode.TextEditor) {
  const mine = issues.filter((i) => i.file === editor.document.uri.fsPath);
  for (const sev of Object.keys(issueTypes) as Issue['severity'][]) {
    const opts: vscode.DecorationOptions[] = mine.filter((i) => i.severity === sev).map((i) => {
      const line = Math.min(Math.max(0, i.line - 1), editor.document.lineCount - 1);
      const text = i.message.length > 90 ? i.message.slice(0, 87) + '...' : i.message;
      return {
        range: new vscode.Range(line, 0, line, 0),
        hoverMessage: new vscode.MarkdownString(`**Sidekick (${sev})**: ${i.message}`),
        renderOptions: { after: { contentText: `   ${text}`, color: new vscode.ThemeColor('editorCodeLens.foreground'), fontStyle: 'italic' } },
      };
    });
    editor.setDecorations(issueTypes[sev], opts);
  }
}
function showIssues(items: Issue[]) {
  issues = items;
  for (const e of vscode.window.visibleTextEditors) renderIssues(e);
}

const send = (m: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

function render() {
  connItem.text = online ? '$(unmute) Sidekick' : '$(mute) Sidekick (offline)';
  for (const mode of MODES) {
    const it = items.get(mode)!;
    it.text = `${toggles[mode] ? '$(check)' : '$(circle-slash)'} ${LABEL[mode]}`;
  }
}

/** Opens the file if needed, switches to it in the editor group the user is working in, highlights the lines and scrolls to them. */
async function highlight(file: string, start: number, end: number) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.window.visibleTextEditors[0]?.viewColumn ?? vscode.ViewColumn.One;
  const editor = await vscode.window.showTextDocument(doc, { viewColumn: column, preserveFocus: true, preview: false });
  const range = new vscode.Range(Math.max(0, start - 1), 0, Math.max(0, end - 1), 0);
  for (const e of vscode.window.visibleTextEditors) e.setDecorations(highlightType, []);
  editor.setDecorations(highlightType, [range]);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => { for (const e of vscode.window.visibleTextEditors) e.setDecorations(highlightType, []); }, 8000);
}

function connect() {
  ws = new WebSocket('ws://localhost:4317/ws?role=extension');
  ws.on('open', () => { online = true; render(); });
  ws.on('close', () => { online = false; render(); setTimeout(connect, 2000); });
  ws.on('error', () => { /* close handler reconnects */ });
  ws.on('message', (raw) => {
    let m: any;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === 'toggles') { Object.assign(toggles, m.modes); render(); if (toggles.whiteboard) void openBoard(); else closeBoard(); }
    else if (m.type === 'highlight') void highlight(m.file, m.start, m.end);
    else if (m.type === 'issues') showIssues(m.items);
  });
}

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((es) => es.forEach(renderIssues)),
    ...Object.values(issueTypes),
  );
  connItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 110);
  connItem.command = 'sidekick.skip';
  connItem.tooltip = 'Sidekick: click to skip current narration';
  connItem.show();
  ctx.subscriptions.push(connItem);
  MODES.forEach((mode, i) => {
    const it = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 105 - i);
    it.command = `sidekick.toggle.${mode}`;
    it.tooltip = `Sidekick ${LABEL[mode]} mode (click to toggle)`;
    it.show();
    items.set(mode, it);
    ctx.subscriptions.push(it, vscode.commands.registerCommand(`sidekick.toggle.${mode}`, () => send({ type: 'toggle', mode, on: !toggles[mode] })));
  });
  ctx.subscriptions.push(
    vscode.commands.registerCommand('sidekick.skip', () => send({ type: 'skip' })),
    vscode.commands.registerCommand('sidekick.openBoard', () => openBoard()),
  );
  render();
  connect();

  for (const d of vscode.workspace.textDocuments) shadow.set(d.uri.fsPath, d.getText());
  ctx.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => { if (!shadow.has(d.uri.fsPath)) shadow.set(d.uri.fsPath, d.getText()); }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const doc = e.document;
      if (doc.uri.scheme !== 'file' || e.contentChanges.length === 0) return;
      const file = doc.uri.fsPath;
      clearTimeout(timers.get(file));
      timers.set(file, setTimeout(() => {
        const before = shadow.get(file) ?? '';
        const after = doc.getText();
        if (before === after) return;
        shadow.set(file, after);
        // The server dedupes against its own copy, so an edit it already saw via a Claude hook is not reported twice.
        send({ type: 'edit', file, before, after, ts: Date.now() });
      }, 1000));
    }),
  );
}

export function deactivate() { ws?.close(); }
