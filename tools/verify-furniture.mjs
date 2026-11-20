// Step 7 furniture checks: text collision geometry in every layout, plus pixel
// analysis of the exported landscape PNG (quote, seal, band, captions, subtitle
// at 768x480). PNG exports and a proportionally letterboxed thumbnail are also
// opened from disk for direct visual inspection; ASCII is diagnostic only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const tools = new URL('./', import.meta.url);
const exportFile = layout => resolve(process.argv[2] ?? fileURLToPath(tools), `step-7-${layout}.png`);
const origin = 'http://localhost:8082';
const profile = await mkdtemp(fileURLToPath(new URL('.chrome-furniture-', tools)));
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
  const pending = new Map(), errors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
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
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${origin}/` });
  await waitFor(`document.querySelector('#poster-type')?.dataset.ready === 'true'`);
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#photo-files' });
  await send('DOM.setFileInputFiles', { nodeId, files: ['boulevard.jpg', 'pier.jpg'].map(name => fileURLToPath(new URL(`../app/samples/${name}`, tools))) });
  await waitFor(`document.querySelector('#photo-count').textContent === '2'`);

  const geometry = [];
  for (const layout of ['landscape', 'portrait', 'square']) {
    await evaluate(`document.querySelector('[data-layout="${layout}"].layout-option').click(); document.querySelector('.photo-tile').click(); document.querySelector('#assign-all').click();`);
    const report = await evaluate(`(() => {
      const svg = document.querySelector('#poster-type');
      const frame = svg.getBoundingClientRect();
      const scale = svg.viewBox.baseVal.width / frame.width;
      const rect = el => {
        const r = el.getBoundingClientRect();
        return { x: (r.left - frame.left) * scale, y: (r.top - frame.top) * scale, width: r.width * scale, height: r.height * scale };
      };
      const measure = document.createElement('canvas').getContext('2d');
      // Font metric boxes carry ascent/descent padding; compare actual glyph ink instead.
      const ink = el => {
        const r = rect(el);
        if (el.tagName !== 'text' || el.hasAttribute('transform')) return r;
        const size = +el.getAttribute('font-size');
        measure.font = (el.getAttribute('font-weight') || 400) + ' ' + size + 'px "' + el.getAttribute('font-family') + '"';
        const m = measure.measureText(el.textContent);
        const y = +el.getAttribute('y');
        const pad = +(el.getAttribute('stroke-width') || 0) / 2;
        const top = y - m.actualBoundingBoxAscent - pad, bottom = y + m.actualBoundingBoxDescent + pad;
        return { ...r, y: top, height: bottom - top };
      };
      const pick = (group, selector) => [...svg.querySelectorAll(selector)].map(el => ({ group, label: (el.textContent || el.tagName).slice(0, 30), ...ink(el) }));
      const items = [
        ...pick('quote', '[data-type="quote"] text'),
        ...pick('quote-rule', '[data-type="quote"] line'),
        ...pick('seal', '[data-type="seal"] text'),
        ...pick('caption', '[data-type="panel-caption"]'),
        ...pick('billing', '[data-billing-line]'),
        ...pick('festival', '[data-type="festival"]'),
        ...pick('rating', '[data-type="rating"] text'),
        ...pick('issue', '[data-type="issue"]'),
        ...pick('release', '[data-type="release"]'),
        ...pick('title', '[data-title-layer]'),
        ...pick('subtitle', '[data-type="subtitle"]'),
        ...pick('tagline', '[data-type="tagline"]'),
      ];
      const overlaps = [];
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.group === b.group) continue;
        const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (ox > 1 && oy > 1) overlaps.push({ a: a.group + ':' + a.label, b: b.group + ':' + b.label, ox: +ox.toFixed(1), oy: +oy.toFixed(1) });
      }
      const outside = items.filter(el => el.x < -1 || el.y < -1 || el.x + el.width > svg.viewBox.baseVal.width + 1 || el.y + el.height > svg.viewBox.baseVal.height + 1).map(el => el.label);
      const seal = svg.querySelector('[data-type="seal"]');
      const band = svg.querySelector('[data-type="band"]');
      const disc = seal.querySelector('circle').getBBox();
      const footerSeal = disc.x + disc.width < svg.viewBox.baseVal.width * .15 && disc.y >= svg.viewBox.baseVal.height * .845 && disc.y + disc.height < svg.viewBox.baseVal.height * .96;
      const release = svg.querySelector('[data-type="release"]');
      const releaseStrip = svg.querySelector('[data-type="release-strip"]');
      const layeredBand = !!(band.compareDocumentPosition(release) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(releaseStrip.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { layout: '${layout}', overlaps, outside, footerSeal, sealRimChars: svg.querySelectorAll('[data-type="seal"] [data-rim]').length, quoteStars: svg.querySelectorAll('[data-type="quote"] [data-star]').length, layeredBand, subtitleFamily: svg.querySelector('[data-type="subtitle"]').getAttribute('font-family'), subtitleSize: +svg.querySelector('[data-type="subtitle"]').getAttribute('font-size') };
    })()`);
    assert.deepEqual(report.overlaps, [], `${layout}: furniture text collisions`);
    assert.deepEqual(report.outside, [], `${layout}: furniture stays inside the cover`);
    assert.equal(report.quoteStars, 5);
    assert.ok(report.sealRimChars >= 16);
    assert.ok(report.footerSeal, `${layout}: seal stays in the lower-left footer`);
    assert.ok(report.layeredBand, `${layout}: band draws over the strip but behind the release text`);
    assert.equal(report.subtitleFamily, 'Scene Editorial');
    geometry.push(report);
  }

  const editorCaptures = [];
  for (const layout of ['landscape', 'portrait', 'square']) {
    await evaluate(`document.querySelector('[data-layout="${layout}"].layout-option').click(); document.querySelectorAll('.type-section')[2].open = true; document.querySelector('#type-quote').scrollIntoView({ block: 'center' });`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = `step-7-${layout}-editor.png`;
    await writeFile(new URL(file, tools), Buffer.from(data, 'base64'));
    const bytes = await readFile(new URL(file, tools));
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1280, 800]);
    editorCaptures.push({ file, width: 1280, height: 800, bytes: bytes.length });
  }

  const png = await readFile(exportFile('landscape'));
  const pixels = await evaluate(`(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${png.toString('base64')}';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const region = (x, y, w, h) => context.getImageData(x, y, w, h).data;
    const lum = (data, i) => .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
    const stats = (x, y, w, h) => {
      const data = region(x, y, w, h);
      let sum = 0, sumSq = 0, bright = 0, count = w * h;
      for (let i = 0; i < data.length; i += 4) {
        const l = lum(data, i);
        sum += l; sumSq += l * l;
        if (l > 180) bright++;
      }
      const mean = sum / count;
      return { mean: +mean.toFixed(1), stddev: +Math.sqrt(sumSq / count - mean * mean).toFixed(1), brightFraction: +(bright / count).toFixed(4) };
    };
    const ascii = (x, y, w, h, cols, rows) => {
      const data = region(x, y, w, h);
      const ramp = ' .:-=+*#%@';
      let out = '';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const px = Math.floor((c + .5) * w / cols), py = Math.floor((r + .5) * h / rows);
          const i = (py * w + px) * 4;
          out += ramp[Math.min(9, Math.floor(lum(data, i) / 25.6))];
        }
        out += '\\n';
      }
      return out;
    };
    const thumb = document.createElement('canvas');
    thumb.width = 768; thumb.height = 480;
    const tctx = thumb.getContext('2d', { willReadFrequently: true });
    tctx.imageSmoothingQuality = 'high';
    tctx.fillStyle = '#0B0D13';
    tctx.fillRect(0, 0, 768, 480);
    tctx.drawImage(canvas, 0, 24, 768, 432);
    const thumbRegion = (x, y, w, h) => tctx.getImageData(x, y, w, h).data;
    const thumbStats = (x, y, w, h) => {
      const data = thumbRegion(x, y, w, h);
      let sum = 0, bright = 0, count = w * h;
      for (let i = 0; i < data.length; i += 4) {
        const l = lum(data, i);
        sum += l;
        if (l > 170) bright++;
      }
      return { mean: +(sum / count).toFixed(1), brightFraction: +(bright / count).toFixed(4) };
    };
    const thumbAscii = (x, y, w, h, cols, rows) => {
      const data = thumbRegion(x, y, w, h);
      const ramp = ' .:-=+*#%@';
      let out = '';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const px = Math.floor((c + .5) * w / cols), py = Math.floor((r + .5) * h / rows);
          const i = (py * w + px) * 4;
          out += ramp[Math.min(9, Math.floor(lum(data, i) / 25.6))];
        }
        out += '\\n';
      }
      return out;
    };
    return {
      quote: stats(660, 770, 600, 80),
      seal: stats(64, 911, 122, 121),
      band: stats(0, 966, 1920, 70),
      releaseStrip: stats(0, 1040, 1920, 36),
      heroCaption: stats(80, 668, 500, 40),
      supportingCaption: stats(1295, 8, 600, 34),
      subtitleNative: stats(67, 560, 700, 70),
      subtitleThumb: thumbStats(27, 248, 280, 28),
      thumbnail: thumb.toDataURL('image/png').split(',')[1],
      ascii: {
        cover: ascii(0, 0, 1920, 1080, 128, 36),
        quote: ascii(560, 760, 800, 110, 100, 14),
        seal: ascii(64, 911, 122, 121, 48, 24),
        band: ascii(0, 940, 1920, 140, 128, 10),
        subtitleThumb: thumbAscii(20, 240, 320, 44, 100, 11),
      },
    };
  })()`);
  assert.ok(pixels.quote.brightFraction > .005, 'Quote lettering is present and bright');
  assert.ok(pixels.seal.brightFraction > .02, 'Seal rings and rim text are present');
  assert.ok(pixels.band.stddev > 2, 'Band silhouette has visible structure');
  assert.ok(pixels.band.mean < 60, 'Band stays low contrast');
  assert.ok(pixels.releaseStrip.mean > 60, 'Release strip stays magenta');
  assert.ok(pixels.heroCaption.brightFraction > .01 && pixels.supportingCaption.brightFraction > .01, 'Captions carry bright lettering');
  assert.ok(pixels.subtitleThumb.brightFraction > .02, 'Subtitle survives the 768x480 downscale');
  await writeFile(new URL('step-7-landscape-768x480.png', tools), Buffer.from(pixels.thumbnail, 'base64'));
  delete pixels.thumbnail;
  const otherLayouts = {};
  for (const [layout, regions] of [
    ['portrait', { quote: [240, 920, 600, 100], seal: [34, 1171, 121, 121], band: [0, 1208, 1080, 88] }],
    ['square', { quote: [240, 770, 600, 90], seal: [34, 911, 121, 121], band: [0, 966, 1080, 70] }],
  ]) {
    const file = await readFile(exportFile(layout));
    otherLayouts[layout] = await evaluate(`(async () => {
      const image = new Image();
      image.src = 'data:image/png;base64,${file.toString('base64')}';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const regions = ${JSON.stringify(regions)};
      const out = {};
      for (const [name, [x, y, w, h]] of Object.entries(regions)) {
        const data = context.getImageData(x, y, w, h).data;
        let sum = 0, bright = 0;
        const count = w * h;
        for (let i = 0; i < data.length; i += 4) {
          const l = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
          sum += l;
          if (l > 180) bright++;
        }
        out[name] = { mean: +(sum / count).toFixed(1), brightFraction: +(bright / count).toFixed(4) };
      }
      return out;
    })()`);
    assert.ok(otherLayouts[layout].quote.brightFraction > .005, `${layout}: exported quote lettering`);
    assert.ok(otherLayouts[layout].seal.brightFraction > .02, `${layout}: exported seal`);
    assert.ok(otherLayouts[layout].band.mean < 60, `${layout}: exported band stays low contrast`);
  }
  assert.deepEqual(errors, []);
  const report = { geometry, editorCaptures, pixels: { ...pixels, ascii: undefined }, otherLayouts, ascii: pixels.ascii };
  await writeFile(new URL('step-7-furniture.json', tools), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ geometry, editorCaptures, pixels: report.pixels, otherLayouts }, null, 2));
  console.log('--- COVER 128x36 ---\n' + pixels.ascii.cover);
  console.log('--- QUOTE ---\n' + pixels.ascii.quote);
  console.log('--- SEAL ---\n' + pixels.ascii.seal);
  console.log('--- BAND ---\n' + pixels.ascii.band);
  console.log('--- SUBTITLE AT 768x480 ---\n' + pixels.ascii.subtitleThumb);
} finally {
  socket?.close(); chrome.kill('SIGTERM'); await closed;
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
