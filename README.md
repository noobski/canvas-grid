# Canvas Grid

Mobile web app for grid-method drawing: pick a reference photo from your phone, enter the real
size of the canvas you'll draw on, and view the photo full screen with a grid overlay that
matches the canvas. The screen stays on while the viewer is open.

## Features

- Photo from the phone's gallery (or camera); remembered on the device between visits
- Canvas size in cm or inches; "match photo proportions"; crop-to-canvas or fit-whole-photo
- Main grid (default 4 × 4, any rows/cols) with a chosen colour and thickness
- Optional subdivision of every cell (2×2, 3×3, 4×4) in a second colour
- Cell width × height shown on screen (and sub-cell size)
- Row/column labels (A1 … D4), diagonals, black & white, mirror H/V
- Focus mode: tap a cell to highlight it and dim the rest
- Pinch to zoom, drag to pan, double-tap to zoom in/out
- Screen wake lock (Screen Wake Lock API, with a video fallback for older browsers)
- Full screen button; add to Home Screen on iPhone for a true full-screen app
- Export the photo with the grid burned in as a full-resolution PNG

## Development

```
npm install
npm run dev        # ng serve on http://localhost:4200
npm run build      # production build into dist/
npm start          # serve dist/ with express (what Railway runs)
```

Angular 20, plain CSS, no backend — everything stays on the device.
