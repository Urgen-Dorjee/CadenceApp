/**
 * Downloads Deno for this platform to resources/deno/.
 * yt-dlp uses it to run YouTube's player JavaScript; without it some
 * downloads fail or fall back to lower-quality formats.
 * Run: node scripts/download-deno.cjs
 */
const { installTool } = require('./tool-download.cjs');

const BASE = 'https://github.com/denoland/deno/releases/latest/download';

installTool({
  title: 'Deno',
  folder: 'deno',
  binaries: ['deno'],
  sources: {
    'win32-x64': [`${BASE}/deno-x86_64-pc-windows-msvc.zip`],
    'darwin-arm64': [`${BASE}/deno-aarch64-apple-darwin.zip`],
    'darwin-x64': [`${BASE}/deno-x86_64-apple-darwin.zip`],
    'linux-x64': [`${BASE}/deno-x86_64-unknown-linux-gnu.zip`],
    'linux-arm64': [`${BASE}/deno-aarch64-unknown-linux-gnu.zip`],
  },
}).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
