const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const INPUT = path.join(__dirname, 'sample_likert_responses.csv');
const SVG_OUTPUT = path.join(__dirname, 'likert_visualisations.svg');
const PNG_OUTPUT = path.join(__dirname, 'likert_visualisations.png');

const rows = fs.readFileSync(INPUT, 'utf8').trim().split('\n').slice(1).map((line) => {
  const [question, stronglyDisagree, disagree, neutral, agree, stronglyAgree, n] = line.split(',');
  const values = [stronglyDisagree, disagree, neutral, agree, stronglyAgree].map(Number);
  if (values.reduce((sum, value) => sum + value, 0) !== 100) {
    throw new Error(`${question}: response percentages must sum to 100`);
  }
  return {
    question,
    values,
    n: Number(n),
    negative: values[0] + values[1],
    favourable: values[3] + values[4],
    mean: values.reduce((sum, value, index) => sum + value * (index + 1), 0) / 100,
  };
});

const colours = {
  ink: '#18212B',
  muted: '#667085',
  grid: '#D9DEE7',
  panel: '#F7F9FC',
  white: '#FFFFFF',
  strongNegative: '#9B3A13',
  negative: '#E07A3F',
  neutral: '#D7DCE3',
  positive: '#6EA8D8',
  strongPositive: '#174A7E',
  accent: '#174A7E',
};

const responseLabels = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];
const responseColours = [
  colours.strongNegative,
  colours.negative,
  colours.neutral,
  colours.positive,
  colours.strongPositive,
];

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const text = (x, y, value, options = {}) => {
  const {
    size = 16,
    fill = colours.ink,
    weight = 400,
    anchor = 'start',
    family = 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
    opacity = 1,
    letterSpacing = 0,
  } = options;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}" letter-spacing="${letterSpacing}">${escapeXml(value)}</text>`;
};

const rect = (x, y, width, height, fill, options = {}) => {
  const { rx = 0, stroke = 'none', strokeWidth = 0, opacity = 1 } = options;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`;
};

const line = (x1, y1, x2, y2, options = {}) => {
  const { stroke = colours.grid, strokeWidth = 1, dash = '', opacity = 1 } = options;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash ? ` stroke-dasharray="${dash}"` : ''} opacity="${opacity}"/>`;
};

const circle = (cx, cy, r, fill, options = {}) => {
  const { stroke = colours.white, strokeWidth = 0 } = options;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
};

function mix(hexA, hexB, amount) {
  const parse = (hex) => hex.match(/[A-Fa-f0-9]{2}/g).map((value) => parseInt(value, 16));
  const a = parse(hexA);
  const b = parse(hexB);
  const rgb = a.map((value, index) => Math.round(value + (b[index] - value) * amount));
  return `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

const svg = [];
svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1280" viewBox="0 0 1440 1280">`);
svg.push(rect(0, 0, 1440, 1280, colours.white));

svg.push(text(72, 72, 'Likert survey visualisations', { size: 34, weight: 720 }));
svg.push(text(72, 106, 'Illustrative 5-point responses • 5 questions • n = 200 per question', { size: 17, fill: colours.muted }));
svg.push(rect(72, 132, 1296, 54, '#EEF4FA', { rx: 10 }));
svg.push(text(96, 166, 'Ease of use leads at 72% favourable; reliability trails at 54%.', { size: 18, weight: 650, fill: colours.accent }));

// 1. Diverging stacked bars
svg.push(text(72, 236, '1  Response distribution', { size: 23, weight: 700 }));
svg.push(text(72, 265, 'Neutral responses straddle the centre; disagreement is left and agreement is right.', { size: 15, fill: colours.muted }));

let legendX = 425;
responseLabels.forEach((label, index) => {
  svg.push(rect(legendX, 288, 16, 16, responseColours[index], { rx: 3 }));
  svg.push(text(legendX + 23, 301, label, { size: 13, fill: colours.muted }));
  legendX += [150, 108, 90, 82, 145][index];
});

const divergingCentre = 812;
const pxPerPercent = 5.15;
const rowStartY = 338;
const rowGap = 59;
const barHeight = 34;

[-100, -50, 0, 50, 100].forEach((tick) => {
  const x = divergingCentre + tick * pxPerPercent;
  svg.push(line(x, 326, x, 624, {
    stroke: tick === 0 ? '#86909C' : colours.grid,
    strokeWidth: tick === 0 ? 1.5 : 1,
    dash: tick === 0 ? '' : '3 5',
  }));
  svg.push(text(x, 645, tick === 0 ? '0' : `${Math.abs(tick)}%`, { size: 12, fill: colours.muted, anchor: 'middle' }));
});

rows.forEach((row, rowIndex) => {
  const y = rowStartY + rowIndex * rowGap;
  svg.push(text(252, y + 22, row.question, { size: 16, weight: 600, anchor: 'end' }));

  const [stronglyDisagree, disagree, neutral, agree, stronglyAgree] = row.values;
  const neutralX = divergingCentre - (neutral / 2) * pxPerPercent;
  const disagreeX = neutralX - disagree * pxPerPercent;
  const strongDisagreeX = disagreeX - stronglyDisagree * pxPerPercent;
  const agreeX = divergingCentre + (neutral / 2) * pxPerPercent;
  const strongAgreeX = agreeX + agree * pxPerPercent;

  const segments = [
    [strongDisagreeX, stronglyDisagree, responseColours[0], stronglyDisagree, colours.white],
    [disagreeX, disagree, responseColours[1], disagree, colours.ink],
    [neutralX, neutral, responseColours[2], neutral, colours.ink],
    [agreeX, agree, responseColours[3], agree, colours.ink],
    [strongAgreeX, stronglyAgree, responseColours[4], stronglyAgree, colours.white],
  ];

  segments.forEach(([x, value, fill, label, labelColour]) => {
    const width = value * pxPerPercent;
    svg.push(rect(x, y, width, barHeight, fill));
    if (width >= 31) {
      svg.push(text(x + width / 2, y + 22, `${label}%`, { size: 12, fill: labelColour, weight: 650, anchor: 'middle' }));
    }
  });
});

