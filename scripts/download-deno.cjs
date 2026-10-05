/**
 * Downloads Deno for Windows to resources/deno/deno.exe.
 * yt-dlp uses it to run YouTube's player JavaScript; without it some
 * downloads fail or fall back to lower-quality formats.
 * Run: node scripts/download-deno.cjs
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DENO_URL = 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip';
const outputDir = path.join(__dirname, '..', 'resources', 'deno');
const zipPath = path.join(outputDir, 'deno.zip');

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
  console.log('=== Deno Downloader for Cadence ===\n');

  const denoExe = path.join(outputDir, 'deno.exe');
  if (fs.existsSync(denoExe)) {
    console.log('Deno is already installed at:', denoExe);
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  await downloadFile(DENO_URL, zipPath);

  console.log('\nExtracting Deno...');
  execSync(
    `powershell -NoProfile -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${outputDir}' -Force"`,
    { stdio: 'inherit' }
  );
  fs.unlinkSync(zipPath);

  const version = execSync(`"${denoExe}" --version`, { encoding: 'utf8' }).split('\n')[0];
  console.log(`\n=== ${version} installed ===`);
  console.log(`Location: ${denoExe}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
