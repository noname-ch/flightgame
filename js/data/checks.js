// Airport checklist (developer tools, F8), see js/airportcheck.js: s = checked (blue, an agent looked at it),
// ok (green, a person approved it) or bad (red, needs work). Written by tools/serve.py, tools/checks.mjs or a commit
// from the game: commit this file to give everyone the checks.
FG.data.checks = {
"ACK": {"s":"checked","by":"agent","at":"2026-10-12","note":"No jet bridges (Nantucket has none): bridges off. Removed a stand that pointed into the FBO buildings. Terminal, aprons and both runways match."},
"ANR": {"s":"checked","by":"agent","at":"2026-10-12","note":"Terminal and the big east hangar were swapped (fixed). Only 1 stand was mapped: now 5 on the marked stands in front of the terminal, nose in. No jet bridges."},
"AVN": {"s":"checked","by":"agent","at":"2026-10-12","note":"Removed the north block of the main apron (grass, 2 stands on it) and 2 taxiway stubs into the fields. Added 2 stands where airliners park in front of the terminal."},
"BRN": {"s":"ok","by":"noname-ch","at":"2026-10-12","note":"No jet bridges (Bern has none): bridges:false in its layout file. Runways, aprons, stands as fixed by hand before."},
"BZO": {"s":"checked","by":"agent","at":"2026-10-12","note":"No jet bridges (Bolzano has none). Removed the grass parking north of the main apron (mapped as paved apron) and its 2 stands. Military-side aprons in the west kept."},
"EPA": {"s":"checked","by":"agent","at":"2026-10-12","note":"Military apron with its hangars, the old civil terminal apron in the north and the taxiways match the satellite picture; nothing to fix."},
"EXT": {"s":"checked","by":"agent","at":"2026-10-12","note":"Removed the grass parking mapped as a big apron, its 3 stands on the grass and a taxiway stub ending in the grass. No jet bridges (Exeter has none)."},
"HPN": {"s":"checked","by":"agent","at":"2026-10-12","note":"Runway 11/29: east end was ~30 m too far south (moved to the real threshold). Terminal with jet bridges, FBO ramps and stands match."},
"ISP": {"s":"checked","by":"agent","at":"2026-10-12","note":"Terminal, jet-bridge gates A/B, aprons and the 3 runways match the satellite picture; nothing to fix."},
"LRH": {"s":"checked","by":"agent","at":"2026-10-12","note":"Removed the light-aircraft grass parking mapped as apron (1 stand). Main apron with 4 nose-in stands, terminal and runway match."},
"LUG": {"s":"ok","by":"noname-ch","at":"2026-10-12","note":"Terminal was the tennis hall: now the building along the apron. Removed 2 grass paths drawn as paved taxiways. S2 pushed off the apron into the street (shorter pushback), north stand turned to push onto its taxiway."},
"SBA": {"s":"checked","by":"agent","at":"2026-10-12","note":"Runways 7/25, 15L/33R and 15R/33L, terminal with its jet bridges, RON and south aprons match the satellite picture; nothing to fix."},
"SEN": {"s":"checked","by":"agent","at":"2026-10-12","note":"No jet bridges (Southend has none). Runways, aprons, terminal, tower and 12 stands match the satellite picture."},
"SIR": {"s":"checked","by":"agent","at":"2026-10-12","note":"Runways (paved + grass), aprons, terminal and 6 stands match the satellite picture; nothing to fix."},
"SOU": {"s":"checked","by":"agent","at":"2026-10-12","note":"Multi-storey car park was a hangar: now a plain building. Terminal, aprons, runway and stands match. Still open: the game draws jet bridges at 3 stands, but SOU has none (needs a 'bridges' fix op)."},
"YTZ": {"s":"checked","by":"agent","at":"2026-10-12","note":"No jet bridges (Billy Bishop boards on foot): bridges off. Terminal, stands, aprons and both runways match."}
};
