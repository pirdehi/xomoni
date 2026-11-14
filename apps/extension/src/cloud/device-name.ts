// The name a newly connected browser gets on xomoni.com when the person doesn't give one (ADR-0018).

/** "Chrome on macOS", from the browser's own description of itself, as a default name for this device. */
export function suggestedDeviceName(userAgent = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Brave/.test(userAgent) ? 'Brave' : 'Chrome';
  const os = /Mac OS X/.test(userAgent)
    ? 'macOS'
    : /Windows/.test(userAgent)
      ? 'Windows'
      : /CrOS/.test(userAgent)
        ? 'ChromeOS'
        : /Linux/.test(userAgent)
          ? 'Linux'
          : '';
  return os ? `${browser} on ${os}` : browser;
}
