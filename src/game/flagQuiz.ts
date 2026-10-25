// Flags mode: a flag is shown and the player clicks its country. The round engine, scoring and records are the same as
// Find it; only the question differs. Two pairs of countries fly flags that look the same in ATLAS's artwork (flag-icons
// draws every flag at 4:3, so even the proportions that tell them apart are lost):
//   Indonesia and Monaco: red over white (Monaco's red is a shade lighter).
//   Chad and Romania: blue, yellow and red bands (Chad's blue is a shade darker).
// Clicking the twin of the flag shown is a fair reading of the flag, so it is a neutral note, never a mistake.
export const FLAG_TWINS: [string, string][] = [['IDN', 'MCO'], ['TCD', 'ROU']];

const TWIN = new Map(FLAG_TWINS.flatMap(([a, b]) => [[a, b], [b, a]] as [string, string][]));
export const flagTwinOf = (id: string) => TWIN.get(id);

// Whether a click on `clicked` while `target`'s flag is shown is the look-alike, not a mistake.
export const isFlagTwin = (target: string, clicked: string) => TWIN.get(target) === clicked;
