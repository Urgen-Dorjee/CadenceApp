/**
 * Sets up Python virtual environment and installs dependencies.
 * Run: node scripts/setup-python.js
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const backendDir = path.join(__dirname, '..', 'backend');
const venvDir = path.join(backendDir, 'venv');
const requirementsFile = path.join(backendDir, 'requirements.txt');

function run(cmd, options = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...options });
}

async function main() {
  console.log('=== Cadence Python Setup ===\n');

  // Check if Python is available
  try {
    execSync('python --version', { stdio: 'pipe' });
  } catch {
    console.error('ERROR: Python is not installed or not in PATH.');
    console.error('Please install Python 3.10+ from https://www.python.org/downloads/');
    process.exit(1);
  }

  // Create virtual environment
  if (!fs.existsSync(venvDir)) {
    console.log('\n1. Creating virtual environment...');
    run(`python -m venv "${venvDir}"`);
  } else {
    console.log('\n1. Virtual environment already exists.');
  }

  // Determine pip path
  const pipPath = path.join(venvDir, 'Scripts', 'pip.exe');

  // Upgrade pip
  console.log('\n2. Upgrading pip...');
  run(`"${pipPath}" install --upgrade pip`);

  // Install requirements
  console.log('\n3. Installing Python dependencies...');
  run(`"${pipPath}" install -r "${requirementsFile}"`);

  // Create temp directories
  const tempDir = path.join(__dirname, '..', 'resources', 'temp');
  const downloadsDir = path.join(tempDir, 'downloads');
  fs.mkdirSync(downloadsDir, { recursive: true });

  console.log('\n=== Python setup complete! ===');
  console.log(`Virtual environment: ${venvDir}`);
  console.log('Run "npm run dev" to start the application.');
}

main().catch(console.error);
