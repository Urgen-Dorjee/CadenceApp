/**
 * Downloads Chromaprint's fpcalc for this platform to resources/chromaprint/.
 * Used to fingerprint songs for "Identify by sound" (AcoustID).
 * Run: node scripts/download-chromaprint.cjs
 */
const { installTool } = require('./tool-download.cjs');

const BASE = 'https://github.com/acoustid/chromaprint/releases/download/v1.5.1';

installTool({
  title: 'fpcalc (Chromaprint)',
  folder: 'chromaprint',
  binaries: ['fpcalc'],
  sources: {
    'win32-x64': [`${BASE}/chromaprint-fpcalc-1.5.1-windows-x86_64.zip`],
    'darwin-arm64': [`${BASE}/chromaprint-fpcalc-1.5.1-macos-universal.tar.gz`],
    'darwin-x64': [`${BASE}/chromaprint-fpcalc-1.5.1-macos-universal.tar.gz`],
    'linux-x64': [`${BASE}/chromaprint-fpcalc-1.5.1-linux-x86_64.tar.gz`],
  },
}).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
