/**
 * Downloads FFmpeg for Windows and extracts to resources/ffmpeg/.
 * Run: node scripts/download-ffmpeg.js
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FFMPEG_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const outputDir = path.join(__dirname, '..', 'resources', 'ffmpeg');
const zipPath = path.join(outputDir, 'ffmpeg.zip');

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading from ${url}...`);
    const file = fs.createWriteStream(dest);

    const request = (url) => {
      https.get(url, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          request(response.headers.location);
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
  console.log('=== FFmpeg Downloader for Cadence ===\n');

  // Check if already exists
  const ffmpegExe = path.join(outputDir, 'ffmpeg.exe');
  if (fs.existsSync(ffmpegExe)) {
    console.log('FFmpeg is already installed at:', ffmpegExe);
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });

  // Download
  await downloadFile(FFMPEG_URL, zipPath);

  // Extract using PowerShell (Windows)
  console.log('\nExtracting FFmpeg...');
  execSync(
    `powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${outputDir}' -Force"`,
    { stdio: 'inherit' }
  );

  // Move binaries from nested folder to resources/ffmpeg/
  const extractedDirs = fs.readdirSync(outputDir).filter(d => d.startsWith('ffmpeg-'));
  if (extractedDirs.length > 0) {
    const binDir = path.join(outputDir, extractedDirs[0], 'bin');
    if (fs.existsSync(binDir)) {
      for (const file of fs.readdirSync(binDir)) {
        const src = path.join(binDir, file);
        const dest = path.join(outputDir, file);
        fs.copyFileSync(src, dest);
        console.log(`  Extracted: ${file}`);
      }
    }
    // Clean up extracted folder
    fs.rmSync(path.join(outputDir, extractedDirs[0]), { recursive: true, force: true });
  }

  // Clean up zip
  fs.unlinkSync(zipPath);

  console.log('\n=== FFmpeg installation complete! ===');
  console.log(`Location: ${outputDir}`);
}

main().catch(console.error);
