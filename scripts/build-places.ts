// Builds capitals and major cities for the Explore country panel from the same pinned Natural Earth release as the borders.
// Run with `npm run places`. Writes public/data/places.json, loaded on demand the first time a country is opened in Explore.
// This is deliberately a small extract (capitals + a few major cities per country), not a full city dataset; see docs/geography.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ROSTER } from '../src/data/roster.ts';
import type { City, PlacesFile } from '../src/data/places.ts';

const NE_COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19';
const NE_FILE = 'ne_10m_populated_places_simple.geojson';
const NE_URL = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_COMMIT}/geojson/${NE_FILE}`;
const RAW = `data-raw/${NE_COMMIT.slice(0, 7)}-${NE_FILE}`;
const MAJOR_CITIES = 6;
// ATLAS plays France and the Netherlands as their European territory (see build-countries.ts), so their overseas cities
// (Cayenne, Saint-Denis de La Réunion…) are left out here too.
const EUROPE_ONLY = ['FRA', 'NLD'];
const EUROPE_BOX = [-11, 35, 30, 72];
const inEurope = (p: Place) => p.longitude >= EUROPE_BOX[0] && p.latitude >= EUROPE_BOX[1] && p.longitude <= EUROPE_BOX[2] && p.latitude <= EUROPE_BOX[3];

// Natural Earth codes that differ from the roster's ids.
const CODE_ALIAS: Record<string, string> = { SSD: 'SDS' };

// Capitals come from Natural Earth's `adm0cap` flag. These countries are corrected or explained by hand, because the flag is
// out of date, misses a second official capital, or the capital is disputed. Names must match Natural Earth places.
type Override = { capitals: [name: string, role?: string][]; note?: string };
const OVERRIDES: Record<string, Override> = {
  ZAF: { capitals: [['Pretoria', 'executive'], ['Cape Town', 'legislative'], ['Bloemfontein', 'judicial']] },
  BOL: { capitals: [['Sucre', 'constitutional'], ['La Paz', 'seat of government']] },
  CIV: { capitals: [['Yamoussoukro', 'official'], ['Abidjan', 'economic']] },
  BEN: { capitals: [['Porto-Novo', 'official'], ['Cotonou', 'seat of government']] },
  LKA: { capitals: [['Sri Jayawardenepura Kotte', 'legislative'], ['Colombo', 'executive']] },
  MYS: { capitals: [['Kuala Lumpur', 'official'], ['Putrajaya', 'administrative']] },
  SWZ: { capitals: [['Mbabane', 'administrative'], ['Lobamba', 'legislative']] },
  // Government ministries completed the move to Dodoma in 2019; Natural Earth still flags Dar es Salaam.
  TZA: { capitals: [['Dodoma']] },
  SDS: { capitals: [['Juba']] },
  GRL: { capitals: [['Nuuk']] },
  PRI: { capitals: [['San Juan']] },
  ISR: { capitals: [['Jerusalem']], note: 'Jerusalem’s status is disputed; most countries keep their embassies in Tel Aviv.' },
  PSX: { capitals: [], note: 'Palestine designates East Jerusalem as its capital; its government is based in Ramallah.' },
  SAH: { capitals: [], note: 'No capital is listed: the territory is disputed between Morocco and the Sahrawi Republic.' },
  NRU: { capitals: [], note: 'Nauru has no official capital; government offices are in Yaren District.' },
};

type Place = { ne_id: number; name: string; nameascii: string; namealt: string | null; adm0_a3: string; adm1name: string | null; adm0cap: number; scalerank: number; pop_max: number; latitude: number; longitude: number };

if (!existsSync(RAW)) {
  console.log(`Downloading ${NE_URL}`);
  const res = await fetch(NE_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  mkdirSync('data-raw', { recursive: true });
  writeFileSync(RAW, await res.text());
}
const places = (JSON.parse(readFileSync(RAW, 'utf8')).features as { properties: Place }[]).map(f => f.properties);
const byCountry = new Map<string, Place[]>();
for (const p of places) {
  const id = CODE_ALIAS[p.adm0_a3] ?? p.adm0_a3;
  byCountry.set(id, [...(byCountry.get(id) ?? []), p]);
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const toCity = (p: Place, country: string, role?: string | true): City => ({
  id: `ne:${p.ne_id}`, name: p.name.replace(/\s+/g, ' '), country,
  // Alternate spellings: the ASCII form ("Montreal") and Natural Earth's alternate name, for future name matching.
  aliases: [...new Set([p.nameascii, ...(p.namealt ? p.namealt.split('|') : [])].filter(a => a && a !== p.name))],
  admin1: p.adm1name ?? '', lng: round(p.longitude), lat: round(p.latitude), population: p.pop_max,
  ...(role ? { capital: role } : {}),
});

const out: PlacesFile = {
  source: { name: 'Natural Earth Populated Places 1:10m', url: NE_URL, commit: NE_COMMIT, licence: 'Public domain' },
  countries: {},
};
const problems: string[] = [];
for (const r of ROSTER) {
  const ps = (byCountry.get(r.id) ?? []).filter(p => !EUROPE_ONLY.includes(r.id) || inEurope(p));
  const o = OVERRIDES[r.id];
  const capitals = o
    ? o.capitals.map(([name, role]) => {
      const p = ps.find(q => q.name === name);
      if (!p) problems.push(`${r.id}: no place named ${name}`);
      return p && toCity(p, r.id, role ?? true);
    }).filter((c): c is City => !!c)
    : ps.filter(p => p.adm0cap === 1).map(p => toCity(p, r.id, true));
  if (!o && !capitals.length) problems.push(`${r.id}: no capital flagged`);
  // Major cities by Natural Earth's cartographic rank (its own judgement of importance), then population.
  const capitalIds = new Set(capitals.map(c => c.id));
  const major = ps.filter(p => !capitalIds.has(`ne:${p.ne_id}`) && p.pop_max > 0)
    .sort((a, b) => a.scalerank - b.scalerank || b.pop_max - a.pop_max)
    .slice(0, MAJOR_CITIES).map(p => toCity(p, r.id));
  out.countries[r.id] = { cities: [...capitals, ...major], ...(o?.note ? { note: o.note } : {}) };
}
if (problems.length) throw new Error(problems.join('\n'));

writeFileSync('public/data/places.json', JSON.stringify(out));
const n = Object.values(out.countries).reduce((s, c) => s + c.cities.length, 0);
console.log(`Wrote ${n} places for ${ROSTER.length} countries.`);
