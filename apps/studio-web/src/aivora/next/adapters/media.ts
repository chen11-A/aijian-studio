/**
 * The address an <img> in the app can load for a saved path. It follows fileMediaUrl in
 * pro/ProWorkspace.tsx: aivora-media:, data:, blob: and http(s) addresses pass through, an
 * absolute local path goes through the aivora-media://local/ protocol that the desktop
 * registers, and anything else gives "".
 */
export function mediaUrl(path: string): string {
  if (!path) return "";
  if (/^(aivora-media:|data:|blob:|http)/.test(path)) return path;
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
    return `aivora-media://local/?path=${encodeURIComponent(path)}`;
  }
  return "";
}
