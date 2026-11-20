export const cinematicPresets = Object.freeze({
  'dusk-amber': {
    contrast: 0.27, lift: 0.027, exposure: 0.04, shoulder: 0.025, saturation: 1.06,
    shadows: [-0.027, 0.030, 0.049], highlights: [0.075, 0.016, -0.075], grain: 0.035, halation: 0.24,
  },
  'night-neon': {
    contrast: 0.55, lift: 0.036, exposure: -0.37, shoulder: 0.038, saturation: 1.08,
    shadows: [-0.043, 0.039, 0.096], highlights: [0.046, 0.009, -0.038], grain: 0.040, halation: 0.30,
  },
  'daylight-fade': {
    contrast: 0.15, lift: 0.057, exposure: 0.24, shoulder: 0.075, saturation: 0.79,
    shadows: [-0.013, 0.021, 0.032], highlights: [0.038, 0.014, -0.040], grain: 0.030, halation: 0.16,
  },
});

export const defaultGrade = 'dusk-amber';

const clampUnit = value => Math.min(1, Math.max(0, value));
const smoothstep = value => value * value * (3 - 2 * value);
const lumaAt = (pixels, i) => (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
const highlightMask = luma => smoothstep(clampUnit((luma - 0.69) / 0.31));
const glowScale = 4;

function blurHighlightMask(pixels, width, height) {
  const columns = Math.ceil(width / glowScale);
  const rows = Math.ceil(height / glowScale);
  const mask = new Float32Array(columns * rows);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / glowScale) * columns;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      mask[row + Math.floor(x / glowScale)] += highlightMask(lumaAt(pixels, i)) * pixels[i + 3] / 255;
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      mask[row * columns + col] /= Math.min(glowScale, width - col * glowScale) * Math.min(glowScale, height - row * glowScale);
    }
  }

  // A separable five-tap Gaussian approximation spreads bright edges by a few output pixels.
  const horizontal = new Float32Array(mask.length);
  const blurred = new Float32Array(mask.length);
  const weights = [1, 4, 6, 4, 1];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const i = row * columns + col;
      for (let offset = -2; offset <= 2; offset++) {
        const sample = row * columns + Math.min(columns - 1, Math.max(0, col + offset));
        horizontal[i] += mask[sample] * weights[offset + 2] / 16;
      }
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const i = row * columns + col;
      for (let offset = -2; offset <= 2; offset++) {
        const sample = Math.min(rows - 1, Math.max(0, row + offset)) * columns + col;
        blurred[i] += horizontal[sample] * weights[offset + 2] / 16;
      }
    }
  }
  return { blurred, columns, rows };
}

function sampleGlow({ blurred, columns, rows }, x, y) {
  const col = Math.max(0, (x + 0.5) / glowScale - 0.5);
  const row = Math.max(0, (y + 0.5) / glowScale - 0.5);
  const left = Math.floor(col);
  const top = Math.floor(row);
  const right = Math.min(left + 1, columns - 1);
  const bottom = Math.min(top + 1, rows - 1);
  const dx = col - left;
  const dy = row - top;
  return (blurred[top * columns + left] * (1 - dx) + blurred[top * columns + right] * dx) * (1 - dy)
    + (blurred[bottom * columns + left] * (1 - dx) + blurred[bottom * columns + right] * dx) * dy;
}

function fineGrain(x, y) {
  let hash = Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca77);
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x80000000 - 1;
}

export function applyCinematicGrade(context, width, height, preset) {
  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  const glow = blurHighlightMask(pixels, width, height);
  const { contrast, lift, exposure, shoulder, saturation, shadows, highlights, grain, halation } = preset;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!pixels[i + 3]) continue;
      const luma = lumaAt(pixels, i);
      const curve = luma + contrast * (smoothstep(luma) - luma);
      const tone = lift + curve * (1 - lift - shoulder) + exposure * luma * (1 - luma);
      const cool = 1 - smoothstep(clampUnit(luma / 0.62));
      const warm = smoothstep(clampUnit((luma - 0.44) / 0.56));
      // Subtract the sharp highlight so the warm halo sits around the light source.
      const halo = halation * Math.max(0, sampleGlow(glow, x, y) - highlightMask(luma));
      const noise = fineGrain(x, y) * grain * (0.55 + 0.45 * 4 * luma * (1 - luma));
      const base = tone - luma * saturation + noise;
      pixels[i] = pixels[i] * saturation + 255 * (base + cool * shadows[0] + warm * highlights[0] + halo);
      pixels[i + 1] = pixels[i + 1] * saturation + 255 * (base + cool * shadows[1] + warm * highlights[1] + halo * 0.33);
      pixels[i + 2] = pixels[i + 2] * saturation + 255 * (base + cool * shadows[2] + warm * highlights[2] + halo * 0.09);
    }
  }
  context.putImageData(image, 0, 0);
}
