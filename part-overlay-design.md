# Part overlays on the builder bike: design + prototype

Branch: `part-overlays` (not merged). The prototype runs on the Sur-Ron Ultra Bee with one part (the Charged Cycle Works 21" front wheel).

## Rule: overlays must be accurate
Each overlay is cut from **that product's own photo**, shot side-on, with matching color and shape, scaled to the base bike. Generic or stand-in art is not allowed. If a product has no usable side-profile photo, it gets no overlay, and the builder shows only the stock photo plus the badge, as it does today. The only non-product art allowed is a **cover** layer: a plain mask that hides the stock part under the new one.

## Data model
New file `overlays.js`, loaded after `data.js` and before `app.js`. It can be generated later from `data/overlays/<bike>.json` once a build script exists. The repo's `tools/build-catalog.js` is referenced but missing.

```js
var OVERLAYS = {
  '<bikeId>': {                 // matches BIKES[].id; base image = img/bike-<bikeId>.png
    '<partPid>': [              // matches CATEGORIES[].options[].pid
      { src:'img/overlays/<file>.png', // transparent PNG, side view, cropped tight
        x:81.4, y:70.6,         // layer CENTER, % of base image width/height
        w:26.5,                 // layer width, % of base width (height follows the PNG's aspect ratio)
        z:20,                   // stacking order: higher draws on top
        role:'cover'            // optional: a mask that hides the stock part
      }
    ]
  }
};
```

Schema notes:
- **Positions are percentages**, so they scale at any size. `fitOverlayBox()` lines the overlay box up with the visible area of the base image, which uses `object-fit:contain`.
- **Fitment is per bike.** The same part needs its own entry, with its own position and scale, on every bike it fits.
- **Covers ("hides"):** a part can carry `role:'cover'` layers. Each one is a plain shape (a dark disc, or a panel cut from the base photo) at a lower z than the product layer.
- **Suggested z bands:** 10 covers, 20 wheels, 30 fork/shock, 40 plastics/seat, 50 bars/cockpit, 60 "restore" crops from the base photo. A restore crop is used when stock parts must stay in front, e.g. fork lowers in front of a new wheel.
- **JSON source:** the mirror would be `data/overlays/ultrabee.json` with `{ "bike_id", "base_image", "layers":[{ "product_id", "src", "x_pct", "y_pct", "w_pct", "z", "role", "source_photo_url" }] }`. `source_photo_url` makes the image's origin auditable.

## Rendering (prototype code, already on the branch)
- `index.html`: adds `<div class="ovlbox" id="bikeOverlays">` inside `.stage`, right after `#bikeImg`, and loads `overlays.js`.
- `app.js`, in `render()` right after `img.alt = …`: calls `renderOverlays(b.id, state.sel)`, re-runs it from `img.onload`, and adds a resize listener inside the IIFE.
- `overlays.js`, `renderOverlays()`: collects the layers for every selected option (`CATEGORIES[].options[sel]`), sorts them by z, and rebuilds the DOM only when the bike or layer set changes (it checks a `data-key`). That handles swapping parts and switching bikes.
- `styles.css`: `.ovlbox{position:absolute;pointer-events:none}`, and `.ovl{position:absolute;transform:translate(-50%,-50%)}` with inline `left/top/width` in %.

```js
var e = document.createElement('img'); e.src = l.src; e.className = 'ovl';
e.style.left = l.x+'%'; e.style.top = l.y+'%'; e.style.width = l.w+'%'; e.style.zIndex = l.z;
box.appendChild(e);
```

## Authoring overlays
1. **Source photo:** use the product's own side-on photo, from the vendor listing or the manufacturer. Reject angled or three-quarter views; stretching them to fit is not allowed.
2. **Cutout:** remove the background so it's transparent. A white key works for studio shots; for others use `rembg` (isnet-general-use), which is installed in `/workspace/rbenv`. Keep gaps such as spokes see-through. Crop tight, and remove logos and watermarks with a mask.
3. **Calibrate:** draw a 10% grid over `img/bike-<id>.png`, then read off the stock part's center and size, e.g. the wheel hub and rim diameter. Set `x/y` to the center and `w` to the part's real size relative to the stock part: a 21" rim is 21/19 the size of a 19" rim on the same photo. Check with a screenshot at desktop and mobile widths and adjust in steps of 0.2%.
4. **Covers:** if stock detail shows through, add a cover layer. If stock parts must stay in front, add a restore crop cut from the base photo.

## MVP plan
1. **Done:** Ultra Bee plus the Charged 21" front wheel (real product photo, side-on), with a dark cover disc.
2. **Next for the Ultra Bee:** these have side-on vendor photos: the Voro OEM side fairings and decal set (plastics), Sirris R46 and RFloXa RAF55RV shocks if a side shot exists, and the seat. Add a restore crop for the fork lowers.
3. **Then:** the Light Bee X and E Ride Pro SS 2.0 (most catalog fitment), covering wheels, fork, seat, plastics and bars.
4. **Store fields:** keep `source_photo_url` with every layer. Any part without a true side-profile photo stays overlay-free.

## Known limits of the prototype
- The stock tire stays. A 21" rim inside a 19" tire photo is close but not exact. A real 21" wheel and tire photo would fix that.
- The new wheel draws over the stock fork lower near the axle. A restore layer fixes this.
