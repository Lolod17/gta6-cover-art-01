// Native-coordinate poster lettering, shared by the three live compositions.
const SVG = 'http://www.w3.org/2000/svg';
const ink = '#0B0D13';
const paper = '#EDE6D8';
const mono = 'Scene Mono';
const display = 'Scene Display';
const editorial = 'Scene Editorial';
const scriptFace = 'Scene Script';
const amber = '#F2B24A';
const measure = document.createElement('canvas').getContext('2d');

export function createPosterCopy() {
  return {
    title: 'AFTER\nHOURS', subtitle: 'A city with no alibi.', subtitleStyle: 'editorial',
    tagline: 'THE NIGHT IS YOUNG. THE STAKES ARE NOT.',
    quote: '"The city never looked this guilty."', seal: 'ORIGINAL COVER ART',
    billing: [
      'PALM DRIVE PICTURES PRESENTS',
      'A LOW TIDE PRODUCTION · AN ORIGINAL PICTURE',
      'MAYA CRUZ    ELIAS VEGA    NICO REYES',
      'MUSIC BY SOL MARIN · PHOTOGRAPHY BY LENA WEST · EDITED BY THEO PARK',
      'WRITTEN & DIRECTED BY ALEX RIVERA',
    ],
    festival: 'OFFICIAL SELECTION · MIDNIGHT COAST FILM FESTIVAL',
    rating: 'R', ratingNote: 'RESTRICTED · LANGUAGE & VIOLENCE', issue: 'ISSUE 006', release: 'COMING SOON',
    panels: [
      { timecode: '6:42 PM', caption: 'LOOKING FOR TROUBLE' },
      { timecode: '7:16 PM', caption: 'LAST LIGHT ON THE STRIP' },
      { timecode: '8:03 PM', caption: 'NO GOOD EXITS' },
      { timecode: '9:27 PM', caption: 'TAKE THE LONG WAY' },
      { timecode: '11:08 PM', caption: 'NOTHING TO LOSE' },
      { timecode: '12:01 AM', caption: 'ONE MORE NIGHT' },
    ],
  };
}

