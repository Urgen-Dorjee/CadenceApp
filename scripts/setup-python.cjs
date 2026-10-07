/**
 * Creates backend/venv and installs the backend's dependencies (and test tools).
 * Works on Windows, macOS and Linux.
 * Run: node scripts/setup-python.cjs
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const isWindows = process.platform === 'win32';
const backendDir = path.join(__dirname, '..', 'backend');
const venvDir = path.join(backendDir, 'venv');
const venvPython = isWindows ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit' });
}

/** A Python 3.10+ on PATH: "py -3" / "python" on Windows, "python3" elsewhere. */
function findPython() {
  const candidates = isWindows ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]];
  for (const [cmd, pre] of candidates) {
    try {
      const out = execFileSync(cmd, [...pre, '-c', 'import sys; print(sys.version_info >= (3, 10))'], { encoding: 'utf8', stdio: 'pipe' });
      if (out.trim() === 'True') return [cmd, pre];
    } catch {
      /* try the next one */
    }
  }
  return null
}

function main() {
  console.log('=== Cadence Python setup ===\n');
  if (!fs.existsSync(venvPython)) {
    const python = findPython();
    if (!python) {
      console.error('Python 3.10 or newer is needed (3.12 recommended): https://www.python.org/downloads/');
      process.exit(1);
    }
    console.log('1. Creating backend/venv...');
    run(python[0], [...python[1], '-m', 'venv', venvDir]);
  } else {
    console.log('1. backend/venv already exists.');
  }
  console.log('\n2. Installing dependencies...');
  run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', 'pip']);
  run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(backendDir, 'requirements-dev.txt')]);
  console.log(`\nDone. Python: ${venvPython}`);
}

main();
