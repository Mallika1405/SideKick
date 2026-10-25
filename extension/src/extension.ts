import * as vscode from 'vscode';
import WebSocket from 'ws';

let ws: WebSocket | undefined;
const timers = new Map<string, NodeJS.Timeout>();
const shadow = new Map<string, string>();

function connect(status: vscode.StatusBarItem) {
  ws = new WebSocket('ws://localhost:4317/ws?role=extension');
  ws.on('open', () => (status.text = '$(unmute) Sidekick'));
  ws.on('close', () => { status.text = '$(mute) Sidekick (offline)'; setTimeout(() => connect(status), 2000); });
  ws.on('error', () => { /* close handler reconnects */ });
}

export function activate(ctx: vscode.ExtensionContext) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(mute) Sidekick (offline)';
  status.show();
  ctx.subscriptions.push(status);
  connect(status);

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
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'edit', file, before, after, ts: Date.now() }));
      }, 1000));
    }),
  );
}

export function deactivate() { ws?.close(); }
