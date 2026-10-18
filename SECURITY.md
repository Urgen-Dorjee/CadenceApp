# Security

## Reporting a problem

Please report security problems **privately** through
[GitHub's private vulnerability reporting](https://github.com/Urgen-Dorjee/CadenceApp/security/advisories/new),
not in a public issue. Include what you found, how to reproduce it, and which version you used.
You'll get a reply within a week, and a fix is released as soon as it's ready.

Only the latest release is supported; installed copies update themselves.

## How Cadence is built to be safe

- The audio engine (a local Python server) listens only on `127.0.0.1`, on a random port, and
  every request needs a secret made fresh at each launch. Requests under any other host name are
  refused, so websites can't reach it (DNS rebinding).
- The window is sandboxed with context isolation, has no Node.js access, opens links in your
  browser rather than inside the app, and has a Content-Security-Policy that allows scripts
  only from the app itself.
- Request URLs are never written to log files, because media URLs carry the secret.
- Files are only ever served from Cadence's own folders or from your library's records.
- Nothing is sent anywhere except what each feature needs: YouTube for downloads, AcoustID
  (a sound fingerprint, never the audio) and MusicBrainz for naming songs, LRCLIB for lyrics,
  and Anthropic only if you turn on "Tidy names" with your own key.

## Checking a download

Every release lists `SHA256SUMS.txt`, and each installer carries a GitHub build attestation
that proves it was built by this repository's release workflow:

```
gh attestation verify Cadence-Setup-2.16.0.exe --repo Urgen-Dorjee/CadenceApp
```
