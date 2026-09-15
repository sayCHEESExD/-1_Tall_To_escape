import { DEFAULT_AVATAR_URL } from '@highjump/shared';

/**
 * Bloxity avatar thumbnails, loaded once per URL and shared by every name tag
 * and scoreboard row that shows the same player.
 *
 * Loaded with CORS (static.bloxity.io answers `Access-Control-Allow-Origin: *`),
 * because they are drawn into canvases that become WebGL textures - a tainted
 * canvas could not be uploaded. A thumbnail that fails falls back to Bloxity's
 * default character thumbnail, and only if THAT fails too is a plain silhouette
 * drawn.
 */
const loading = new Map<string, Promise<HTMLImageElement | null>>();
const loaded = new Map<string, HTMLImageElement | null>();

const keyOf = (url: string): string => url || DEFAULT_AVATAR_URL;

/** Load a thumbnail ('' = the default). Resolves null only if nothing could be loaded. */
export const loadAvatar = (url: string): Promise<HTMLImageElement | null> => {
  const key = keyOf(url);
  const pending = loading.get(key);
  if (pending) return pending;
  const request = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      loaded.set(key, image);
      resolve(image);
    };
    image.onerror = () => {
      if (key === DEFAULT_AVATAR_URL) {
        loaded.set(key, null);
        resolve(null);
        return;
      }
      void loadAvatar('').then((fallback) => {
        loaded.set(key, fallback);
        resolve(fallback);
      });
    };
    image.src = key;
  });
  loading.set(key, request);
  return request;
};

/** The thumbnail if it has finished loading: an image, null (none available), or undefined (not yet). */
export const avatarNow = (url: string): HTMLImageElement | null | undefined => loaded.get(keyOf(url));

/** Draw a round avatar with a coloured ring; a silhouette while it loads or when none exists. */
export const drawAvatar = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null | undefined,
  cx: number,
  cy: number,
  radius: number,
  ring: string,
): void => {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#2b3a55';
  ctx.fill();
  ctx.clip();
  if (image) {
    ctx.drawImage(image, cx - radius, cy - radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = '#8fa3bb';
    ctx.beginPath();
    ctx.arc(cx, cy - radius * 0.22, radius * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy + radius * 0.95, radius * 0.72, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2, radius * 0.12);
  ctx.strokeStyle = ring;
  ctx.stroke();
};
