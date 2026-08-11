const fs = require('fs');
let src = fs.readFileSync('probeA-gen2-jssrc.js', 'utf8');
// strip the leading "// @exec: {...}" comment line, if present
src = src.replace(/^\/\/ @exec:.*\n/, '');
let capturedPrompt = null;
const tools = {
  image_gen__imagegen: async (params) => {
    capturedPrompt = params.prompt;
    return { image_url: 'stub', output_hint: 'stub' };
  }
};
function text(x) {}
function generatedImage(x) {}
async function run() {
  const fn = new Function('tools', 'text', 'generatedImage', `return (async () => { ${src} })();`);
  await fn(tools, text, generatedImage);
  const source = fs.readFileSync('probeA-prompt.txt', 'utf8');
  console.log('source len', source.length, 'captured len', capturedPrompt.length);
  console.log('EQUAL:', source === capturedPrompt);
  if (source !== capturedPrompt) {
    for (let i = 0; i < Math.max(source.length, capturedPrompt.length); i++) {
      if (source[i] !== capturedPrompt[i]) {
        console.log('first diff at', i, JSON.stringify(source.slice(i - 20, i + 20)), 'vs', JSON.stringify(capturedPrompt.slice(i - 20, i + 20)));
        break;
      }
    }
  }
}
run().catch(e => console.error('ERR', e));
