import { isEmbedded, portalConfig } from '../config/portalConfig.js';
import { logger } from '../util/logger.js';

const SCOPE = 'portal';

/**
 * Optional hosting-portal hooks (Unblocked City), driven entirely by
 * `portalConfig`. With nothing configured this does nothing at all.
 *
 * Everything here is best-effort: a portal script that fails to load, or a
 * parent page that is not listening, never affects the game.
 */
export const startPortal = (): void => {
  const { name, sdkUrl, allowedOrigins } = portalConfig;
  if (!sdkUrl && allowedOrigins.length === 0) return;

  if (sdkUrl) {
    try {
      const script = document.createElement('script');
      script.src = sdkUrl;
      script.async = true;
      script.addEventListener('load', () => logger.info(SCOPE, `${name || 'portal'} SDK loaded`));
      script.addEventListener('error', () => logger.warn(SCOPE, `${name || 'portal'} SDK failed to load`));
      document.head.appendChild(script);
    } catch (error) {
      logger.warn(SCOPE, `could not add the portal SDK: ${String(error)}`);
    }
  }

  // Tell an allowed parent page the game is ready. Only to origins the build
  // was configured with - never '*'.
  if (isEmbedded()) {
    for (const origin of allowedOrigins) {
      try {
        window.parent.postMessage({ type: 'game-ready', game: 'tall-escape' }, origin);
      } catch {
        /* the parent is another origin; nothing to do */
      }
    }
  }
};
