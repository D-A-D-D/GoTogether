// Getting a picture ready to upload: shrunk, and for a profile picture cropped square. Phones take
// photos of many megabytes; sending one as it is would be slow, costly and pointless, because nobody
// views a chat picture at 4000 pixels wide. The server also checks size and type (and does not trust
// this), so this is about speed and fairness, not safety.
//
// The arithmetic is pure and tested; prepareImage() is the browser part that does the drawing.

export interface Size {
  width: number;
  height: number;
}

/** The size that fits within `max` on its longer side, keeping the proportions - and never larger than the original. */
export function fitWithin(width: number, height: number, max: number): Size {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The largest centred square in a picture: where to start cutting, and how big. */
export function centredSquare(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}

/** Pictures bigger than this are refused before the browser even tries to open them. */
export const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface PrepareOptions {
  /** The longer side, in pixels, after shrinking. */
  maxSide: number;
  /** Crop to a centred square first (profile pictures). */
  square?: boolean;
  /** JPEG quality, 0 to 1. */
  quality: number;
}

export class UnsupportedImageError extends Error {
  constructor(message = 'That picture could not be opened. Try a JPEG or PNG photo.') {
    super(message);
    this.name = 'UnsupportedImageError';
  }
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  // createImageBitmap applies the photo's rotation (EXIF) when asked, so a portrait photo is not sent sideways.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // fall through to an <img>, which some browsers can open when createImageBitmap cannot
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new UnsupportedImageError();
  }
}

/** Shrinks (and optionally squares) a chosen picture into a JPEG ready to upload. */
export async function prepareImage(file: File, options: PrepareOptions): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new UnsupportedImageError('That is not a picture.');
  if (file.size > MAX_SOURCE_BYTES) throw new UnsupportedImageError('That picture is too large to use. Choose a smaller one.');

  const decoded = await decode(file);
  try {
    const crop = options.square ? centredSquare(decoded.width, decoded.height) : { sx: 0, sy: 0, size: 0 };
    const sourceW = options.square ? crop.size : decoded.width;
    const sourceH = options.square ? crop.size : decoded.height;
    const out = fitWithin(sourceW, sourceH, options.maxSide);
    if (out.width === 0) throw new UnsupportedImageError();

    const canvas = document.createElement('canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    const context = canvas.getContext('2d');
    if (!context) throw new UnsupportedImageError();
    // A white backdrop, so a PNG with transparent parts does not turn black when saved as a JPEG.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, out.width, out.height);
    context.drawImage(decoded.source, options.square ? crop.sx : 0, options.square ? crop.sy : 0, sourceW, sourceH, 0, 0, out.width, out.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', options.quality));
    if (!blob) throw new UnsupportedImageError();
    return { blob, width: out.width, height: out.height };
  } finally {
    decoded.close();
  }
}

/** What a profile picture is shrunk to, and what a chat picture is. */
export const AVATAR_IMAGE: PrepareOptions = { maxSide: 512, square: true, quality: 0.86 };
export const CHAT_IMAGE: PrepareOptions = { maxSide: 1600, quality: 0.82 };
