import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://localhost:8082';
const shots = join(root, 'screenshots');
const temporary = await mkdtemp('/var/folders/qn/xwy5j1td2z5fdt1fxgt44p9h0000gn/T/opencode/scene06-shots-');
const downloads = join(temporary, 'downloads');
await mkdir(downloads);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'profile')}`, 'about:blank',
], { stdio: 'ignore' });
const closed = new Promise(resolve => chrome.once('close', resolve));
let socket;
const errors = [], requests = [], started = [], progress = new Map();
const report = { screenshots: [], exports: [] };

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const value = await predicate();
    if (value) return value;
    await delay(100);
  }
  throw new Error(message);
}
function dimensions(path) {
  const output = execFileSync('sips', ['-g', 'format', '-g', 'pixelWidth', '-g', 'pixelHeight', path], { encoding: 'utf8' });
  return { format: output.match(/format: (\w+)/)[1], width: +output.match(/pixelWidth: (\d+)/)[1], height: +output.match(/pixelHeight: (\d+)/)[1] };
}
async function inspectScreenshot(name, expectedWidth, expectedHeight) {
  const path = join(shots, name), bytes = (await stat(path)).size;
  const info = dimensions(path);
  assert.equal(info.format, 'jpeg');
  assert.equal(info.width, expectedWidth);
  assert.equal(info.height, expectedHeight);
  assert.ok(bytes <= 262144 && Math.max(info.width, info.height) <= 1280 && Math.min(info.width, info.height) >= 480);
  const entry = { name, ...info, bytes, sha256: createHash('sha256').update(await readFile(path)).digest('hex') };
  report.screenshots.push(entry);
  console.log(JSON.stringify(entry));
}

try {
  const target = await waitFor(async () => {
    try {
      const [port] = (await readFile(join(temporary, 'profile', 'DevToolsActivePort'), 'utf8')).split('\n');
      return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page');
    } catch { return null; }
  }, 'Chrome did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const { id, method, params, result, error } = JSON.parse(data);
    if (method === 'Browser.downloadWillBegin') started.push(params);
    if (method === 'Browser.downloadProgress') progress.set(params.guid, params.state);
    if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.text);
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') errors.push(params.args.map(arg => arg.description ?? arg.value));
    if (method === 'Network.requestWillBeSent') requests.push(params.request.url);
    const action = pending.get(id);
    if (!action) return;
    pending.delete(id);
    if (error) action.reject(new Error(JSON.stringify(error)));
    else action.resolve(result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const run = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    assert.ok(!exceptionDetails, JSON.stringify(exceptionDetails));
    return result.value;
  };
  const edit = (id, value, event = 'input') => run(`(() => {
    const input = document.getElementById(${JSON.stringify(id)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
  })()`);
  const layout = name => run(`document.querySelector('.layout-option[data-layout="${name}"]').click()`);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin });
  await waitFor(() => run(`document.querySelector('#export-cover')?.disabled === false`), 'App did not become ready');
  const { root: documentRoot } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector: '#photo-files' });
  await send('DOM.setFileInputFiles', { nodeId, files: ['boulevard.jpg', 'pier.jpg'].map(name => join(root, 'app', 'samples', name)) });
  await waitFor(() => run(`document.querySelector('#photo-count').textContent === '2'`), 'Photos did not load');

  // All scene setup uses the editor's existing controls; the renderer and app files stay authoritative.
  for (const format of ['landscape', 'portrait', 'square']) {
    await layout(format);
    for (const [panel, photo, zoom, x, y] of [
      [0, 0, 1, 50, 30], [1, 0, 1.7, 67, 23], [2, 1, 2.2, 100, 30],
      [3, 0, 1.8, 10, 48], [4, 0, 1.15, 72, 15], [5, 0, 1.5, 15, 82],
    ]) {
      await edit('active-panel', String(panel), 'change');
      await run(`document.querySelectorAll('.photo-tile')[${photo}].click()`);
      await edit('crop-zoom', String(zoom));
      await edit('focus-x', String(x));
      await edit('focus-y', String(y));
    }
  }

  const captureCover = async (format, name, width, height, targetWidth, targetHeight) => {
    await layout(format);
    const index = started.length;
    await run(`document.querySelector('#export-cover').click()`);
    const entry = await waitFor(() => started[index], `No ${format} export`);
    assert.equal(entry.suggestedFilename, `after-hours-${format}.png`);
    await waitFor(() => {
      assert.notEqual(progress.get(entry.guid), 'canceled');
      return progress.get(entry.guid) === 'completed';
    }, `${format} download did not complete`);
    const source = join(downloads, entry.guid);
    assert.deepEqual(dimensions(source), { format: 'png', width, height });
    report.exports.push({ name: entry.suggestedFilename, width, height, bytes: (await stat(source)).size,
      sha256: createHash('sha256').update(await readFile(source)).digest('hex') });
    // The only image transformations are proportional downscaling and JPEG encoding.
    for (const quality of [88, 84, 80, 76, 72, 68, 64, 60, 55, 50, 45]) {
      execFileSync('sips', ['-Z', String(Math.min(1280, Math.max(width, height))), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), source, '--out', join(shots, name)], { stdio: 'ignore' });
      if ((await stat(join(shots, name))).size <= 262144) break;
    }
    await inspectScreenshot(name, targetWidth, targetHeight);
  };
  await captureCover('landscape', '1-key-art.jpg', 1920, 1080, 1280, 720);
  await captureCover('portrait', '3-portrait.jpg', 1080, 1350, 1024, 1280);
  await captureCover('square', '4-square.jpg', 1080, 1080, 1080, 1080);
  await layout('landscape');
  await edit('active-panel', '0', 'change');
  await run(`document.activeElement.blur(); document.querySelector('.type-inspector').scrollTop = 0`);
  await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assert.equal(await run(`document.querySelectorAll('.has-photo').length`), 6);
  for (const quality of [88, 84, 80, 76, 72]) {
    const capture = await send('Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: false });
    await writeFile(join(shots, '2-editor.jpg'), Buffer.from(capture.data, 'base64'));
    if ((await stat(join(shots, '2-editor.jpg'))).size <= 262144) break;
  }
  await inspectScreenshot('2-editor.jpg', 1280, 800);
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith(origin) || /^(blob:|data:)/.test(url)), 'External app request');
  for (const name of ['1-cover.jpg', '3-cover.jpg']) {
    await unlink(join(shots, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  report.screenshots.sort((a, b) => a.name.localeCompare(b.name));
  report.browser = (await send('Browser.getVersion')).product;
  report.errors = errors;
  report.requests = [...new Set(requests.filter(url => url.startsWith(origin)))];
  await writeFile(join(root, 'tools', 'step-6-captures.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.browser}: four compliant screenshots; zero runtime errors; local resources only.`);
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await closed;
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
