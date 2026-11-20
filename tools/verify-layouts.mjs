// Local-only Chrome verification. Artifacts stay under tools/.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const tools = fileURLToPath(new URL('.', import.meta.url));
const profile = await mkdtemp(`${tools}.chrome-layouts-`);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
let socket;
const chromeExited = new Promise(resolve => chrome.once('exit', resolve));

try {
  let endpoint;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const [port] = (await readFile(`${profile}/DevToolsActivePort`, 'utf8')).split('\n');
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      endpoint = targets.find(target => target.type === 'page')?.webSocketDebuggerUrl;
      if (endpoint) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(endpoint, 'Chrome remote debugging must become available');
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  const requests = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:8082/' });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate('document.querySelectorAll("#cover-grid > .placeholder-panel").length === 6')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const results = [];
  for (const key of ['landscape', 'portrait', 'square']) {
    await evaluate(`document.querySelector('button[data-layout="${key}"]').click()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    const metrics = await evaluate(`(() => {
      const grid = document.querySelector('#cover-grid');
      const rect = grid.getBoundingClientRect();
      const panels = [...grid.children].map(panel => {
        const r = panel.getBoundingClientRect();
        return { x: r.x - rect.x, y: r.y - rect.y, width: r.width, height: r.height };
      });
      return {
        layout: document.querySelector('#preview-frame').dataset.layout,
        width: rect.width, height: rect.height,
        gap: parseFloat(getComputedStyle(grid).gap), panels,
        selectedButtons: document.querySelectorAll('.layout-option[aria-pressed="true"]').length,
        viewport: { width: innerWidth, height: innerHeight },
        document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        imageCount: document.images.length,
      };
    })()`);
    const expected = key === 'landscape' ? 16 / 9 : key === 'portrait' ? 4 / 5 : 1;
    assert.ok(Math.abs(metrics.width / metrics.height - expected) < .001, `${key}: aspect ratio`);
    assert.equal(metrics.panels.length, 6);
    assert.equal(metrics.selectedButtons, 1);
    assert.equal(metrics.imageCount, 0);
    assert.equal(metrics.document.width, 1280, 'No horizontal overflow');
    assert.equal(metrics.document.height, 720, 'The whole shell fits the viewport');
    const nativeWidth = key === 'landscape' ? 1920 : 1080;
    metrics.nativeGutter = metrics.gap / metrics.width * nativeWidth;
    assert.ok(Math.abs(metrics.nativeGutter - 12) < .01, `${key}: 12px native gutter`);
    for (let i = 0; i < metrics.panels.length; i += 1) {
      const a = metrics.panels[i];
      assert.ok(a.width > 0 && a.height > 0);
      assert.ok(a.x >= -.1 && a.y >= -.1 && a.x + a.width <= metrics.width + .1 && a.y + a.height <= metrics.height + .1);
      for (const b of metrics.panels.slice(i + 1)) {
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        assert.ok(overlapX <= 0 || overlapY <= 0, `${key}: panels must not overlap`);
      }
    }
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const filename = `step-1-${key}-1280x720.png`;
    await writeFile(`${tools}${filename}`, Buffer.from(screenshot.data, 'base64'));
    const bytes = await readFile(`${tools}${filename}`);
    metrics.screenshot = { file: filename, bytes: (await stat(`${tools}${filename}`)).size, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    assert.equal(metrics.screenshot.width, 1280);
    assert.equal(metrics.screenshot.height, 720);
    results.push(metrics);
  }
  assert.equal(errors.length, 0, 'No browser runtime errors');
  assert.ok(requests.every(url => url.startsWith('http://localhost:8082/') || url.startsWith('data:')), 'Only local requests');
  const report = { browser: (await send('Browser.getVersion')).product, results, errors, requests: [...new Set(requests.map(url => url.startsWith('data:') ? 'data: (embedded poster band)' : url))] };
  await writeFile(`${tools}step-1-measurements.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await chromeExited;
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
