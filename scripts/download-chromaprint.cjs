/**
 * Downloads Chromaprint fpcalc for Windows to resources/chromaprint/fpcalc.exe.
 * Cadence uses it to fingerprint songs and look up their names on AcoustID
 * (only when song identification is turned on in Settings).
 * Run: node scripts/download-chromaprint.cjs
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FPCALC_URL = 'https://github.com/acoustid/chromaprint/releases/download/v1.5.1/chromaprint-fpcalc-1.5.1-windows-x86_64.zip';
const outputDir = path.join(__dirname, '..', 'resources', 'chromaprint');
const zipPath = path.join(outputDir, 'fpcalc.zip');

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading from ${url}...`);
    const file = fs.createWriteStream(dest);

    const request = (url) => {
      https.get(url, { headers: { 'User-Agent': 'cadence-setup' } }, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          request(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed with HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloaded = 0;
        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalSize) {
            const pct = ((downloaded / totalSize) * 100).toFixed(1);
            process.stdout.write(`\rDownloading: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)}MB)`);
          }
        });
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('\nDownload complete.');
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    };

    request(url);
  });
}

async function main() {
  console.log('=== Chromaprint (fpcalc) Downloader for Cadence ===\n');

  const fpcalcExe = path.join(outputDir, 'fpcalc.exe');
  if (fs.existsSync(fpcalcExe)) {
    console.log('fpcalc is already installed at:', fpcalcExe);
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  await downloadFile(FPCALC_URL, zipPath);

  console.log('\nExtracting fpcalc...');
  execSync(
    `powershell -NoProfile -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${outputDir}' -Force"`,
    { stdio: 'inherit' }
  );
  fs.unlinkSync(zipPath);

  // The zip contains a versioned folder; move fpcalc.exe up next to this script's output.
  for (const entry of fs.readdirSync(outputDir)) {
    const nested = path.join(outputDir, entry, 'fpcalc.exe');
    if (fs.existsSync(nested)) {
      fs.copyFileSync(nested, fpcalcExe);
      fs.rmSync(path.join(outputDir, entry), { recursive: true, force: true });
    }
  }
  const version = execSync(`"${fpcalcExe}" -version`, { encoding: 'utf8' }).trim();
  console.log(`
=== ${version} installed ===`);
  console.log(`Location: ${fpcalcExe}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
