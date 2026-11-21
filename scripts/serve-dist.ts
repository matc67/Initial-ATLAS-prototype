// Serves the production build (dist/) the way Netlify does for ATLAS: the [[headers]] of netlify.toml (security headers,
// the Content Security Policy, caching), index.html for /, and a plain 404 for anything missing (no SPA fallback). The
// browser tests run against it, so they test the headers that will be deployed. `node scripts/serve-dist.ts [port]`.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export type HeaderRule = { for: string; values: { [name: string]: string } };

// The [[headers]] blocks of a netlify.toml: `for = "…"` and the `name = "value"` lines of their [headers.values].
export function headerRules(toml: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let rule: HeaderRule | null = null;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line === '[[headers]]') { rule = { for: '', values: {} }; rules.push(rule); continue; }
    if (line.startsWith('[')) { if (line !== '[headers.values]') rule = null; continue; }
    const m = /^([A-Za-z][\w-]*)\s*=\s*"((?:[^"\\]|\\.)*)"$/.exec(line);
    if (!rule || !m) continue;
    if (m[1] === 'for') rule.for = m[2]; else rule.values[m[1]] = m[2].replace(/\\"/g, '"');
  }
  return rules;
}
// Netlify's path patterns as ATLAS uses them: an exact path, or a prefix ending in *.
export const matches = (pattern: string, path: string) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern);
export const headersFor = (rules: HeaderRule[], path: string) => Object.assign({}, ...rules.filter(r => matches(r.for, path)).map(r => r.values));

const TYPES: { [ext: string]: string } = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.geojson': 'application/geo+json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
};

export function serve(dir = 'dist', port = 4173, toml = readFileSync('netlify.toml', 'utf8')) {
  const rules = headerRules(toml);
  return createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const file = normalize(join(dir, path === '/' ? 'index.html' : path));
    const ok = file.startsWith(normalize(dir)) && existsSync(file) && statSync(file).isFile();
    res.writeHead(ok ? 200 : 404, { 'Content-Type': ok ? TYPES[extname(file)] ?? 'application/octet-stream' : 'text/plain', ...headersFor(rules, path) });
    res.end(ok ? readFileSync(file) : 'Not found');
  }).listen(port, '127.0.0.1');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 4173);
  if (!existsSync('dist/index.html')) { console.error('No build in dist/: run `npm run build` first.'); process.exit(1); }
  serve('dist', port);
  console.log(`Serving dist/ with the netlify.toml headers on http://127.0.0.1:${port}/`);
}
