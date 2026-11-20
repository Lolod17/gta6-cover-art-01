import { clamp, normalizeFocus, createPanelCrop, getPanelCropPresets, getPhotoPlacement, getPanelOutputSizes, drawPanelPhoto, decodeLocalPhoto } from './photo-pipeline.js';
import { defaultGrade } from './cinematic-grade.js';
import { createPosterCopy, renderPosterTypography, loadPosterFonts } from './poster-typography.js';
import { downloadCoverPng } from './cover-export.js';

const layouts = Object.freeze({
  landscape: { key: 'landscape', name: 'Hero + Grid', ratio: '16 / 9', label: '16:9', width: 1920, height: 1080 },
  portrait: { key: 'portrait', name: 'Portrait Stack', ratio: '4 / 5', label: '4:5', width: 1080, height: 1350 },
  square: { key: 'square', name: 'Square Mosaic', ratio: '1 / 1', label: '1:1', width: 1080, height: 1080 },
});
const photos = [];
const crops = Object.fromEntries(Object.keys(layouts).map(key => [key, Array.from({ length: 6 }, () => createPanelCrop())]));
let activeLayout = 'landscape';
let activePanel = 0;
let activeGrade = defaultGrade;
let importQueue = Promise.resolve();
let photoSequence = 0;
const grid = document.querySelector('#cover-grid');
const panelPhoto = document.querySelector('#panel-photo');
const activePanelPicker = document.querySelector('#active-panel');
const gradePicker = document.querySelector('#cinematic-grade');
const panelRasters = new WeakMap();
const posterCopy = createPosterCopy();
const typography = document.querySelector('#poster-type');
let fontsReady = false;
const exportCover = document.querySelector('#export-cover');
const exportSheet = document.querySelector('#export-sheet');
const exportStatus = document.querySelector('#export-status');
const crop = () => crops[activeLayout][activePanel];
const findPhoto = id => photos.find(photo => photo.id === id);
const panelName = index => index === 0 ? 'Hero / 01' : `Panel / ${String(index + 1).padStart(2, '0')}`;

function createPlaceholderPanels(grid, miniature = false) {
  for (let index = 1; index <= 6; index += 1) {
    const panel = document.createElement(miniature ? 'div' : 'button');
    panel.className = 'placeholder-panel';
    panel.dataset.panel = index;
    if (!miniature) {
      panel.type = 'button';
      panel.setAttribute('aria-label', `${panelName(index - 1)}: no photo`);
      panel.setAttribute('aria-pressed', String(index === 1));
      const number = String(index).padStart(2, '0');
      panel.innerHTML = `<canvas class="panel-photo" hidden></canvas><span class="panel-corner"></span><span class="panel-number">${number}</span><span class="panel-label">${index === 1 ? 'HERO FRAME' : 'SUPPORTING FRAME'} / ${number}</span><span class="panel-corner"></span><span class="focus-marker" aria-hidden="true" hidden></span>`;
    }
    grid.append(panel);
  }
}

function selectCoverLayout(key) {
  const layout = layouts[key];
  if (!layout) return;
  activeLayout = key;
  const frame = document.querySelector('#preview-frame');
  const grid = document.querySelector('#cover-grid');
  frame.dataset.layout = key;
  frame.style.setProperty('--cover-ratio', layout.ratio);
  grid.className = `cover-grid layout-${key}`;
  grid.setAttribute('aria-label', `${layout.name}: six photo panels in a ${layout.label} composition`);
  document.querySelector('#preview-heading').firstChild.textContent = `${layout.name} `;
  document.querySelector('#preview-ratio').textContent = `/ ${layout.label}`;
  document.querySelector('#cover-dimensions').textContent = `${layout.width} × ${layout.height} PX`;
  for (const button of document.querySelectorAll('[data-layout].layout-option')) {
    button.setAttribute('aria-pressed', String(button.dataset.layout === key));
  }
  renderPanels();
  syncInspector();
  renderTypography();
}

function renderTypography() {
  if (!fontsReady) return;
  const layout = layouts[activeLayout];
  const bounds = grid.getBoundingClientRect();
  const panels = [...grid.children].map(panel => {
    const rect = panel.getBoundingClientRect();
    return {
      x: (rect.left - bounds.left) / bounds.width * layout.width,
      y: (rect.top - bounds.top) / bounds.height * layout.height,
      width: rect.width / bounds.width * layout.width,
      height: rect.height / bounds.height * layout.height,
    };
  });
  renderPosterTypography(typography, layout, posterCopy, panels);
  typography.dataset.ready = 'true';
}

