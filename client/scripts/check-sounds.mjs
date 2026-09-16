#!/usr/bin/env node
/**
 * Loads every cue sample in a real browser and checks it decodes.
 *
 * A sample the browser cannot decode is silence, and silence is exactly what a
 * working cue looks like from the outside - no error, no log line, nothing.
 * The unit test only proves the file exists; this proves it is audio. Run it
 * after swapping the placeholder for a real recording.
 *
 *   node scripts/check-sounds.mjs [url]      # url defaults to the preview server
 */

import { chromium } from 'playwright-core';
import { CUE_SOURCES } from '../src/audio/cues.js';

const TARGET = process.argv[2] ?? 'http://localhost:4173';
const MIN_PEAK = 0.1;      // anything quieter is effectively silence

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto(TARGET, { waitUntil: 'domcontentloaded' });

const results = await page.evaluate(async (sources) => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  return Promise.all(sources.map(async (src) => {
    try {
      const res = await fetch(`/sounds/${src}`);
      if (!res.ok) return { src, error: `HTTP ${res.status}` };
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      const ch = buf.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
      return {
        src, seconds: +buf.duration.toFixed(3), rate: buf.sampleRate,
        channels: buf.numberOfChannels, peak: +peak.toFixed(3),
      };
    } catch (e) {
      return { src, error: String(e.message ?? e) };
    }
  }));
}, CUE_SOURCES);

await browser.close();

let bad = 0;
for (const r of results) {
  if (r.error) { console.log(`FAIL ${r.src}: ${r.error}`); bad++; continue; }
  if (r.peak < MIN_PEAK) { console.log(`FAIL ${r.src}: decodes but is silent (peak ${r.peak})`); bad++; continue; }
  console.log(`ok   ${r.src}  ${r.seconds}s  ${r.rate}Hz  ${r.channels}ch  peak ${r.peak}`);
}
process.exit(bad ? 1 : 0);
