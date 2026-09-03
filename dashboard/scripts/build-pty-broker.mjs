// Deterministic build + package of the Linux PTY broker.
//
// Emits, under dashboard/dist-server/:
//   kb-shell-broker/            the tsc output plus main.js and an ESM package.json marker
//   kb-shell-broker.tar.gz      the byte-deterministic install payload consumed by
//                               deploy/install_pty_broker.py at /opt/kb-shell-broker/releases/<digest>/
//
// Determinism matters twice: scripts/build_platform_release.py hashes the archive into
// MANIFEST.sha256, and the installer trusts that digest as the archive's identity. Every tar field
// that could carry build-host state (mtime, uid/gid, uname/gname, ordering) is pinned, and the gzip
// container is written by hand so no zlib build stamps its OS byte or mtime into the output.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(dashboardRoot, 'dist-server');
const outputRoot = path.join(distRoot, 'kb-shell-broker');
const archivePath = path.join(distRoot, 'kb-shell-broker.tar.gz');
const modulesRoot = path.join(dashboardRoot, 'node_modules');
// Every bare specifier the broker resolves at RUNTIME must ship inside the archive. The install root
// (/opt/kb-shell-broker/releases/<digest>/) has no node_modules above it, so a missing dependency is
// not a build failure - it is a silent runtime failure on every inbound connection (koffi is loaded
// per-connection by readUnixPeerIdentity). `assertEveryRuntimeSpecifierIsPackaged` proves this list
// is complete against the emitted JavaScript rather than trusting it.
const RUNTIME_PACKAGES = ['node-pty', 'koffi'];
// koffi loads its native from a sibling scoped package (@koromix/koffi-<platform>-<arch>) that npm
// installs per host, so whichever ones are present ship with it.
const NATIVE_SIDECAR_SCOPE = '@koromix';
// Mirrors scripts/build_platform_release.py NATIVE_BUILD_KEEP_SUFFIXES: node-gyp build trees carry
// absolute build paths in their intermediates, so only the loadable binaries may ship.
const NATIVE_KEEP_SUFFIXES = new Set(['.node', '.dll', '.so', '.dylib', '.exe']);
// ELF e_machine values the VM can actually load. e_ident[4] (class) must be 2 (64-bit) and
// e_ident[5] (data) must be 1 (little-endian); a 32-bit or big-endian .node loads nowhere we deploy.
const ELF_MACHINES = new Map([[0x3e, 'x86-64'], [0xb7, 'aarch64']]);
const BARE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const ENTRY_SOURCE = "import { runLinuxBrokerProcess } from './server/pty/linuxBrokerMain.js';\n"
  + 'void runLinuxBrokerProcess();\n';
const PACKAGE_MARKER = '{"name":"kb-shell-broker","private":true,"type":"module"}\n';
// tsc emits JavaScript and nothing else, so the pipe-stdin exec shim - a .py file the broker resolves
// beside its own module at runtime - has to be copied in by hand. It is not optional: without it every
// headless (claude/codex) launch refuses at create, so it is copied here and asserted below alongside
// the compiler's own required output.
const EXTRA_PAYLOAD_FILES = ['server/pty/pipeStdinExec.py'];

function fail(message) {
  process.stderr.write(`build:pty-broker: ${message}\n`);
  process.exit(1);
}

function walk(root) {
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) found.push(full);
    }
  }
  return found;
}

function nodeGypBuildRoots(root) {
  return new Set(walk(root)
    .filter((item) => path.basename(item) === 'config.gypi' && path.basename(path.dirname(item)) === 'build')
    .map((item) => path.dirname(item)));
}

