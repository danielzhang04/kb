// SSR render: bundle once -> selectComposition -> renderMedia. Prints wall-clock timings.
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const compositionId = process.argv[2] || 'Video'; // [C1] Spike removed; default to Video

const t0 = Date.now();
const bundleLocation = await bundle({
  entryPoint: path.join(here, 'src', 'index.ts'),
  webpackOverride: (config) => config,
});
const tBundle = Date.now();
console.log(`bundle: ${((tBundle - t0) / 1000).toFixed(1)}s`);

const composition = await selectComposition({serveUrl: bundleLocation, id: compositionId});
console.log(
  `composition ${composition.id}: ${composition.width}x${composition.height} ` +
  `${composition.durationInFrames}f @ ${composition.fps}fps ` +
  `(${(composition.durationInFrames / composition.fps).toFixed(1)}s)`,
);

const outputLocation = path.join(here, 'out', `${compositionId.toLowerCase()}.mp4`);
let lastPct = -1;
await renderMedia({
  composition,
  serveUrl: bundleLocation,
  codec: 'h264',
  outputLocation,
  onProgress: ({progress}) => {
    const pct = Math.floor(progress * 10) * 10;
    if (pct > lastPct) {
      lastPct = pct;
      process.stdout.write(`render ${pct}% (${((Date.now() - tBundle) / 1000).toFixed(0)}s)\n`);
    }
  },
});
const tEnd = Date.now();
const secs = (tEnd - tBundle) / 1000;
const videoSecs = composition.durationInFrames / composition.fps;
console.log(
  `render: ${secs.toFixed(1)}s wall for ${videoSecs.toFixed(1)}s of video ` +
  `(${(secs / videoSecs).toFixed(1)}x realtime) -> ${outputLocation}`,
);
