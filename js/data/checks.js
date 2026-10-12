// Airport checklist (developer tools, F4), see js/airportcheck.js: s = checked (blue, an agent looked at it),
// ok (green, a person approved it) or bad (red, needs work). Written by tools/serve.py, tools/checks.mjs or a commit
// from the game: commit this file to give everyone the checks.
FG.data.checks = {
"BRN": {"s":"checked","by":"agent","at":"2026-10-12","note":"No jet bridges (Bern has none): bridges:false in its layout file. Runways, aprons, stands as fixed by hand before."},
"LUG": {"s":"checked","by":"agent","at":"2026-10-12","note":"Terminal was the tennis hall: now the building along the apron. Removed 2 grass paths drawn as paved taxiways. S2 pushed off the apron into the street (shorter pushback), north stand turned to push onto its taxiway."}
};
