// Airport checklist (developer tools, F8), see js/airportcheck.js: s = checked (blue, an agent looked at it),
// ok (green, a person approved it) or bad (red, needs work). Written by tools/serve.py, tools/checks.mjs or a commit
// from the game: commit this file to give everyone the checks.
FG.data.checks = {
"ACK": {"s":"checked","by":"agent","at":"2026-10-12","note":"No jet bridges (Nantucket has none): bridges off. Removed a stand that pointed into the FBO buildings. Terminal, aprons and both runways match."},
"ANR": {"s":"checked","by":"agent","at":"2026-10-12","note":"Terminal and the big east hangar were swapped (fixed). Only 1 stand was mapped: now 5 on the marked stands in front of the terminal, nose in. No jet bridges."},
"AVN": {"s":"checked","by":"agent","at":"2026-10-12","note":"Removed the north block of the main apron (grass, 2 stands on it) and 2 taxiway stubs into the fields. Added 2 stands where airliners park in front of the terminal."},
"BRN": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 5 taxiways straightened, 6 buildings/aprons squared; added the missing terminal apron (stands Y2, Y3A, Y4, S3 stood on unmapped concrete). Earlier: no jet bridges."},
"BZO": {"s":"checked","by":"agent","at":"2026-10-12","note":"No jet bridges (Bolzano has none). Removed the grass parking north of the main apron (mapped as paved apron) and its 2 stands. Military-side aprons in the west kept."},
"EPA": {"s":"checked","by":"agent","at":"2026-10-12","note":"Military apron with its hangars, the old civil terminal apron in the north and the taxiways match the satellite picture; nothing to fix."},
"EXT": {"s":"checked","by":"agent","at":"2026-10-12","note":"Removed the grass parking mapped as a big apron, its 3 stands on the grass and a taxiway stub ending in the grass. No jet bridges (Exeter has none)."},
"HPN": {"s":"checked","by":"agent","at":"2026-10-12","note":"Runway 11/29: east end was ~30 m too far south (moved to the real threshold). Terminal with jet bridges, FBO ramps and stands match."},
"ISP": {"s":"checked","by":"agent","at":"2026-10-12","note":"Terminal, jet-bridge gates A/B, aprons and the 3 runways match the satellite picture; nothing to fix."},
"JOI": {"s":"checked","by":"agent","at":"2026-10-12","note":"Runway 15/33 was drawn at the wrong angle, ~300 m off at the ends: moved onto the real one. No jet bridges (Joinville has none)."},
"KNA": {"s":"checked","by":"agent","at":"2026-10-12","note":"Runway 05/23, the air-force apron with its hangars and the small south apron match the satellite picture; nothing to fix."},
"LRH": {"s":"checked","by":"agent","at":"2026-10-12","note":"Removed the light-aircraft grass parking mapped as apron (1 stand). Main apron with 4 nose-in stands, terminal and runway match."},
"LUA": {"s":"ok","by":"lianhirter-arch","at":"2026-10-12"},
"LUG": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 2 taxiways straightened, 8 buildings/aprons squared. Earlier: real terminal, no grass taxiways, stand pushbacks."},
"SBA": {"s":"checked","by":"agent","at":"2026-10-12","note":"Runways 7/25, 15L/33R and 15R/33L, terminal with its jet bridges, RON and south aprons match the satellite picture; nothing to fix."},
"SEN": {"s":"checked","by":"agent","at":"2026-10-12","note":"No jet bridges (Southend has none). Runways, aprons, terminal, tower and 12 stands match the satellite picture."},
"SIR": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 29 taxiways straightened, 1 bend made a 90° turn, 15 buildings/aprons squared. Earlier: matched the satellite picture."},
"SOU": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 4 buildings/aprons squared (its taxiways were straight already). Earlier: car park no hangar, no jet bridges."},
"YTZ": {"s":"checked","by":"agent","at":"2026-10-12","note":"No jet bridges (Billy Bishop boards on foot): bridges off. Terminal, stands, aprons and both runways match."}
};
