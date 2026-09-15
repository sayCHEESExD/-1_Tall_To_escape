/**
 * Hosting-portal integration (Unblocked City), entirely build-time configured.
 *
 * NOTHING is hardcoded: with no variables set the game runs standalone and this
 * module does nothing. When the portal's details are known, set them in the
 * build environment and rebuild:
 *
 *   VITE_PORTAL_NAME        a label for logs, e.g. "Unblocked City"
 *   VITE_PORTAL_SDK_URL     optional script the portal asks games to load
 *   VITE_PORTAL_ORIGINS     comma-separated parent origins allowed to embed
 *                           and message the game (postMessage), e.g.
 *                           "https://portal.example,https://www.portal.example"
 *
 * The SDK, if any, is loaded AFTER the game boots and every failure is
 * swallowed: a blocked or missing portal script must never stop play.
 */
export interface PortalConfig {
  readonly name: string;
  readonly sdkUrl: string;
  readonly allowedOrigins: readonly string[];
}

const env = (key: string): string => {
  const value = import.meta.env[key] as string | undefined;
  return typeof value === 'string' ? value.trim() : '';
};

export const portalConfig: PortalConfig = {
  name: env('VITE_PORTAL_NAME'),
  sdkUrl: env('VITE_PORTAL_SDK_URL'),
  allowedOrigins: env('VITE_PORTAL_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.startsWith('https://') || origin.startsWith('http://')),
};

/** True when the game is running inside another page. */
export const isEmbedded = (): boolean => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};
