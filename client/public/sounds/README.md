# Cue samples

One file per sound named in [`client/src/audio/cues.js`](../../src/audio/cues.js). Adding a
sound to an action is one line in that table and one file here; nothing else knows.

**Every file here is a synthesized placeholder**, not a recording - enough to hear that the
wiring works and to tell the cues apart, nothing more:

| file | cue | what it is |
| --- | --- | --- |
| `gulp.wav` | drinks cleared | two pitch-swept sine bloops |
| `sad-trombone.wav` | Tutkintouudistus | four descending notes with a wobble |
| `foghorn.wav` | Teekkariristeily | two low blasts |
| `jackpot.wav` | the 80op disc | fast ascending arpeggio |
| `chime.wav` | Teekkarilakki | two bell notes |

Replace them with real CC0 samples (freesound.org or Pixabay), short, mono, and the table
entry can point at any format `decodeAudioData` takes:

```js
DRINKS_CLEARED: { src: 'gulp.mp3', ... }
```

Everything in `public/` is copied into the Vite build and served by the game server through
`CLIENT_DIST`, so a new file here needs no build or compose change. A `src` with no matching
file is silence, not a crash - `npm test` fails on that mismatch so it does not go unnoticed.
