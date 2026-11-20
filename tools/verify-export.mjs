import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const tools = new URL('./', import.meta.url);
const origin = 'http://localhost:8082';
const workspace = await mkdtemp(fileURLToPath(new URL('.chrome-export-', tools)));
const downloads = join(workspace, 'downloads');
await mkdir(downloads);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--remote-debugging-port=0', `--user-data-dir=${join(workspace, 'profile')}`, 'about:blank',
], { stdio: 'ignore' });
const closed = new Promise(resolve => chrome.once('close', resolve));
let socket;

async function waitFor(predicate, message, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await predicate();
    if (value) return value;
    await delay(100);
  }
  assert.fail(message);
}

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
  const pending = new Map(), started = [], progress = new Map(), errors = [], requests = [];
  socket.onmessage = ({ data }) => {
    const { id, method, params, result, error } = JSON.parse(data);
    if (method === 'Browser.downloadWillBegin') started.push(params);
    if (method === 'Browser.downloadProgress') progress.set(params.guid, params.state);
    if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.text);
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') errors.push(params.args.map(arg => arg.description ?? arg.value));
    if (method === 'Network.requestWillBeSent') requests.push(params.request.url);
    if (!pending.has(id)) return;
    const { resolve, reject } = pending.get(id);
    pending.delete(id);
    if (error) reject(new Error(JSON.stringify(error)));
    else resolve(result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const run = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, userGesture: true });
    assert.ok(!exceptionDetails, JSON.stringify(exceptionDetails));
    return result.value;
  };
  const edit = (id, value, event = 'input') => run(`(() => {
    const field = document.getElementById(${JSON.stringify(id)});
    field.value = ${JSON.stringify(value)};
    field.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
  })()`);
  const pickLayout = layout => run(`document.querySelector('.layout-option[data-layout="${layout}"]').click()`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: `${origin}/` });
  await waitFor(() => run(`document.querySelector('#export-cover')?.disabled === false`), 'Export controls did not become ready');
  assert.equal(await run('devicePixelRatio'), 2);

  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#photo-files' });
  await send('DOM.setFileInputFiles', {
    nodeId, files: ['boulevard.jpg', 'pier.jpg'].map(name => fileURLToPath(new URL(`../app/samples/${name}`, tools))),
  });
  await waitFor(() => run(`document.querySelector('#photo-count').textContent === '2'`), 'Sample photos did not load');
  await edit('type-title', 'Midnight /\nGetaway!');
  await edit('cinematic-grade', 'night-neon', 'change');
  for (const [index, layout] of ['landscape', 'portrait', 'square'].entries()) {
    await pickLayout(layout);
    await run(`document.querySelector('#cover-grid > :first-child').click();
      document.querySelectorAll('.photo-tile')[${index % 2}].click();
      document.querySelector('#assign-all').click();
      document.querySelector('#cover-grid > :nth-child(3)').click();
      document.querySelectorAll('.photo-tile')[${1 - index % 2}].click();`);
    await edit('crop-zoom', `${1.2 + index * 0.1}`);
    await edit('focus-x', `${25 + index * 25}`);
  }

  const download = async (control, filename, width, height) => {
    const index = started.length;
    await run(`document.getElementById('${control}').click()`);
    const entry = await waitFor(async () => {
      const status = await run(`document.querySelector('#export-status').textContent`);
      assert.notEqual(status, 'Export failed. Try again.', JSON.stringify(errors));
      return started[index];
    }, `No download started for ${filename}`);
    assert.equal(entry.suggestedFilename, filename);
    await waitFor(() => {
      const state = progress.get(entry.guid);
      assert.notEqual(state, 'canceled');
      return state === 'completed';
    }, `Download did not finish for ${filename}`);
    const path = join(downloads, entry.guid);
    const dimensions = execFileSync('sips', ['-g', 'format', '-g', 'pixelWidth', '-g', 'pixelHeight', path], { encoding: 'utf8' });
    assert.match(dimensions, /format: png/);
    assert.equal(+dimensions.match(/pixelWidth: (\d+)/)[1], width);
    assert.equal(+dimensions.match(/pixelHeight: (\d+)/)[1], height);
    return { path, sha256: execFileSync('shasum', ['-a', '256', path], { encoding: 'utf8' }).split(/\s/)[0] };
  };

  const browser = (await send('Browser.getVersion')).product;
  console.log(`${browser}, devicePixelRatio 2`);
  for (const [layout, width, height] of [
    ['landscape', 1920, 1080], ['portrait', 1080, 1350], ['square', 1080, 1080], ['contact-sheet', 1600, 1440],
  ]) {
    const sheet = layout === 'contact-sheet';
    if (!sheet) await pickLayout(layout);
    const args = [sheet ? 'export-sheet' : 'export-cover', `midnight-getaway-${layout}.png`, width, height];
    const first = await download(...args);
    const second = await download(...args);
    assert.equal(first.sha256, second.sha256, `${layout}: consecutive export hashes`);
    assert.ok((await readFile(first.path)).equals(await readFile(second.path)), `${layout}: exact bytes`);
    console.log(`${args[1]}  ${width} × ${height}  ${first.sha256}  (both downloads)`);
    if (process.argv.includes('--keep')) await copyFile(first.path, join(workspace, args[1]));
  }
  assert.equal(await run(`document.querySelector('#preview-frame').dataset.layout`), 'square', 'Contact sheet preserves the active layout');
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith(`${origin}/`) || /^(blob:|data:)/.test(url)), 'Export only requests local resources');
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await closed;
  await rm(join(workspace, 'profile'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await rm(downloads, { recursive: true, force: true });
  if (process.argv.includes('--keep')) console.log(`PNGs saved in ${workspace}`);
  else await rm(workspace, { recursive: true, force: true });
}
