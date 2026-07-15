// QC frames from a motion.json: node still-video.mjs <motion.json> <publicDir> <frame> [frame...]
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [motionPath, publicDir, ...frames] = process.argv.slice(2);
const inputProps = {spec: JSON.parse(fs.readFileSync(motionPath, 'utf-8'))};

const bundleLocation = await bundle({
  entryPoint: path.join(here, 'src', 'index.ts'),
  publicDir: path.resolve(publicDir),
  webpackOverride: (config) => config,
});
const composition = await selectComposition({serveUrl: bundleLocation, id: 'Video', inputProps});
for (const f of frames.map(Number)) {
  const out = path.join(here, 'out', `video-f${f}.png`);
  await renderStill({composition, serveUrl: bundleLocation, frame: f, output: out, inputProps});
  console.log(out);
}
