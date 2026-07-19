// Render one motion.json to MP4.
//   node render-video.mjs <motion.json> <publicDir = the video's assets dir> <out.mp4>
// Prints MACHINE-readable result lines build_motion.py parses:
//   RESULT seconds=<wall render seconds> video_seconds=<duration> out=<path>
//
// Long compositions are rendered in FRAME-RANGE CHUNKS and concatenated (ffmpeg -c copy).
// A flat single-pass render of a full-length piece exhausts the Chromium render-tab's memory
// deep into the run (surfaces as a mid-render "timeout"/EPIPE) and is unreliable at ANY
// concurrency on a memory-constrained box. Chunking keeps each Chromium pass small and bounded.
// Knobs (env): RENDER_CONCURRENCY (default 4), RENDER_TIMEOUT_MS (default 120000),
//              RENDER_CHUNK_FRAMES (default 1500; 0 disables chunking → single pass).
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [motionPath, publicDir, outPath, frameArg] = process.argv.slice(2);
if (!motionPath || !publicDir || !outPath) {
  console.error('usage: node render-video.mjs <motion.json> <publicDir> <out.mp4> [startFrame-endFrame]');
  process.exit(2);
}
// Optional "s-e" (inclusive) → render ONLY that frame window to outPath, single pass, no concat.
// Used by build_motion --chapter to emit one section clip; audio comes out correct because the VO/
// music/SFX are absolute-positioned in the composition (same mechanism the memory-chunk path relies on).
const subRange = frameArg
  ? frameArg.split('-').map((n) => Number(n))
  : null;

const spec = JSON.parse(fs.readFileSync(motionPath, 'utf-8'));
const inputProps = {spec};
const concurrency = Number(process.env.RENDER_CONCURRENCY || 4);
const timeoutInMilliseconds = Number(process.env.RENDER_TIMEOUT_MS || 120000);
const chunkFrames = Number(process.env.RENDER_CHUNK_FRAMES || 1500);

const t0 = Date.now();
const bundleLocation = await bundle({
  entryPoint: path.join(here, 'src', 'index.ts'),
  publicDir: path.resolve(publicDir),
  webpackOverride: (config) => config,
});
console.log(`bundle: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const composition = await selectComposition({serveUrl: bundleLocation, id: 'Video', inputProps});
console.log(
  `composition: ${composition.width}x${composition.height} ${composition.durationInFrames}f @ ${composition.fps}fps`,
);

const total = composition.durationInFrames;
const resolvedOut = path.resolve(outPath);

async function renderRange(frameRange, dest) {
  let lastPct = -1;
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: dest,
    inputProps,
    concurrency,
    timeoutInMilliseconds,
    ...(frameRange ? {frameRange} : {}),
    onProgress: ({progress}) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct > lastPct) {
        lastPct = pct;
        const tag = frameRange ? `[${frameRange[0]}-${frameRange[1]}] ` : '';
        process.stdout.write(`render ${tag}${pct}%\n`);
      }
    },
  });
}

const t1 = Date.now();
if (subRange) {
  // Single explicit window → one clip, no chunk/concat (short enough to render in one pass).
  const [s, e] = [Math.max(0, subRange[0]), Math.min(total - 1, subRange[1])];
  console.log(`sub-range render: frames [${s}-${e}] of ${total}`);
  fs.mkdirSync(path.dirname(resolvedOut), {recursive: true});
  await renderRange([s, e], resolvedOut);
} else if (chunkFrames > 0 && total > chunkFrames) {
  // Chunked path: render [s, e] segments to temp files, then concat -c copy.
  const nChunks = Math.ceil(total / chunkFrames);
  console.log(`chunked render: ${nChunks} chunks of <=${chunkFrames}f (total ${total}f)`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rvchunk-'));
  const parts = [];
  try {
    for (let i = 0; i < nChunks; i++) {
      const s = i * chunkFrames;
      const e = Math.min(s + chunkFrames - 1, total - 1); // frameRange end is INCLUSIVE
      const dest = path.join(tmpDir, `chunk-${String(i).padStart(3, '0')}.mp4`);
      await renderRange([s, e], dest);
      parts.push(dest);
    }
    // ffmpeg concat demuxer, stream-copy (all chunks share codec/params → lossless, fast).
    const listFile = path.join(tmpDir, 'concat.txt');
    fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
    fs.mkdirSync(path.dirname(resolvedOut), {recursive: true});
    execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', resolvedOut],
      {stdio: ['ignore', 'ignore', 'inherit']});
  } finally {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
} else {
  await renderRange(null, resolvedOut);
}
const secs = (Date.now() - t1) / 1000;
const renderedFrames = subRange
  ? Math.min(total - 1, subRange[1]) - Math.max(0, subRange[0]) + 1
  : total;
const videoSecs = renderedFrames / composition.fps;
console.log(`RESULT seconds=${secs.toFixed(1)} video_seconds=${videoSecs.toFixed(2)} out=${resolvedOut}`);
