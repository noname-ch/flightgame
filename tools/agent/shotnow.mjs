// node shotnow.mjs out.png: screenshot of the page as it is
import fs from 'node:fs';
const tabs = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9447}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
setTimeout(() => process.exit(2), 30000);
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id === 1) { fs.writeFileSync(process.argv[2], Buffer.from(m.result.data, 'base64')); process.exit(0); } });
ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
