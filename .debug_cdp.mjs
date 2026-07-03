import http from 'node:http';

function getTargets() {
  return new Promise((resolve, reject) => {
    http
      .get('http://127.0.0.1:9230/json', (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

const targets = await getTargets();
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.log('No page target found');
  process.exit(1);
}

console.log('Connecting to:', page.webSocketDebuggerUrl);

const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.addEventListener('open', async () => {
  await send('Runtime.enable');
  await send('Log.enable');

  const rootResult = await send('Runtime.evaluate', {
    expression:
      'JSON.stringify({ rootChildren: document.getElementById("root")?.childElementCount, backendPort: window.__backendPort, electronAPI: !!window.electronAPI, backendStartupFailed: window.__backendStartupFailed, bodyHTML: document.body.innerHTML.substring(0, 1000) })',
    returnByValue: true,
  });
  console.log('Page state:', rootResult.result?.value);

  ws.close();
  process.exit(0);
});

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.consoleAPICalled') {
    const args = msg.params.args.map((a) => a.value || a.description || '').join(' ');
    console.log(`[console.${msg.params.type}]`, args);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log('[exception]', JSON.stringify(msg.params.exceptionDetails));
  } else if (msg.method === 'Log.entryAdded') {
    console.log(`[log.${msg.params.entry.level}]`, msg.params.entry.text);
  } else if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(msg.error);
    else resolve(msg.result);
  }
});

ws.addEventListener('error', (e) => {
  console.log('WS error:', e.message || e);
  process.exit(1);
});
setTimeout(() => {
  console.log('Timeout');
  process.exit(1);
}, 8000);
