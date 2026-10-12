// Airport checklist (developer tools, F8), see js/airportcheck.js: s = checked (blue, an agent looked at it),
// ok (green, a person approved it) or bad (red, needs work). Written by tools/serve.py, tools/checks.mjs or a commit
// from the game: commit this file to give everyone the checks.
FG.data.checks = {
"ACK": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 6 taxiways straightened, 7 buildings/aprons squared; removed 2 stands that stood in other stands' way. Earlier: no jet bridges."},
"ANR": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 12 taxiways straightened, 18 buildings/aprons squared. Earlier: terminal/hangar swap, 5 real stands."},
"AVN": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 14 taxiways straightened, 15 buildings/aprons squared. Earlier: no grass apron, stands where airliners park."},
"BRN": {"s":"ok","by":"noname-ch","at":"2026-10-12","note":"Tidied: 5 taxiways straightened, 6 buildings/aprons squared; added the missing terminal apron (stands Y2, Y3A, Y4, S3 stood on unmapped concrete). Earlier: no jet bridges."},
"BZO": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 1 taxiway straightened, 12 buildings/aprons squared; removed stand S1, whose lead line ran through the terminal. Earlier: no jet bridges, no grass apron."},
"EPA": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 3 taxiways straightened, 5 buildings/aprons squared; removed a stand in another's way."},
"EXT": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 5 taxiways straightened, 3 buildings/aprons squared; added the light concrete strip of the main apron; removed a stand whose lead-in crossed S3's. Earlier: no grass apron, no jet bridges."},
"GCJ": {"s":"checked","by":"agent","at":"2026-10-12","note":"Runway 15/33 onto the real one (north end ~90 m too far north, south end to the threshold). Terminal widened to the real building and the apron taken off it; stand S1 (on the terminal roof) removed; dirt east of the south hangars no longer apron. Tidied: 11 taxiways straightened, 5 buildings/aprons squared. No jet bridges."},
"HPN": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 31 buildings/aprons squared (taxiways were straight); added the concrete strip in front of the terminal gates. Earlier: runway 11/29 east end."},
"ISP": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 4 taxiways straightened, 7 buildings/aprons squared. Earlier: matched the satellite picture."},
"JOI": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 2 taxiways straightened, 1 building squared. Earlier: runway onto the real one, no jet bridges."},
"KNA": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 1 taxiway straightened, 5 buildings/aprons squared."},
"LRH": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 2 taxiways straightened, 10 buildings/aprons squared. Earlier: no grass apron."},
"LUA": {"s":"ok","by":"lianhirter-arch","at":"2026-10-12"},
"LUG": {"s":"ok","by":"noname-ch","at":"2026-10-12","note":"Tidied: 2 taxiways straightened, 8 buildings/aprons squared. Earlier: real terminal, no grass taxiways, stand pushbacks."},
"MEK": {"s":"checked","by":"agent","at":"2026-10-12","note":"Runways, aprons and hangars match the satellite (mostly a military base). Tidied: 3 taxiways straightened, 1 bend made a 90° turn, 5 buildings/aprons squared; removed S5, which stood in S4's way. Left: the 'terminal' north of the hangars looks like corrugated sheds by a vehicle yard; the real passenger terminal could not be identified, so it was left as is."},
"MYD": {"s":"checked","by":"agent","at":"2026-10-12","note":"Both runways were grass strips ~0.5-1 km off: 17/35 moved onto the real paved runway north of the apron; 08/26 onto the paved strip running WSW from its south end (its west part is under cloud on the satellite, so its length, 1.1 km from the data, is unchecked). Deleted 2 grass taxiways to the GA parking; added 3 stands on the apron (nose to the terminal, 4 now). Tidied: 3 taxiways straightened, 3 buildings/aprons squared. No jet bridges."},
"SBA": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 12 taxiways straightened, 1 bend made a 90° turn, 8 buildings/aprons squared. Earlier: matched the satellite picture."},
"SEN": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 4 taxiways straightened, 7 buildings/aprons squared; removed a stand that crossed S10 on the north apron. Earlier: no jet bridges."},
"SIR": {"s":"bad","by":"noname-ch","at":"2026-10-12","note":"Runways (paved + grass), aprons, terminal and 6 stands match the satellite picture; nothing to fix."},
"SOU": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 4 buildings/aprons squared (its taxiways were straight already). Earlier: car park no hangar, no jet bridges."},
"WIL": {"s":"checked","by":"agent","at":"2026-10-12","note":"Runways 07/25 (east end ~40 m south) and 13/31 (both ends ~20-40 m) moved onto the real ones. Tidied: 5 taxiways straightened, 9 buildings/aprons squared; removed a stand whose lead-in crossed S9. Aprons, hangars and GA parking match the satellite; no jet bridges."},
"YTZ": {"s":"checked","by":"agent","at":"2026-10-12","note":"Tidied: 3 taxiways straightened, 6 buildings/aprons squared. Earlier: no jet bridges."}
};
