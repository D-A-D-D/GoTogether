// Icon generator — run with: node scripts/generate-icons.mjs
// Renders the app icon SVG (shapes only - the SVG rasterizer here has no
// access to web fonts) to the manifest's PNG sizes,
// the Apple touch icon, and a hand-assembled favicon.ico (PNG-in-ICO,
// supported since Vista/every modern browser — not worth a dependency
// for something this simple, especially given how much bit-rotted baggage
// the popular ICO-writer packages tend to drag in).
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

/** Minimal ICO container: PNG-format images, one ICONDIRENTRY each. */
function buildIco(pngBuffers) {
  const headerSize = 6 + 16 * pngBuffers.length;
  let offset = headerSize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngBuffers.length, 4);

  pngBuffers.forEach(({ size, buffer }, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry); // width (0 = 256)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1); // height
    header.writeUInt8(0, entry + 2); // color count
    header.writeUInt8(0, entry + 3); // reserved
    header.writeUInt16LE(1, entry + 4); // color planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(buffer.length, entry + 8); // data size
    header.writeUInt32LE(offset, entry + 12); // data offset
    offset += buffer.length;
  });

  return Buffer.concat([header, ...pngBuffers.map((p) => p.buffer)]);
}

function svg(size) {
  // Always authored in the same 512-unit space; sharp rasterizes then
  // resizes to `size`, so nothing here needs to scale per-size.
  // The mark is the app's logo - two stops joined by a dashed route - on the deep forest
  // colour, kept inside the middle 80% so Android's circular mask never clips it.
  return `<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#0B4B45"/>
  <path d="M146 360C146 232 366 290 366 154" fill="none" stroke="#FF7A57" stroke-width="30"
        stroke-linecap="round" stroke-dasharray="2 68"/>
  <circle cx="140" cy="372" r="62" fill="#FFF1DE"/>
  <circle cx="372" cy="140" r="62" fill="none" stroke="#FFC247" stroke-width="34"/>
</svg>`;
}

async function renderPng(size) {
  return sharp(Buffer.from(svg(size)), { density: 384 }).resize(size, size).png().toBuffer();
}

async function render(size, path) {
  writeFileSync(path, await renderPng(size));
  console.log(`wrote ${path}`);
}

await render(192, 'public/icons/icon-192.png');
await render(512, 'public/icons/icon-512.png');
await render(180, 'src/app/apple-icon.png');

const icoBuffers = await Promise.all(
  [16, 32, 48].map(async (size) => ({ size, buffer: await renderPng(size) })),
);
writeFileSync('src/app/favicon.ico', buildIco(icoBuffers));
console.log('wrote src/app/favicon.ico');
