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

Two types have no file here (Saab 340 and Saab 2000): `js/planebuilder.js` builds their models from
`js/data/looks.js` and `builtModels` in `js/data/models.js`. Their pictures are in `hangar/` like the others.

`icons/` holds the top view of every aircraft type as a plain shape; the 2D map uses it as the aircraft's icon
(`planeGlyph` in `js/ui.js`). `tools/hangar_shots.html` makes these too.