svg.push(text(divergingCentre - 12, 672, '← DISAGREE', { size: 12, fill: colours.muted, weight: 650, anchor: 'end', letterSpacing: 1 }));
svg.push(text(divergingCentre + 12, 672, 'AGREE →', { size: 12, fill: colours.muted, weight: 650, letterSpacing: 1 }));

// Bottom panel backgrounds
svg.push(rect(72, 718, 628, 468, colours.panel, { rx: 16 }));
svg.push(rect(724, 718, 644, 468, colours.panel, { rx: 16 }));

// 2. Net favourability lollipop
svg.push(text(104, 765, '2  Net favourability', { size: 22, weight: 700 }));
svg.push(text(104, 793, 'Favourable minus unfavourable responses', { size: 14, fill: colours.muted }));

const sortedRows = [...rows].sort((a, b) => b.favourable - b.negative - (a.favourable - a.negative));
const dotX0 = 292;
const dotWidth = 358;
const dotMin = 0;
const dotMax = 60;
const dotScale = (value) => dotX0 + ((value - dotMin) / (dotMax - dotMin)) * dotWidth;

[0, 20, 40, 60].forEach((tick) => {
  const x = dotScale(tick);
  svg.push(line(x, 824, x, 1116, { stroke: colours.grid, dash: tick === 0 ? '' : '3 5' }));
  svg.push(text(x, 1139, `${tick}`, { size: 12, fill: colours.muted, anchor: 'middle' }));
});

sortedRows.forEach((row, index) => {
  const y = 854 + index * 56;
  const score = row.favourable - row.negative;
  svg.push(text(266, y + 5, row.question, { size: 14, weight: 600, anchor: 'end' }));
  svg.push(line(dotScale(0), y, dotScale(score), y, { stroke: '#9EC2E0', strokeWidth: 8 }));
  svg.push(circle(dotScale(score), y, 10, colours.accent, { stroke: colours.white, strokeWidth: 2 }));
  svg.push(text(dotScale(score) + 18, y + 5, `+${score}`, { size: 14, fill: colours.accent, weight: 700 }));
});
svg.push(text(104, 1162, 'Higher values indicate a stronger positive balance.', { size: 12, fill: colours.muted }));

// 3. Response heatmap
svg.push(text(756, 765, '3  Response heatmap', { size: 22, weight: 700 }));
svg.push(text(756, 793, 'Share of respondents in each response category', { size: 14, fill: colours.muted }));

const heatX = 938;
const heatY = 834;
const cellWidth = 78;
const cellHeight = 51;
const cellGap = 5;
const heatLabelLines = [
  ['Strongly', 'disagree'],
  ['Disagree'],
  ['Neutral'],
  ['Agree'],
  ['Strongly', 'agree'],
];

heatLabelLines.forEach((labelLines, index) => {
  labelLines.forEach((label, lineIndex) => {
    svg.push(text(heatX + index * (cellWidth + cellGap) + cellWidth / 2, 816 + lineIndex * 13, label, { size: 11, fill: colours.muted, anchor: 'middle' }));
  });
});

rows.forEach((row, rowIndex) => {
  const y = heatY + rowIndex * (cellHeight + cellGap);
  svg.push(text(912, y + 31, row.question, { size: 13, weight: 600, anchor: 'end' }));
  row.values.forEach((value, valueIndex) => {
    const intensity = Math.min(0.88, 0.16 + value / 48);
    const base = valueIndex < 2 ? colours.negative : valueIndex === 2 ? '#9AA4B2' : colours.accent;
    const fill = mix(colours.white, base, intensity);
    const labelColour = intensity > 0.57 ? colours.white : colours.ink;
    const x = heatX + valueIndex * (cellWidth + cellGap);
    svg.push(rect(x, y, cellWidth, cellHeight, fill, { rx: 8 }));
    svg.push(text(x + cellWidth / 2, y + 32, `${value}%`, { size: 14, fill: labelColour, weight: 700, anchor: 'middle' }));
  });
});

svg.push(text(756, 1162, 'Darker cells represent a larger share within each response direction.', { size: 12, fill: colours.muted }));

svg.push(line(72, 1220, 1368, 1220, { stroke: colours.grid }));
svg.push(text(72, 1250, 'Illustrative data — replace sample_likert_responses.csv with real survey percentages.', { size: 12, fill: colours.muted }));
svg.push(text(1368, 1250, 'Scale: 1 = strongly disagree, 5 = strongly agree', { size: 12, fill: colours.muted, anchor: 'end' }));
svg.push('</svg>');

const svgMarkup = svg.join('\n');
fs.writeFileSync(SVG_OUTPUT, svgMarkup);

sharp(Buffer.from(svgMarkup))
  .png({ compressionLevel: 9 })
  .toFile(PNG_OUTPUT)
  .then(() => {
    console.log(`Created ${path.basename(SVG_OUTPUT)}`);
    console.log(`Created ${path.basename(PNG_OUTPUT)}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
