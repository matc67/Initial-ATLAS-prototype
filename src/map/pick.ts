// Which country a click means. Visible land and clickable area are separate: tiny countries get a ring marker and island
// countries an invisible halo around their islands, so they can be clicked without pixel-perfect aim, but neither ever
// takes a click that lands on another country's actual land. Pure, so it is tested in pick.test.ts.

// What is under (or near) the pointer, gathered by the map.
export type PickInput = {
  land: string | null;                       // the playable country whose land is under the pointer
  landIsSmall: boolean;                      // that country has a ring or a halo of its own
  halo: string | null;                       // the island halo under the pointer (halos never overlap; see build-countries.ts)
  markers: { id: string; px: number }[];     // ring markers in reach, with their distance from the pointer in screen pixels
  ringRadius: number;                        // the visible ring's radius at this zoom
  reach: number;                             // how far from a ring a click still counts for it
};
export type Pick = { kind: 'country'; id: string } | { kind: 'ambiguous'; ids: string[] } | { kind: 'none' };

// Two rings whose distances from the click differ by less than this are too close to call.
export const AMBIGUOUS_PX = 3;
// Over another country's land, a click counts for a ring only within this share of its radius.
export const RING_CORE = 0.5;

function nearest(markers: PickInput['markers'], within: number): Pick | null {
  const near = markers.filter(m => m.px <= within).sort((a, b) => a.px - b.px || (a.id < b.id ? -1 : 1));
  if (!near.length) return null;
  const tied = near.filter(m => m.px - near[0].px < AMBIGUOUS_PX);
  return tied.length > 1 ? { kind: 'ambiguous', ids: tied.map(m => m.id) } : { kind: 'country', id: near[0].id };
}

// In order: a ring under the pointer (the ring is drawn on top, so that is what the player sees and aims at), the land
// under the pointer, an island halo, then a ring within reach. Ties between rings are reported, never guessed.
export function resolvePick(p: PickInput): Pick {
  // Clicking a small country's actual land always means that country, even beside a neighbour's ring.
  if (p.land && p.landIsSmall) return { kind: 'country', id: p.land };
  // Over another country's land, only the centre of a ring counts for the ring (Vatican City over Italy). Nearer its edge
  // the click could mean either: Qatar is a few pixels wide at world zoom and sits under Bahrain's ring. Too close to call.
  const ring = nearest(p.markers, p.ringRadius);
  if (p.land && ring?.kind === 'country' && p.markers.find(m => m.id === ring.id)!.px > p.ringRadius * RING_CORE) {
    return { kind: 'ambiguous', ids: [ring.id, p.land] };
  }
  return ring
    ?? (p.land ? { kind: 'country', id: p.land } : null)
    ?? (p.halo ? { kind: 'country', id: p.halo } : null)
    ?? nearest(p.markers, p.reach)
    ?? { kind: 'none' };
}

// Ring sizes by zoom, matching the marker layers in GlobeView: the ring grows from 5.5 px at zoom 1 to 8 px at zoom 5;
// the click reach is a constant 14 px. Every ring fades out between zoom 4.2 and 6.5 and stops taking clicks at 6.5, by
// which point the islands are big enough to click (island countries keep their invisible halo around them).
export const ringRadiusAt = (zoom: number) => 5.5 + (Math.min(5, Math.max(1, zoom)) - 1) * (2.5 / 4);
export const MARKER_REACH_PX = 14;
// A fingertip covers far more than a mouse pointer, so on touch screens a ring takes taps from further out. The reach
// only ever applies over water or the ring's own land (see resolvePick), so it cannot take a tap on a neighbour.
export const TOUCH_REACH_PX = 22;
export const reachFor = (coarsePointer: boolean) => (coarsePointer ? TOUCH_REACH_PX : MARKER_REACH_PX);
export const markerActive = (zoom: number) => zoom < 6.5;

// ---- Subdivisions ---------------------------------------------------------------------------------------------------
// Which subdivision a click means. Subdivisions tile their country exactly, so a click on land is the unit under the
// pointer. Two assists keep tiny units fair (Prince Edward Island is a pixel or two wide with all of Canada on a phone):
// - Over water, a unit within reach counts; several in reach are reported, never guessed.
// - On land, if a unit that is tiny on screen (under TINY_UNIT_PX across) is also within reach, the click could have been
//   meant for it: it is reported as too close to call, and the map zooms in instead of counting a guess.
// Both depend only on the geometry on screen, never on the answer, so neither gives anything away.
export const TINY_UNIT_PX = 10;
// The zoom below which a unit `extentKm` across, at latitude `lat`, is under TINY_UNIT_PX on screen (web-map scale: 512 px
// around the equator at zoom 0). Below it the unit carries a ring marker, like a tiny country, so it is never a speck.
export const ringUntilZoom = (extentKm: number, lat: number) =>
  Math.log2((TINY_UNIT_PX * 40075 * Math.cos((lat * Math.PI) / 180)) / (Math.max(extentKm, 0.01) * 512));
export type SubPickInput = {
  direct: string | null;                        // the unit whose land is under the pointer
  near: { id: string; sizePx: number }[];       // units within reach, with their size on screen
  overOtherLand: boolean;                       // the pointer is on another country's land
};
export function resolveSubPick(p: SubPickInput): Pick {
  if (p.direct) {
    const tiny = p.near.filter(n => n.id !== p.direct && n.sizePx < TINY_UNIT_PX).map(n => n.id);
    return tiny.length ? { kind: 'ambiguous', ids: [p.direct, ...tiny].sort() } : { kind: 'country', id: p.direct };
  }
  if (p.overOtherLand || !p.near.length) return { kind: 'none' };
  const ids = [...new Set(p.near.map(n => n.id))].sort();
  return ids.length === 1 ? { kind: 'country', id: ids[0] } : { kind: 'ambiguous', ids };
}
