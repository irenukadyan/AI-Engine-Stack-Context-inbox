const vscode = require('vscode');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { execFile } = require('child_process');

let server;
let token;
let output;
let changeCount = 0;
let latestNote = '';
let watcher;
let selectedRoot;
let inboxProvider;
let inboxStatus;
let pairingProvider;
let extensionState;

function workspaceProjects() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length) return folders.map((folder, index) => ({ id: `workspace-${index}`, name: folder.name, root: folder.uri.fsPath }));
  return selectedRoot ? [{ id: 'selected-folder', name: path.basename(selectedRoot), root: selectedRoot }] : [];
}

function workspaceRoot(projectId) {
  const projects = workspaceProjects();
  return projects.find((project) => project.id === projectId)?.root || projects[0]?.root;
}

function addresses(port) {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${port}/mobile?token=${token}`);
      }
    }
  }
  return urls;
}

function pairingUrl() {
  const port = vscode.workspace.getConfiguration('aiRemoteControl').get('port', 8765);
  return addresses(port)[0] || `http://127.0.0.1:${port}/mobile?token=${token}`;
}

async function showPairingQr() {
  // This command is the quick entry point from the status bar, Activity Bar,
  // and Command Palette. If the quiet background start has not run yet, start
  // it and intentionally show the QR code for this user-requested action.
  if (!server || !token) return start({ showQr: true });
  const url = pairingUrl();
  const image = await QRCode.toDataURL(url, { width: 340, margin: 2, errorCorrectionLevel: 'M' });
  const panel = vscode.window.createWebviewPanel('aiRemoteControlPairing', 'AI Engine Stack: Pair your phone', vscode.ViewColumn.One, { enableScripts: true });
  panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:440px;margin:32px auto;text-align:center;color:#334155;background:#f8fafc;padding:0 20px}.brand{display:flex;justify-content:center;align-items:center;gap:8px;color:#0f172a;font-weight:700}.mark{background:#0d9488;color:#fff;border-radius:7px;padding:6px;font-size:.7rem}.brand b{color:#0d9488}h1{color:#0f172a;margin-bottom:8px}p{color:#64748b;line-height:1.5}img{width:min(340px,90vw);background:#fff;border:1px solid #e2e8f0;padding:12px;border-radius:12px}code{display:block;overflow-wrap:anywhere;background:#fff;border:1px solid #e2e8f0;padding:10px;border-radius:6px;text-align:left;font-size:.75rem;color:#475569}button{padding:10px 16px;border:0;border-radius:6px;font-weight:600;cursor:pointer;background:#0d9488;color:#fff}</style></head><body><div class="brand"><span class="mark">AI</span><span>AI Engine <b>Stack</b></span></div><h1>Pair your phone</h1><p>Open your phone camera and scan this code. Both devices must be on the same Wi-Fi.</p><img src="${image}" alt="Phone pairing QR code"><p>This pairing link expires when you stop or restart Context Inbox.</p><code>${url}</code><p><button id="copy">Copy link</button></p><script>document.getElementById('copy').onclick=()=>navigator.clipboard.writeText(${JSON.stringify(url)}).then(()=>document.getElementById('copy').textContent='Copied');</script></body></html>`;
}

