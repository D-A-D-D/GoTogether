// Decides what an uploaded file really is by looking at its first bytes, and measures an image's size from
// its header - without decoding it. The uploader's own claim (the Content-Type header, a filename) is never
// used: it is trivially forged, and a file served back with the wrong type is how an upload becomes an attack.
//
// Deliberately narrow. Pictures: JPEG, PNG and WebP only - not GIF (animated, large) and above all not SVG
// (a picture that can carry script). Sound: the containers browsers record voice in (WebM and Ogg on Chrome and
// Firefox, MP4 on Safari) plus MP3 and WAV. Anything else is refused.

export interface SniffedImage {
  family: 'image';
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
}

export interface SniffedAudio {
  family: 'audio';
  mime: 'audio/webm' | 'audio/ogg' | 'audio/mp4' | 'audio/mpeg' | 'audio/wav';
}

export type Sniffed = SniffedImage | SniffedAudio;

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const ascii = (buf: Buffer, start: number, end: number) => buf.toString('latin1', start, end);

/** Width and height from a JPEG's start-of-frame marker, walking its segments. Null if it is malformed. */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let at = 2;
  while (at + 4 <= buf.length) {
    if (buf[at] !== 0xff) return null;
    let marker = buf[at + 1];
    // Fill bytes: any number of 0xFF may precede a marker.
    while (marker === 0xff && at + 2 < buf.length) {
      at += 1;
      marker = buf[at + 1];
    }
    // Markers with no length: standalone ones and restart markers.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any frame header
    const length = buf.readUInt16BE(at + 2);
    if (length < 2) return null;
    // Start-of-frame markers (baseline, progressive, ...), but not DHT/JPG/DAC which sit in the same range.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (at + 9 > buf.length) return null;
      return { height: buf.readUInt16BE(at + 5), width: buf.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

function pngSize(buf: Buffer): { width: number; height: number } | null {
  // 8-byte signature, then the IHDR chunk: length(4) 'IHDR'(4) width(4) height(4).
  if (buf.length < 24 || ascii(buf, 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  const chunk = ascii(buf, 12, 16);
  if (chunk === 'VP8 ') {
    // Lossy: a 3-byte frame tag, the start code 9D 01 2A, then 14-bit width and height.
    if (!startsWith(buf, [0x9d, 0x01, 0x2a], 23)) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // Extended: 24-bit width-1 and height-1.
    return { width: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1, height: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1 };
  }
  return null;
}

/** What the bytes are, or null if they are not something we accept. Never throws. */
export function sniffMedia(buf: Buffer): Sniffed | null {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 12) return null;

    if (startsWith(buf, [0xff, 0xd8, 0xff])) {
      const size = jpegSize(buf);
      return size && size.width > 0 && size.height > 0 ? { family: 'image', mime: 'image/jpeg', ...size } : null;
    }
    if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      const size = pngSize(buf);
      return size && size.width > 0 && size.height > 0 ? { family: 'image', mime: 'image/png', ...size } : null;
    }
    if (ascii(buf, 0, 4) === 'RIFF') {
      const form = ascii(buf, 8, 12);
      if (form === 'WEBP') {
        const size = webpSize(buf);
        return size && size.width > 0 && size.height > 0 ? { family: 'image', mime: 'image/webp', ...size } : null;
      }
      if (form === 'WAVE') return { family: 'audio', mime: 'audio/wav' };
      return null;
    }
    if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { family: 'audio', mime: 'audio/webm' };
    if (ascii(buf, 0, 4) === 'OggS') return { family: 'audio', mime: 'audio/ogg' };
    if (ascii(buf, 4, 8) === 'ftyp') return { family: 'audio', mime: 'audio/mp4' };
    if (ascii(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { family: 'audio', mime: 'audio/mpeg' };
    return null;
  } catch {
    return null;
  }
}
