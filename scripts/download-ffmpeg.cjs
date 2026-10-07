/**
 * Downloads FFmpeg and FFprobe for this platform to resources/ffmpeg/.
 * Run: node scripts/download-ffmpeg.cjs
 */
const { installTool } = require('./tool-download.cjs');

const MAC = 'https://ffmpeg.martin-riedl.de/redirect/latest/macos';

/** Static Linux build of the newest FFmpeg release branch from BtbN/FFmpeg-Builds. */
async function btbnRelease(platform) {
  const res = await fetch('https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest', {
    headers: { 'User-Agent': 'cadence-setup', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) },
  });
  if (!res.ok) throw new Error(`Couldn't list FFmpeg builds (HTTP ${res.status})`);
  const pattern = new RegExp(`^ffmpeg-n(\\d+)\\.(\\d+)-latest-${platform}-gpl-\\d+\\.\\d+\\.tar\\.xz$`);
  const builds = (await res.json()).assets
    .map((a) => ({ a, m: a.name.match(pattern) }))
    .filter((x) => x.m)
    .sort((x, y) => y.m[1] - x.m[1] || y.m[2] - x.m[2]);
  if (!builds.length) throw new Error(`No FFmpeg release build for ${platform}`);
  return builds[0].a.browser_download_url;
}

installTool({
  title: 'FFmpeg',
  folder: 'ffmpeg',
  binaries: ['ffmpeg', 'ffprobe'],
  sources: {
    'win32-x64': ['https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'],
    'darwin-arm64': [`${MAC}/arm64/release/ffmpeg.zip`, `${MAC}/arm64/release/ffprobe.zip`],
    'darwin-x64': [`${MAC}/amd64/release/ffmpeg.zip`, `${MAC}/amd64/release/ffprobe.zip`],
    // Linux: BtbN's newest *release* build (e.g. n9.0), not the development snapshot.
    'linux-x64': [() => btbnRelease('linux64')],
    'linux-arm64': [() => btbnRelease('linuxarm64')],
  },
}).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
