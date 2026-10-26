// Flag artwork from the flag-icons package (MIT), copied to public/flags by `npm run data`; emoji flags do not render on
// Windows. `iso2` is the roster's ISO 3166-1 alpha-2 code; every playable country has one.

// The URL of a flag under the app's base path (`/` in development, the deployment folder in production builds).
export const flagUrl = (iso2: string, base = import.meta.env?.BASE_URL ?? '/') => `${base.endsWith('/') ? base : `${base}/`}flags/${iso2.toLowerCase()}.svg`;

// Flags are fetched the first time they are shown. In a Sprint the next question appears the instant the last one is
// answered, so its flag would arrive a moment after its name, as an empty box. A round fetches all its flags up front.
// Only the codes are remembered: the image is needed just long enough to put the file in the browser's cache. Keeping
// the Image objects kept every flag's parsed SVG in memory for the whole visit (thousands of nodes for detailed flags).
const warmed = new Set<string>();
export function preloadFlags(iso2s: (string | undefined)[]) {
  if (typeof Image === 'undefined') return;
  for (const code of iso2s) {
    if (!code || warmed.has(code)) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = flagUrl(code);
    warmed.add(code);
  }
}
