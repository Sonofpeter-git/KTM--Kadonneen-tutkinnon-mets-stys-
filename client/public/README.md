# Served assets

**`board.jpg` is generated — do not edit it by hand.**

It is drawn by `client/scripts/render-basemap.mjs` from real coastline geometry
(`tools/art/geodata.json`), refilled with the physical board's own colours:

```bash
cd client && npm run art
```

The coast, the lakes and the national borders are projected through the very same
`BASEMAP.bounds` in `tools/generate-board.mjs` that place the city circles, so the map
and the cities cannot drift apart — neither is measured against the other.

To change the map window, edit those bounds, re-run `node tools/generate-board.mjs`,
then `npm run art` to repaint the coast to match. `npm run verify:map` confirms the two
still agree.
