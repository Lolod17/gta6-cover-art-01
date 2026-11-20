import { applyCinematicGrade, cinematicPresets, defaultGrade } from './cinematic-grade.js';

// Normalized source focus and output-space geometry never depend on preview size.
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const normalizeFocus = value => Math.round(clamp(value, 0, 1) * 1e6) / 1e6;

export function createPanelCrop(photoId = '') {
  return { photoId, mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 };
}

export function getPanelCropPresets(index) {
  // The second pass changes both scale and subject focus, including equal-size panels.
  const secondPass = index >= 3;
  return {
    face: { zoom: secondPass ? 2.8 : 2.4, focusX: secondPass ? 0.63 : 0.56, focusY: secondPass ? 0.28 : 0.22, mode: 'fill' },
    detail: { zoom: secondPass ? 1.9 : 1.65, focusX: secondPass ? 0.78 : 0.28, focusY: secondPass ? 0.82 : 0.73, mode: 'fill' },
    wide: { zoom: secondPass ? 1.16 : 1.05, focusX: secondPass ? 0.7 : 0.5, focusY: secondPass ? 0.55 : 0.5, mode: 'fit' },
  };
}

export function getPhotoPlacement(photo, crop, width, height) {
  const fitScale = Math.min(width / photo.width, height / photo.height);
  const fillScale = Math.max(width / photo.width, height / photo.height);
  const scale = (crop.mode === 'fit' ? fitScale : fillScale) * crop.zoom;
  const drawnWidth = photo.width * scale;
  const drawnHeight = photo.height * scale;
  return {
    x: clamp(width / 2 - crop.focusX * drawnWidth, Math.min(0, width - drawnWidth), Math.max(0, width - drawnWidth)),
    y: clamp(height / 2 - crop.focusY * drawnHeight, Math.min(0, height - drawnHeight), Math.max(0, height - drawnHeight)),
    width: drawnWidth, height: drawnHeight, scale,
  };
}

export function getPanelOutputRects({ key, width, height }) {
  const gap = 12;
  if (key === 'portrait') {
    const row = (height - gap * 4) / 5.15;
    const half = (width - gap) / 2;
    const pair = y => [{ x: 0, y, width: half, height: row }, { x: half + gap, y, width: half, height: row }];
    return [
      { x: 0, y: 0, width, height: row * 2 + gap },
      ...pair((row + gap) * 2),
      { x: 0, y: (row + gap) * 3, width, height: row * 1.15 },
      ...pair(height - row),
    ];
  }
  const cellWidth = (width - gap * 2) / 3;
  const cellHeight = (height - gap * 2) / 3;
  const supporting = [[2, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
  return [
    { x: 0, y: 0, width: cellWidth * 2 + gap, height: cellHeight * 2 + gap },
    ...supporting.map(([column, row]) => ({
      x: column * (cellWidth + gap), y: row * (cellHeight + gap), width: cellWidth, height: cellHeight,
    })),
  ];
}

export function getPanelOutputSizes(layout) {
  return getPanelOutputRects(layout).map(({ width, height }) => [width, height]);
}

export function drawPanelPhoto(canvas, photo, crop, outputSize, grade = defaultGrade) {
  const [width, height] = outputSize.map(Math.round);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, width, height);
  const placement = getPhotoPlacement(photo, crop, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(photo.bitmap, placement.x, placement.y, placement.width, placement.height);
  if (grade !== null) applyCinematicGrade(context, width, height, cinematicPresets[grade]);
  context.save();
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = '#0B0D13';
  context.fillRect(0, 0, width, height);
  context.restore();
  return placement;
}

export async function decodeLocalPhoto(file, id) {
  if (!/\.(jpe?g|png|webp|avif|gif|bmp)$/i.test(file.name)) {
    throw new Error(`${file.name}: choose a JPEG, PNG, WebP, AVIF, GIF or BMP.`);
  }
  // A bitmap snapshots the first frame of animated images and honors EXIF orientation.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const thumbnail = document.createElement('canvas');
  thumbnail.width = 120;
  thumbnail.height = 80;
  const photo = { id, name: file.name, width: bitmap.width, height: bitmap.height, bitmap };
  drawPanelPhoto(thumbnail, photo, createPanelCrop(id), [120, 80], null);
  return { ...photo, thumbnail: thumbnail.toDataURL('image/jpeg', 0.8) };
}
