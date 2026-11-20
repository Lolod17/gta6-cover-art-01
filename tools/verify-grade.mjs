// Export the live panel rasters at native layout size through headless Chrome.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const tools = new URL('./', import.meta.url);
const origin = 'http://localhost:8082';
const profile = await mkdtemp(fileURLToPath(new URL('.chrome-grade-', tools)));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
const chromeClosed = new Promise(resolve => chrome.on('close', resolve));
let socket;

try {
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    try {
      const [port] = (await readFile(`${profile}/DevToolsActivePort`, 'utf8')).split('\n');
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = targets.find(entry => entry.type === 'page');
    } catch {
      await delay(100);
    }
  }
  assert.ok(target, 'Headless Chrome starts');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  const requests = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    assert.fail(`Timed out: ${expression}`);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${origin}/` });
  await waitFor(`document.querySelectorAll('#cover-grid canvas').length === 6`);
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#photo-files' });
  await send('DOM.setFileInputFiles', {
    nodeId, files: [fileURLToPath(new URL('../app/samples/boulevard.jpg', tools))],
  });
  await waitFor(`document.querySelector('#photo-count').textContent === '1'`);
  assert.equal(await evaluate(`document.querySelector('#cinematic-grade').value`), 'dusk-amber');

  const assignAll = `document.querySelector('.photo-tile').click(); document.querySelector('#assign-all').click();`;
  await evaluate(`(() => {
    ${assignAll}
    const picker = document.querySelector('#active-panel');
    const zoom = document.querySelector('#crop-zoom');
    const focusX = document.querySelector('#focus-x');
    const focus = document.querySelector('#focus-y');
    for (const option of picker.options) {
      picker.value = option.value;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      // Fill all panels applies varied presets; normalize every crop so the
      // identical-raster assertion compares like-for-like panels.
      document.querySelector('#mode-fill').click();
      zoom.value = 1;
      zoom.dispatchEvent(new Event('input', { bubbles: true }));
      focusX.value = 50;
      focusX.dispatchEvent(new Event('input', { bubbles: true }));
      focus.value = 32;
      focus.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  const render = (grade, exportPng = false) => evaluate(`(async () => {
    const picker = document.querySelector('#cinematic-grade');
    picker.value = ${JSON.stringify(grade)};
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    const grid = document.querySelector('#cover-grid');
    const panels = [...grid.children];
    const canvases = panels.map(panel => panel.querySelector('canvas'));
    const hashes = await Promise.all(canvases.map(async canvas => {
      if (canvas.hidden) throw new Error('Expected a photo in every panel');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const hash = await crypto.subtle.digest('SHA-256', data.data);
      return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    }));
    const result = { hashes, crops: panels.map(panel => panel.dataset.crop) };
    if (${exportPng}) {
      const cover = document.createElement('canvas');
      cover.width = 1920;
      cover.height = 1080;
      const ctx = cover.getContext('2d', { alpha: false });
      ctx.fillStyle = '#0B0D13';
      ctx.fillRect(0, 0, cover.width, cover.height);
      const bounds = grid.getBoundingClientRect();
      panels.forEach((panel, index) => {
        const rect = panel.getBoundingClientRect();
        const x = Math.round((rect.left - bounds.left) * cover.width / bounds.width);
        const y = Math.round((rect.top - bounds.top) * cover.height / bounds.height);
        ctx.drawImage(canvases[index], x, y);
      });
      result.png = cover.toDataURL('image/png').split(',')[1];
    }
    return result;
  })()`);

  const grades = ['dusk-amber', 'night-neon', 'daylight-fade'];
  const exports = [];
  for (const grade of grades) exports.push(await render(grade, true));
  for (let panel = 0; panel < 6; panel++) {
    assert.equal(new Set(exports.map(result => result.hashes[panel])).size, 3, `Panel ${panel + 1} changes with each preset`);
    assert.equal(new Set(exports.map(result => result.crops[panel])).size, 1, `Panel ${panel + 1} retains its crop`);
  }
  for (const result of exports) {
    assert.equal(new Set(result.crops).size, 1);
    assert.equal(new Set(result.hashes.slice(1)).size, 1, 'Matching photo, crop, and dimensions yield identical rasters across panels');
  }
  assert.deepEqual(await render(grades[0], true), exports[0], 'Switching back reproduces identical panel pixels and PNG bytes');

  for (const layout of ['portrait', 'square']) {
    await evaluate(`document.querySelector('.layout-option[data-layout="${layout}"]').click(); ${assignAll}`);
    const first = await render(grades[0]);
    const next = await render(grades[1]);
    assert.deepEqual(first.crops, next.crops);
    first.hashes.forEach((hash, index) => assert.notEqual(hash, next.hashes[index], `${layout} panel ${index + 1} is graded`));
  }
  await evaluate(`(() => {
    const zoom = document.querySelector('#crop-zoom');
    const focusX = document.querySelector('#focus-x');
    const focusY = document.querySelector('#focus-y');
    zoom.value = 1;
    zoom.dispatchEvent(new Event('input', { bubbles: true }));
    focusX.value = 50;
    focusX.dispatchEvent(new Event('input', { bubbles: true }));
    focusY.value = 50;
    focusY.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#mode-fit').click();
  })()`);
  for (const grade of grades) {
    await render(grade);
    const corner = await evaluate(`(() => {
      const canvas = document.querySelector('#cover-grid [aria-pressed="true"] canvas');
      return Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 1).data);
    })()`);
    assert.deepEqual(corner, [11, 13, 19, 255], 'Fit letterboxing stays ink under each grade');
  }
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith(`${origin}/`) || url.startsWith('data:')), 'Only local app resources are requested');

  const reports = [];
  for (const [index, grade] of grades.entries()) {
    const file = `step-3-${grade}.png`;
    const buffer = Buffer.from(exports[index].png, 'base64');
    assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    await writeFile(new URL(file, tools), buffer);
    const png = await readFile(new URL(file, tools));
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert.deepEqual([width, height], [1920, 1080]);
    reports.push({ file, width, height, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') });
  }
  assert.equal(new Set(reports.map(report => report.sha256)).size, 3);
  console.log(JSON.stringify({ browser: (await send('Browser.getVersion')).product, exports: reports }, null, 2));
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await chromeClosed;
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
