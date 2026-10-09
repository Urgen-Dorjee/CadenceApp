/**
 * Builds the backend for macOS and Linux: a relocatable Python
 * (python-build-standalone, https://github.com/astral-sh/python-build-standalone)
 * with only backend/requirements.txt installed, plus the backend source files.
 *
 * Output: .cadence-build/backend/ (bundled by electron-builder as resources/backend):
 *   python/bin/python3   standalone Python 3.12
 *   main.py, config.py, core/, routers/, services/
 *
 * Windows uses build-backend.cjs, which copies the installed Python instead.
 * For a test run on Windows: set CADENCE_PORTABLE_BUILD=1.
 */
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const isWindows = process.platform === 'win32';
const root = path.join(__dirname, '..');
const backendDir = path.join(root, 'backend');
const outputDir = isWindows
  ? path.join(os.tmpdir(), 'cadence-portable-build', 'backend')
  : path.join(root, '.cadence-build', 'backend');
const PYTHON_MINOR = '3.12';

// On Windows use the system's bsdtar: Git's GNU tar (often first on PATH) reads "C:" as a host name.
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

const TRIPLES = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

function get(url, { json = false } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'cadence-build' };
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (token && url.startsWith('https://api.github.com/')) headers.Authorization = `Bearer ${token}`;
    https.get(url, { headers }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), { json }));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve(json ? JSON.parse(body.toString('utf8')) : body);
      });
    }).on('error', reject);
  });
}

/** URL of the newest "install_only" Python 3.12 build for this platform. */
async function pythonUrl() {
  const key = `${process.platform}-${process.env.CADENCE_ARCH || process.arch}`;
  const triple = TRIPLES[key];
  if (!triple) throw new Error(`No portable Python for ${key}`);
  const tag = process.env.CADENCE_PBS_RELEASE || 'latest';
  const api = `https://api.github.com/repos/astral-sh/python-build-standalone/releases/${tag === 'latest' ? 'latest' : `tags/${tag}`}`;
  const release = await get(api, { json: true });
  const pattern = new RegExp(`^cpython-${PYTHON_MINOR.replace('.', '\\.')}\\.\\d+\\+\\d+-${triple}-install_only\\.tar\\.gz$`);
  const asset = release.assets.find((a) => pattern.test(a.name));
  if (!asset) throw new Error(`No Python ${PYTHON_MINOR} build for ${triple} in python-build-standalone ${release.tag_name}`);
  return asset.browser_download_url;
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options })
}

function copyDir(src, dst) {
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (p) => !/(^|[\\/])(__pycache__|\.pytest_cache)([\\/]|$)/.test(p) && !p.endsWith('.pyc'),
  });
}

async function build() {
  console.log('=== Cadence backend (portable Python) ===\n');
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const url = await pythonUrl();
  console.log(`1. Python: ${url}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-python-'));
  try {
    const archive = path.join(work, 'python.tar.gz');
    fs.writeFileSync(archive, await get(url));
    run(TAR, ['-xzf', archive, '-C', work]); // unpacks to python/
    fs.renameSync(path.join(work, 'python'), path.join(outputDir, 'python'));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  const python = isWindows ? path.join(outputDir, 'python', 'python.exe') : path.join(outputDir, 'python', 'bin', 'python3');

  console.log('2. Installing backend/requirements.txt...');
  execFileSync(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '--no-warn-script-location',
    '-r', path.join(backendDir, 'requirements.txt')], { stdio: 'inherit' });

  console.log('3. Copying backend source...');
  for (const file of ['main.py', 'config.py']) fs.copyFileSync(path.join(backendDir, file), path.join(outputDir, file));
  for (const dir of ['core', 'routers', 'services']) copyDir(path.join(backendDir, dir), path.join(outputDir, dir));

  console.log('4. Verifying...');
  console.log(`   ${run(python, ['-c', 'import sys; print(sys.version.split()[0], sys.platform)']).trim()}`);
  run(python, ['-c', 'import fastapi, uvicorn, yt_dlp, yt_dlp_ejs, mutagen, numpy, anthropic, send2trash'], { cwd: outputDir });
  console.log('   Libraries: OK');
  run(python, ['-c', 'import main'], {
    cwd: outputDir,
    env: { ...process.env, CADENCE_TOKEN: 'build-check', CADENCE_DATA_DIR: path.join(os.tmpdir(), 'cadence-build-check') },
  });
  console.log('   Backend modules: OK');
  // Hash-checked .pyc files stay valid whatever the file dates, so Python never recompiles them at
  // start-up (the app can't save new ones: on macOS that would break its signature).
  console.log('5. Precompiling Python files...');
  execFileSync(python, ['-m', 'compileall', '-q', '-f', '-j', '0', '--invalidation-mode', 'unchecked-hash', outputDir], {
    stdio: 'inherit',
  });
  console.log(`\nOutput: ${outputDir}`);
}

module.exports = { build, outputDir };

if (require.main === module) {
  build().catch((err) => {
    console.error('Build failed:', err.message);
    process.exit(1);
  });
}
