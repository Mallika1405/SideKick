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
let diagnostics: vscode.DiagnosticCollection;

type Issue = { file: string; line: number; severity: 'info' | 'warn' | 'bug'; message: string };
const SEVERITY = { info: vscode.DiagnosticSeverity.Information, warn: vscode.DiagnosticSeverity.Warning, bug: vscode.DiagnosticSeverity.Error };

function showIssues(items: Issue[]) {
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const i of items) {
    const line = Math.max(0, i.line - 1);
    const d = new vscode.Diagnostic(new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER), i.message, SEVERITY[i.severity]);
    d.source = 'Sidekick';
    byFile.set(i.file, [...(byFile.get(i.file) ?? []), d]);
  }
  diagnostics.clear();
  for (const [file, ds] of byFile) diagnostics.set(vscode.Uri.file(file), ds);
}

const highlightType = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
  isWholeLine: true,
  overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
});

const send = (m: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

function render() {
  connItem.text = online ? '$(unmute) Sidekick' : '$(mute) Sidekick (offline)';
  for (const mode of MODES) {
    const it = items.get(mode)!;
    it.text = `${toggles[mode] ? '$(check)' : '$(circle-slash)'} ${LABEL[mode]}`;
  }
}

async function highlight(file: string, start: number, end: number) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const editor = await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false });
  const range = new vscode.Range(Math.max(0, start - 1), 0, Math.max(0, end - 1), 0);
  editor.setDecorations(highlightType, [range]);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => editor.setDecorations(highlightType, []), 8000);
}

function connect() {
  ws = new WebSocket('ws://localhost:4317/ws?role=extension');
  ws.on('open', () => { online = true; render(); });
  ws.on('close', () => { online = false; render(); setTimeout(connect, 2000); });
  ws.on('error', () => { /* close handler reconnects */ });
  ws.on('message', (raw) => {
    let m: any;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === 'toggles') { Object.assign(toggles, m.modes); render(); }
    else if (m.type === 'highlight') void highlight(m.file, m.start, m.end);
    else if (m.type === 'issues') showIssues(m.items);
  });
}

export function activate(ctx: vscode.ExtensionContext) {
  diagnostics = vscode.languages.createDiagnosticCollection('sidekick');
  ctx.subscriptions.push(diagnostics);
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
  ctx.subscriptions.push(vscode.commands.registerCommand('sidekick.skip', () => send({ type: 'skip' })));
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
