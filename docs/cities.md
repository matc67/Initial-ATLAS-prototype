# City data (City Rush)

City Rush asks players how much of a country's city population they can name from memory. This page covers where the city list comes from, what counts as a city, how guesses are matched, how the score is calculated, and the dataset's limits.

## Source and licence

| | |
|---|---|
| Dataset | [GeoNames](https://www.geonames.org/) `cities1000` (every populated place with 1,000+ people, plus capitals), `alternateNamesV2` (names in other languages) and `admin1CodesASCII` (region names). |
| Licence | **CC BY 4.0**. Attribution is required. |
| Attribution shown | In the footer while City Rush is open, on the setup and results panels, and in `public/data/cities/index.json` (`source.attribution`): "Contains data from GeoNames (geonames.org), licensed under CC BY 4.0." |
| Build | `npm run cities` (`scripts/build-cities.ts`). It downloads into `data-raw/geonames/`, which is gitignored: about 1 GB unzipped, mostly the alternate names. It writes `public/data/cities/`. |
| Shipped | `index.json` (about 20 KB), plus one file per playable country, loaded only when that country is chosen: 6.6 MB in all, never loaded together. The largest are the United States (727 KB, ≈320 KB gzipped), Mexico and France (≈180 KB gzipped). Nothing loads at startup. |

GeoNames updates daily, so the download is not pinned. Each country file carries a `version`, a fingerprint of every city that can be scored, with its population and the city it is part of. Records and saved progress key on it, so a rebuild that changes what can be scored starts that country's records fresh. Old records are kept, not deleted.

## What counts as a city

- Feature class P (populated place) in `cities1000`. Excluded: city sections (`PPLX`, such as boroughs and neighbourhoods), historical places (`PPLH`, `PPLCH`), abandoned places (`PPLQ`) and destroyed places (`PPLW`).
- Population 1,000 or more, or a national or first-level capital (`PPLC`, `PPLA`, `PPLG`) of any size (Parham, Antigua and Barbuda, 969).
- **Why 1,000.** It was 5,000 until this release. At 1,000 the list grows from 64,000 to 138,000 places and from 186 to 194 playable countries, with every city of the 5,000 list kept (a build check compared them). The added places are real towns (Pilot Butte, Saskatchewan; Coober Pedy, South Australia; Toronto, Ohio), not neighbourhoods: city sections (`PPLX`) are still excluded. The cost is size (6.6 MB of country files instead of 3.2 MB, still one country at a time) and some more suburbs inside metropolitan figures (see *Parts of a city*). Measured: building the United States' name index takes about 45 ms when the country is chosen, and a guess about 0.3 ms. The threshold is one setting (`CITY_MIN`) in the build script.
- GeoNames has no legal "city" status. This threshold is how the game separates cities from villages. The game always says "places of 1,000+ people in GeoNames". It never claims a country's complete list of cities.

### Which country a place counts for

GeoNames' own country code decides, checked against the ATLAS map:
- The place must lie on that country's drawn shape, or within 25 km of it. The shapes are simplified, so border and coastal towns can fall just outside.
- Places are never moved to a neighbour because a simplified border puts them there. El Paso stays in the United States.
- The one deliberate reassignment: Moroccan-coded places inside Western Sahara as ATLAS draws it (Smara and 2 others). `build-places.ts` makes the same reassignment.

**Left out, and listed by the build:**
- Places outside the 200 countries: Hong Kong, Macau, the Cayman Islands, French overseas regions and other territories.
- **Crimea (43 places).** GeoNames codes them as Ukraine, while Natural Earth draws Crimea on Russia's side. The game counts them for neither country rather than take a side. To change this, add a rule to `REASSIGN` or relax the border check in `scripts/build-cities.ts`.
- 10 Marshall Islands atolls more than 25 km from the simplified shape.

### Duplicate records

GeoNames sometimes lists one place twice. Two records with the same name, in the same region, less than 10 km apart are treated as one place: the larger record is kept and the build lists the rest (65 at the last build, such as Hyesan, La Ceiba and Nanto). Same-name places in different regions are kept, even when they touch: Kansas City, Missouri and Kansas City, Kansas are two cities.

## Scoring

**Each city found adds its GeoNames population.** The score is the people found; the number of cities is a secondary statistic.

**City Population Coverage = people found ÷ the people that can be found × 100**, where both figures come from the same processed list:
- The denominator (`CityBook.total`, written to the index as `population` and checked by a test against what the game computes) is the population of every city a guess can claim (see *Same-name cities*), except the parts of a city (see below) and cities without a population figure.
- It is never divided by the national population. GeoNames city figures overlap with each other and with rural areas, differ in date and in the boundary they describe, and do not sum to a country's population. The game labels the figure "City Population Coverage" and says so on the setup and results panels.
- Finding every findable city gives exactly 100% (a test checks this for every country).

**Cities without a population figure** (33 at the last build, mostly small capitals such as those of the Bahamas and Barbados) can still be found: they go on the map and add to the city count, but add no people and are left out of the denominator. No figure is ever estimated.

**Parts of a city.** GeoNames lists some districts as places of their own while the city's figure already includes them: New York City's 8.8M includes Brooklyn's 2.7M. A short, hand-reviewed list (`PARTS` in the build script) marks those districts as parts of their city. A city and its parts never add more than the city's own population, in either order:
- Brooklyn first: +2.7M. New York City later: +6.1M, the rest of the city.
- New York City first: +8.8M. Brooklyn later: +0, shown as "already counted in New York City". It still goes on the map and adds to the city count.
- If the listed parts add up to more than the city (Paris's arrondissements, Shanghai's districts), each part adds at most what the city has left.

The list covers cities whose GeoNames figure plainly spans the whole municipality or its listed districts. Each rule names the city and which places are its parts: places sharing its admin code down to a level, a list of second-level codes, or a list of names. The build prints each family (city, number of parts, people listed) for review:

| Country | Cities |
|---|---|
| United States | New York City (the five boroughs) |
| Australia | Sydney, Melbourne, Brisbane, Perth, Adelaide: GeoNames gives the whole metropolitan population, so places within a conservative distance (30–45 km) in the same state are its parts |
| Canada | Montréal (its boroughs, not the island's other municipalities), Ottawa, Toronto |
| Mexico, Chile | Mexico City, Santiago (Santiago Province) |
| Europe | London (Greater London), Paris, Madrid (the municipality), Brussels, Warsaw, Prague, Moscow, Saint Petersburg, Istanbul |
| Africa | Johannesburg, Lagos, Kinshasa |
| Asia | Delhi (the National Capital Territory, including New Delhi), Bangkok, Hanoi, Kuala Lumpur, Singapore (the whole country), Taipei, New Taipei City, Tokyo (the 23 special wards, not western Tokyo's cities), Shanghai, Beijing, Tianjin, Chongqing, Guangzhou, Shenzhen |

GeoNames gives Chongqing (22M) and Shanghai (24.9M) the population of the whole municipality, so every place listed inside them, Wanzhou included, is a part.

## Matching a guess (`src/game/cityMatch.ts`)

A guess is compared only with the chosen country's cities. A city in another country can never match.

**Folding.** Case, accents, punctuation and hyphens are ignored, as are "St."/"Saint", "Ste"/"Sainte", "Mt."/"Mount" and "Ft."/"Fort". Letters that Unicode doesn't decompose are folded too: ø, æ, ß, ł, đ, þ, ı.

**Accepted names**
- The GeoNames name and its ASCII form.
- Alternate names in English or in one of the country's own languages. Historic and colloquial names are excluded, so "Bombay" does not count. So are names that aren't in Latin script, codes (MUC, NYC) and names containing digits.
- In Japan and Korea, the administrative suffix ("Fukui-shi", "Goyang-si") is dropped from the name, and the full form is kept as an alias.
- `EXTRA_ALIASES` in the build script is a short, hand-reviewed list (currently Stoke → Stoke-on-Trent).

**Typos.** Only when nothing matches exactly (name, alias, or name plus region), a guess one edit away from a listed name is accepted as that city, with "Accepted as Niagara Falls". On folded strings:
- an inserted, missing or swapped pair of neighbouring characters, for names of 6+ letters ("Tornto", "Vancover", "Niagra Falls"; a missing space counts as one);
- one character replaced by another, for names of 8+ letters ("Vancouvar"). Short names are never corrected: Rome, Lima and York differ from other real places by a letter.
- A guess one edit from two different cities is ambiguous: nothing is awarded ("close to more than one city").
- A corrected name resolves exactly like the correct spelling: a shared name means the largest; "Portlnd, Maine" is Portland, Maine. Regions are never corrected.
- **Smaller real places.** The build keeps, per country, the real places in `cities1000` that are not on the list (under 1,000 people, or city sections) but are one typo from a listed name (1,212 worldwide, the `nearby` field). Typed exactly, they are never corrected into a listed city: "Altdorf is a smaller place, not on the list". They are checked by country, not by region, and never score.
- A test checks every listed name and alias in Canada, Germany and the United States still matches exactly, and that a guess takes well under 20 ms in the United States.

**Same-name cities.** Every guess means exactly one city, whatever has been found already, so results never depend on the order of guesses:
- A name on its own means the largest city of that name: "Portland" is Portland, Oregon.
- A name with a region means the largest city of that name in that region: "Portland, Maine", "Portland Maine", "Portland ME" and "Portland (Maine)" all work. Regions can be typed by their GeoNames name, ASCII form, English names and abbreviations ("ON", "Que.", "State of Maine"), and US postal codes.
- Repeating a guess, or naming a city already found by another spelling, is "already found". When the name is shared, the message suggests adding a region.
- A city that shares both its name and its region with a larger one cannot be named separately (1,619 worldwide, about 0.2% of the listed population). It is left out of the total, so 100% stays reachable, and stays in the data files for a later version that accepts a district.

**Collisions**
- An alias never takes another city's own name.
- An alias claimed by several cities goes to the largest only when it is at least 10× the next ("Frankfurt" → Frankfurt am Main, not Frankfurt an der Oder). Otherwise it is dropped for all of them.
- A city counts once however it was found: the score is kept by city id, so an alias can never score a city a second time.

## Cities You Missed (`src/game/cityLearning.ts`)

After every **completed** run, the results show the five largest cities the player could have named and did not: cities a guess can claim, with a population, not listed inside a larger city (Brooklyn's people are New York City's), largest first, ties by GeoNames id. Clicking one flies to it; on the map they are hollow coral rings, separate from the white dots of cities found. They are never shown during play.

- **Completed** means the timer ran out, the player pressed Finish (City Rush), or Finish (City Explorer). **Abandon** (City Rush) discards the run: no personal best, no learning. Leaving City Explorer keeps the map and changes nothing here.
- Saved per country and mode (`atlas-city-rush-learning-v1`): the five city ids, the run's people, total, city count, data version and start time. The start time means one run is recorded once, even if its end is noticed again after a refresh.
- **Learned.** In the next run of that country and mode, naming one of those five shows "Learned! +people" instead of the usual tick. It adds exactly what the city always adds: no bonus.
- A city leaves the list only by being named: the list is recomputed from each completed run, so a city forgotten again comes straight back.
- **Improvement** (results, when there is a previous completed run): previous coverage, the change in percentage points (shown as a change, not an improvement, when it went down), previously missed cities remembered, and the people they added. If the data version or total changed since, the coverage comparison is left out; stored ids the data no longer has are ignored.

## Region borders

When the chosen country has reviewed subdivision data (Australia, Brazil, Canada, France, Germany, India, Japan, Mexico, Nigeria, the United States: `public/data/admin1`, the Regions game's files), City Rush draws its internal borders as thin dark lines and names regions that are large enough on screen. Nothing is clickable and the country keeps its own colour, so city dots stay on top. Show regions is on by default and remembered (`atlas-city-rush-regions-v1`). The small index loads when City Rush opens and a country's file only when it is chosen; other countries show no borders and no toggle, and nothing is approximated.

## Known limitations

- **Overlap outside the reviewed list.** Other cities with districts listed by GeoNames are not covered, so a district and its city can both be claimed in full. Distance alone cannot tell a district from a neighbouring city (Pudong is part of Shanghai; Guarulhos, 14 km from São Paulo, is a separate city), so each case needs review. Known remaining cases include Luanda, Dhaka, Yangon, Ho Chi Minh City and the districts of some Turkish cities (Ankara, İzmir). Adding one is a line in `PARTS`.
- **Figures differ in kind.** Some GeoNames populations are for a municipality (Chongqing, Istanbul), others for a city proper or an urban area. Coverage is fair within a country, because every player plays the same list, but it is not comparable between countries. Personal bests are kept per country and duration.
- **Dominant cities.** In some countries one city holds most of the listed population (Bridgetown is 86% of Barbados's total), so one guess can reach a high coverage.
- The population threshold misses some well-known small towns and includes some suburbs.
- Display names follow GeoNames, which sometimes uses the local form ("Köln", "Montréal"). The English form is accepted when typed.
- Historic names (Bombay, Madras, Peking) are not accepted.