class PairingProvider {
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage(async (message) => {
      if (message?.command === 'start') await start({ showQr: false });
      if (message?.command === 'openQr') await showPairingQr();
    });
    this.refresh();
  }

  async refresh() {
    if (!this.view) return;
    const running = Boolean(server && token);
    const image = running
      ? await QRCode.toDataURL(pairingUrl(), { width: 300, margin: 2, errorCorrectionLevel: 'M' })
      : '';
    if (!this.view) return;
    this.view.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px;text-align:center}
      h2{font-size:1.15rem;margin:4px 0 8px}p{color:var(--vscode-descriptionForeground);line-height:1.45}
      img{box-sizing:border-box;width:100%;max-width:300px;background:#fff;padding:10px;border-radius:8px}
      button{font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;border-radius:3px;padding:8px 14px;cursor:pointer}
      button:hover{background:var(--vscode-button-hoverBackground)}
    </style></head><body>
      ${running
        ? `<h2>Pair your phone</h2><p>Scan this code while your phone and computer are on the same Wi-Fi.</p><img src="${image}" alt="Phone pairing QR code"><p><button id="openQr">Open larger QR code</button></p>`
        : `<h2>Context Inbox is stopped</h2><p>Start it to create a phone pairing QR code.</p><button id="start">Start Context Inbox</button>`}
      <script>const vscode=acquireVsCodeApi();document.getElementById('start')?.addEventListener('click',()=>vscode.postMessage({command:'start'}));document.getElementById('openQr')?.addEventListener('click',()=>vscode.postMessage({command:'openQr'}));</script>
    </body></html>`;
  }
}

function safeFileName(value) {
  const cleaned = path.basename(String(value || 'upload')).replace(/[^a-zA-Z0-9._ -]/g, '_');
  return cleaned.slice(0, 120) || 'upload';
}

function controlDirectory(root) { return path.join(root, 'phone-transfer'); }
function inboxIndexPath(root) { return path.join(controlDirectory(root), 'inbox.json'); }
function readInbox(root) {
  try { const entries = JSON.parse(fs.readFileSync(inboxIndexPath(root), 'utf8')); return Array.isArray(entries) ? entries : []; }
  catch { return []; }
}
function writeInbox(root, entries) {
  fs.mkdirSync(controlDirectory(root), { recursive: true });
  fs.writeFileSync(inboxIndexPath(root), JSON.stringify(entries, null, 2));
  const pending = entries.filter((entry) => !entry.handled);
  const lines = ['# AI Engine Stack Context Inbox', '', 'Unhandled context sent from a paired phone:', ''];
  if (!pending.length) lines.push('No unhandled items.');
  pending.forEach((entry) => lines.push(`## ${entry.kind === 'note' ? 'Note' : 'File'} — ${entry.createdAt}`, '', entry.kind === 'note' ? entry.text : `File: \`${entry.relativePath}\``, ''));
  fs.writeFileSync(path.join(controlDirectory(root), 'INBOX.md'), lines.join('\n'));
}
function addInboxItem(root, item) {
  const entries = readInbox(root);
  entries.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), handled: false, ...item });
  writeInbox(root, entries); inboxProvider?.refresh();
}

function updateInboxStatus() {
  if (!inboxStatus) return;
  const root = workspaceRoot();
  const count = root ? readInbox(root).filter((entry) => !entry.handled).length : 0;
  inboxStatus.text = count ? `$(mail-unread) Context Inbox: ${count}` : '$(mail) Context Inbox: clear';
  inboxStatus.tooltip = `${count ? `${count} unhandled item(s) received from your phone.` : 'No unhandled phone items.'} Click to show the phone pairing QR code.`;
  inboxStatus.show();
}

class InboxProvider {
  constructor() { this.emitter = new vscode.EventEmitter(); this.onDidChangeTreeData = this.emitter.event; }
  refresh() { updateInboxStatus(); this.emitter.fire(undefined); }
  getTreeItem(item) { return item; }
  getChildren() {
    const root = workspaceRoot(); if (!root) return [];
    return readInbox(root).filter((entry) => !entry.handled).slice(0, 30).map((entry) => new InboxItem(entry));
  }
}
class InboxItem extends vscode.TreeItem {
  constructor(entry) {
    super(entry.kind === 'note' ? entry.text.replace(/\s+/g, ' ').slice(0, 60) : path.basename(entry.relativePath), vscode.TreeItemCollapsibleState.None);
    this.entry = entry; this.contextValue = 'aiRemoteControlInboxItem';
    this.description = new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.tooltip = `${entry.kind === 'note' ? entry.text : entry.relativePath}\nReceived ${new Date(entry.createdAt).toLocaleString()}`;
    this.iconPath = new vscode.ThemeIcon(entry.kind === 'note' ? 'comment' : 'file-media');
    this.command = { command: 'aiRemoteControl.openInboxItem', title: 'Open inbox item', arguments: [entry] };
  }
}

