# Mercor campaign demo

The primary demo uses a normal creative brief. Do not ask the generator to make mistakes.

1. Open the Mercor campaign starter in Takecheck. Copy its creative brief.
2. Create a 40–50 second portrait UGC-style video in HeyGen free, using a female stock avatar and the exact brief. No deliberately wrong facts or captions.
3. Time submission-to-ready separately from review. HeyGen's queue may take minutes or much longer; save the finished clip for a reliable presentation.
4. Upload the finished video. Load the same Mercor campaign brief in the reviewer. Add a script only if the generator's exact wording was separately approved.
5. Run the actual review. Inspect the observations before accepting any findings.
6. Keep brief violations separate from subjective creative notes. Do not turn a taste disagreement into a factual error.
7. Click flagged moments, verify source evidence, and add justified changes to the next-take brief.
8. If no meaningful issues are found, say that the draft passed the checks that could be completed. Do not invent a failure to make the demo more dramatic.
9. Reopen a saved local review for the presentation if needed. The UI labels it Saved replay and retains its actual analysis runtime.

The 8-second synthetic spelling test is a developer diagnostic. It is not the campaign demo or evidence of natural generation failures.

Provider reference: https://help.heygen.com/en/articles/9655503-heygen-video-processing-times

## Talking-head diagnostics when Gemini quota is blocked

Open AI settings → Developer diagnostic. Load the talking-head clean control and click **Check picture & audio**. It should produce no playback flags. Load the stress test and run the same check; inspect the freeze near 5–8s and audio cut near 9–11.5s. These are real local computations on the uploaded clip, not cached inference. The footage comes from HeyGen's public avatar showcase; it is not the requested Mercor video.

The UI must say **Playback checked** and explicitly leave campaign meaning unreviewed. Do not claim that this path reviewed speech or that zero playback flags means the ad passed the campaign brief. The text-only diagnostic is retained only for regression checks.

For the primary pitch, describe the technical contribution as a video-first review pipeline with evidence provenance, rereading, independent media measurements and human confirmation. Do not call it model training or a proven general detector of AI content.
