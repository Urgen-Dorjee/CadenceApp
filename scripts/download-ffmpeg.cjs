/**
 * Downloads FFmpeg and FFprobe for this platform to resources/ffmpeg/.
 * Run: node scripts/download-ffmpeg.cjs
 */
const { installTool } = require('./tool-download.cjs');

const MAC = 'https://ffmpeg.martin-riedl.de/redirect/latest/macos';

installTool({
  title: 'FFmpeg',
  folder: 'ffmpeg',
  binaries: ['ffmpeg', 'ffprobe'],
  sources: {
    'win32-x64': ['https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'],
    'darwin-arm64': [`${MAC}/arm64/release/ffmpeg.zip`, `${MAC}/arm64/release/ffprobe.zip`],
    'darwin-x64': [`${MAC}/amd64/release/ffmpeg.zip`, `${MAC}/amd64/release/ffprobe.zip`],
    'linux-x64': ['https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz'],
    'linux-arm64': ['https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz'],
  },
}).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
