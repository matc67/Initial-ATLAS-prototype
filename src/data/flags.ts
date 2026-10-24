// Flag artwork from the flag-icons package (MIT), copied to public/flags by `npm run data`; emoji flags do not render on
// Windows. `iso2` is the roster's ISO 3166-1 alpha-2 code; an empty code means ATLAS deliberately shows no flag
// (Western Sahara: its usual flag is the Sahrawi Republic's, one side of the dispute).

// The URL of a flag under the app's base path (`/` in development, the deployment folder in production builds).
export const flagUrl = (iso2: string, base = import.meta.env?.BASE_URL ?? '/') => `${base.endsWith('/') ? base : `${base}/`}flags/${iso2.toLowerCase()}.svg`;

// Flags are fetched the first time they are shown. In a Sprint the next question appears the instant the last one is
// answered, so its flag would arrive a moment after its name, as an empty box. A round fetches all its flags up front.
const warmed = new Map<string, HTMLImageElement>();
export function preloadFlags(iso2s: (string | undefined)[]) {
  if (typeof Image === 'undefined') return;
  for (const code of iso2s) {
    if (!code || warmed.has(code)) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = flagUrl(code);
    warmed.set(code, img);
  }
}
