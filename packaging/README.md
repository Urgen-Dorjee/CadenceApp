# Getting Cadence listed

Everything here is posted or submitted by the maintainer, from their own accounts.

## Google Search Console (get the website indexed)

1. Open <https://search.google.com/search-console> and sign in with Google.
2. **Add property** → **URL prefix** → `https://urgen-dorjee.github.io/CadenceApp/`.
3. Choose **HTML tag** verification, copy the `<meta name="google-site-verification" ...>` tag, add it to the
   `<head>` of `docs/index.html`, push, then click **Verify**.
4. **Sitemaps** → submit `sitemap.xml`.
5. **URL inspection** → paste the site address → **Request indexing**.

Bing: <https://www.bing.com/webmasters> can import the property straight from Search Console.

## winget (Windows Package Manager)

The manifests for the current version are in `winget/<version>/` and pass `winget validate`.

Submit with Microsoft's tool:

```powershell
winget install Microsoft.WingetCreate
wingetcreate submit --token <a GitHub token with public_repo> packaging\winget\2.20.1
```

or fork <https://github.com/microsoft/winget-pkgs>, copy the three files to
`manifests/u/UrgenDorjee/Cadence/2.20.1/`, and open a pull request. Microsoft's checks install the app in a
test machine; a reviewer merges it within a few days. Afterwards anyone can run `winget install UrgenDorjee.Cadence`.

For each new release: `wingetcreate update UrgenDorjee.Cadence --version <new> --urls <installer url> --submit`.

## AlternativeTo

<https://alternativeto.net/software/new/>. Suggested text:

- **Name:** Cadence
- **Website:** https://urgen-dorjee.github.io/CadenceApp/
- **License:** Free, open source (MIT)
- **Platforms:** Windows, Mac, Linux
- **Short description:** Free YouTube downloader that splits jukeboxes and movie albums into tagged songs, and saves whole videos and courses.
- **Description:** Cadence is a free, open-source desktop app for music and video from YouTube. Paste a jukebox, movie album or singer collection: it finds where every song starts (from chapters, the description, comments or by listening for the gaps), cuts in the silence between songs, names songs by their sound, and saves them as tagged MP3, M4A, Opus or FLAC files with cover art and lyrics, filed into a music library. In Video mode it saves whole videos, playlists and courses with subtitles and chapters, and plays them in a built-in player that remembers where you stopped. It can also split audio and video files from your computer.
- **Alternative to:** 4K Video Downloader, yt-dlp, Stacher, Parabolic, MediaHuman YouTube to MP3 Converter, JDownloader
- **Tags:** youtube-downloader, music, mp3, playlist, video-downloader, music-library

## Communities

Post as yourself, say you're the author, and follow each community's rules on self-promotion.

**r/opensource, r/software, r/DataHoarder, r/youtubedl, Bollywood/Hindi music communities:**

> **Cadence: a free, open-source app that splits YouTube jukeboxes into separate, tagged songs**
>
> I got tired of two-hour "90s hits" jukeboxes ending up as one huge file, so I built Cadence. Paste a jukebox
> or movie album: it finds where each song starts (chapters, description, comments, or by listening for the
> gaps), cuts in the silence, names the songs by their sound, and files them into a library with cover art.
> It also saves whole videos and courses with subtitles and chapters, and has a built-in player.
> Windows, macOS and Linux; MIT licensed; built on yt-dlp and FFmpeg.
> Website: https://urgen-dorjee.github.io/CadenceApp/ · Source: https://github.com/Urgen-Dorjee/CadenceApp
> Feedback very welcome.

**Hacker News:** submit the GitHub link with the title
`Show HN: Cadence – split YouTube jukeboxes into tagged songs (open source)` and post the paragraph above as
the first comment.

## Your own website

- **Link to Cadence from wanderingwhispers.com** (a Projects card with the screenshot): a link from an
  established site helps search engines find a new one sooner.
- **Optional: `cadence.wanderingwhispers.com`.** Add a DNS `CNAME` record `cadence` → `urgen-dorjee.github.io`
  where the domain's DNS is managed, then set the custom domain in GitHub → Settings → Pages (and update the
  canonical, Open Graph and sitemap addresses in `docs/`).

## GitHub social preview

GitHub → Settings → General → **Social preview** → upload `docs/social-preview.png`. This is the picture shown
when the repository link is shared (it can only be set on the website, not through the API).
