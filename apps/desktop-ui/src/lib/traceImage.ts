// Decodes a picture in the browser into the grey values the tracer needs (lib/bitmapTrace.ts). It uses
// a canvas, so it only runs in the app window (it is not unit-tested in Node; the tracing it feeds is).
import { analysisSize, grayFromRGBA } from '@/lib/bitmapTrace';
import { api } from '@/lib/tauri';

export interface LoadedPicture {
  /** Grey values, row by row: 0 black to 255 white, a transparent pixel counting as white. */
  gray: Uint8Array;
  /** The size the picture was brought to for tracing (see analysisSize). */
  width: number;
  height: number;
  /** How many times bigger than the picture itself that is (1 or more for a small picture, less than 1 for a big one). */
  scale: number;
  /** The picture at that same size (white where it was transparent), for the preview. */
  previewUrl: string;
}

const CACHE_SIZE = 3;
const cache = new Map<string, Promise<LoadedPicture>>();

async function decode(assetId: string): Promise<LoadedPicture> {
  const url = await api.imageDataUrl(assetId);
  if (!url) throw new Error('The picture data is not available. Try importing the picture again.');
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw new Error('This picture could not be read.');
  }
  const { width, height } = analysisSize(img.naturalWidth, img.naturalHeight);
  if (width < 1 || height < 1) throw new Error('This picture has no size.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This window cannot read pictures.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const gray = grayFromRGBA(ctx.getImageData(0, 0, width, height).data, width, height);

  // The picture as it was traced (at the size it was traced, on white where it is transparent), for the preview.
  const flat = document.createElement('canvas');
  flat.width = width;
  flat.height = height;
  const fctx = flat.getContext('2d');
  if (!fctx) throw new Error('This window cannot read pictures.');
  fctx.fillStyle = '#ffffff';
  fctx.fillRect(0, 0, width, height);
  fctx.drawImage(canvas, 0, 0);
  return { gray, width, height, scale: width / img.naturalWidth, previewUrl: flat.toDataURL('image/png') };
}

/** The picture with this asset id, decoded once and kept for the last few pictures traced. */
export function loadPicture(assetId: string): Promise<LoadedPicture> {
  const hit = cache.get(assetId);
  if (hit) {
    cache.delete(assetId);
    cache.set(assetId, hit);
    return hit;
  }
  const made = decode(assetId);
  cache.set(assetId, made);
  while (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  // A picture that failed is not kept, so trying again really tries again.
  made.catch(() => {
    if (cache.get(assetId) === made) cache.delete(assetId);
  });
  return made;
}

