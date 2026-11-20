// Exercise the real fill button and download; hash photo pixels before lettering.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createPanelCrop, getPanelCropPresets } from '../app/src/photo-pipeline.js';

const tools = fileURLToPath(new URL('./', import.meta.url));
const workspace = await mkdtemp(join(tools, '.chrome-variety-'));
const downloads = join(workspace, 'downloads');
await mkdir(downloads);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--remote-debugging-port=0', `--user-data-dir=${join(workspace, 'profile')}`, 'about:blank',
], { stdio: 'ignore' });
const closed = new Promise(resolve => chrome.once('close', resolve));
let socket;
const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await predicate();
    if (value) return value;
    await delay(100);
  }
  assert.fail(message);
};

try {
  const target = await waitFor(async () => {
    try {
      const [port] = (await readFile(join(workspace, 'profile', 'DevToolsActivePort'), 'utf8')).split('\n');
      return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(entry => entry.type === 'page');
    } catch { return null; }
  }, 'Chrome did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map(), started = [], progress = new Map(), errors = [];
  socket.onmessage = ({ data }) => {
    const { id, method, params, result, error } = JSON.parse(data);
    if (method === 'Browser.downloadWillBegin') started.push(params);
    if (method === 'Browser.downloadProgress') progress.set(params.guid, params.state);
    if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails);
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') errors.push(params.args);
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    if (error) waiter.reject(new Error(JSON.stringify(error)));
    else waiter.resolve(result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const run = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    assert.ok(!exceptionDetails, JSON.stringify(exceptionDetails));
    return result.value;
  };
  const readPanels = () => run(`(async () => Promise.all([...document.querySelectorAll('#cover-grid > button')].map(async panel => {
    const canvas = panel.querySelector('canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const hash = await crypto.subtle.digest('SHA-256', pixels);
    return { crop: JSON.parse(panel.dataset.crop), width: canvas.width, height: canvas.height,
      sha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
  })))()`);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:8082/' });
  await waitFor(() => run(`document.querySelector('#export-cover')?.disabled === false`), 'App did not load');
  assert.equal(await run(`document.querySelector('#assign-all').disabled`), true);
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#photo-files' });
  await send('DOM.setFileInputFiles', { nodeId, files: [fileURLToPath(new URL('../app/samples/boulevard.jpg', import.meta.url))] });
  await waitFor(() => run(`document.querySelector('#photo-count').textContent === '1'`), 'Photo did not load');
  assert.equal(await run(`document.querySelector('#assign-all').textContent`), 'Fill all panels');
  const results = {};
  for (const layout of ['landscape', 'portrait', 'square']) {
    await run(`document.querySelector('.layout-option[data-layout="${layout}"]').click();
      document.querySelector('.photo-tile').click(); document.querySelector('#assign-all').click();`);
    const panels = await readPanels();
    assert.equal(new Set(panels.map(panel => panel.sha256)).size, 6, `${layout}: six distinct photo rasters`);
    panels.forEach((panel, index) => assert.deepEqual(panel.crop, {
      ...createPanelCrop('photo-0001'), ...getPanelCropPresets(index)[['wide', 'face', 'detail'][index % 3]],
    }));
    // Fill from a supporting panel and after an edit must reproduce exactly the same pixels.
    await run(`(() => { document.querySelector('#cover-grid > :nth-child(5)').click();
      const zoom = document.querySelector('#crop-zoom'); zoom.value = '3.1'; zoom.dispatchEvent(new Event('input'));
      document.querySelector('#assign-all').click(); })()`);
    assert.deepEqual(await readPanels(), panels, `${layout}: deterministic refill from any selected panel`);
    results[layout] = panels;
  }
  await run(`document.querySelector('.layout-option[data-layout="landscape"]').click()`);
  assert.deepEqual(await readPanels(), results.landscape, 'Other layouts preserve the landscape crops');
  await run(`document.querySelector('#export-cover').click()`);
  const download = await waitFor(async () => {
    assert.notEqual(await run(`document.querySelector('#export-status').textContent`), 'Export failed. Try again.');
    return started[0];
  }, 'Export did not start');
  await waitFor(() => progress.get(download.guid) === 'completed', 'Export did not finish');
  assert.equal(download.suggestedFilename, 'after-hours-landscape.png');
  const output = join(tools, 'step-6-variety-landscape.png');
  await copyFile(join(downloads, download.guid), output);
  const bytes = await readFile(output);
  assert.equal(bytes.readUInt32BE(16), 1920);
  assert.equal(bytes.readUInt32BE(20), 1080);
  const exportedPanels = await run(`(async () => {
    const { getPanelOutputRects } = await import('/src/photo-pipeline.js');
    const image = await createImageBitmap(await (await fetch('data:image/png;base64,${bytes.toString('base64')}')).blob());
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return Promise.all(getPanelOutputRects({ key: 'landscape', width: 1920, height: 1080 }).map(async rect => {
      const pixels = context.getImageData(rect.x, rect.y, rect.width, rect.height).data;
      const hash = await crypto.subtle.digest('SHA-256', pixels);
      return { ...rect, sha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
    }));
  })()`);
  assert.equal(new Set(exportedPanels.map(panel => panel.sha256)).size, 6, 'Six distinct panel regions in the saved PNG');
  assert.deepEqual(errors, []);
  const report = {
    passed: true, browser: (await send('Browser.getVersion')).product,
    hashMethod: 'SHA-256 of native panel canvas RGBA bytes, before typography',
    panels: results,
    export: { file: 'step-6-variety-landscape.png', width: 1920, height: 1080, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      panelHashMethod: 'SHA-256 of RGBA bytes extracted from each saved PNG panel region, including typography',
      panels: exportedPanels }, errors,
  };
  await writeFile(join(tools, 'step-6-variety-measurements.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await closed;
  await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
