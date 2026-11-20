// Headless, local-only verification of the actual photo UI and canvas pixels.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPanelCrop, getPhotoPlacement, getPanelOutputSizes } from '../app/src/photo-pipeline.js';

const tools = fileURLToPath(new URL('.', import.meta.url));
const sample = name => fileURLToPath(new URL(`../app/samples/${name}`, import.meta.url));
const profile = `${tools}.chrome-photo-verification-profile`;
const digest = data => createHash('sha256').update(data).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
const requests = [];
const chooserEvents = [];
const results = {};
await mkdir(profile, { recursive: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--hide-scrollbars', '--remote-debugging-port=9230', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
const chromeExited = new Promise(resolve => chrome.once('exit', resolve));
let socket;

try {
  let endpoint;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await (await fetch('http://127.0.0.1:9230/json')).json();
      endpoint = targets.find(target => target.type === 'page')?.webSocketDebuggerUrl;
      if (endpoint) break;
    } catch {}
    await delay(100);
  }
  assert.ok(endpoint, 'Headless Chrome starts');
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (message.method === 'Page.fileChooserOpened') chooserEvents.push(message.params);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    assert.fail(`Timed out: ${expression}`);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const setInput = (selector, value, event = 'input') => evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    input.value = ${JSON.stringify(String(value))};
    input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
  })()`);
  const readPanel = async (index = 0) => {
    const panel = await evaluate(`(() => {
      const panel = document.querySelectorAll('#cover-grid > button')[${index}];
      const canvas = panel.querySelector('canvas');
      const rect = panel.getBoundingClientRect();
      return { crop: JSON.parse(panel.dataset.crop), hidden: canvas.hidden,
        canvas: { width: canvas.width, height: canvas.height },
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pixels: canvas.hidden ? '' : canvas.toDataURL() };
    })()`);
    panel.pixelHash = digest(panel.pixels);
    delete panel.pixels;
    return panel;
  };
  const loadThroughPicker = async names => {
    const before = Number(await evaluate('document.querySelector("#photo-count").textContent'));
    const previousChoosers = chooserEvents.length;
    await click('#add-photos');
    for (let attempt = 0; attempt < 50 && chooserEvents.length === previousChoosers; attempt += 1) await delay(20);
    assert.equal(chooserEvents.length, previousChoosers + 1, 'Add photos opens the real file picker');
    const chooser = chooserEvents.at(-1);
    assert.equal(chooser.mode, 'selectMultiple');
    await send('DOM.setFileInputFiles', { backendNodeId: chooser.backendNodeId, files: names.map(sample) });
    await waitFor(`document.querySelector('#photo-count').textContent === '${before + names.length}'`);
  };
  const navigate = async () => {
    await send('Page.navigate', { url: 'http://localhost:8082/' });
    await waitFor(`document.querySelectorAll('#cover-grid > button[data-crop]').length === 6`);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await navigate();
  assert.equal(await evaluate(`document.querySelector('#crop-zoom').disabled`), true);
  await loadThroughPicker(['boulevard.jpg']);
  await click('.photo-tile');
  const centered = await readPanel();
  assert.equal(centered.crop.photoId, 'photo-0001');
  assert.equal(centered.hidden, false);
  assert.deepEqual(centered.canvas, { width: 1276, height: 716 });
  const source = await evaluate(`document.querySelector('.photo-tile').title`);
  await setInput('#crop-zoom', 1.65);
  const zoomed = await readPanel();
  await setInput('#focus-x', 80);
  await setInput('#focus-y', 25);
  const focused = await readPanel();
  assert.notEqual(focused.pixelHash, centered.pixelHash, 'Focus and zoom visibly change the photo pixels');
  assert.notEqual(focused.pixelHash, zoomed.pixelHash, 'Moving focus alone changes the photo at a fixed zoom');
  assert.deepEqual(focused.crop, { photoId: 'photo-0001', mode: 'fill', zoom: 1.65, focusX: 0.8, focusY: 0.25 });
  results.requiredWorkflow = { source, centered, focused };

  // Replay from a fresh page; the same file and controls must draw identical bytes.
  await navigate();
  await loadThroughPicker(['boulevard.jpg']);
  await click('.photo-tile');
  await setInput('#crop-zoom', 1.65);
  await setInput('#focus-x', 80);
  await setInput('#focus-y', 25);
  assert.equal((await readPanel()).pixelHash, focused.pixelHash);
  results.replayPixelHash = (await readPanel()).pixelHash;

  // The canvas raster is fixed at output-panel size, independent of the preview.
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 2, mobile: false });
  await delay(50);
  assert.equal((await readPanel()).pixelHash, focused.pixelHash);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await click('#reset-crop');
  assert.equal((await readPanel()).pixelHash, centered.pixelHash, 'Reset restores the original pixels');

  await click('#mode-fit');
  const fitted = await readPanel();
  assert.equal(fitted.crop.mode, 'fit');
  assert.notEqual(fitted.pixelHash, centered.pixelHash);
  // Exercise fit/fill math for wide and tall sources, including zoom and extremes.
  for (const photo of [{ width: 2000, height: 500 }, { width: 500, height: 2000 }]) {
    for (const mode of ['fill', 'fit']) {
      for (const focus of [0, 0.5, 1]) {
        const placement = getPhotoPlacement(photo, { ...createPanelCrop(), mode, focusX: focus, focusY: focus }, 600, 400);
        if (mode === 'fill') {
          assert.ok(placement.width >= 600 && placement.height >= 400);
          assert.ok(placement.x <= 0 && placement.y <= 0);
          assert.ok(placement.x + placement.width >= 600 && placement.y + placement.height >= 400);
        } else {
          assert.ok(placement.width <= 600 && placement.height <= 400);
          assert.ok(placement.x >= 0 && placement.y >= 0);
          assert.ok(placement.x + placement.width <= 600 && placement.y + placement.height <= 400);
        }
      }
    }
  }
  results.fit = fitted;
  await click('#mode-fill');
  await setInput('#crop-zoom', 2);
  const beforeDrag = await readPanel();
  const x = beforeDrag.rect.x + beforeDrag.rect.width * 0.5;
  const y = beforeDrag.rect.y + beforeDrag.rect.height * 0.5;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 35, y: y + 20, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 35, y: y + 20, button: 'left', clickCount: 1 });
  const dragged = await readPanel();
  assert.ok(dragged.crop.focusX < beforeDrag.crop.focusX && dragged.crop.focusY < beforeDrag.crop.focusY);
  assert.notEqual(dragged.pixelHash, beforeDrag.pixelHash);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaY: -120, deltaX: 0 });
  await waitFor(`Number(document.querySelector('#crop-zoom').value) > 2`);
  const wheeled = await readPanel();
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x - 50, y: y + 25, button: 'left', clickCount: 1, modifiers: 8 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x - 50, y: y + 25, button: 'left', clickCount: 1, modifiers: 8 });
  const pointFocused = await readPanel();
  assert.notDeepEqual(pointFocused.crop, wheeled.crop, 'Shift-click moves source focus');
  results.gestures = { dragged: dragged.crop, wheeled: wheeled.crop, pointFocused: pointFocused.crop };

  await loadThroughPicker(['pier.jpg', 'boulevard.jpg']);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.photo-tile span')].map(node => node.textContent)`), ['boulevard.jpg', 'pier.jpg', 'boulevard.jpg']);
  await click('#assign-all');
  const heroBeforeAssignment = await readPanel();
  await click('#cover-grid > button:nth-child(2)');
  await click('.photo-tile:nth-child(2)');
  assert.equal((await readPanel(1)).crop.photoId, 'photo-0002');
  assert.equal((await readPanel()).pixelHash, heroBeforeAssignment.pixelHash, 'Assigning panel 2 preserves hero crop');
  await setInput('#panel-photo', '', 'change');
  assert.equal((await readPanel(1)).hidden, true);
  assert.equal(await evaluate(`document.querySelector('#crop-zoom').disabled`), true);
  await setInput('#panel-photo', 'photo-0002', 'change');
  await click('#cover-grid > button:first-child');

  // Native CDP file drag-drop uses the same file ingestion as the file picker.
  const dragData = { items: [], files: [sample('pier.jpg')], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await send('Input.dispatchDragEvent', { type, x: 150, y: 480, data: dragData });
  }
  await waitFor(`document.querySelector('#photo-count').textContent === '4'`);
  assert.equal((await readPanel()).pixelHash, heroBeforeAssignment.pixelHash, 'Import does not overwrite an assignment');
  results.library = await evaluate(`[...document.querySelectorAll('.photo-tile')].map(node => ({ id: node.dataset.photoId, name: node.textContent, source: node.title }))`);

  const layoutResults = [];
  for (const key of ['portrait', 'square', 'landscape']) {
    await click(`.layout-option[data-layout="${key}"]`);
    if (key !== 'landscape') {
      assert.equal((await readPanel()).crop.photoId, '', 'A new layout starts with its own empty crops');
      await click('.photo-tile:nth-child(2)');
      await click('#assign-all');
      await setInput('#crop-zoom', 1.3);
      await click('#mode-fit');
    } else {
      assert.equal((await readPanel()).pixelHash, heroBeforeAssignment.pixelHash, 'Returning restores the landscape crop');
    }
    const metrics = await evaluate(`(() => {
      const grid = document.querySelector('#cover-grid');
      const bounds = grid.getBoundingClientRect();
      return { layout: document.querySelector('#preview-frame').dataset.layout,
        preview: { width: bounds.width, height: bounds.height },
        gap: parseFloat(getComputedStyle(grid).gap),
        selectedPanels: grid.querySelectorAll('[aria-pressed="true"]').length,
        document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        panels: [...grid.children].map(panel => {
          const r = panel.getBoundingClientRect(); const canvas = panel.querySelector('canvas');
          return { width: r.width, height: r.height, x: r.x - bounds.x, y: r.y - bounds.y,
            outputWidth: canvas.width, outputHeight: canvas.height, crop: JSON.parse(panel.dataset.crop) };
        }) };
    })()`);
    assert.equal(metrics.selectedPanels, 1);
    assert.equal(metrics.document.width, 1280, 'No horizontal overflow');
    assert.equal(metrics.document.height, 720, 'Controls and footer fit the desktop viewport');
    const width = key === 'landscape' ? 1920 : 1080;
    const height = key === 'landscape' ? 1080 : key === 'portrait' ? 1350 : 1080;
    assert.ok(Math.abs(metrics.preview.width / metrics.preview.height - width / height) < 0.001);
    assert.ok(Math.abs(metrics.gap / metrics.preview.width * width - 12) < 0.01, 'Gutters remain 12px at output size');
    const outputSizes = getPanelOutputSizes({ key, width, height });
    metrics.panels.forEach((panel, index) => {
      assert.equal(panel.outputWidth, Math.round(outputSizes[index][0]));
      assert.equal(panel.outputHeight, Math.round(outputSizes[index][1]));
      assert.ok(Math.abs(panel.width / panel.height - outputSizes[index][0] / outputSizes[index][1]) < 0.002);
      assert.ok(panel.width > 0 && panel.height > 0);
      assert.ok(panel.x >= -0.1 && panel.y >= -0.1 && panel.x + panel.width <= metrics.preview.width + 0.1 && panel.y + panel.height <= metrics.preview.height + 0.1);
      for (const other of metrics.panels.slice(index + 1)) {
        const overlapX = Math.min(panel.x + panel.width, other.x + other.width) - Math.max(panel.x, other.x);
        const overlapY = Math.min(panel.y + panel.height, other.y + other.height) - Math.max(panel.y, other.y);
        assert.ok(overlapX <= 0 || overlapY <= 0, 'Panels do not overlap');
      }
    });
    layoutResults.push(metrics);
  }
  results.layouts = layoutResults;

  // Required focus screenshot: visible library, assigned hero and the moved focus.
  await setInput('#crop-zoom', 1.65);
  await setInput('#focus-x', 80);
  await setInput('#focus-y', 25);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const filename = 'step-2-photo-pipeline-1280x720.png';
  await writeFile(`${tools}${filename}`, Buffer.from(screenshot.data, 'base64'));
  const png = await readFile(`${tools}${filename}`);
  results.screenshot = { file: filename, bytes: png.length, width: png.readUInt32BE(16), height: png.readUInt32BE(20), sha256: digest(png) };
  assert.equal(results.screenshot.width, 1280);
  assert.equal(results.screenshot.height, 720);

  // Bad input reports a readable error and leaves existing photos/crops intact.
  const beforeBadFiles = await readPanel();
  await evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['not a photo'], 'broken.jpg', { type: 'image/jpeg' }));
    transfer.items.add(new File(['text'], 'notes.txt', { type: 'text/plain' }));
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  })()`);
  await waitFor(`document.querySelector('#photo-status').textContent.includes('Could not read: broken.jpg, notes.txt')`);
  assert.equal(await evaluate(`document.querySelector('#photo-count').textContent`), '4');
  assert.equal((await readPanel()).pixelHash, beforeBadFiles.pixelHash);
  results.invalidFiles = await evaluate(`document.querySelector('#photo-status').textContent`);

  // Keyboard-accessible panel picker and a narrow viewport retain usable controls.
  await setInput('#active-panel', 2, 'change');
  assert.equal(await evaluate(`document.querySelector('#cover-grid > button:nth-child(3)').getAttribute('aria-pressed')`), 'true');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  results.narrowViewport = await evaluate(`({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, zoomWidth: document.querySelector('#crop-zoom').getBoundingClientRect().width })`);
  assert.equal(results.narrowViewport.documentWidth, 390);
  assert.ok(results.narrowViewport.zoomWidth > 0);
  assert.equal(errors.length, 0, 'No browser runtime exceptions');
  assert.ok(requests.every(url => url.startsWith('http://localhost:8082/') || url.startsWith('data:')), 'Only local files and data images');
  const report = { browser: (await send('Browser.getVersion')).product, results, errors, requests: [...new Set(requests)] };
  await writeFile(`${tools}step-2-measurements.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: true, browser: report.browser, screenshot: results.screenshot,
    source, deterministicCanvasSha256: results.replayPixelHash, photoCount: results.library.length,
    layoutBounds: results.layouts.map(({ layout, preview, document }) => ({ layout, preview, document })),
    narrowViewport: results.narrowViewport, errors }, null, 2));
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await chromeExited;
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
