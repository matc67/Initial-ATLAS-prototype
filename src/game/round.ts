// A quick round; a full round plays every country in the area.
export const QUICK_ROUND = 10;

// The round's questions in random order (Fisher–Yates), `n` of them.
export function pickRound(ids: string[], n = ids.length, random = Math.random): string[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, n);
}