function node(tag, attributes = {}, text) {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

function fittedSize(text, family, size, width, weight, spacing = 0) {
  measure.font = `${weight} ${size}px "${family}"`;
  const length = measure.measureText(text).width + Math.max(0, [...text].length - 1) * spacing;
  return length > width ? size * width / length : size;
}

function lettering(parent, text, x, y, width, size, options = {}) {
  if (!text.trim()) return;
  const { family = mono, weight = 400, spacing = 0, ...attributes } = options;
  const fitted = fittedSize(text, family, size, width, weight, spacing);
  const element = node('text', {
    x, y, fill: paper, 'font-family': family, 'font-weight': weight,
    'font-size': fitted, 'letter-spacing': spacing * fitted / size,
    ...attributes,
  }, text);
  parent.append(element);
  return element;
}

function titleLines(title) {
  const lines = title.trim().split(/\n+/).filter(Boolean);
  if (lines.length > 1) return [lines[0], lines.slice(1).join(' ')];
  const words = (lines[0] || '').split(/\s+/);
  if (words.length < 2 || title.length < 12) return lines;
  let split = 1;
  for (let index = 1; index < words.length; index++) {
    if (Math.abs(words.slice(0, index).join(' ').length - title.length / 2) <
        Math.abs(words.slice(0, split).join(' ').length - title.length / 2)) split = index;
  }
  return [words.slice(0, split).join(' '), words.slice(split).join(' ')];
}

function starPath(cx, cy, r) {
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = (index * 36 - 90) * Math.PI / 180;
    const radius = index % 2 ? r * .45 : r;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

// The bottom band is painted on a canvas once per size, then embedded as a data URL
// so the live SVG preview and the PNG export share the exact same pixels.
const bandCache = new Map();
function bandImage(w, h) {
  const key = `${w}x${h}`;
  if (bandCache.has(key)) return bandCache.get(key);
  const bandHeight = h * .105;
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = Math.round(bandHeight * 2);
  const context = canvas.getContext('2d');
  context.scale(2, 2);
  const ground = h * .101;
  let seed = 6;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  context.fillStyle = paper;
  context.globalAlpha = .10;
  let x = -w * .01;
  while (x < w) {
    const buildingWidth = w * (.02 + random() * .035);
    const buildingHeight = h * (.029 + random() * .022);
    context.fillRect(x, ground - buildingHeight, buildingWidth, buildingHeight);
    x += buildingWidth + w * .004;
  }
  context.strokeStyle = paper;
  context.lineCap = 'round';
  context.globalAlpha = .18;
  for (const fraction of [.18, .31, .69, .82]) {
    const palmX = w * fraction;
    const palmHeight = h * (.042 + random() * .017);
    const lean = w * .008 * (random() > .5 ? 1 : -1);
    const topX = palmX + lean, topY = ground - palmHeight;
    context.lineWidth = Math.max(2, w * .0022);
    context.beginPath();
    context.moveTo(palmX, ground);
    context.quadraticCurveTo(palmX + lean * .3, ground - palmHeight * .6, topX, topY);
    context.stroke();
    context.lineWidth = Math.max(1.5, w * .0016);
    for (let index = 0; index < 8; index += 1) {
      const direction = index % 2 ? 1 : -1;
      const frond = Math.floor(index / 2);
      const length = Math.min(w, h) * (.012 + frond * .006);
      const rise = palmHeight * (.38 - frond * .21);
      context.beginPath();
      context.moveTo(topX, topY);
      context.quadraticCurveTo(topX + direction * length * .54, topY - palmHeight * .35, topX + direction * length, topY - rise);
      context.stroke();
    }
  }
  context.globalAlpha = .08;
  context.fillRect(0, ground - 1, w, 1.5);
  const url = canvas.toDataURL('image/png');
  bandCache.set(key, url);
  return url;
}

function renderQuote(svg, layout, copy) {
  const text = copy.quote.trim();
  if (!text) return;
  const { width: w, height: h } = layout;
  const unit = Math.min(w, h);
  const portrait = layout.key === 'portrait';
  const ruleY = h * (portrait ? .695 : .728);
  const starY = h * (portrait ? .708 : .7425);
  const baselineY = h * (portrait ? .742 : .779);
  const size = unit * .026;
  const maxWidth = w * .76;
  const fitted = fittedSize(text, editorial, size, maxWidth, 600);
  measure.font = `600 ${fitted}px "${editorial}"`;
  const plateWidth = Math.max(w * .28, measure.measureText(text).width + unit * .065);
  const group = node('g', { 'data-type': 'quote' });
  group.append(node('rect', { x: w / 2 - plateWidth / 2, y: ruleY, width: plateWidth, height: baselineY - ruleY + unit * .009, fill: ink, opacity: .76 }));
  group.append(node('line', { x1: w / 2 - w * .14, y1: ruleY, x2: w / 2 + w * .14, y2: ruleY, stroke: paper, 'stroke-width': 1.5, opacity: .6 }));
  const starRadius = unit * .0075, gap = unit * .022;
  for (let index = 0; index < 5; index += 1) {
    group.append(node('path', { d: starPath(w / 2 - gap * 2 + index * gap, starY, starRadius), fill: amber, stroke: ink, 'stroke-width': 1, 'data-star': 'quote' }));
  }
  lettering(group, text, w / 2, baselineY, maxWidth, size, { family: editorial, weight: 600, 'text-anchor': 'middle', 'data-type': 'quote-line' });
  svg.append(group);
}

function renderSeal(svg, layout, copy) {
  const rim = copy.seal.trim().toUpperCase();
  if (!rim) return;
  const { width: w, height: h } = layout;
  const unit = Math.min(w, h);
  const margin = w * .035;
  // Keep the entire stamp inside the dark footer, independent of photo crops.
  const radius = unit * .053;
  const cx = margin + radius, cy = h * .96 - radius - unit * .008;
  const group = node('g', { 'data-type': 'seal' });
  group.append(node('circle', { cx, cy, r: radius - 1.5, fill: ink, stroke: amber, 'stroke-width': 2.5 }));
  group.append(node('circle', { cx, cy, r: radius * .70, fill: 'none', stroke: amber, 'stroke-width': 1.2, opacity: .7 }));
  const rimRadius = radius * .76;
  const characters = [...rim.replace(/\s+/g, ' ')];
  const arcLength = rimRadius * Math.PI * 1.24;
  const rimSize = Math.min(radius * .25, arcLength / (characters.length * .68));
  const step = rimSize * .68 / rimRadius;
  characters.forEach((character, index) => {
    if (character === ' ') return;
    const radians = -Math.PI / 2 + (index - (characters.length - 1) / 2) * step;
    const px = cx + rimRadius * Math.cos(radians), py = cy + rimRadius * Math.sin(radians);
    group.append(node('text', {
      x: px, y: py, fill: paper, 'font-family': mono, 'font-weight': 600, 'font-size': rimSize,
      'text-anchor': 'middle', transform: `rotate(${radians * 180 / Math.PI + 90} ${px} ${py})`, 'data-rim': index,
    }, character));
  });
  group.append(node('path', { d: starPath(cx, cy + radius * .84, radius * .075), fill: amber, 'data-star': 'seal' }));
  const issue = copy.issue.trim().toUpperCase();
  if (issue) {
    const words = issue.split(/\s+/);
    if (words.length > 1) {
      lettering(group, words[0], cx, cy - radius * .14, radius * 1.16, radius * .23, { weight: 600, spacing: radius * .02, 'text-anchor': 'middle', 'data-type': 'seal-issue' });
      lettering(group, words.slice(1).join(' '), cx, cy + radius * .46, radius * 1.02, radius * .60, { family: display, weight: 700, 'text-anchor': 'middle', 'data-type': 'seal-issue' });
    } else {
      lettering(group, issue, cx, cy + radius * .2, radius * 1.3, radius * .3, { family: display, weight: 700, 'text-anchor': 'middle', 'data-type': 'seal-issue' });
    }
  }
  svg.append(group);
}

export function renderPosterTypography(svg, layout, copy, panels) {
  const { width: w, height: h } = layout;
  const unit = Math.min(w, h);
  const margin = w * .035;
  const hero = panels[0];
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.replaceChildren();
  svg.append(node('title', {}, `${copy.title.replaceAll('\n', ' ')} — ${copy.subtitle}`));
  const defs = node('defs');
  const gradient = (id, stops, x2 = '0%', y2 = '100%') => {
    const grad = node('linearGradient', { id, x1: '0%', y1: '0%', x2, y2 });
    for (const [offset, color, opacity = 1] of stops) grad.append(node('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
    defs.append(grad);
  };
  gradient('title-fill', [['0%', '#FFF5DE'], ['48%', paper], ['100%', '#F2B24A']]);
  gradient('hero-scrim', [['0%', ink, .52], ['100%', ink, 0]], '100%', '0%');
  gradient('billing-scrim', [['0%', ink, 0], ['32%', ink, .94], ['45%', ink, 1], ['100%', ink, 1]]);
  svg.append(defs);
  svg.append(node('rect', { x: 0, y: 0, width: hero.width, height: hero.height, fill: 'url(#hero-scrim)' }));
  svg.append(node('rect', { x: 0, y: h * .73, width: w, height: h * .27, fill: 'url(#billing-scrim)' }));

  const textWidth = hero.width - margin * 2;
  lettering(svg, copy.tagline, margin, hero.height * .10, textWidth, unit * .016, { spacing: unit * .002, 'data-type': 'tagline' });
  const lines = titleLines(copy.title.toUpperCase());
  const titleSize = Math.min(hero.height * (lines.length > 1 ? .30 : .48), textWidth * .34);
  const size = Math.min(titleSize, ...lines.map(line => fittedSize(line, display, titleSize, textWidth - 24, 700, -titleSize * .025)));
  const titleGroup = node('g', { 'data-type': 'title', 'paint-order': 'stroke fill', 'stroke-linejoin': 'round' });
  // Offset solid ink silhouettes keep the shadow sharp at every output scale.
  for (const shadow of [true, false]) lines.forEach((line, index) => {
    lettering(titleGroup, line, margin + (shadow ? unit * .009 : 0), hero.height * .20 + size * .84 + index * size * 1.02 + (shadow ? unit * .01 : 0), textWidth, size, {
      family: display, weight: 700, spacing: -size * .025,
      fill: shadow ? ink : 'url(#title-fill)', stroke: ink,
      'stroke-width': layout.key === 'landscape' ? 14 : 12,
      'data-title-layer': shadow ? 'shadow' : 'face',
    });
  });
  svg.append(titleGroup);
  const subtitleY = hero.height * .20 + size * .84 + Math.max(0, lines.length - 1) * size * 1.02 + unit * .06;
  const script = copy.subtitleStyle === 'script';
  lettering(svg, copy.subtitle, margin, Math.min(hero.height * .88, subtitleY), textWidth, unit * .05, {
    family: script ? scriptFace : editorial, weight: script ? 400 : 600,
    'data-type': 'subtitle', stroke: ink, 'stroke-width': 1.5, 'paint-order': 'stroke fill',
  });

  panels.forEach((panel, index) => {
    const { timecode, caption } = copy.panels[index];
    const text = [timecode.trim(), caption.trim()].filter(Boolean).join(' — ').toUpperCase();
    if (!text) return;
    const x = panel.x + unit * .014;
    // The hero caption anchors its lower edge; supporting captions mark the upper edge.
    const topInset = layout.key === 'portrait' && index >= 4 ? .025 : .034;
    const y = index === 0 ? panel.y + panel.height - unit * .018 : panel.y + unit * topInset;
    const width = panel.width - unit * .028;
    const size = unit * .026;
    const spacing = unit * .0008;
    const fitted = fittedSize(text, display, size, width, 500, spacing);
    measure.font = `500 ${size}px "${display}"`;
    const labelWidth = measure.measureText(text).width * fitted / size + ([...text].length - 1) * spacing * fitted / size;
    svg.append(node('rect', { x: x - unit * .008, y: y - unit * .023, width: labelWidth + unit * .016, height: unit * .031, fill: ink, opacity: .90 }));
    lettering(svg, text, x, y, width, size, { family: display, weight: 500, spacing, 'data-type': 'panel-caption', 'data-panel': index });
  });

  renderQuote(svg, layout, copy);

  if (copy.release.trim()) {
    svg.append(node('rect', { x: 0, y: h * .96, width: w, height: h * .04, fill: '#C41C83', 'data-type': 'release-strip' }));
    svg.append(node('image', { x: 0, y: h * .895, width: w, height: h * .105, href: bandImage(w, h), preserveAspectRatio: 'none', 'data-type': 'band' }));
  }

  const billing = node('g', { 'data-type': 'billing' });
  const creditSizes = [.012, .014, .019, .0105, .015];
  // Portrait's final panel row starts later; keep its captions above the credit stack.
  const portrait = layout.key === 'portrait';
  copy.billing.forEach((line, index) => {
    lettering(billing, line, w / 2, h * (portrait ? .866 : .825) + index * unit * .023, w * .70, unit * creditSizes[index], {
      'text-anchor': 'middle', weight: index === 2 || index === 4 ? 600 : 400, 'data-billing-line': index + 1,
    });
  });
  svg.append(billing);
  lettering(svg, copy.festival, w / 2, h * (portrait ? .85 : .802), w * .86, unit * .013, { 'text-anchor': 'middle', spacing: unit * .001, fill: '#F2B24A', 'data-type': 'festival' });

  if (copy.rating.trim() || copy.ratingNote.trim()) {
    const ratingY = h * (portrait ? .887 : .861), ratingW = w * .075, ratingH = unit * .065;
    const ratingX = w - margin - ratingW;
    const group = node('g', { 'data-type': 'rating' });
    group.append(node('rect', { x: ratingX, y: ratingY, width: ratingW, height: ratingH, fill: ink, stroke: paper, 'stroke-width': 1.5 }));
    lettering(group, copy.rating, ratingX + ratingW / 2, ratingY + ratingH * .73, ratingW * .82, unit * .041, { family: display, weight: 700, 'text-anchor': 'middle' });
    lettering(group, copy.ratingNote, w - margin, ratingY + ratingH + unit * .014, w * .11, unit * .009, { 'text-anchor': 'end' });
    svg.append(group);
  }
  if (copy.seal.trim()) renderSeal(svg, layout, copy);
  else lettering(svg, copy.issue, margin, h * (portrait ? .93 : .904), w * .11, unit * .016, { 'data-type': 'issue' });
  if (copy.release.trim()) {
    lettering(svg, copy.release, w / 2, h * .988, w * .90, unit * .022, { weight: 600, 'text-anchor': 'middle', spacing: unit * .007, 'data-type': 'release' });
  }
}

export async function loadPosterFonts() {
  await Promise.all([
    document.fonts.load('700 100px "Scene Display"'),
    document.fonts.load('500 28px "Scene Display"'),
    document.fonts.load('400 40px "Scene Editorial"'),
    document.fonts.load('600 40px "Scene Editorial"'),
    document.fonts.load('400 40px "Scene Script"'),
    document.fonts.load('400 20px "Scene Mono"'),
    document.fonts.load('600 20px "Scene Mono"'),
  ]);
}
