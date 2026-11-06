# Takecheck

Review AI-generated UGC ads against an approved brief. Inspect timestamped findings, play the source video, compare evidence, confirm or dismiss issues, and export a correction brief.

## Run locally

Requires Node 22.13+.

```sh
npm install
npm run dev -- --port 3000
```

Open the printed local URL. Select **Connect Gemini**, paste your own Gemini API key, validate access, and select a video-capable model. The key stays in React memory in that tab. Requests pass through the server to Google; keys are not persisted or logged by application code. Refreshing the page clears the session key.

Upload an MP4, WebM, or MOV under 14 MB and 60 seconds. MP4 with H.264/AAC is the most portable. Enter one approved requirement per line, optionally add a script and two reference images, then run review.

## What works

- Actual video analysis through the Google provider in the Vercel AI SDK.
- Separate speech/message and visual/caption review passes, run concurrently.
- Requirement-linked findings; invalid timestamps and unknown requirement IDs are rejected.
- An actual source-video frame is extracted in the browser for each finding when decoding succeeds.
- Player, full-screen playback, time scrubbing, timeline flags, transcript navigation.
- Human Confirm/Dismiss decisions and correction export containing confirmed findings only.
- Videos, reference files, findings, and decisions persist in IndexedDB on this browser and origin.
- Saved results are labeled Replay. The cache identity covers video contents, brief, script, references, matching mode, model, and checker version.
- New analyses have measured runtime; the demo kit has a manual submission-to-ready generation timer.
- No hardcoded model findings, fake analysis progress, or fabricated performance scores.

## Review limits

The first version uses model-assisted transcription, visible-text extraction, and interpretation. The two review passes are not independent detectors. Visual sampling is one frame per second and can miss short errors; reported timestamps are approximate. No AI authenticity, lip-sync, compliance, ad-performance, or universal safety verdict is produced. Review uncertain evidence manually.

The browser stores uploaded media locally. Running analysis sends media and the brief to Google under the connected account's API terms. Delete projects in the sidebar to clear their local copies. There is no cloud media database or cross-device project sync.

## Mercor demo

The **Demo kit** contains the intentionally flawed HeyGen prompt and a separate approved brief. Generate the clip in HeyGen free, download it, and upload it here. Deliberately introduced errors must be disclosed as test cases. Inspect the generated video; only claim errors that are actually present. The exact generation and review times depend on your run and provider quotas.

Never claim that captions are inaccurate merely because they faithfully repeat incorrect speech. A factual error and a caption-transcription error are separate checks.

## Check

```sh
npm run typecheck
npm test
npm run build
```

Core tests cover evidence validation, invalid timestamps, repeat-issue merging, missing-check handling, and correction export decisions. API-backed analysis requires a working key and quota. The source uses Vinext with Cloudflare Workers for private Sites hosting; `npm run dev` runs the same application locally.

## Structure

- `app/page.tsx`: review workspace and player
- `app/api/review/route.ts`: model review pipeline
- `app/api/connection/route.ts`: account model discovery
- `lib/review.ts`: schemas, finding validation, requirement coverage, export
- `lib/storage.ts`: local projects and content-based cache identity
- `lib/demo.ts`: approved Mercor brief and flawed generation prompt
- `tests/review.test.mjs`: review-logic tests
- `docs/`: product spec, demo notes, implementation status

See `docs/product-spec.md` for research sources and product boundaries.
