// Messages shown during an active challenge. Play tests geography, so none of them may identify what was clicked: no name,
// flag, capital or region of a wrong country, and no name for land outside the game. They take no country argument at
// all, so they cannot. Explore is where countries are named.
export const FEEDBACK = {
  wrong: 'Incorrect — try again.',
  ocean: 'That was the ocean. Click a country.',
  notInGame: 'That land is not one of the countries in this game.',
  outsideArea: (areaTitle: string) => `That country is outside ${areaTitle}.`,
  notInSet: 'That country is not part of the Classic 195.',
  // Several tiny countries sit under the pointer: the map zooms in so the player can choose. Never a mistake.
  tooClose: 'Too close to call. Zoomed in so you can choose.',
} as const;
