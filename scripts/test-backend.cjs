/**
 * Runs the backend tests with backend/venv's Python (any platform).
 * Run: npm run test:backend
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const backendDir = path.join(__dirname, '..', 'backend');
const venvPython = process.platform === 'win32'
  ? path.join(backendDir, 'venv', 'Scripts', 'python.exe')
  : path.join(backendDir, 'venv', 'bin', 'python');
const python = fs.existsSync(venvPython) ? venvPython : process.platform === 'win32' ? 'python' : 'python3';

const result = spawnSync(python, ['-m', 'pytest', '-q', ...process.argv.slice(2)], { cwd: backendDir, stdio: 'inherit' });
process.exit(result.status ?? 1);
