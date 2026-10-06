/**
 * Builds the Python backend by creating a standalone Python distribution
 * with venv packages + backend source files.
 *
 * Copies the base Python runtime, standard library, extension modules,
 * and the site-packages of a clean build venv into a self-contained directory.
 *
 * The build venv is created from backend/requirements.txt (outside OneDrive)
 * and recreated whenever requirements.txt changes, so the installer only ships
 * what Cadence uses, never leftovers from the developer's own venv.
 *
 * Uses a temp directory outside OneDrive to avoid file-locking issues.
 * Run: node scripts/build-backend.js
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const backendDir = path.join(__dirname, '..', 'backend');
const devVenvDir = path.join(backendDir, 'venv');
const buildVenvDir = path.join('C:\\temp', 'cadence-build-venv');
const venvDir = buildVenvDir;
const requirementsFile = path.join(backendDir, 'requirements.txt');
const tempBuildDir = path.join('C:\\temp', 'cadence-backend-build');
const outputDir = path.join(tempBuildDir, 'backend');

function robocopy(src, dst, extraArgs = '') {
  try {
    execSync(`robocopy "${src}" "${dst}" ${extraArgs} /E /NFL /NDL /NJH /NJS /nc /ns /np`, {
      stdio: 'pipe',
    });
  } catch (err) {
    // robocopy returns 1 for success with files copied, 0 for nothing to copy
    if (err.status > 7) {
      throw new Error(`robocopy failed with exit code ${err.status}`);
    }
  }
}

function getBasePythonHome() {
  // 1. Explicit override, 2. the dev venv's base interpreter, 3. python on PATH
  if (process.env.CADENCE_PYTHON_HOME) return process.env.CADENCE_PYTHON_HOME;
  const cfgPath = path.join(devVenvDir, 'pyvenv.cfg');
  if (fs.existsSync(cfgPath)) {
    for (const line of fs.readFileSync(cfgPath, 'utf8').split('\n')) {
      const match = line.match(/^\s*home\s*=\s*(.+)/);
      if (match) return match[1].trim();
    }
  }
  return execSync('python -c "import sys; print(sys.base_prefix)"', { encoding: 'utf8' }).trim();
}

/** Create (or refresh) the clean build venv from requirements.txt. */
function ensureBuildVenv(basePythonHome) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(requirementsFile)).digest('hex');
  const stamp = path.join(buildVenvDir, '.requirements-sha256');
  const python = path.join(buildVenvDir, 'Scripts', 'python.exe');
  if (fs.existsSync(python) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === hash) {
    console.log('Build venv is up to date with requirements.txt');
    return;
  }
  console.log('Creating a clean build venv from requirements.txt...');
  fs.rmSync(buildVenvDir, { recursive: true, force: true });
  execSync(`"${path.join(basePythonHome, 'python.exe')}" -m venv "${buildVenvDir}"`, { stdio: 'inherit' });
  execSync(`"${python}" -m pip install --disable-pip-version-check --upgrade pip`, { stdio: 'inherit' });
  execSync(`"${python}" -m pip install --disable-pip-version-check -r "${requirementsFile}"`, { stdio: 'inherit' });
  fs.writeFileSync(stamp, hash);
}

function getPythonVersion() {
  const pythonExe = path.join(venvDir, 'Scripts', 'python.exe');
  const output = execSync(
    `"${pythonExe}" -c "import sys; print(f'{sys.version_info.major}{sys.version_info.minor}')"`,
    { encoding: 'utf8' }
  );
  return output.trim(); // e.g., "312"
}

