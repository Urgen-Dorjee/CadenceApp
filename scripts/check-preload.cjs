/**
 * Fails the build if dist-electron/preload.js is not CommonJS.
 * The window is sandboxed, and a sandboxed preload written as an ES module
 * fails silently: the app then can't reach its audio engine.
 * Run: node scripts/check-preload.cjs
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'dist-electron', 'preload.js');
if (!fs.existsSync(file)) {
  console.error(`check-preload: ${file} not found. Build the app first.`);
  process.exit(1);
}
const code = fs.readFileSync(file, 'utf8');
if (/^\s*(import|export)\s/m.test(code) || !code.includes('require("electron")')) {
  console.error('check-preload: preload.js is not CommonJS. The sandboxed window would fail to load it.');
  process.exit(1);
}
console.log('check-preload: preload.js is CommonJS');
