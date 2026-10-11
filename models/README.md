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

`hangar/` holds a picture of each model for the hangar marketplace (`js/hangar.js`). To make them again,
serve the project folder locally, open `tools/hangar_shots.html` and save each picture into `hangar/`.

In the game the models are not shown with their own textures but painted in the airline livery by
`js/livery.js`; the hangar pictures show that livery too.