async function main() {
  console.log('=== Cadence Backend Builder (standalone Python) ===\n');

  // Get base Python info and a clean venv with only Cadence's dependencies
  const basePythonHome = getBasePythonHome();
  console.log(`Base Python home: ${basePythonHome}`);
  ensureBuildVenv(basePythonHome);

  const pyVer = getPythonVersion();
  console.log(`Python version: ${pyVer}`);

  // Locate base Python directories
  const baseLibDir = path.join(basePythonHome, 'Lib');
  const baseDLLsDir = path.join(basePythonHome, 'DLLs');

  if (!fs.existsSync(baseLibDir)) {
    console.error('ERROR: Python standard library not found at', baseLibDir);
    process.exit(1);
  }

  const dllName = `python${pyVer}.dll`;
  const pthName = `python${pyVer}._pth`;

  // Clean output
  if (fs.existsSync(outputDir)) {
    console.log('Cleaning previous build...');
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const pythonOutDir = path.join(outputDir, 'python');
  fs.mkdirSync(pythonOutDir, { recursive: true });

  // 1. Copy python.exe from BASE Python (not venv — venv exe needs pyvenv.cfg)
  console.log('\n1. Copying Python executables...');
  const basePythonExe = path.join(basePythonHome, 'python.exe');
  const basePythonwExe = path.join(basePythonHome, 'pythonw.exe');
  fs.copyFileSync(basePythonExe, path.join(pythonOutDir, 'python.exe'));
  if (fs.existsSync(basePythonwExe)) {
    fs.copyFileSync(basePythonwExe, path.join(pythonOutDir, 'pythonw.exe'));
  }

  // 2. Copy Python DLL and runtime DLLs
  console.log('2. Copying Python runtime DLLs...');
  const dllSrc = path.join(basePythonHome, dllName);
  if (fs.existsSync(dllSrc)) {
    fs.copyFileSync(dllSrc, path.join(pythonOutDir, dllName));
    console.log(`   Copied ${dllName}`);
  } else {
    console.error(`ERROR: ${dllName} not found at ${dllSrc}`);
    process.exit(1);
  }

  // Copy python3.dll (stable ABI - needed by Rust extensions like tokenizers)
  const python3Dll = path.join(basePythonHome, 'python3.dll');
  if (fs.existsSync(python3Dll)) {
    fs.copyFileSync(python3Dll, path.join(pythonOutDir, 'python3.dll'));
    console.log('   Copied python3.dll');
  }

  // Copy vcruntime DLLs
  for (const dll of ['vcruntime140.dll', 'vcruntime140_1.dll']) {
    const src = path.join(basePythonHome, dll);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(pythonOutDir, dll));
      console.log(`   Copied ${dll}`);
    }
  }

  // 3. Copy standard library (excluding large/unnecessary directories)
  console.log('3. Copying Python standard library...');
  const libOutDir = path.join(pythonOutDir, 'Lib');
  const excludeDirs = [
    'site-packages', '__pycache__', 'test', 'tests',
    'idlelib', 'tkinter', 'turtledemo', 'lib2to3',
    'ensurepip', 'distutils',
  ];
  const xdArgs = excludeDirs.map(d => `"${d}"`).join(' ');
  robocopy(baseLibDir, libOutDir, `/XD ${xdArgs}`);

  // 4. Copy extension modules (DLLs/)
  console.log('4. Copying Python extension modules (DLLs/)...');
  if (fs.existsSync(baseDLLsDir)) {
    const dllsOutDir = path.join(pythonOutDir, 'DLLs');
    robocopy(baseDLLsDir, dllsOutDir);
  } else {
    console.log('   No DLLs/ directory found (may be fine for some installs)');
  }

  // 5. Copy site-packages from venv
  console.log('5. Copying site-packages from venv (this may take a moment)...');
  const sitePackagesSrc = path.join(venvDir, 'Lib', 'site-packages');
  const sitePackagesOut = path.join(libOutDir, 'site-packages');
  robocopy(sitePackagesSrc, sitePackagesOut);

  // 6. Create ._pth file so Python finds its libraries
  console.log('6. Creating path configuration...');
  const pthContent = [
    '..',
    'Lib',
    'Lib\\site-packages',
    'DLLs',
    'import site',
  ].join('\r\n') + '\r\n';
  fs.writeFileSync(path.join(pythonOutDir, pthName), pthContent);
  console.log(`   Created ${pthName}`);

  // 7. Copy backend source files
  console.log('7. Copying backend source files...');
  const srcDirs = ['core', 'routers', 'services'];
  const srcFiles = ['main.py', 'config.py'];

  for (const file of srcFiles) {
    const src = path.join(backendDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outputDir, file));
    }
  }

  for (const dir of srcDirs) {
    const src = path.join(backendDir, dir);
    const dst = path.join(outputDir, dir);
    if (fs.existsSync(src)) {
      robocopy(src, dst);
    }
  }

  // Copy .env if exists
  const envFile = path.join(backendDir, '.env');
  if (fs.existsSync(envFile)) {
    fs.copyFileSync(envFile, path.join(outputDir, '.env'));
  }

  // 8. Verify
  console.log('\n8. Verifying build...');
  const pythonOut = path.join(pythonOutDir, 'python.exe');
  const mainPy = path.join(outputDir, 'main.py');
  const dllOut = path.join(pythonOutDir, dllName);

  if (!fs.existsSync(pythonOut)) {
    console.error('ERROR: python.exe not found in output!');
    process.exit(1);
  }
  if (!fs.existsSync(mainPy)) {
    console.error('ERROR: main.py not found in output!');
    process.exit(1);
  }
  if (!fs.existsSync(dllOut)) {
    console.error(`ERROR: ${dllName} not found in output!`);
    process.exit(1);
  }

  // Quick smoke test: verify Python can start and import key modules
  try {
    const version = execSync(
      `"${pythonOut}" -c "import sys; print(sys.version)"`,
      { encoding: 'utf8', cwd: pythonOutDir }
    );
    console.log(`   Python test: ${version.trim()}`);
  } catch (err) {
    console.error('ERROR: Python smoke test failed!');
    console.error(err.message);
    process.exit(1);
  }

  try {
    execSync(
      `"${pythonOut}" -c "import fastapi; import uvicorn; print('FastAPI + Uvicorn OK')"`,
      { encoding: 'utf8', cwd: pythonOutDir }
    );
    console.log('   FastAPI + Uvicorn: OK');
  } catch (err) {
    console.error('ERROR: FastAPI/Uvicorn import test failed:', err.message);
    process.exit(1);
  }

  try {
    execSync(
      `"${pythonOut}" -c "import yt_dlp, yt_dlp_ejs, mutagen, numpy, anthropic, send2trash; print('ok')"`,
      { encoding: 'utf8', cwd: pythonOutDir }
    );
    console.log('   yt-dlp + yt-dlp-ejs + mutagen + numpy + anthropic + send2trash: OK');
  } catch (err) {
    console.error('ERROR: library import test failed:', err.message);
    process.exit(1);
  }

  // The backend's own modules must import too (catches a missing source file).
  try {
    execSync(`"${pythonOut}" -c "import main"`, {
      encoding: 'utf8',
      cwd: outputDir,
      env: { ...process.env, CADENCE_TOKEN: 'build-check', CADENCE_DATA_DIR: path.join(tempBuildDir, 'check-data') },
    });
    console.log('   Backend modules: OK');
  } catch (err) {
    console.error('ERROR: backend failed to import:', err.message);
    process.exit(1);
  }

  // Calculate total size
  let totalSize = 0;
  function walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else {
        totalSize += fs.statSync(fullPath).size;
      }
    }
  }
  walkDir(outputDir);

  console.log(`\n=== Build successful! ===`);
  console.log(`Output: ${outputDir}`);
  console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`\nStructure:`);
  console.log(`  ${outputDir}/`);
  console.log(`    python/python.exe     (standalone Python runtime)`);
  console.log(`    python/${dllName}    (Python DLL)`);
  console.log(`    python/${pthName}   (path config)`);
  console.log(`    python/Lib/           (standard library + site-packages)`);
  console.log(`    python/DLLs/          (extension modules)`);
  console.log(`    main.py               (backend entry point)`);
  console.log(`    core/, routers/, services/`);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
