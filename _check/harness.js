// _check/harness.js - Automated browser testing harness using CDP
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 8089;
const CDP_PORT = 9444;
const BRAVE_PATH = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const ROOT_DIR = process.cwd();

// Simple static file server
const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(ROOT_DIR, reqPath);
    if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end('Not found: ' + reqPath);
    }
    const ext = path.extname(filePath);
    const mimeMap = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.jpg': 'image/jpeg'
    };
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(filePath).pipe(res);
});

export async function runBrowserTest({ urlPath, waitMs = 2000, screenshotPath, actions = null }) {
    await new Promise(r => server.listen(PORT, r));
    console.log(`Server listening on http://127.0.0.1:${PORT}`);

    const chromeProcess = spawn(BRAVE_PATH, [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--window-size=1920,1080',
        '--user-data-dir=/tmp/brave_harness_profile',
        'about:blank'
    ], { stdio: 'ignore' });

    // Wait for CDP endpoint
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
            const data = await resp.json();
            if (data && data[0] && data[0].webSocketDebuggerUrl) {
                wsUrl = data[0].webSocketDebuggerUrl;
                break;
            }
        } catch (e) {}
    }

    if (!wsUrl) {
        chromeProcess.kill();
        server.close();
        throw new Error('Failed to connect to Brave CDP');
    }

    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const callbacks = new Map();
    const consoleLogs = [];
    const errors = [];

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && callbacks.has(msg.id)) {
            const cb = callbacks.get(msg.id);
            callbacks.delete(msg.id);
            cb(msg.result, msg.error);
        } else if (msg.method === 'Runtime.consoleAPICalled') {
            consoleLogs.push({ type: msg.params.type, args: msg.params.args.map(a => a.value || a.description) });
        } else if (msg.method === 'Runtime.exceptionThrown') {
            errors.push(msg.params.exceptionDetails);
        }
    };

    await new Promise(r => ws.onopen = r);

    function send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = msgId++;
            callbacks.set(id, (res, err) => {
                if (err) reject(err);
                else resolve(res);
            });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    await send('Runtime.enable');
    await send('Page.enable');

    const targetUrl = `http://127.0.0.1:${PORT}${urlPath}`;
    console.log('Navigating to:', targetUrl);
    await send('Page.navigate', { url: targetUrl });

    await new Promise(r => setTimeout(r, waitMs));

    if (actions) {
        await actions({ send, evaluate: (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true }) });
    }

    let screenshotBuffer = null;
    if (screenshotPath) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        screenshotBuffer = Buffer.from(shot.data, 'base64');
        fs.writeFileSync(screenshotPath, screenshotBuffer);
        console.log(`Screenshot saved to ${screenshotPath} (${screenshotBuffer.length} bytes)`);
    }

    // Evaluate info
    const evalRes = await send('Runtime.evaluate', {
        expression: `({
            title: document.title,
            errors: window.__errors || [],
            info: window.__debugInfo || null
        })`,
        returnByValue: true
    });

    ws.close();
    chromeProcess.kill();
    server.close();

    return {
        logs: consoleLogs,
        errors,
        evalResult: evalRes?.result?.value
    };
}
