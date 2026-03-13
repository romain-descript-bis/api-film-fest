# CLAUDE.md — TV Blind Test

## Project overview

Self-contained web app for the Descript API Film Fest. After the user picks shows and validates audio clips, the Descript API produces the final blind test video. The composition happens entirely inside the webapp via `POST /api/descript-compose`.

## Running the app

```bash
npm run dev     # tsx watch — restarts on TypeScript changes
```

The frontend is plain JS served as static files from `src/client/` — no build step needed.

## Key files to know

| File | Role |
|---|---|
| `src/server/routes/descript-compose.ts` | Three-step Descript pipeline: create project → import media → compose. Edit this to change how the video is composed. |
| `src/server/routes/compose.ts` | Audio pipeline (download → trim → Drive upload → write manifest.json) |
| `src/server/services/descript-api.ts` | Thin wrapper over `https://descriptapi.com/v1` |
| `src/server/services/gdrive.ts` | Google Drive OAuth + file upload (returns `?export=download` URLs) |
| `src/client/app.js` | Entire frontend — SPA with 5 views, cookie persistence |

## Composition prompt

The Descript agent prompt is built by `buildDescriptPrompt()` in `descript-compose.ts`. It controls:
- Video structure (opening DJ scene → intro avatar → 10 rounds → outro avatar → closing scene)
- Per-round layout (10s question + 5s reveal, continuous audio with fade in/out)
- Visual style (dark background, poster images from TMDB URLs, small show name at bottom)
- Opening/closing DJ character style (decade-appropriate, from `buildDecadeStyle()`)

When iterating on the composition, edit those two functions.

## Descript API

- Base URL: `https://descriptapi.com/v1`
- Auth: `Authorization: Bearer dx_bearer_...:dx_secret_...` (full key as Bearer)
- Key endpoints: `POST /jobs/import/project_media`, `POST /jobs/agent`, `GET /jobs/{id}`
- Jobs are async — poll `job_state` until `"stopped"`, then check `result.status`

## Audio pipeline

1. `yt-dlp` searches YouTube and downloads full MP3 to `downloads/{videoId}.mp3`
2. `ffmpeg` trims to 15s starting at `startSeconds` → `downloads/{videoId}_trim_{start}.mp3`
3. Trimmed files are uploaded to Google Drive as `?export=download` direct links
4. Those Drive URLs are passed to Descript's `import/project_media` job

## manifest.json schema

Written by `POST /api/compose`, read by `POST /api/descript-compose`:

```jsonc
{
  "decades": ["80s"],
  "createdAt": "ISO timestamp",
  "shows": [{
    "id": 123,
    "name": "Cheers",
    "year": 1982,
    "posterUrl": "https://image.tmdb.org/t/p/w342/...",
    "youtubeVideoId": "abc123",
    "audioFile": "downloads/abc123.mp3",
    "trimmedFile": "downloads/abc123_trim_12.mp3",
    "startSeconds": 12,
    "driveUrl": "https://drive.google.com/uc?export=download&id=..."
  }],
  "avatarScript": { "intro": "...", "outro": "..." }
}
```

## Environment variables

| Variable | Where to get it |
|---|---|
| `TMDB_API_KEY` | themoviedb.org/settings/api (free) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | console.cloud.google.com → OAuth 2.0 credentials |
| `DESCRIPT_API_KEY` | Descript developer portal |

## Cookie / session state

The frontend persists state in a `tvblindtest` cookie (≤ ~2KB). It stores: current view, selected decades, selected shows (with poster URLs), and per-show music selections. To reset: click **↺ Reset** in the header.
