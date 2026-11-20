import { drawPanelPhoto, getPanelOutputRects } from './photo-pipeline.js';
import { renderPosterTypography } from './poster-typography.js';

const exportDpr = 2;
const ink = '#0B0D13';
const paper = '#EDE6D8';
let embeddedFonts;

export function coverFilename(title, variant) {
  const stem = title.normalize('NFC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu)?.join('-');
  return `${stem || 'untitled-cover'}-${variant}.png`;
}

function exportCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

function supersampledCanvas(width, height) {
  const raster = exportCanvas(width * exportDpr, height * exportDpr);
  raster.context.scale(exportDpr, exportDpr);
  return raster;
}

function resolveOutputSize(raster, width, height) {
  const { canvas, context } = exportCanvas(width, height);
  context.drawImage(raster, 0, 0, width, height);
  raster.width = raster.height = 0;
  return canvas;
}

async function fontDataUrl(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error('Could not read a local poster font.');
  const font = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(font);
  });
}

function loadEmbeddedFonts() {
  // SVGs decoded as images cannot load fonts from the document or external URLs.
  embeddedFonts ??= Promise.all([
    ['Scene Display', '200 700', '../fonts/Oswald.ttf'],
    ['Scene Editorial', '400 900', '../fonts/PlayfairDisplay.ttf'],
    ['Scene Script', '400', '../fonts/InstrumentSerif-Italic.ttf'],
    ['Scene Mono', '100 700', '../fonts/RobotoMono.ttf'],
  ].map(async ([family, weight, path]) =>
    `@font-face { font-family: '${family}'; font-weight: ${weight}; src: url('${await fontDataUrl(path)}') format('truetype'); }`
  )).then(rules => rules.join('\n')).catch(error => {
    embeddedFonts = undefined;
    throw error;
  });
  return embeddedFonts;
}

async function drawTypography(context, layout, copy, panels, fontRules) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('width', layout.width * exportDpr);
  svg.setAttribute('height', layout.height * exportDpr);
  renderPosterTypography(svg, layout, copy, panels);
  const style = document.createElementNS(namespace, 'style');
  style.textContent = fontRules;
  svg.prepend(style);
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    context.drawImage(image, 0, 0, layout.width, layout.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderCover({ layout, panels: states, grade, copy }, fontRules) {
  const { width, height } = layout;
  const { canvas, context } = supersampledCanvas(width, height);
  const panels = getPanelOutputRects(layout);
  const photoRaster = document.createElement('canvas');
  context.fillStyle = ink;
  context.fillRect(0, 0, width, height);
  panels.forEach(({ x, y, width, height }, index) => {
    const { photo, crop } = states[index];
    if (photo) {
      drawPanelPhoto(photoRaster, photo, crop, [width * exportDpr, height * exportDpr], grade);
      context.drawImage(photoRaster, x, y, width, height);
    } else {
      context.fillStyle = ['#1B212A', '#252D36', '#202630'][index % 3];
      context.fillRect(x, y, width, height);
    }
  });
  photoRaster.width = photoRaster.height = 0;
  await drawTypography(context, layout, copy, panels, fontRules);
  return canvas;
}

async function renderContactSheet(covers, fontRules) {
  const width = 1600;
  const height = 1440;
  const { canvas, context } = supersampledCanvas(width, height);
  const slots = {
    landscape: [200, 56, 1200, 675],
    portrait: [244, 776, 480, 600],
    square: [756, 776, 600, 600],
  };
  context.fillStyle = ink;
  context.fillRect(0, 0, width, height);
  context.font = '400 20px "Scene Mono"';
  for (const cover of covers) {
    const { key, name, label } = cover.layout;
    const [x, y, w, h] = slots[key];
    const raster = await renderCover(cover, fontRules);
    context.drawImage(raster, x, y, w, h);
    raster.width = raster.height = 0;
    context.fillStyle = paper;
    context.fillText(`${name.toUpperCase()} / ${label}`, x, y + h + 28);
  }
  return resolveOutputSize(canvas, width, height);
}

export async function downloadCoverPng(covers, variant) {
  const fontRules = await loadEmbeddedFonts();
  const [{ layout, copy }] = covers;
  const canvas = variant === 'contact-sheet'
    ? await renderContactSheet(covers, fontRules)
    : resolveOutputSize(await renderCover(covers[0], fontRules), layout.width, layout.height);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(png => {
    if (png) resolve(png);
    else reject(new Error('Could not encode PNG.'));
  }, 'image/png'));
  canvas.width = canvas.height = 0;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = coverFilename(copy.title, variant);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