function runtimePackageRoots() {
  const roots = [];
  for (const name of RUNTIME_PACKAGES) {
    const root = path.join(modulesRoot, name);
    if (!existsSync(root)) fail(`node_modules/${name} is absent; run \`npm ci\` first`);
    roots.push({ specifier: name, root });
  }
  const scope = path.join(modulesRoot, NATIVE_SIDECAR_SCOPE);
  if (existsSync(scope)) {
    for (const entry of readdirSync(scope, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      roots.push({ specifier: `${NATIVE_SIDECAR_SCOPE}/${entry.name}`, root: path.join(scope, entry.name) });
    }
  }
  return roots;
}

function assertEveryRuntimeSpecifierIsPackaged(emitted, packaged) {
  for (const file of emitted) {
    if (path.extname(file) !== '.js') continue;
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(BARE_SPECIFIER)) {
      if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue;
      const parts = specifier.split('/');
      const pkg = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      if (!packaged.has(pkg)) {
        fail(`${path.basename(file)} imports '${specifier}' but node_modules/${pkg} is not packaged`);
      }
    }
  }
}

function assertLoadableLinuxNative(item) {
  const header = readFileSync(item).subarray(0, 20);
  if (header.length < 20 || !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    fail(`native module is not ELF: ${item}`);
  }
  if (header[4] !== 2) fail(`native module is not ELF class 64: ${item}`);
  if (header[5] !== 1) fail(`native module is not little-endian ELF: ${item}`);
  const machine = header.readUInt16LE(18);
  if (!ELF_MACHINES.has(machine)) {
    fail(`native module targets unsupported machine 0x${machine.toString(16)}: ${item}`);
  }
}

function isNodeGypIntermediate(item, buildRoots) {
  const inBuildTree = [...buildRoots].some((buildRoot) => item.startsWith(buildRoot + path.sep));
  if (!inBuildTree) return false;
  return !NATIVE_KEEP_SUFFIXES.has(path.extname(item).toLowerCase());
}

function tarBlocks(name, data, executable) {
  if (Buffer.byteLength(name, 'utf8') > 255) fail(`archive member name is too long: ${name}`);
  let prefix = '';
  let member = name;
  if (Buffer.byteLength(member, 'utf8') > 100) {
    const cut = member.lastIndexOf('/', 100);
    if (cut <= 0) fail(`archive member name cannot be split for ustar: ${name}`);
    prefix = member.slice(0, cut);
    member = member.slice(cut + 1);
    if (Buffer.byteLength(member, 'utf8') > 100 || Buffer.byteLength(prefix, 'utf8') > 155) {
      fail(`archive member name cannot be split for ustar: ${name}`);
    }
  }
  const header = Buffer.alloc(512);
  const octal = (value, width) => value.toString(8).padStart(width - 1, '0') + '\0';
  header.write(member, 0, 100, 'utf8');
  header.write(octal(executable ? 0o555 : 0o444, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(data.length, 12), 124, 12, 'ascii');
  header.write(octal(0, 12), 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write(prefix, 345, 155, 'utf8');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return [header, data, padding];
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data) {
  let value = 0xff_ff_ff_ff;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xff_ff_ff_ff) >>> 0;
}

function gzip(data) {
  // Fixed header: magic, deflate, no flags, mtime 0, max compression, OS 255 ("unknown"). Node's
  // zlib.gzipSync stamps a platform-dependent OS byte, which would make the digest host-dependent.
  const header = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x02, 0xff]);
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(crc32(data), 0);
  trailer.writeUInt32LE(data.length >>> 0, 4);
  return Buffer.concat([header, deflateRawSync(data, { level: 9 }), trailer]);
}

rmSync(outputRoot, { recursive: true, force: true });
rmSync(archivePath, { force: true });
mkdirSync(outputRoot, { recursive: true });

const compiler = path.join(dashboardRoot, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(compiler)) fail('typescript is not installed; run `npm ci` first');
const compiled = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.pty-broker.json'],
  { cwd: dashboardRoot, stdio: 'inherit' });
if (compiled.status !== 0) fail('tsc -p tsconfig.pty-broker.json failed');

