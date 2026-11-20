import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const tools = new URL('./', import.meta.url);
const origin = 'http://localhost:8082';
const profile = await mkdtemp(fileURLToPath(new URL('.chrome-typography-', tools)));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
const closed = new Promise(resolve => chrome.on('close', resolve));
let socket;
try {
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    try {
      const [port] = (await readFile(`${profile}/DevToolsActivePort`, 'utf8')).split('\n');
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(entry => entry.type === 'page');
    } catch { await delay(100); }
  }
  assert.ok(target, 'Headless Chrome starts');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map(), errors = [], requests = [];
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
  const edit = (id, value) => evaluate(`(() => {
    const input = document.getElementById(${JSON.stringify(id)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent`);
  const artifacts = [];
  const screenshot = async (name, width, height) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(new URL(name, tools), Buffer.from(data, 'base64'));
    const png = await readFile(new URL(name, tools));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height]);
    artifacts.push({ file: name, width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.length });
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${origin}/` });
  await waitFor(`document.querySelector('#poster-type')?.dataset.ready === 'true'`);
  assert.equal(await evaluate(`document.fonts.check('700 100px "Scene Display"') && document.fonts.check('400 40px "Scene Editorial"') && document.fonts.check('600 20px "Scene Mono"')`), true);
  assert.equal(await evaluate(`document.querySelectorAll('[data-type="quote"] [data-star]').length`), 5, 'Pull quote carries five stars');
  assert.ok(await evaluate(`!!document.querySelector('[data-type="quote"] line')`), 'Pull quote has a thin rule');
  assert.ok(await evaluate(`!!document.querySelector('[data-type="seal"]')`), 'Seal badge renders');
  assert.ok(await evaluate(`!!document.querySelector('[data-type="band"]')`), 'Bottom band renders');
  assert.equal(await evaluate(`document.querySelector('[data-type="subtitle"]').getAttribute('font-family')`), 'Scene Editorial', 'Subtitle defaults to the editorial serif');
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#photo-files' });
  await send('DOM.setFileInputFiles', { nodeId, files: ['boulevard.jpg', 'pier.jpg'].map(name => fileURLToPath(new URL(`../app/samples/${name}`, tools))) });
  await waitFor(`document.querySelector('#photo-count').textContent === '2'`);
  await evaluate(`document.querySelector('.photo-tile').click(); document.querySelector('#assign-all').click();`);
  const photoBefore = await evaluate(`document.querySelector('#cover-grid canvas').toDataURL()`);
  const initial = await evaluate(`document.querySelector('#poster-type').innerHTML`);
  await edit('type-title', 'MIDNIGHT\nRUN');
  assert.equal(await text('[data-type="title"]'), 'MIDNIGHTRUNMIDNIGHTRUN');
  await edit('type-subtitle', 'Everybody owes somebody.');
  assert.equal(await text('[data-type="subtitle"]'), 'Everybody owes somebody.');
  for (const [id, selector, value] of [
    ['tagline', 'tagline', 'ONE NIGHT. NO SECOND CHANCES.'],
    ['festival', 'festival', 'OFFICIAL SELECTION · NIGHTFALL 2026'],
    ['rating', 'rating', 'PG-13'], ['rating-note', 'rating', 'PARENTS STRONGLY CAUTIONED'],
    ['release', 'release', 'COMING THIS WINTER'],
    ['quote', 'quote', '"Nobody sleeps in this town."'],
  ]) {
    await edit(`type-${id}`, value);
    assert.ok((await text(`[data-type="${selector}"]`)).includes(value));
  }
  await edit('type-seal', 'OFFICIAL SELECTION');
  await edit('type-issue', 'VOL. 021');
  assert.equal(await evaluate(`[...document.querySelectorAll('[data-type="seal"] [data-rim]')].map(el => el.textContent).join('')`), 'OFFICIALSELECTION', 'Seal rim text is editable');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-type="seal-issue"]')].map(el => el.textContent)`), ['VOL.', '021'], 'Seal carries the issue number');
  await edit('type-seal', '');
  assert.equal(await text('[data-type="issue"]'), 'VOL. 021', 'Issue remains visible when the seal is hidden');
  for (const style of ['script', 'editorial']) {
    await evaluate(`(() => { const picker = document.getElementById('type-subtitle-style'); picker.value = '${style}'; picker.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await evaluate(`document.querySelector('[data-type="subtitle"]').getAttribute('font-family')`), style === 'script' ? 'Scene Script' : 'Scene Editorial');
  }
  for (let index = 0; index < 5; index++) {
    await edit(`type-billing-${index}`, `CREDIT LINE ${index + 1}`);
    assert.equal(await text(`[data-billing-line="${index + 1}"]`), `CREDIT LINE ${index + 1}`);
  }
  const sizes = await evaluate(`[...document.querySelectorAll('[data-billing-line]')].map(el => +el.getAttribute('font-size'))`);
  assert.equal(new Set(sizes).size, 5, 'Five distinct billing hierarchy sizes');
  await edit('type-caption', 'the getaway'); await edit('type-timecode', '2:14 am');
  assert.equal(await text('[data-type="panel-caption"][data-panel="0"]'), '2:14 AM — THE GETAWAY', 'Caption casing is unified to uppercase');
  await evaluate(`document.querySelector('#cover-grid > :nth-child(2)').click()`);
  await edit('type-caption', 'STAY IN THE SHADOWS'); await edit('type-timecode', '3:00 AM');
  assert.equal(await text('[data-type="panel-caption"][data-panel="0"]'), '2:14 AM — THE GETAWAY');
  assert.equal(await text('[data-type="panel-caption"][data-panel="1"]'), '3:00 AM — STAY IN THE SHADOWS');
  await edit('type-title', '<script>alert("text")</script>');
  assert.equal(await evaluate(`document.querySelectorAll('#poster-type script').length`), 0, 'Copy is literal text');
  await edit('type-title', 'A VERY LONG TITLE THAT MUST STILL FIT INSIDE THE HERO PANEL');
  assert.equal(await evaluate(`(() => {
    const hero = document.querySelector('#cover-grid > :first-child').getBoundingClientRect();
    return [...document.querySelectorAll('[data-title-layer="face"]')].every(el => el.getBoundingClientRect().right < hero.right);
  })()`), true, 'Long title fits hero');
  for (const id of ['title', 'subtitle', 'tagline', 'festival', 'rating', 'rating-note', 'issue', 'release', 'quote', 'seal', 'caption', 'timecode', ...Array.from({ length: 5 }, (_, i) => `billing-${i}`)]) await edit(`type-${id}`, '');
  assert.equal(await evaluate(`document.querySelectorAll('#poster-type text').length`), 5, 'Only the five un-cleared panel captions remain');
  assert.equal(await evaluate(`document.querySelector('#cover-grid canvas').toDataURL()`), photoBefore, 'Text edits preserve photo pixels');

  // Reload defaults, then verify layout changes, frame scaling, and actual screenshots.
  await send('Page.navigate', { url: `${origin}/` });
  await waitFor(`document.querySelector('#poster-type')?.dataset.ready === 'true'`);
  assert.equal(await evaluate(`document.querySelector('#poster-type').innerHTML`), initial, 'Same defaults reproduce identical SVG');
  const documentNode = await send('DOM.getDocument');
  const inputNode = await send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#photo-files' });
  await send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: ['boulevard.jpg', 'pier.jpg'].map(name => fileURLToPath(new URL(`../app/samples/${name}`, tools))) });
  await waitFor(`document.querySelector('#photo-count').textContent === '2'`);
  const geometry = [];
  for (const layout of ['landscape', 'portrait', 'square']) {
    await evaluate(`document.querySelector('[data-layout="${layout}"].layout-option').click(); document.querySelector('.photo-tile').click(); document.querySelector('#assign-all').click(); document.querySelector('#cover-grid > :nth-child(3)').click(); document.querySelectorAll('.photo-tile')[1].click();`);
    await edit('type-caption', `A ${layout.toUpperCase()} SCENE`);
    assert.equal(await text('[data-type="panel-caption"][data-panel="2"]'), `8:03 PM — A ${layout.toUpperCase()} SCENE`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-type="panel-caption"]').length`), 6);
    assert.equal(await evaluate(`document.querySelectorAll('[data-billing-line]').length`), 5);
    assert.equal(await evaluate(`+document.querySelector('[data-title-layer="face"]').getAttribute('stroke-width')`), layout === 'landscape' ? 14 : 12);
    geometry.push(await evaluate(`(() => {
      const frame = document.querySelector('#preview-frame').getBoundingClientRect();
      const svg = document.querySelector('#poster-type');
      const outside = [...svg.querySelectorAll('text')].filter(el => {
        const r = el.getBBox(); return r.x < 0 || r.y < 0 || r.x + r.width > svg.viewBox.baseVal.width + 1 || r.y + r.height > svg.viewBox.baseVal.height + 1;
      });
      return { layout: '${layout}', width: frame.width, height: frame.height, outside: outside.map(el => el.textContent), overflow: document.documentElement.scrollWidth > innerWidth };
    })()`));
    assert.deepEqual(geometry.at(-1).outside, []);
    assert.equal(geometry.at(-1).overflow, false);
    if (layout === 'portrait') {
      const spacing = await evaluate(`(() => {
      const caption = document.querySelector('[data-panel="5"][data-type="panel-caption"]').getBBox();
      const festival = document.querySelector('[data-type="festival"]').getBBox();
      const credit = document.querySelector('[data-billing-line="1"]').getBBox();
      return { captionBottom: caption.y + caption.height, festivalTop: festival.y, festivalBottom: festival.y + festival.height, creditTop: credit.y };
    })()`);
      assert.ok(spacing.captionBottom < spacing.festivalTop && spacing.festivalBottom < spacing.creditTop, JSON.stringify(spacing));
    }
    await screenshot(`step-4-${layout}-editor.png`, 1280, 800);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight`), true, 'Desktop shell fits 1280 × 720');
  await evaluate(`document.querySelector('[data-layout="landscape"].layout-option').click(); document.querySelectorAll('.type-section')[1].open = true; document.querySelector('#type-billing-0').scrollIntoView({ block: 'start' });`);
  await screenshot('step-4-billing-editor.png', 1280, 720);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, 'Mobile has no horizontal overflow');
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith(`${origin}/`) || url.startsWith('data:')), 'Only local requests');
  const report = { browser: (await send('Browser.getVersion')).product, geometry, artifacts, errors, requests: [...new Set(requests.map(url => url.startsWith('data:') ? 'data: (local photo thumbnail)' : url))] };
  await writeFile(new URL('step-4-measurements.json', tools), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  socket?.close(); chrome.kill('SIGTERM'); await closed;
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
