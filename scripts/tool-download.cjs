/**
 * Shared by the download-*.cjs scripts: fetch a tool's archive for this platform,
 * unpack it, and put the named executables in resources/<folder>/.
 *
 * Works on Windows, macOS and Linux. Executables get ".exe" on Windows only.
 */
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const isWindows = process.platform === 'win32';
const exe = (name) => (isWindows ? `${name}.exe` : name);

// On Windows use the system's bsdtar: Git's GNU tar (often first on PATH) reads "C:" as a host name.
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

/** "win32-x64", "darwin-arm64", "linux-x64"... The architecture can be forced with CADENCE_ARCH (e.g. for an Intel Mac build on Apple Silicon). */
function platformKey() {
  return `${process.platform}-${process.env.CADENCE_ARCH || process.arch}`;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}`);
    const file = fs.createWriteStream(dest);
    const request = (target) => {
      https.get(target, { headers: { 'User-Agent': 'cadence-setup' } }, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          request(new URL(response.headers.location, target).toString());
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed with HTTP ${response.statusCode}: ${target}`));
          return;
        }
        const total = parseInt(response.headers['content-length'], 10);
        let done = 0;
        response.on('data', (chunk) => {
          done += chunk.length;
          if (total && process.stdout.isTTY) {
            process.stdout.write(`\r  ${((done / total) * 100).toFixed(1)}% (${(done / 1048576).toFixed(1)} MB)`);
          }
        });
        response.pipe(file);
        file.on('finish', () => file.close(() => {
          if (process.stdout.isTTY) process.stdout.write('\n');
          resolve();
        }));
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    };
    request(url);
  });
}

/** Unpack .zip, .tar.gz or .tar.xz into `dir`. */
function extract(archive, dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (archive.endsWith('.zip')) {
    if (isWindows) {
      execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${archive}' -DestinationPath '${dir}' -Force`], { stdio: 'inherit' });
    } else {
      execFileSync('unzip', ['-oq', archive, '-d', dir], { stdio: 'inherit' });
    }
  } else {
    // Windows 10+ ships bsdtar, which reads .tar.gz and .tar.xz too.
    execFileSync(TAR, ['-xf', archive, '-C', dir], { stdio: 'inherit' });
  }
}

/** First file called `name` anywhere under `dir`. */
function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Install a tool into resources/<folder>/.
 *   sources: { "<platform>-<arch>": [url, ...] }, every URL's archive is unpacked
 *   binaries: executable names (without .exe) to take from the archives
 */
async function installTool({ title, folder, sources, binaries }) {
  const outputDir = path.join(__dirname, '..', 'resources', folder);
  const wanted = binaries.map((b) => path.join(outputDir, exe(b)));
  if (wanted.every((f) => fs.existsSync(f))) {
    console.log(`${title} is already installed in ${outputDir}`);
    return;
  }
  const key = platformKey();
  const urls = sources[key];
  if (!urls) throw new Error(`No ${title} download for ${key}. Install it yourself and put it in ${outputDir}.`);

  console.log(`=== ${title} for ${key} ===`);
  fs.mkdirSync(outputDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `cadence-${folder}-`));
  try {
    for (const [i, url] of urls.entries()) {
      const name = new URL(url).pathname.split('/').pop() || `download-${i}`;
      const archive = path.join(work, `${i}-${name.endsWith('.zip') || name.includes('.tar.') ? name : `${name}.zip`}`);
      await downloadFile(url, archive);
      extract(archive, path.join(work, `x${i}`));
    }
    for (const [i, binary] of binaries.entries()) {
      const found = findFile(work, exe(binary));
      if (!found) throw new Error(`${exe(binary)} wasn't in the ${title} download`);
      fs.copyFileSync(found, wanted[i]);
      if (!isWindows) fs.chmodSync(wanted[i], 0o755);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  const version = execFileSync(wanted[0], binaries[0] === 'ffmpeg' ? ['-version'] : binaries[0] === 'fpcalc' ? ['-version'] : ['--version'], { encoding: 'utf8' }).split('\n')[0];
  console.log(`Installed: ${version}`);
}

module.exports = { installTool, platformKey, exe };
