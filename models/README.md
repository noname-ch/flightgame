# 3D aircraft models

The `.glb` files are the aircraft models from
[Flightradar24/fr24-3d-models](https://github.com/Flightradar24/fr24-3d-models), licensed under
**GPLv2** (see that repository for the authors of each model).

They were converted from glTF 1.0 to glTF 2.0 for three.js and changed on the way:

- re-oriented to x = right wing, y = nose, z = up, centred, and scaled to a length of 1
  (`js/view3d.js` scales each one to the real length from `js/data/looks.js`)
- parts with the same material merged, duplicate vertices removed
- textures limited to 1024 px and stored as JPEG

`js/data/models.js` maps each aircraft type of the game to one of these files.

`hangar/` holds a picture of each aircraft type for the hangar marketplace (`js/hangar.js`). To make them again,
serve the project folder locally, open `tools/hangar_shots.html` and save each picture into `hangar/`.

In the game the models are not shown with their own textures but painted in the airline livery by
`js/livery.js`; the hangar pictures show that livery too.

Six more models come from [FlightGear](https://www.flightgear.org/) aircraft (mirrored at
[github.com/FGMEMBERS](https://github.com/FGMEMBERS)), also **GPLv2**:

| File | Aircraft | Repository | 3D model by |
|---|---|---|---|
| `dhc6.glb` | DHC-6 Twin Otter | `dhc6` | Syd Adams, Christian Thiriot, Jonathan Schellhase |
| `do228.glb` | Dornier 228 | `DO-228` | Emmanuel Baranger |
| `dc3.glb` | Douglas DC-3 | `Douglas-Dc3` | Emmanuel Baranger, PAF Team |
| `ju52.glb` | Junkers Ju 52/3m | `ju52` | Detlef Faber |
| `concorde.glb` | Concorde | `Concorde` | see the repository |
| `b1900d.glb` | Beechcraft 1900D | `b1900d` | see the repository (it has no licence file of its own; FlightGear's aircraft collection is GPL) |

They were converted from AC3D: only the outer shell is kept, without textures, as white parts and dark
parts (windows, propellers, tyres), turned and scaled like the others. The DC-3 and the Ju 52 got simple
propellers, because theirs are separate models. The Twin Otter and the Ju 52 stand on their fixed landing gear
(`modelsOnGear` in `js/data/models.js`); the other models have none.

Two models come from 3D-print models on [Thingiverse](https://www.thingiverse.com/), both licensed under
**CC BY-SA** (Creative Commons Attribution-ShareAlike):

| File | Aircraft | Source | Model by |
|---|---|---|---|
| `saab340.glb` | Saab 340 | [SAAB-340](https://www.thingiverse.com/thing:7158020) (`SAAB_340_v2.stl`) | pershing1945 |
| `saab2000.glb` | Saab 2000 | [Saab 2000](https://www.thingiverse.com/thing:7204950) (`Saab_2000.stl`), a remix of the SAAB-340 | Qwerty1998 |

`tools/convert_model.html` converted them from STL: turned and scaled like the others and thinned out. The
engraved windows became dark parts, and both got simple propellers (four and six blades), because the print
models have none. They have no landing gear.

`a321.glb` (A321, A321neo, A321XLR) is
[Vietnam Airlines Airbus A321-200](https://sketchfab.com/3d-models/vietnam-airlines-airbus-a321-200-3c78ea05609f4cb5b4d0ab2583021a7f)
by Dave Love (Sketchfab: Tyler_Dave), licensed under **CC BY 4.0** (Creative Commons Attribution,
https://creativecommons.org/licenses/by/4.0/). Converted from Sketchfab's glTF: turned and scaled like the others, its
own landing gear taken out (the game draws its own, which folds away), parts with the same material merged, textures at
1024 px, materials made matt (some were full metal, which shows black without reflections). In the game it is painted in
the airline's livery like every model; its own texture gives the windows, doors and panel lines.

`a343.glb` (A340-300) is [Airbus A340-300](https://sketchfab.com/3d-models/airbus-a340-300-2c6bc47ca51a4f8587845f6b1f08269b)
by CarlosCG31 on Sketchfab, licensed under **CC BY 4.0**, converted the same way (its own gear taken out). Its engine
cowlings get smooth normals as it loads (`SMOOTH` in `js/models3d.js`).

`a359.glb` (A350-900, and stretched the A350-1000, -2000, -20000) is
[A350](https://sketchfab.com/3d-models/a350-cdeb75381f434353b0cbe00c9244556e) by manilov.ap, and `a380.glb` (A380-800)
is [Airbus A380](https://sketchfab.com/3d-models/airbus-a380-98d21f9c8104445f814cef47ef992889) by Brout (davidbroutian),
both on Sketchfab under **CC BY 4.0**, converted the same way (their own gear taken out; the A380's old
specular-glossiness material read into a plain one). Their windows and doors are dark grey in their textures, not black:
`DETAIL` in `js/livery.js` keeps them. The A350's fan is a picture on its cowling, so its fans don't turn. Its cockpit
glass is a few big faces in a ragged bluish patch of its texture: its black mask is drawn from the old A350 model's
outline of the glass instead (`A350_COCKPIT` in `js/livery.js`; the two noses are the same shape), the patch painted over.

`icons/` holds the top view of every aircraft type as a plain shape; the 2D map uses it as the aircraft's icon
(`planeGlyph` in `js/ui.js`). `tools/hangar_shots.html` makes these too.

In 3D the wings bend, the propellers and fans turn and the control surfaces (ailerons, flaps, elevators, rudder)
move in the shader (`js/livery.js`), so the files need no animation. Propellers are found as pieces thin along the
nose in front of the engines and the surfaces as the rear of the wing's, tailplane's and fin's chord. A model edited
in Blender keeps working as long as it stays 1 unit long and centred (export glTF Binary, +Y Up, no Draco); a
propeller only turns when it is its own piece (Edit Mode, select it, `P` → Selection).

`a320.glb` has plain wing tips, `a321.glb` wing tip fences. The sharklets of the A320neo, A321neo and A321XLR and the
A320's wing tip fences are not in the files: `js/models3d.js` (`addWingTips`) builds them onto the wing tips as the model loads,
for the types with `sharklets` or `fences` in `js/data/looks.js`. As it loads, `a320.glb` also gets smooth normals where
its faces were flat facets (`SMOOTH`: the engine cowlings), and `js/livery.js` paints its light see-through window glass
dark (`DARK_GLASS`) and its doors and exits as seams (`CABIN_DOORS`). The A320neo's bigger engines are the model's grown
(`growEngines`, looks.js `engines`, where they are: `FG.data.engineBox` in `js/data/models.js`).

## Making a model from pictures or video (`tools/plane_scan.html`)

Serve the project folder (`./play.sh`) and open `http://localhost:8000/tools/plane_scan.html`. It builds an aircraft
from a **side view** (needed), a **top or bottom view** and a **front view**: pictures (drop, paste or open) or
frames of a video (the slider; "Find side-on frame" looks through a fly-by for the frame where the aircraft is
longest). Three-view drawings work best; photos have to be taken square on, it does not untangle perspective.

1. The aircraft is cut out from the background on its own (sky, paper). Brush and wand (+/−) fix what it gets wrong.
2. Two marks line each picture up: nose and tail (side and top view), the two wing tips (front view).
3. "Build model" fits an aircraft to the outlines: the fuselage from side and top view, wing and tailplane
   from the top view, the fin from the side view, the engines where they stick out of the wing's leading edge
   (or beside the rear fuselage); propellers where the nacelles reach far forward, a high wing and a T-tail
   where the pictures show them. "Match the outlines" then moves wing, tailplane and engines until the model's
   outlines (orange) cover the pictures best. Sliders and menus change anything by hand.
4. "Save for the game" writes a `.glb` like the others here: 1 unit long, centred, x = right wing, y = nose,
   z = up, white with the windows (dark spots on the fuselage in the side view) in its texture, each part its
   own piece so that `js/livery.js` finds engines, propellers and control surfaces. "Save with photo colours"
   paints it with the pictures instead. The box below the buttons has the lines for `js/data/models.js`.

`?demo=a320` (any file name here) draws one of these models from three sides and builds it again, to try it.
