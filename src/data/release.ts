// Where this release's data lives, and what happens when a page outlives its release.
//
// A production build moves public/data into a folder named after a hash of its contents (/data/<hash>/, see
// scripts/release-data.ts) and writes /release.json naming that folder. The page asks only for files in its own folder,
// so a page loaded before a deploy can never mix its code with the next release's data: either it gets the files it was
// built with (cached), or a 404 once the deploy has replaced them. On a 404 it reads /release.json (never cached): when
// that names another folder, the page is out of date, and it says so ("ATLAS has been updated") instead of failing
// quietly. Saved progress lives in localStorage and is untouched; reloading picks up the new release.
//
// In development, and in Node (tests, scripts), the data is read from /data/ as it is.
const env = (import.meta as { env?: { BASE_URL?: string; ATLAS_DATA_DIR?: string } }).env;
const BASE = env?.BASE_URL ?? '/';
export const DATA_DIR: string = env?.ATLAS_DATA_DIR ?? 'data/';
export const dataUrl = (path: string) => `${BASE}${DATA_DIR}${path}`;

export const UPDATE_EVENT = 'atlas:updated';
export type ReleaseInfo = { dataDir: string };

// True when the deployed release is another one than this page's. Any failure to tell (offline, no release.json in
// development) is false: the caller then reports an ordinary load failure.
export async function releaseChanged(fetcher: typeof fetch = fetch, ownDir = DATA_DIR): Promise<boolean> {
  try {
    const res = await fetcher(`${BASE}release.json`, { cache: 'no-store' });
    if (!res.ok) return false;
    const info = (await res.json()) as Partial<ReleaseInfo>;
    return typeof info.dataDir === 'string' && info.dataDir !== ownDir;
  } catch { return false; }
}

let announced = false;
function announceUpdate() {
  if (announced || typeof window === 'undefined') return;
  announced = true;
  window.dispatchEvent(new Event(UPDATE_EVENT));
}

// Fetches one of this release's data files as JSON. Rejects on any failure; on a 404 caused by a newer deploy it also
// tells the page (UPDATE_EVENT), once.
export async function fetchData<T>(path: string, fetcher: typeof fetch = fetch): Promise<T> {
  const res = await fetcher(dataUrl(path));
  if (!res.ok) {
    if (res.status === 404 && (await releaseChanged(fetcher))) announceUpdate();
    throw new Error(`Could not load ${path} (${res.status}).`);
  }
  return res.json() as Promise<T>;
}
