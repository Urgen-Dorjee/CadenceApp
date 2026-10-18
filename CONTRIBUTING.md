# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Getting set up

Follow **Getting started** in the [README](README.md#getting-started): Node 20, Python 3.12,
then `npm install`, `npm run setup:all` and `npm run dev`.

## Before opening a pull request

```
npm run lint                     # ESLint and Ruff
npx tsc --noEmit -p tsconfig.json
npm test                         # frontend
cd backend && python -m pytest   # backend (needs FFmpeg: npm run setup:ffmpeg)
```

CI runs the same checks on Windows, macOS and Linux.

- Keep each pull request to one change, with tests for what it fixes or adds.
- Changes to how songs are cut must keep (or improve) the numbers from
  `python scripts/bench-cuts.py <a folder of songs>`; put before and after in the pull request.
- Write interface text plainly, for people who aren't technical.
- Please don't add trackers, analytics or anything that sends data without the user turning it on.

## Releasing (maintainers)

Bump the version in `package.json`, `package-lock.json` and `backend/main.py`, merge to `master`,
and push a tag `vX.Y.Z`. The Release workflow tests, builds all four installers, adds checksums
and build attestations, and publishes the release with the update feeds.

### Free code signing for Windows

[SignPath Foundation](https://signpath.org) signs open-source projects at no cost, so Windows
doesn't show "unknown publisher". Once the project is accepted:

1. In SignPath, create the project `cadence` with a signing policy `release-signing` and an
   artifact configuration that signs the installer `.exe`, linked to this GitHub repository.
2. In GitHub → Settings → Secrets and variables → Actions, add the secret `SIGNPATH_API_TOKEN`
   and the variable `SIGNPATH_ORGANIZATION_ID` (and `SIGNPATH_PROJECT_SLUG` /
   `SIGNPATH_POLICY_SLUG` if you named them differently).

The release workflow then signs the Windows installer and updates the update feed to match.
Without them, it builds unsigned as before.

macOS signing needs a paid Apple Developer ID, so Mac builds stay ad-hoc signed; the README
explains how to open them.
