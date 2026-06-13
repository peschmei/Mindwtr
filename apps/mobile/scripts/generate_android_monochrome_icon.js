#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const OUTPUT_PATH = path.join(__dirname, '..', 'assets', 'images', 'android-icon-monochrome.png');

const GLYPH = {
  center: SIZE / 2,
  ringRadius: 252,
  ringStroke: 54,
  checkStroke: 84,
  checkPoints: [
    [370, 522],
    [458, 612],
    [658, 422],
  ],
};

const ANTIALIAS_RADIUS = 1.75;

const formatPathNumber = (value) => Number(value.toFixed(3)).toString();

const buildCirclePath = ({ center, ringRadius }) => {
  const c = center;
  const r = ringRadius;
  const k = r * 0.5522847498307936;
  const top = c - r;
  const right = c + r;
  const bottom = c + r;
  const left = c - r;
  const cpNear = c - k;
  const cpFar = c + k;

  return [
    `M${formatPathNumber(c)},${formatPathNumber(top)}`,
    `C${formatPathNumber(cpFar)},${formatPathNumber(top)} ${formatPathNumber(right)},${formatPathNumber(cpNear)} ${formatPathNumber(right)},${formatPathNumber(c)}`,
    `C${formatPathNumber(right)},${formatPathNumber(cpFar)} ${formatPathNumber(cpFar)},${formatPathNumber(bottom)} ${formatPathNumber(c)},${formatPathNumber(bottom)}`,
    `C${formatPathNumber(cpNear)},${formatPathNumber(bottom)} ${formatPathNumber(left)},${formatPathNumber(cpFar)} ${formatPathNumber(left)},${formatPathNumber(c)}`,
    `C${formatPathNumber(left)},${formatPathNumber(cpNear)} ${formatPathNumber(cpNear)},${formatPathNumber(top)} ${formatPathNumber(c)},${formatPathNumber(top)}`,
  ].join(' ');
};

const buildCheckPath = (points) => points
  .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${formatPathNumber(x)},${formatPathNumber(y)}`)
  .join(' ');

const buildVectorDrawableXml = () => `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="${SIZE}"
    android:viewportHeight="${SIZE}">
    <path
        android:pathData="${buildCirclePath(GLYPH)}"
        android:fillColor="#00000000"
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="${GLYPH.ringStroke}"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />
    <path
        android:pathData="${buildCheckPath(GLYPH.checkPoints)}"
        android:fillColor="#00000000"
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="${GLYPH.checkStroke}"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />
</vector>
`;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const strokeCoverage = (distanceFromStrokeCenter, strokeWidth) => {
  const edgeDistance = distanceFromStrokeCenter - strokeWidth / 2;
  if (edgeDistance <= -ANTIALIAS_RADIUS) {
    return 1;
  }
  if (edgeDistance >= ANTIALIAS_RADIUS) {
    return 0;
  }
  return 0.5 - edgeDistance / (ANTIALIAS_RADIUS * 2);
};

const distanceToSegment = (x, y, x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp(((x - x1) * dx + (y - y1) * dy) / lengthSquared, 0, 1);
  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;
  return Math.hypot(x - nearestX, y - nearestY);
};

const setAlpha = (pixels, x, y, coverage) => {
  if (coverage <= 0 || x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
    return;
  }
  const offset = (y * SIZE + x) * 4;
  const alpha = Math.round(clamp(coverage, 0, 1) * 255);
  if (alpha <= pixels[offset + 3]) {
    return;
  }
  pixels[offset] = 255;
  pixels[offset + 1] = 255;
  pixels[offset + 2] = 255;
  pixels[offset + 3] = alpha;
};

const drawRing = (pixels, cx, cy, radius, strokeWidth) => {
  const padding = Math.ceil(strokeWidth / 2 + ANTIALIAS_RADIUS + 1);
  const minX = Math.max(0, Math.floor(cx - radius - padding));
  const maxX = Math.min(SIZE - 1, Math.ceil(cx + radius + padding));
  const minY = Math.max(0, Math.floor(cy - radius - padding));
  const maxY = Math.min(SIZE - 1, Math.ceil(cy + radius + padding));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distanceFromRing = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius);
      setAlpha(pixels, x, y, strokeCoverage(distanceFromRing, strokeWidth));
    }
  }
};

const drawSegment = (pixels, start, end, strokeWidth) => {
  const [x1, y1] = start;
  const [x2, y2] = end;
  const padding = Math.ceil(strokeWidth / 2 + ANTIALIAS_RADIUS + 1);
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - padding));
  const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(x1, x2) + padding));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - padding));
  const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(y1, y2) + padding));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = distanceToSegment(x + 0.5, y + 0.5, x1, y1, x2, y2);
      setAlpha(pixels, x, y, strokeCoverage(distance, strokeWidth));
    }
  }
};

const crcTable = new Uint32Array(256);
for (let n = 0; n < crcTable.length; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data = Buffer.alloc(0)) => {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
};

const encodePng = (pixels) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  header[9] = 6;

  const scanlines = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const scanlineOffset = y * (SIZE * 4 + 1);
    scanlines[scanlineOffset] = 0;
    pixels.copy(scanlines, scanlineOffset + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND'),
  ]);
};

const generateIcon = () => {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const { center, ringRadius, ringStroke, checkStroke, checkPoints } = GLYPH;

  drawRing(pixels, center, center, ringRadius, ringStroke);
  drawSegment(pixels, checkPoints[0], checkPoints[1], checkStroke);
  drawSegment(pixels, checkPoints[1], checkPoints[2], checkStroke);

  fs.writeFileSync(OUTPUT_PATH, encodePng(pixels));
  console.log(`Generated ${path.relative(process.cwd(), OUTPUT_PATH)}`);
};

if (require.main === module) {
  generateIcon();
}

module.exports = {
  buildVectorDrawableXml,
  __testables: {
    GLYPH,
    buildCheckPath,
    buildCirclePath,
    distanceToSegment,
    formatPathNumber,
    strokeCoverage,
  },
};