function sendJson(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function isAuthorized(req) {
  return req.headers.authorization === `Bearer ${token}`;
}

function gitStatus(root) {
  return new Promise((resolve) => {
    execFile('git', ['status', '--short'], { cwd: root, windowsHide: true }, (error, stdout) => {
      if (error) return resolve({ available: false, changedFiles: 0, entries: [] });
      const entries = stdout.trim().split(/\r?\n/).filter(Boolean).slice(0, 25);
      resolve({ available: true, changedFiles: entries.length, entries });
    });
  });
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('File is larger than the upload limit.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function mobilePage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#111827"><title>AI Remote Control</title><style>
  :root{color-scheme:dark;font-family:system-ui,sans-serif}body{margin:0;background:#111827;color:#f9fafb}.wrap{max-width:580px;margin:auto;padding:28px 18px}h1{font-size:1.5rem;margin:0 0 6px}.sub{color:#9ca3af;margin:0 0 24px}.card{background:#1f2937;border:1px solid #374151;border-radius:14px;padding:18px;margin:14px 0}input,textarea,button{font:inherit}input,textarea{box-sizing:border-box;width:100%;padding:12px;border-radius:9px;border:1px solid #4b5563;background:#111827;color:white;margin:8px 0 12px}textarea{min-height:90px}button{border:0;border-radius:9px;padding:12px 16px;background:#60a5fa;color:#0b1220;font-weight:700;width:100%}button:disabled{opacity:.55}.status{white-space:pre-wrap;font-size:.9rem;color:#d1d5db}.ok{color:#86efac}.err{color:#fca5a5}</style></head><body><main class="wrap"><h1>AI Remote Control</h1><p class="sub">Send a file or brief to the paired VS Code workspace.</p><section class="card"><strong>Workspace</strong><p id="workspace" class="status">Connecting…</p><p id="changes" class="status"></p></section><section class="card"><label for="file"><strong>File or screenshot</strong></label><input id="file" type="file" accept="image/*,.pdf,.txt,.md,.json,.csv"><button id="upload">Send to VS Code</button><p id="uploadStatus" class="status"></p></section><section class="card"><label for="note"><strong>Instruction / note</strong></label><textarea id="note" placeholder="Example: Use this screenshot to fix the checkout layout."></textarea><button id="sendNote">Send note</button><p id="noteStatus" class="status"></p></section></main><script>
  const token=new URLSearchParams(location.search).get('token'); const auth={'Authorization':'Bearer '+token};
  const message=(id,text,good=false)=>{const e=document.getElementById(id);e.textContent=text;e.className='status '+(good?'ok':'');};
  async function refresh(){try{const r=await fetch('/api/status',{headers:auth});const d=await r.json();if(!r.ok)throw Error(d.error);message('workspace',d.workspace);message('changes',d.git.available?d.git.changedFiles+' Git change(s) currently detected.':'Git status unavailable.');}catch(e){message('workspace','Connection error: '+e.message);}}
  document.getElementById('upload').onclick=async()=>{const f=document.getElementById('file').files[0];if(!f)return message('uploadStatus','Choose a file first.');const b=document.getElementById('upload');b.disabled=true;message('uploadStatus','Sending…');try{const r=await fetch('/api/upload',{method:'POST',headers:{...auth,'X-File-Name':encodeURIComponent(f.name),'Content-Type':f.type||'application/octet-stream'},body:f});const d=await r.json();if(!r.ok)throw Error(d.error);message('uploadStatus','Received in VS Code: '+d.file,true);document.getElementById('file').value='';refresh();}catch(e){message('uploadStatus',e.message)}finally{b.disabled=false}};
  document.getElementById('sendNote').onclick=async()=>{const value=document.getElementById('note').value.trim();if(!value)return message('noteStatus','Write a note first.');try{const r=await fetch('/api/note',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({text:value})});const d=await r.json();if(!r.ok)throw Error(d.error);message('noteStatus','Note delivered to VS Code.',true);document.getElementById('note').value='';}catch(e){message('noteStatus',e.message)}}; refresh();setInterval(refresh,5000);
  </script></body></html>`;
}

function mobilePage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#111827"><title>AI Context Inbox</title><style>
  :root{color-scheme:dark;font-family:system-ui,sans-serif}body{margin:0;background:#111827;color:#f9fafb}.wrap{max-width:580px;margin:auto;padding:28px 18px}h1{font-size:1.5rem;margin:0 0 6px}.sub{color:#9ca3af;margin:0 0 24px}.card{background:#1f2937;border:1px solid #374151;border-radius:14px;padding:18px;margin:14px 0}input,textarea,select,button{font:inherit}input,textarea,select{box-sizing:border-box;width:100%;padding:12px;border-radius:9px;border:1px solid #4b5563;background:#111827;color:white;margin:8px 0 12px}textarea{min-height:90px}button{border:0;border-radius:9px;padding:12px 16px;background:#60a5fa;color:#0b1220;font-weight:700;width:100%}button:disabled{opacity:.55}.status{white-space:pre-wrap;font-size:.9rem;color:#d1d5db}.ok{color:#86efac}</style></head><body><main class="wrap"><h1>AI Context Inbox</h1><p class="sub">Send context directly into an open VS Code project.</p><section class="card"><label for="project"><strong>Project in VS Code</strong></label><select id="project" disabled><option>Connecting...</option></select><p id="workspace" class="status"></p><p id="changes" class="status"></p></section><section class="card"><label for="file"><strong>File or screenshot</strong></label><input id="file" type="file" accept="image/*,.pdf,.txt,.md,.json,.csv"><button id="upload">Send to project</button><p id="uploadStatus" class="status"></p></section><section class="card"><label for="note"><strong>Instruction / note</strong></label><textarea id="note" placeholder="Example: Use this screenshot to fix the checkout layout."></textarea><button id="sendNote">Send note</button><p id="noteStatus" class="status"></p></section></main><script>
  const token=new URLSearchParams(location.search).get('token'), project=document.getElementById('project'), auth={'Authorization':'Bearer '+token};
  const message=(id,text,good=false)=>{const e=document.getElementById(id);e.textContent=text;e.className='status '+(good?'ok':'');};
  const headers=(extra={})=>({...auth,'X-Project-Id':project.value,...extra});
  function setProjects(items){const remembered=localStorage.getItem('airc-project');if(project.dataset.loaded!=='yes'){project.replaceChildren();items.forEach(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.name;project.append(option)});project.value=items.some(item=>item.id===remembered)?remembered:items[0]?.id||'';project.disabled=!items.length;project.dataset.loaded='yes';project.onchange=()=>{localStorage.setItem('airc-project',project.value);refresh()};}}
  async function refresh(){try{const r=await fetch('/api/status',{headers:headers()});const d=await r.json();if(!r.ok)throw Error(d.error);setProjects(d.projects||[]);const chosen=(d.projects||[]).find(item=>item.id===project.value);message('workspace',chosen?'Uploads are saved in '+chosen.name+'/phone-transfer/':'No project available.');message('changes',d.git.available?d.git.changedFiles+' Git change(s) currently detected.':'Git status unavailable.')}catch(e){message('workspace','Connection error: '+e.message)}}
  document.getElementById('upload').onclick=async()=>{const f=document.getElementById('file').files[0];if(!f)return message('uploadStatus','Choose a file first.');const b=document.getElementById('upload');b.disabled=true;message('uploadStatus','Sending...');try{const r=await fetch('/api/upload',{method:'POST',headers:headers({'X-File-Name':encodeURIComponent(f.name),'Content-Type':f.type||'application/octet-stream'}),body:f});const d=await r.json();if(!r.ok)throw Error(d.error);message('uploadStatus','Received: '+d.file,true);document.getElementById('file').value='';refresh()}catch(e){message('uploadStatus',e.message)}finally{b.disabled=false}};
  document.getElementById('sendNote').onclick=async()=>{const value=document.getElementById('note').value.trim();if(!value)return message('noteStatus','Write a note first.');try{const r=await fetch('/api/note',{method:'POST',headers:headers({'Content-Type':'application/json'}),body:JSON.stringify({text:value})});const d=await r.json();if(!r.ok)throw Error(d.error);message('noteStatus','Note delivered to VS Code.',true);document.getElementById('note').value=''}catch(e){message('noteStatus',e.message)}};refresh();setInterval(refresh,5000);
  </script></body></html>`;
}

function mobilePage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0d9488"><title>AI Engine Stack — Context Inbox</title><style>
  :root{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#334155;background:#f8fafc}*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#334155}.brandbar{height:64px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;padding:0 18px;color:#0f172a}.brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:1rem}.mark{width:27px;height:27px;border-radius:7px;background:#0d9488;color:white;display:grid;place-items:center;font-size:.67rem;letter-spacing:-1px}.brand b{color:#0d9488;font-style:normal}.product{font-size:.72rem;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.07em}.wrap{max-width:580px;margin:auto;padding:28px 18px 40px}h1{font-size:1.65rem;line-height:1.25;color:#0f172a;margin:0 0 8px}.sub{color:#64748b;margin:0 0 24px;line-height:1.55}.card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin:14px 0;box-shadow:0 1px 2px rgba(15,23,42,.03)}label,strong{color:#0f172a}input,textarea,select,button{font:inherit}input,textarea,select{width:100%;padding:12px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;margin:8px 0 12px}textarea{min-height:92px;resize:vertical}button{border:0;border-radius:6px;padding:12px 16px;background:#0d9488;color:#fff;font-weight:600;width:100%}button:disabled{opacity:.55}.status{white-space:pre-wrap;font-size:.88rem;color:#64748b;margin:4px 0 0}.ok{color:#0f766e;font-weight:600}</style></head><body><header class="brandbar"><div class="brand"><span class="mark">AI</span><span>AI Engine <b>Stack</b></span></div><span class="product">Context Inbox</span></header><main class="wrap"><h1>Send development context</h1><p class="sub">Files and notes go directly into the selected project in VS Code.</p><section class="card"><label for="project"><strong>Files or screenshots</strong></label><input id="file" type="file" multiple accept="image/*,.pdf,.txt,.md,.json,.csv"><button id="upload">Send to project</button><p id="uploadStatus" class="status"></p></section><section class="card"><label for="note"><strong>Instruction / note</strong></label><textarea id="note" placeholder="Example: Use this screenshot to fix the checkout layout."></textarea><button id="sendNote">Send note</button><p id="noteStatus" class="status"></p></section></main><script>
  const token=new URLSearchParams(location.search).get('token'), project=document.getElementById('project'), auth={'Authorization':'Bearer '+token};
  const message=(id,text,good=false)=>{const e=document.getElementById(id);e.textContent=text;e.className='status '+(good?'ok':'');};
  const headers=(extra={})=>({...auth,'X-Project-Id':project.value,...extra});
  function setProjects(items){const remembered=localStorage.getItem('airc-project');if(project.dataset.loaded!=='yes'){project.replaceChildren();items.forEach(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.name;project.append(option)});project.value=items.some(item=>item.id===remembered)?remembered:items[0]?.id||'';project.disabled=!items.length;project.dataset.loaded='yes';project.onchange=()=>{localStorage.setItem('airc-project',project.value);refresh()};}}
  async function refresh(){try{const r=await fetch('/api/status',{headers:headers()});const d=await r.json();if(!r.ok)throw Error(d.error);setProjects(d.projects||[]);const chosen=(d.projects||[]).find(item=>item.id===project.value);message('workspace',chosen?'Uploads are saved in '+chosen.name+'/phone-transfer/':'No project available.');message('changes',d.git.available?d.git.changedFiles+' Git change(s) currently detected.':'Git status unavailable.')}catch(e){message('workspace','Connection error: '+e.message)}}
  document.getElementById('upload').onclick=async()=>{const input=document.getElementById('file'),files=Array.from(input.files);if(!files.length)return message('uploadStatus','Choose one or more files first.');const b=document.getElementById('upload');b.disabled=true;const received=[],failed=[];try{for(const [index,f] of files.entries()){message('uploadStatus','Sending '+(index+1)+' of '+files.length+'...');try{const r=await fetch('/api/upload',{method:'POST',headers:headers({'X-File-Name':encodeURIComponent(f.name),'Content-Type':f.type||'application/octet-stream'}),body:f});const d=await r.json();if(!r.ok)throw Error(d.error);received.push(f.name)}catch(e){failed.push(f.name+': '+e.message)}}input.value='';if(failed.length)message('uploadStatus','Received '+received.length+' of '+files.length+'.\\nCould not send: '+failed.join('\\n'));else message('uploadStatus','Received '+received.length+' file'+(received.length===1?'':'s')+' in VS Code.',true);refresh()}finally{b.disabled=false}};
  document.getElementById('sendNote').onclick=async()=>{const value=document.getElementById('note').value.trim();if(!value)return message('noteStatus','Write a note first.');try{const r=await fetch('/api/note',{method:'POST',headers:headers({'Content-Type':'application/json'}),body:JSON.stringify({text:value})});const d=await r.json();if(!r.ok)throw Error(d.error);message('noteStatus','Note delivered to VS Code.',true);document.getElementById('note').value=''}catch(e){message('noteStatus',e.message)}};refresh();setInterval(refresh,5000);
  </script></body></html>`;
}

async function handle(req, res) {
  const root = workspaceRoot(req.headers['x-project-id']);
  if (!root) return sendJson(res, 409, { error: 'Open a folder or workspace in VS Code first.' });
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/mobile') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(mobilePage());
  }
  if (!url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
  if (!isAuthorized(req)) return sendJson(res, 401, { error: 'Pairing token required.' });
  if (req.method === 'GET' && url.pathname === '/api/status') {
    return sendJson(res, 200, { workspace: path.basename(root), projects: workspaceProjects().map(({ id, name }) => ({ id, name })), git: await gitStatus(root), changesObserved: changeCount, latestNote });
  }
  const config = vscode.workspace.getConfiguration('aiRemoteControl');
  if (req.method === 'POST' && url.pathname === '/api/upload') {
    try {
      const body = await readBody(req, config.get('maxUploadMb', 15) * 1024 * 1024);
      const inbox = path.join(controlDirectory(root), 'inbox');
      fs.mkdirSync(inbox, { recursive: true });
      const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}_${safeFileName(decodeURIComponent(req.headers['x-file-name'] || 'upload'))}`;
      const target = path.join(inbox, filename);
      fs.writeFileSync(target, body, { flag: 'wx' });
      addInboxItem(root, { kind: 'file', relativePath: path.relative(root, target) });
      vscode.window.showInformationMessage(`AI Engine Stack received ${filename}`);
      return sendJson(res, 201, { file: path.relative(root, target) });
    } catch (error) { return sendJson(res, 400, { error: error.message || 'Upload failed.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/note') {
    try {
      const body = JSON.parse((await readBody(req, 20 * 1024)).toString('utf8'));
      const text = String(body.text || '').trim().slice(0, 10000);
      if (!text) return sendJson(res, 400, { error: 'A note is required.' });
      latestNote = text;
      const notePath = path.join(controlDirectory(root), 'remote-notes.md');
      fs.mkdirSync(path.dirname(notePath), { recursive: true });
      fs.appendFileSync(notePath, `\n## ${new Date().toLocaleString()}\n\n${text}\n`);
      const itemPath = path.join(controlDirectory(root), 'notes', `${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
      fs.mkdirSync(path.dirname(itemPath), { recursive: true });
      fs.writeFileSync(itemPath, `${text}\n`);
      addInboxItem(root, { kind: 'note', text, relativePath: path.relative(root, itemPath) });
      vscode.window.showInformationMessage('AI Engine Stack received a mobile note.');
      return sendJson(res, 201, { ok: true });
    } catch (error) { return sendJson(res, 400, { error: error.message || 'Note failed.' }); }
  }
  return sendJson(res, 404, { error: 'Not found' });
}

async function start(options = {}) {
  const showQr = options.showQr !== false;
  if (server) return showQr ? showPairingQr() : showStatus();
  let root = workspaceRoot();
  if (!root) {
    const chosen = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Use this folder for AI Engine Stack',
      title: 'Choose the project folder to receive mobile files'
    });
    if (!chosen?.[0]) return vscode.window.showInformationMessage('AI Engine Stack was not started: no project folder selected.');
    selectedRoot = chosen[0].fsPath;
    root = selectedRoot;
  }
  token = crypto.randomBytes(24).toString('base64url');
  const port = vscode.workspace.getConfiguration('aiRemoteControl').get('port', 8765);
  server = http.createServer((req, res) => handle(req, res));
  server.on('error', (error) => { vscode.window.showErrorMessage(`AI Engine Stack could not start: ${error.message}`); server = undefined; });
  server.listen(port, '0.0.0.0', async () => {
    const url = pairingUrl();
    output.appendLine(`Mobile pairing URL: ${url}`);
    if (showQr) {
      await vscode.env.clipboard.writeText(url);
      output.show(true);
      vscode.window.showInformationMessage('AI Engine Stack Context Inbox is running. The mobile pairing URL was copied to your clipboard.');
    } else {
      vscode.window.showInformationMessage('AI Engine Stack Context Inbox is ready. Open the AI Engine Stack icon in the Activity Bar whenever you need to pair a phone.');
    }
    await pairingProvider?.refresh();
    if (showQr) {
      await showPairingQr();
      await extensionState?.update('hasSeenPairingOnboarding', true);
    }
  });
  const roots = workspaceProjects().map((project) => project.root);
  const watchers = roots.map((projectRoot) => {
    const projectWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(projectRoot, '**/*'));
    projectWatcher.onDidCreate(() => changeCount++); projectWatcher.onDidChange(() => changeCount++); projectWatcher.onDidDelete(() => changeCount++);
    return projectWatcher;
  });
  watcher = vscode.Disposable.from(...watchers);
  inboxProvider?.refresh();
}

function stop() {
  watcher?.dispose(); watcher = undefined;
  if (!server) return vscode.window.showInformationMessage('AI Engine Stack Context Inbox is not running.');
  server.close(); server = undefined; token = undefined;
  pairingProvider?.refresh();
  vscode.window.showInformationMessage('AI Engine Stack Context Inbox stopped.');
}

function showStatus() {
  if (!server) return vscode.window.showInformationMessage('AI Engine Stack Context Inbox is stopped. Run “Start Context Inbox”.');
  const port = vscode.workspace.getConfiguration('aiRemoteControl').get('port', 8765);
  const urls = addresses(port);
  output.appendLine(`Running for ${workspaceRoot()}\n${urls.join('\n') || 'No LAN address found.'}`);
  output.show(true);
}

function activate(context) {
  extensionState = context.globalState;
  output = vscode.window.createOutputChannel('AI Engine Stack Context Inbox');
  inboxStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  inboxStatus.command = 'aiRemoteControl.showPairingQr';
  inboxProvider = new InboxProvider();
  pairingProvider = new PairingProvider();
  updateInboxStatus();
  context.subscriptions.push(output, inboxStatus,
    vscode.window.registerTreeDataProvider('aiRemoteControlInbox', inboxProvider),
    vscode.window.registerWebviewViewProvider('aiRemoteControlPairing', pairingProvider),
    vscode.commands.registerCommand('aiRemoteControl.start', () => start({ showQr: true })),
    vscode.commands.registerCommand('aiRemoteControl.stop', stop),
    vscode.commands.registerCommand('aiRemoteControl.showStatus', showStatus),
    vscode.commands.registerCommand('aiRemoteControl.showPairingQr', showPairingQr),
    vscode.commands.registerCommand('aiRemoteControl.enableAutoStart', async () => {
      if (!vscode.workspace.workspaceFolders?.length) return vscode.window.showErrorMessage('Open a trusted workspace before enabling automatic start.');
      await vscode.workspace.getConfiguration('aiRemoteControl').update('autoStart', true, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage('AI Engine Stack will now start automatically for this workspace.');
      await start({ showQr: true });
    }),
    vscode.commands.registerCommand('aiRemoteControl.refreshInbox', () => inboxProvider.refresh()),
    vscode.commands.registerCommand('aiRemoteControl.openInboxItem', async (entry) => {
      const root = workspaceRoot(); if (!root || !entry?.relativePath) return;
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(root, entry.relativePath)), { preview: true });
    }),
    vscode.commands.registerCommand('aiRemoteControl.markHandled', (entry) => {
      const root = workspaceRoot(); if (!root || !entry?.id) return;
      writeInbox(root, readInbox(root).map((item) => item.id === entry.id ? { ...item, handled: true, handledAt: new Date().toISOString() } : item));
      inboxProvider.refresh();
    }),
    { dispose: stop });
  if (vscode.workspace.workspaceFolders?.length && vscode.workspace.getConfiguration('aiRemoteControl').get('autoStart', false)) {
    const showOnboardingQr = !extensionState.get('hasSeenPairingOnboarding', false);
    setTimeout(() => start({ showQr: showOnboardingQr }), 800);
  }
}

function deactivate() { stop(); }
module.exports = { activate, deactivate };
