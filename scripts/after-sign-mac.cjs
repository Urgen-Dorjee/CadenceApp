/**
 * electron-builder afterSign hook (macOS only): give the whole app one valid ad-hoc signature.
 *
 * Without an Apple Developer ID the app is signed ad-hoc. On Apple Silicon every program
 * must carry a valid signature, and if any file in the app doesn't match it, macOS calls
 * the download "damaged" with no way to open it. The bundled Python, its libraries,
 * FFmpeg, Deno and fpcalc come from other builds, so sign each of them first, then the
 * app around them, and stop the build if the result doesn't verify.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Mach-O programs and libraries under `dir`, deepest first so each is signed before what contains it. */
function machOFiles(dir) {
  const found = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && isMachO(full)) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
}

function isMachO(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(4);
    if (fs.readSync(fd, head, 0, 4, 0) < 4) return false;
    const magic = head.readUInt32BE(0);
    // 64/32-bit Mach-O in either byte order, and universal ("fat") binaries.
    return [0xfeedfacf, 0xcffaedfe, 0xfeedface, 0xcefaedfe, 0xcafebabe].includes(magic);
  } finally {
    fs.closeSync(fd);
  }
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${app}`);

  // Extended attributes (e.g. Finder info) make codesign refuse the bundle.
  run('xattr', ['-cr', app]);

  // Every loose program and library, including those inside Electron's frameworks...
  const files = machOFiles(path.join(app, 'Contents'));
  for (const file of files) {
    run('codesign', ['--force', '--sign', '-', '--timestamp=none', file]);
  }
  console.log(`  • signed ${files.length} programs and libraries`);

  // ...then the bundles around them, innermost first, and the app last.
  const bundles = [];
  const findBundles = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const full = path.join(d, entry.name);
      findBundles(full);
      if (/\.(framework|app)$/.test(entry.name)) bundles.push(full);
    }
  };
  findBundles(path.join(app, 'Contents'));
  for (const bundle of bundles) {
    run('codesign', ['--force', '--sign', '-', '--timestamp=none', bundle]);
  }
  run('codesign', ['--force', '--sign', '-', '--timestamp=none', app]);
  try {
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  } catch (err) {
    throw new Error(`The signed app doesn't verify:\n${err.stderr || err.message}`);
  }
  console.log('  • signature verified');
};
