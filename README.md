# Takecheck

A second look before an AI UGC ad goes live. Upload the actual video, add the same campaign brief used to generate it, inspect timestamped evidence, and confirm changes for the next take.

## Run

Requires Node 22.13+.

```sh
npm install
npm run dev -- --port 3000
```

Upload an H.264/AAC MP4 under 14 MB and 60 seconds. WebM/MOV depend on browser codecs. **Check picture & audio** works locally without an API key. Connect Gemini for spoken-content and campaign-brief review. The connection tests an actual generation request against up to four catalog-listed models, prefers a working current model, allows a sufficient response budget and distinguishes zero/daily quota, permissions, unavailable models and network failures. A catalog listing alone cannot masquerade as usable generation access.

Keys stay in React memory for the current tab. They are sent in the review request to the application server and used only for Google requests; application code does not store or log them. Refreshing clears the key. Projects and media persist in this browser's IndexedDB, not a cloud media database.

## How the review works

1. **Local video/audio checks.** A self-hosted MediaPipe face detector runs on decoded video at 4 samples/second. Frame differences in a fixed presenter crop are compared with decoded PCM audio energy. Conservative rules flag sustained still presenter pictures while audio continues, and near-digital silence surrounded by audible sections. These are playback notes requiring editorial confirmation, not brief violations or AI-authenticity verdicts.
2. **Blind video observation.** Gemini receives the actual video, including audio, without the expected brief. It records timestamped speech, visible text, and concrete visual events such as a shot change, mouth occlusion, hand gesture, or face leaving frame. Initial sampling is 2 fps.
3. **Brief judgment.** A fresh model context compares the source evidence with the campaign brief and optional approved script. Every candidate must cite source observation IDs and literal source evidence. Ordinary gestures and intentional product cutaways are not automatically errors. Subjective creative notes have low severity and are limited to two.
4. **Blind video reread.** Candidate windows are read again at 4 fps without the brief or verdict. Text/speech quotes must be reproduced; structured visual event types must recur at overlapping times. Unsupported claims are withheld. The same model performs both reads, so this is consistency evidence rather than independent proof.
5. **Independent text check, when relevant.** Browser Tesseract checks actual frames for visible brand/caption quotes. This is secondary to the talking-head review. OCR uncertainty remains visible.
6. **Cross-check model claims.** If a transcript span overlaps a measured near-silent interval, mark it uncertain without changing its quoted words. If a positive delivery/continuity assessment conflicts with a measured playback note, downgrade it to cannot verify. Unrelated supported requirements remain intact.
7. **Human decision.** Click timeline flags, play the source, inspect actual evidence frames, confirm or dismiss, then export only confirmed changes. Exported JSON includes source observations, rejected candidates, stage timings, and local media measurements.

The text evidence record is an audit trail extracted from video, not training data or a substitute for video input. We do not train or fine-tune a model. Confirm/dismiss decisions are saved locally; they do not silently update model weights.

## What was actually tested

The developer diagnostics include an actual talking-head UGC sample from [HeyGen's public avatar showcase](https://www.heygen.com/avatars). A 12-second crop is the clean control. A separate stress copy adds a known picture freeze at 5–8s and an audio mute at 9–11.5s. These deliberately edited controls are **not** the primary Mercor campaign and do not demonstrate natural generator failure rates.

Actual browser scan on this machine:

| Clip | Playback findings | End-to-end time |
| --- | --- | --- |
| Untouched talking head | 0 | 2.074s |
| Controlled stress copy | Freeze 5.25–7.75s; near silence 9.25–11.5s | 2.133s |

The model/runtime was already loaded. These are two short local diagnostic runs, not representative latency, precision, recall, or a Gemini benchmark. A blind internal vision reviewer separately noticed the repeated presenter frames around 5–8s; a different reviewer reported no clear visual defect in the clean contact sheet. Both inspected 2 fps stills and did not hear audio. An offline Whisper tiny.en diagnostic transcribed the actual source speech; this is not wired into the hosted product.

Recorded browser measurements are bound to the exact source files by SHA-256 in the test fixtures. Tests also cover missing audio, no detected face, short still moments, invented evidence, time errors, reread disagreement, unavailable checks, cache identity, and correction export. Text-card tests remain isolated regression tests.

```sh
npm run typecheck
npm test
npm run build
```

35 automated tests passed at implementation time. Live Gemini 3.5 Flash Lite review of the 12-second talking-head stress clip succeeded: 20.050s server analysis, 26.423s end to end, 5,396 reported tokens. The model returned a positive delivery assessment that conflicted with local playback signals. A new deterministic cross-check marks overlapping transcript spans uncertain and downgrades conflicting positive delivery/continuity checks to cannot verify. This is a measured single run, not a general latency or accuracy benchmark.

## Limits

- A visible face is not identity or proof of a real person. No attractiveness, emotion, anatomy, deepfake, or measured lip-sync score is produced.
- Audio energy is not speech detection. Intentional pauses/still shots can resemble playback defects. Short or subtle artifacts may be missed.
- Model speech, visual understanding, judgment, and approximate timestamps can be wrong. Passing one requirement does not establish the whole ad is ready.
- No virality, reach, conversion, legal-compliance, or universal quality verdict.
- Generic appearance opinions are withheld. Visual cue notes still need human playback review.
- The local scan survives absent Gemini access. If Gemini fails after that scan, playback results remain available, with campaign coverage explicitly incomplete.

## Primary Mercor demo

The Mercor campaign starter contains a normal CMO-style brief shared by generation and review. Generate a 40–50s vertical female-stock-avatar clip in HeyGen free, without planted mistakes or fabricated employee/testimonial claims. Use the same brief to review it. A clean result is valid. Time the real generation separately; a saved video/review can be used with its replay label for presentation reliability.

The requested custom Mercor clip has not yet been generated in this session. The public talking-head control is separate test material.

## Source map

- `app/page.tsx`: campaign workspace, video player, local scan, human decisions, persistence, exports
- `app/api/review/route.ts`: Gemini video observation/judgment/reread driver
- `lib/analysis.ts`: evidence provenance, grounding, verification and abstention
- `lib/media-scan.ts`: decoded video/audio and local face inference
- `lib/media-signals.ts`: conservative temporal rules and playback notes
- `lib/ocr.ts`: secondary independent visible-text verification
- `lib/review.ts`: schemas, coverage reconciliation, correction export
- `lib/storage.ts`: IndexedDB and content-based cache identity
- `lib/demo.ts`: normal Mercor generation/review brief

Platform: React/Vinext, Vercel AI SDK, Gemini provider, Cloudflare Workers through private Sites hosting. Face/OCR assets are self-hosted and prepared from locked npm packages before dev/build.

References: [Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding), [MediaPipe face detector](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector), [Tesseract.js](https://github.com/naptha/tesseract.js). See `docs/` for the product brief and demo runbook.

A second live Gemini test used the untouched source with a diagnostic requirement prohibiting product-only cutaways. Gemini produced one requirement-linked visual finding around the cut near 6s and reproduced the cue on a blind reread. Measured server time: 10.772s; end-to-end: 21.159s; reported tokens: 11,480. This tests the visual finding path; the diagnostic brief was not the original generation brief and is not the Mercor demo.