function renderPanels() {
  const sizes = getPanelOutputSizes(layouts[activeLayout]);
  [...grid.children].forEach((panel, index) => {
    const state = crops[activeLayout][index];
    const photo = findPhoto(state.photoId);
    const canvas = panel.querySelector('canvas');
    const marker = panel.querySelector('.focus-marker');
    panel.setAttribute('aria-pressed', String(index === activePanel));
    panel.setAttribute('aria-label', `${panelName(index)}: ${photo ? photo.name : 'no photo'}`);
    panel.classList.toggle('has-photo', Boolean(photo));
    canvas.hidden = !photo;
    marker.hidden = !photo || index !== activePanel;
    // Expose serializable crop values on the panel for inspection and QA.
    panel.dataset.crop = JSON.stringify(state);
    if (photo) {
      const renderKey = `${activeLayout}/${activeGrade}/${panel.dataset.crop}`;
      let raster = panelRasters.get(canvas);
      if (raster?.key !== renderKey) {
        const placement = drawPanelPhoto(canvas, photo, state, sizes[index], activeGrade);
        raster = { key: renderKey, placement };
        panelRasters.set(canvas, raster);
      }
      const { placement } = raster;
      marker.style.left = `${(placement.x + state.focusX * placement.width) / canvas.width * 100}%`;
      marker.style.top = `${(placement.y + state.focusY * placement.height) / canvas.height * 100}%`;
    }
  });
}

function syncInspector() {
  const state = crop();
  const photo = findPhoto(state.photoId);
  activePanelPicker.value = String(activePanel);
  document.querySelector('#caption-panel-name').textContent = panelName(activePanel).toUpperCase();
  document.querySelector('#type-timecode').value = posterCopy.panels[activePanel].timecode;
  document.querySelector('#type-caption').value = posterCopy.panels[activePanel].caption;
  panelPhoto.value = state.photoId;
  for (const mode of ['fill', 'fit']) {
    const button = document.querySelector(`#mode-${mode}`);
    button.setAttribute('aria-pressed', String(state.mode === mode));
    button.disabled = !photo;
  }
  for (const [id, value, label] of [
    ['crop-zoom', state.zoom, `${state.zoom.toFixed(2)}×`],
    ['focus-x', state.focusX * 100, `${Math.round(state.focusX * 100)}%`],
    ['focus-y', state.focusY * 100, `${Math.round(state.focusY * 100)}%`],
  ]) {
    const input = document.querySelector(`#${id}`);
    input.value = value;
    input.disabled = !photo;
    document.querySelector(`#${id === 'crop-zoom' ? 'zoom' : id}-value`).value = label;
  }
  document.querySelector('#reset-crop').disabled = !photo;
  document.querySelector('#assign-all').disabled = !photo;
  for (const button of document.querySelectorAll('.photo-tile')) {
    button.setAttribute('aria-pressed', String(button.dataset.photoId === state.photoId));
  }
}

function selectPanel(index) {
  activePanel = index;
  renderPanels();
  syncInspector();
}

function assignPhoto(id) {
  if (id && !findPhoto(id)) return;
  if (crop().photoId !== id) crops[activeLayout][activePanel] = createPanelCrop(id);
  renderPanels();
  syncInspector();
}

function appendPhotoToLibrary(photo) {
  const option = new Option(photo.name, photo.id);
  panelPhoto.append(option);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'photo-tile';
  button.dataset.photoId = photo.id;
  button.title = `${photo.name} · ${photo.width} × ${photo.height} · Assign to selected panel`;
  button.setAttribute('aria-label', `Assign ${photo.name} to selected panel`);
  button.setAttribute('aria-pressed', 'false');
  const image = new Image();
  image.src = photo.thumbnail;
  image.alt = '';
  const name = document.createElement('span');
  name.textContent = photo.name;
  button.append(image, name);
  button.addEventListener('click', () => assignPhoto(photo.id));
  document.querySelector('.library-empty')?.remove();
  document.querySelector('#photo-list').append(button);
}

function importPhotoFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  // Serialize entire batches so decoding time cannot change photo IDs or library order.
  importQueue = importQueue.then(async () => {
    const status = document.querySelector('#photo-status');
    status.textContent = `Reading ${files.length} photo${files.length === 1 ? '' : 's'} locally…`;
    const errors = [];
    let loaded = 0;
    for (const file of files) {
      try {
        const photo = await decodeLocalPhoto(file, `photo-${String(++photoSequence).padStart(4, '0')}`);
        photos.push(photo);
        appendPhotoToLibrary(photo);
        loaded += 1;
      } catch {
        errors.push(file.name);
      }
    }
    document.querySelector('#photo-count').textContent = String(photos.length);
    status.textContent = `${loaded} loaded. Choose a photo to assign.${errors.length ? ` Could not read: ${errors.join(', ')}.` : ''}`;
    status.dataset.importing = 'false';
    syncInspector();
  });
  document.querySelector('#photo-status').dataset.importing = 'true';
}

function editCrop(values) {
  Object.assign(crop(), values);
  renderPanels();
  syncInspector();
}

function bindPanelGestures(panel, index) {
  let drag = null;
  panel.addEventListener('click', () => selectPanel(index));
  panel.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    selectPanel(index);
    const state = crop();
    const photo = findPhoto(state.photoId);
    if (!photo) return;
    const rect = panel.getBoundingClientRect();
    const canvas = panel.querySelector('canvas');
    const placement = getPhotoPlacement(photo, state, canvas.width, canvas.height);
    const pointerX = (event.clientX - rect.left) / rect.width * canvas.width;
    const pointerY = (event.clientY - rect.top) / rect.height * canvas.height;
    if (event.shiftKey) {
      editCrop({ focusX: normalizeFocus((pointerX - placement.x) / placement.width), focusY: normalizeFocus((pointerY - placement.y) / placement.height) });
      return;
    }
    drag = { x: pointerX, y: pointerY, placement, layout: activeLayout };
    panel.setPointerCapture(event.pointerId);
    panel.classList.add('is-dragging');
  });
  panel.addEventListener('pointermove', event => {
    if (!drag || drag.layout !== activeLayout || index !== activePanel) return;
    const canvas = panel.querySelector('canvas');
    const rect = panel.getBoundingClientRect();
    const dx = (event.clientX - rect.left) / rect.width * canvas.width - drag.x;
    const dy = (event.clientY - rect.top) / rect.height * canvas.height - drag.y;
    editCrop({
      focusX: normalizeFocus((canvas.width / 2 - drag.placement.x - dx) / drag.placement.width),
      focusY: normalizeFocus((canvas.height / 2 - drag.placement.y - dy) / drag.placement.height),
    });
  });
  const stopDrag = () => { drag = null; panel.classList.remove('is-dragging'); };
  panel.addEventListener('pointerup', stopDrag);
  panel.addEventListener('pointercancel', stopDrag);
  panel.addEventListener('lostpointercapture', stopDrag);
  panel.addEventListener('wheel', event => {
    if (!findPhoto(crops[activeLayout][index].photoId)) return;
    event.preventDefault();
    selectPanel(index);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? panel.clientHeight : 1);
    editCrop({ zoom: Math.round(clamp(crop().zoom * Math.exp(-delta * 0.0015), 1, 4) * 100) / 100 });
  }, { passive: false });
}

