import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';

const root = new URL('../', import.meta.url);

async function assetBytes(name) {
  return readFile(new URL(`public/${name}`, root));
}

function pngSize(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function pngRgba(bytes) {
  const { width, height } = pngSize(bytes);
  let offset = 8;
  const idat = [];
  let bitDepth;
  let colorType;
  let interlace;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += 12 + length;
  }
  assert.equal(bitDepth, 8, 'PNG uses 8-bit channels');
  assert.equal(colorType, 6, 'PNG uses RGBA channels');
  assert.equal(interlace, 0, 'PNG is non-interlaced');

  const stride = width * 4;
  const filtered = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[y * (stride + 1)];
    const rowStart = y * stride;
    const sourceStart = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceStart + x];
      const left = x >= 4 ? pixels[rowStart + x - 4] : 0;
      const above = y > 0 ? pixels[rowStart - stride + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[rowStart - stride + x - 4] : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + above;
      else if (filter === 3) value = raw + Math.floor((left + above) / 2);
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - above);
        const pc = Math.abs(estimate - upperLeft);
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft);
      } else assert.equal(filter, 0, `unsupported PNG filter ${filter}`);
      pixels[rowStart + x] = value & 0xff;
    }
  }
  return { width, height, pixels };
}

test('browser brand assets expose deterministic PNG and ICO fallbacks', async () => {
  for (const [name, size] of [
    ['favicon-16.png', 16],
    ['favicon-32.png', 32],
    ['icon-192-maskable.png', 192],
    ['icon-512-maskable.png', 512],
  ]) {
    assert.deepEqual(pngSize(await assetBytes(name)), { width: size, height: size }, name);
  }

  const ico = await assetBytes('favicon.ico');
  assert.equal(ico.readUInt16LE(0), 0, 'ICO reserved field');
  assert.equal(ico.readUInt16LE(2), 1, 'ICO image type');
  assert.equal(ico.readUInt16LE(4), 2, 'ICO contains 16px and 32px entries');
  assert.deepEqual(
    [ico.readUInt8(6) || 256, ico.readUInt8(7) || 256, ico.readUInt8(22) || 256, ico.readUInt8(23) || 256],
    [16, 16, 32, 32],
    'ICO directory dimensions',
  );
});

test('maskable icons are opaque full-bleed variants of the Likerts mark', async () => {
  const source = await assetBytes('icon-maskable.svg');
  assert.match(source.toString(), /<rect width="64" height="64" fill="#021a38"\/>/);

  for (const name of ['icon-192-maskable.png', 'icon-512-maskable.png']) {
    const bytes = await assetBytes(name);
    const { width, height, pixels } = pngRgba(bytes);
    assert.equal(width, height, name);
    assert.deepEqual([...pixels.subarray(0, 4)], [2, 26, 56, 255], `${name} top-left is opaque #021a38`);
    const bottomRight = (height - 1) * width * 4 + (width - 1) * 4;
    assert.deepEqual([...pixels.subarray(bottomRight, bottomRight + 4)], [2, 26, 56, 255], `${name} bottom-right is opaque #021a38`);
  }
});

test('manifest and root document declare explicit install scope and brand metadata', async () => {
  const manifest = JSON.parse((await assetBytes('site.webmanifest')).toString());
  assert.equal(manifest.id, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.lang, 'en');
  assert.equal(manifest.dir, 'ltr');
  assert.equal(manifest.name, 'Likerts — Free Synthetic Research');
  assert.equal(manifest.theme_color, '#021a38');
  assert.deepEqual(
    manifest.icons.filter((icon) => icon.purpose === 'maskable').map((icon) => icon.src),
    ['/icon-192-maskable.png', '/icon-512-maskable.png'],
  );

  const index = (await readFile(new URL('index.html', root))).toString();
  assert.match(index, /href="\/favicon\.ico" type="image\/x-icon" sizes="any"/);
  assert.match(index, /href="\/favicon-32\.png" type="image\/png" sizes="32x32"/);
  assert.match(index, /href="\/favicon-16\.png" type="image\/png" sizes="16x16"/);
  assert.match(index, /name="theme-color" content="#021a38"/);
  assert.match(index, /property="og:locale" content="en_US"/);
  assert.match(index, /property="og:image" content="https:\/\/likerts\.com\/social\/likerts-en-us-v1\.png"/);
  assert.match(index, /name="twitter:image" content="https:\/\/likerts\.com\/social\/likerts-en-us-v1\.png"/);
  assert.match(index, /Likerts — Free Synthetic Research\. Model-generated—not human participant evidence\./);
  assert.doesNotMatch(index, /#021a3a/i);
});