writeFileSync(path.join(outputRoot, 'main.js'), ENTRY_SOURCE, 'utf8');
writeFileSync(path.join(outputRoot, 'package.json'), PACKAGE_MARKER, 'utf8');
for (const relative of EXTRA_PAYLOAD_FILES) {
  const source = path.join(dashboardRoot, relative);
  if (!existsSync(source)) fail(`payload file ${relative} is missing from the source tree`);
  mkdirSync(path.join(outputRoot, path.dirname(relative)), { recursive: true });
  copyFileSync(source, path.join(outputRoot, relative));
}
for (const required of ['server/pty/linuxBrokerMain.js', 'server/pty/linuxBrokerServer.js',
  'server/pty/brokerProtocol.js', 'server/pty/fdPinnedPaths.js',
  'server/pty/unixServiceIdentity.js', 'shared/ptyProtocol.js',
  // The server-owned workflow tool-allowlist table the broker re-resolves `toolPolicyId` against.
  // Absent from the payload, every claude/codex launch dies at import time, so it is listed here and
  // the build FAILS rather than shipping a broker that throws on the first agent session.
  'server/control/workflowProfiles.js',
  // The exec shim: absent, every headless launch refuses at create with a pinning error.
  'server/pty/pipeStdinExec.py']) {
  if (!existsSync(path.join(outputRoot, required))) fail(`broker compiler did not emit ${required}`);
}

const packages = runtimePackageRoots();
const emitted = walk(outputRoot);
assertEveryRuntimeSpecifierIsPackaged(emitted, new Set(packages.map((entry) => entry.specifier)));

const members = new Map();
for (const item of emitted) {
  const relative = path.relative(outputRoot, item).split(path.sep).join('/');
  members.set(relative, { source: item, executable: false });
}
// npm tarballs ship prebuilt natives for every platform (node-pty: prebuilds/{win32,darwin,linux}-*).
// The VM only ever resolves linux-* prebuilds, so foreign-platform trees are excluded from the
// archive outright — packaging them would either bloat the payload or, worse, trip the Linux ELF
// wall below on bytes the broker can never load.
function isForeignPrebuild(packageRelative) {
  const parts = packageRelative.split('/');
  const index = parts.indexOf('prebuilds');
  return index !== -1 && index + 1 < parts.length && !parts[index + 1].startsWith('linux-');
}

const natives = [];
for (const { specifier, root } of packages) {
  const buildRoots = nodeGypBuildRoots(root);
  for (const item of walk(root)) {
    if (isNodeGypIntermediate(item, buildRoots)) continue;
    const packageRelative = path.relative(root, item).split(path.sep).join('/');
    if (isForeignPrebuild(packageRelative)) continue;
    const extension = path.extname(item).toLowerCase();
    if (extension === '.node') natives.push(item);
    const relative = `node_modules/${specifier}/${packageRelative}`;
    members.set(relative, { source: item, executable: NATIVE_KEEP_SUFFIXES.has(extension) });
  }
}
if (!natives.some((item) => path.basename(item) === 'pty.node')) {
  fail('node-pty has no compiled pty.node module; run `npm ci` so node-gyp builds it');
}
if (!natives.some((item) => path.basename(item) === 'koffi.node')) {
  fail('koffi has no native module; run `npm ci` so its @koromix sidecar installs');
}
// On a Linux build host the archive IS what the VM loads, so every native must be a 64-bit ELF for
// an architecture we deploy. Elsewhere the archive is a developer artefact: the release packer
// (scripts/build_platform_release.py) refuses to ship a broker archive built off Linux at all.
if (process.platform === 'linux') natives.forEach(assertLoadableLinuxNative);

const blocks = [];
for (const relative of [...members.keys()].sort()) {
  const member = members.get(relative);
  blocks.push(...tarBlocks(relative, readFileSync(member.source), member.executable));
}
blocks.push(Buffer.alloc(1024));
const archive = gzip(Buffer.concat(blocks));
writeFileSync(archivePath, archive);
const digest = createHash('sha256').update(archive).digest('hex');
process.stdout.write(`kb-shell-broker.tar.gz members=${members.size} bytes=${statSync(archivePath).size}`
  + ` sha256=${digest}\n`);
