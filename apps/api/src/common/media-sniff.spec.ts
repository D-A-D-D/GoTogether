import { sniffMedia } from './media-sniff.js';

// Minimal files, built by hand, so the test shows exactly which bytes make something acceptable.

const u16be = (n: number) => Buffer.from([(n >> 8) & 255, n & 255]);
const u16le = (n: number) => Buffer.from([n & 255, (n >> 8) & 255]);
const u32be = (n: number) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u24le = (n: number) => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255]);

function jpeg(width: number, height: number, withFrame = true) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0]), u16be(16), Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]);
  const sof = Buffer.concat([Buffer.from([0xff, 0xc0]), u16be(17), Buffer.from([8]), u16be(height), u16be(width), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, ...(withFrame ? [sof] : []), Buffer.from([0xff, 0xd9, 0, 0])]);
}

/** A JPEG whose Huffman table (marker 0xC4, which sits among the frame markers) comes before the frame header. */
function jpegTablesFirst(width: number, height: number) {
  const dht = Buffer.concat([Buffer.from([0xff, 0xc4]), u16be(6), Buffer.from([0, 0, 0, 0])]);
  const sof = Buffer.concat([Buffer.from([0xff, 0xc0]), u16be(17), Buffer.from([8]), u16be(height), u16be(width), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), dht, sof, Buffer.from([0xff, 0xd9, 0, 0])]);
}

function png(width: number, height: number) {
  const ihdr = Buffer.concat([u32be(13), Buffer.from('IHDR', 'latin1'), u32be(width), u32be(height), Buffer.from([8, 2, 0, 0, 0]), u32be(0)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(8)]);
}

function riff(form: string, rest: Buffer) {
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from(form, 'latin1'), rest]);
}

function webpLossy(width: number, height: number) {
  return riff('WEBP', Buffer.concat([Buffer.from('VP8 ', 'latin1'), Buffer.alloc(4), Buffer.alloc(3), Buffer.from([0x9d, 0x01, 0x2a]), u16le(width), u16le(height), Buffer.alloc(8)]));
}

function webpLossless(width: number, height: number) {
  const bits = (width - 1) | ((height - 1) << 14);
  const packed = Buffer.alloc(4);
  packed.writeUInt32LE(bits >>> 0);
  return riff('WEBP', Buffer.concat([Buffer.from('VP8L', 'latin1'), Buffer.alloc(4), Buffer.from([0x2f]), packed, Buffer.alloc(8)]));
}

function webpExtended(width: number, height: number) {
  return riff('WEBP', Buffer.concat([Buffer.from('VP8X', 'latin1'), Buffer.alloc(4), Buffer.alloc(4), u24le(width - 1), u24le(height - 1), Buffer.alloc(8)]));
}

describe('sniffMedia - pictures', () => {
  it('recognises a JPEG and reads its size from the frame header', () => {
    expect(sniffMedia(jpeg(640, 480))).toEqual({ family: 'image', mime: 'image/jpeg', width: 640, height: 480 });
  });

  it('does not mistake a JPEG\'s tables for its frame header, wherever they sit', () => {
    expect(sniffMedia(jpegTablesFirst(800, 600))).toEqual({ family: 'image', mime: 'image/jpeg', width: 800, height: 600 });
  });

  it('recognises a PNG and reads its size', () => {
    expect(sniffMedia(png(1024, 768))).toEqual({ family: 'image', mime: 'image/png', width: 1024, height: 768 });
  });

  it('recognises all three kinds of WebP and reads their sizes', () => {
    expect(sniffMedia(webpLossy(300, 200))).toEqual({ family: 'image', mime: 'image/webp', width: 300, height: 200 });
    expect(sniffMedia(webpLossless(512, 256))).toEqual({ family: 'image', mime: 'image/webp', width: 512, height: 256 });
    expect(sniffMedia(webpExtended(4000, 3000))).toEqual({ family: 'image', mime: 'image/webp', width: 4000, height: 3000 });
  });

  it('gives a very large picture its real size, so the caller can refuse it', () => {
    expect(sniffMedia(png(60000, 60000))).toMatchObject({ width: 60000, height: 60000 });
    expect(sniffMedia(jpeg(65535, 65535))).toMatchObject({ width: 65535, height: 65535 });
  });

  it('refuses a JPEG with no frame header, a zero-sized one, and a truncated PNG', () => {
    expect(sniffMedia(jpeg(10, 10, false))).toBeNull();
    expect(sniffMedia(jpeg(0, 0))).toBeNull();
    expect(sniffMedia(png(0, 5))).toBeNull();
    expect(sniffMedia(png(10, 10).subarray(0, 18))).toBeNull();
  });

  it('is not fooled by a PNG signature without an IHDR chunk', () => {
    const bad = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(30)]);
    expect(sniffMedia(bad)).toBeNull();
  });
});

describe('sniffMedia - sound', () => {
  it('recognises the containers browsers record and play', () => {
    expect(sniffMedia(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20)]))).toEqual({ family: 'audio', mime: 'audio/webm' });
    expect(sniffMedia(Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(20)]))).toEqual({ family: 'audio', mime: 'audio/ogg' });
    expect(sniffMedia(Buffer.concat([u32be(24), Buffer.from('ftypM4A ', 'latin1'), Buffer.alloc(20)]))).toEqual({ family: 'audio', mime: 'audio/mp4' });
    expect(sniffMedia(Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.alloc(20)]))).toEqual({ family: 'audio', mime: 'audio/mpeg' });
    expect(sniffMedia(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(20)]))).toEqual({ family: 'audio', mime: 'audio/mpeg' });
    expect(sniffMedia(riff('WAVE', Buffer.alloc(20)))).toEqual({ family: 'audio', mime: 'audio/wav' });
  });
});

describe('sniffMedia - what it refuses', () => {
  it('refuses GIFs and SVGs: one is animated and large, the other can carry script', () => {
    expect(sniffMedia(Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(20)]))).toBeNull();
    expect(sniffMedia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'))).toBeNull();
  });

  it('refuses HTML and scripts, even with an image-looking beginning of the text', () => {
    expect(sniffMedia(Buffer.from('<!doctype html><html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffMedia(Buffer.from('GIF89a<script>alert(1)</script>'))).toBeNull();
    expect(sniffMedia(Buffer.from('#!/bin/sh\nrm -rf /\n'))).toBeNull();
  });

  it('refuses other RIFF files such as AVI, and an executable', () => {
    expect(sniffMedia(riff('AVI ', Buffer.alloc(30)))).toBeNull();
    expect(sniffMedia(Buffer.concat([Buffer.from('MZ', 'latin1'), Buffer.alloc(40)]))).toBeNull();
  });

  it('refuses anything too short to be a real file, and things that are not buffers', () => {
    expect(sniffMedia(Buffer.alloc(0))).toBeNull();
    expect(sniffMedia(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sniffMedia('not a buffer' as never)).toBeNull();
    expect(sniffMedia(undefined as never)).toBeNull();
    expect(sniffMedia({} as never)).toBeNull();
  });

  it('never throws on noise', () => {
    for (let i = 0; i < 200; i++) {
      const noise = Buffer.alloc(64 + i);
      for (let j = 0; j < noise.length; j++) noise[j] = (i * 31 + j * 17) & 255;
      expect(() => sniffMedia(noise)).not.toThrow();
    }
    // A JPEG whose segment lengths run past the end of the file.
    const truncated = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff]), Buffer.alloc(6)]);
    expect(() => sniffMedia(truncated)).not.toThrow();
    expect(sniffMedia(truncated)).toBeNull();
  });
});
