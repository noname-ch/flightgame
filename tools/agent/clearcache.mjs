const tabs = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9447}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let n = 0; const send = (method, params = {}) => new Promise((r) => { const id = ++n; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id === id) r(m); }); ws.send(JSON.stringify({ id, method, params })); });
await send('Network.enable'); await send('Network.clearBrowserCache'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.reload', { ignoreCache: true });
process.exit(0);
