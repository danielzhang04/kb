// Dump QC frames from a composition: node still.mjs Video 30 160 250 330  [C1] (Spike removed)
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [compositionId, ...frames] = process.argv.slice(2);

const bundleLocation = await bundle({
  entryPoint: path.join(here, 'src', 'index.ts'),
  webpackOverride: (config) => config,
});
const composition = await selectComposition({serveUrl: bundleLocation, id: compositionId});
for (const f of frames.map(Number)) {
  const out = path.join(here, 'out', `${compositionId.toLowerCase()}-f${f}.png`);
  await renderStill({composition, serveUrl: bundleLocation, frame: f, output: out});
  console.log(out);
}