createPlaceholderPanels(document.querySelector('#cover-grid'));
[...grid.children].forEach((panel, index) => {
  activePanelPicker.append(new Option(panelName(index), String(index)));
  bindPanelGestures(panel, index);
});
for (const thumbnail of document.querySelectorAll('[data-thumbnail]')) {
  const grid = document.createElement('span');
  grid.className = `cover-grid layout-${thumbnail.dataset.thumbnail}`;
  createPlaceholderPanels(grid, true);
  thumbnail.append(grid);
}
for (const button of document.querySelectorAll('.layout-option')) {
  button.addEventListener('click', () => selectCoverLayout(button.dataset.layout));
}
activePanelPicker.addEventListener('change', () => selectPanel(Number(activePanelPicker.value)));
gradePicker.value = activeGrade;
gradePicker.addEventListener('change', () => {
  activeGrade = gradePicker.value;
  renderPanels();
});
panelPhoto.addEventListener('change', () => assignPhoto(panelPhoto.value));
for (const mode of ['fill', 'fit']) document.querySelector(`#mode-${mode}`).addEventListener('click', () => editCrop({ mode }));
document.querySelector('#crop-zoom').addEventListener('input', event => editCrop({ zoom: Number(event.target.value) }));
document.querySelector('#focus-x').addEventListener('input', event => editCrop({ focusX: normalizeFocus(Number(event.target.value) / 100) }));
document.querySelector('#focus-y').addEventListener('input', event => editCrop({ focusY: normalizeFocus(Number(event.target.value) / 100) }));
document.querySelector('#reset-crop').addEventListener('click', () => {
  crops[activeLayout][activePanel] = createPanelCrop(crop().photoId);
  renderPanels();
  syncInspector();
});
document.querySelector('#assign-all').addEventListener('click', () => {
  const id = crop().photoId;
  if (!findPhoto(id)) return;
  crops[activeLayout] = crops[activeLayout].map((state, index) => ({
    ...createPanelCrop(id),
    ...getPanelCropPresets(index)[['wide', 'face', 'detail'][index % 3]],
  }));
  renderPanels();
  syncInspector();
});
const fileInput = document.querySelector('#photo-files');
document.querySelector('#add-photos').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { importPhotoFiles(fileInput.files); fileInput.value = ''; });
for (const name of ['dragenter', 'dragover']) document.addEventListener(name, event => {
  if (![...event.dataTransfer.types].includes('Files')) return;
  event.preventDefault();
  if (name === 'dragenter') document.body.classList.add('is-file-drag');
  event.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('is-file-drag'); });
document.addEventListener('drop', event => {
  event.preventDefault();
  document.body.classList.remove('is-file-drag');
  importPhotoFiles(event.dataTransfer.files);
});
const initialLayout = new URLSearchParams(location.search).get('layout');
selectCoverLayout(layouts[initialLayout] ? initialLayout : 'landscape');

for (const [id, key] of Object.entries({
  title: 'title', subtitle: 'subtitle', tagline: 'tagline', festival: 'festival',
  rating: 'rating', 'rating-note': 'ratingNote', issue: 'issue', release: 'release',
  quote: 'quote', seal: 'seal',
})) {
  const input = document.querySelector(`#type-${id}`);
  input.value = posterCopy[key];
  input.addEventListener('input', () => { posterCopy[key] = input.value; renderTypography(); });
}
const subtitleStylePicker = document.querySelector('#type-subtitle-style');
subtitleStylePicker.value = posterCopy.subtitleStyle;
subtitleStylePicker.addEventListener('change', () => { posterCopy.subtitleStyle = subtitleStylePicker.value; renderTypography(); });
posterCopy.billing.forEach((value, index) => {
  const input = document.querySelector(`#type-billing-${index}`);
  input.value = value;
  input.addEventListener('input', () => { posterCopy.billing[index] = input.value; renderTypography(); });
});
for (const key of ['timecode', 'caption']) {
  document.querySelector(`#type-${key}`).addEventListener('input', event => {
    posterCopy.panels[activePanel][key] = event.target.value;
    renderTypography();
  });
}
new ResizeObserver(renderTypography).observe(grid);

async function exportCurrentCovers(variant) {
  const keys = variant === 'contact-sheet' ? Object.keys(layouts) : [variant];
  const copy = structuredClone(posterCopy);
  const covers = keys.map(key => ({
    layout: layouts[key],
    grade: activeGrade,
    copy,
    panels: crops[key].map(crop => ({ crop: { ...crop }, photo: findPhoto(crop.photoId) })),
  }));
  exportCover.disabled = exportSheet.disabled = true;
  exportStatus.textContent = 'Rendering PNG…';
  try {
    await downloadCoverPng(covers, variant);
    exportStatus.textContent = 'PNG download started.';
  } catch (error) {
    console.error(error);
    exportStatus.textContent = 'Export failed. Try again.';
  } finally {
    exportCover.disabled = exportSheet.disabled = false;
  }
}

exportCover.addEventListener('click', () => exportCurrentCovers(activeLayout));
exportSheet.addEventListener('click', () => exportCurrentCovers('contact-sheet'));
loadPosterFonts().then(() => {
  fontsReady = true;
  renderTypography();
  exportCover.disabled = exportSheet.disabled = false;
}).catch(() => {
  document.querySelector('.type-footnote').textContent = 'Could not load local poster fonts. Reload to try again.';
});
