// node ev.mjs "<expression>": evaluate in the headless game page
const tabs = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9447}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
setTimeout(() => { console.error('timeout'); process.exit(2); }, 60000);
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); const r = m.result; process.stdout.write(String(r.exceptionDetails ? JSON.stringify(r.exceptionDetails).slice(0, 800) : typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value)) + '\n', () => process.exit(0)); });
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: process.argv[2], awaitPromise: true, returnByValue: true } }));
