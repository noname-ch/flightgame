// Airport checklist (developer tools, F4), see js/airportcheck.js: s = checked (blue, an agent looked at it),
// ok (green, a person approved it) or bad (red, needs work). Written by tools/serve.py, tools/checks.mjs or a commit
// from the game: commit this file to give everyone the checks.
FG.data.checks = {
"ANR": {"s":"checked","by":"agent","at":"2026-10-12","note":"Terminal and the big east hangar were swapped (fixed). Only 1 stand was mapped: now 5 on the marked stands in front of the terminal, nose in. No jet bridges."},
"BRN": {"s":"checked","by":"agent","at":"2026-10-12","note":"No jet bridges (Bern has none): bridges:false in its layout file. Runways, aprons, stands as fixed by hand before."},
"BZO": {"s":"checked","by":"agent","at":"2026-10-12","note":"No jet bridges (Bolzano has none). Removed the grass parking north of the main apron (mapped as paved apron) and its 2 stands. Military-side aprons in the west kept."},
"EXT": {"s":"checked","by":"agent","at":"2026-10-12","note":"Removed the grass parking mapped as a big apron, its 3 stands on the grass and a taxiway stub ending in the grass. No jet bridges (Exeter has none)."},
"LUG": {"s":"checked","by":"agent","at":"2026-10-12","note":"Terminal was the tennis hall: now the building along the apron. Removed 2 grass paths drawn as paved taxiways. S2 pushed off the apron into the street (shorter pushback), north stand turned to push onto its taxiway."},
"SEN": {"s":"checked","by":"agent","at":"2026-10-12","note":"No jet bridges (Southend has none). Runways, aprons, terminal, tower and 12 stands match the satellite picture."},
"SIR": {"s":"checked","by":"agent","at":"2026-10-12","note":"Runways (paved + grass), aprons, terminal and 6 stands match the satellite picture; nothing to fix."},
"SOU": {"s":"checked","by":"agent","at":"2026-10-12","note":"Multi-storey car park was a hangar: now a plain building. Terminal, aprons, runway and stands match. Still open: the game draws jet bridges at 3 stands, but SOU has none (needs a 'bridges' fix op)."}
};
