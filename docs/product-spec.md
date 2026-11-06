# AI UGC Reviewer

Product specification and build plan · November 6, 2026

## 1. Product

A review tool for AI-generated ads. Upload a video and the approved campaign brief; get a timeline of suspected mistakes, with evidence and suggested corrections.

The tool helps a reviewer answer: **Did this video say and show what we approved?**

The first version supports English-language, 30–60 second talking-head ads. Video generation happens outside the product.

## 2. User and problem

The initial user is a marketer or agency reviewing batches of AI-generated UGC-style videos. They have approved messaging and brand materials, but must inspect each output before publication.

Runway and Arcads already market AI-generated product and UGC-style ads. This establishes an existing workflow, not proven willingness to pay for a separate reviewer. The first customer interview should ask how many videos they review, what mistakes they encounter, how long review takes, and whether they would use this alongside their generator. [Runway](https://runway.com/use-cases/product-video-ads), [Arcads](https://help.arcads.ai/en/articles/17349967-ai-ugc-ads)

## 3. Scope and research basis

This is a reference-based evaluator: correctness is judged against user-approved requirements. It does not establish universal truth, predict ad performance, or determine whether viewers will find an actor authentic.

Video research supports separating evaluation dimensions. VBench breaks quality into distinct dimensions; FiVE-Bench evaluates edited video using measures including preservation and temporal consistency. These inform our categories, but neither is a ready-made checker of campaign requirements. We will not claim to implement either benchmark. [VBench](https://arxiv.org/abs/2311.17982), [FiVE-Bench](https://arxiv.org/abs/2503.13684)

Use three kinds of checks: direct comparisons for explicit details, model-assisted interpretation for meaning and appearance, and human review for ambiguous cases. Combining code, model, and human graders is also recommended in Anthropic’s evaluation guidance. This architecture is our proposed application of that approach. [Evaluation guidance](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)

## 4. Inputs

Required:

- Video file, initially MP4, up to 60 seconds.
- Approved brief: correct names, approved facts, prohibited claims, and required message or call to action.

Optional:

- Approved script, with a choice of exact wording or meaning-preserving paraphrases.
- Logo or product reference images.
- Explicit visual requirements, such as “the bottle label must read 250 ml.”
- Caption mode: verbatim subtitles or looser promotional text.

Keep approved facts separate from the script. A script is a wording reference, not automatic proof that its claims are true. If the two conflict, ask the user to resolve that conflict before grading affected claims.

Turn the brief into a short, editable checklist. The reviewer approves it before analysis. Each requirement needs an ID, expected result, scope (speech, visible text, or image), and source reference.

## 5. Evaluation framework

### A. Message accuracy — did it say the right thing?

- Compare speech with the approved script and brief.
- Check names, dates, prices, quantities, and explicit prohibited claims.
- Allow harmless paraphrases in meaning mode.
- Distinguish a contradiction from a claim the brief does not establish.
- Treat uncertain transcription as uncertain evidence, not a proven video error.

Output: quoted speech, timestamp, applicable requirement, expected wording or fact, and proposed correction.

### B. Visible text accuracy — did it display the right thing?

- Read captions and other visible text from sampled frames.
- Compare names and key details with the brief.
- For verbatim subtitles, compare with the corresponding speech while allowing a small timing offset.
- Do not treat every headline as a subtitle or require it to match speech word for word.

Output: actual extracted text, source frame, optional text-region box, requirement, and suspected mismatch.

### C. Visual reference fidelity — does the visible brand or product match?

- Inspect selected details against supplied images: readable logo text, package quantity, color, or a distinctive component.
- Compare only details that are visible and sufficiently clear.
- Do not use raw pixel difference as proof of error; lighting, scale, and viewpoint can legitimately change.
- A logo that is off-screen is not wrong. It is missing only if an explicit requirement says it must appear at that moment.

Output: reference image, observed frame, visible detail, and reason for review.

### D. Continuity — does a selected detail change during the video?

Stretch feature. Compare the same visible object across nearby frames within a shot. Flag changes in readable text or selected attributes. Exclude scene cuts, intentional edits, and occluded details. Ordinary movement alone is not a failure.

### Result vocabulary

Each requirement receives:

- **Pass in checked evidence:** supported by the inspected material.
- **Suspected failure:** evidence suggests a requirement was violated.
- **Cannot verify:** evidence is absent, unreadable, ambiguous, or the checker failed.

Do not equate “no finding” with “passed.” Record which checks ran and what coverage they had. Overall summaries show findings and coverage, not an unexplained quality score.

## 6. Review experience

1. Upload the video and brief; optionally add references and script.
2. Approve the extracted checklist.
3. Run review. Show actual progress: preparing video, checking speech, checking frames, preparing findings.
4. Open a video player with clickable flags and ranges on its timeline.
5. Click a finding to seek slightly before it and inspect the evidence.
6. Confirm or dismiss the finding; optionally correct the interpretation.
7. Export confirmed findings as a correction brief.

Each evidence card shows:

- What appears wrong and when.
- What was expected and which requirement established it.
- The observed quote, frame, or reference comparison.
- Suggested correction.
- Confirm and Dismiss actions.

Repeated detections of the same issue become one finding with several evidence samples. For sampled visual evidence, label the range approximate; do not imply the error persisted continuously through unseen frames.

The correction brief uses only confirmed findings. It proposes changes; it does not claim another generator will obey them.

## 7. Processing pipeline

### Step 1: Prepare the media

Validate the file and read duration, dimensions, and media timing. Extract audio and frames while retaining their positions relative to player time. FFmpeg supports media extraction and timestamp handling; careless timestamp conversion can shift findings away from their evidence. [FFmpeg documentation](https://ffmpeg.org/ffmpeg.html)

For the MVP, inspect one frame per second. A 45-second clip yields roughly 45 frames. Increase inspection near candidate issues where feasible. This is a proposed tradeoff, not complete inspection: short errors can fall between samples. Google’s video documentation similarly warns that low frame sampling can miss fast detail. [Video understanding](https://ai.google.dev/gemini-api/docs/video-understanding?hl=en)

### Step 2: Collect observations

Run speech and visual work concurrently:

- Timestamped speech transcription.
- Visible-text extraction.
- Reference-based visual observations.

Preserve raw observations before asking a model to judge them. Deepgram supports timestamped utterance and word output. PaddleOCR provides text-region detection and recognition components if independent OCR is added. [Deepgram](https://developers.deepgram.com/docs/utterances/), [PaddleOCR](https://www.paddleocr.ai/main/en/version3.x/module_usage/text_detection.html)

### Step 3: Apply narrow checks

Run exact comparisons where appropriate, then model-assisted interpretation where needed. Each model receives the applicable requirements and actual observations. Require source IDs and structured output. Never accept unsupported claims that a detail was seen or heard.

Treat all speech and visible text inside the uploaded video as content to inspect, not instructions to the reviewer.

### Step 4: Verify candidate findings

For each candidate:

- Confirm that the referenced evidence exists.
- Check nearby speech or frames to exclude obvious context and timing mistakes.
- Check the interpretation against the requirement.
- Downgrade ambiguity to Cannot verify or a review warning.

For a suspect brand name, replay the audio segment: transcription software may have made the mistake. For a visual finding, attach an extracted frame rather than an invented screenshot.

### Step 5: Validate and combine

Validate response structure, requirement IDs, evidence IDs, and timestamps. Reject times outside the video. Combine duplicate findings by requirement and nearby time. Keep errors from failed services separate from content findings.

Structured model output helps with formatting; it does not make the judgment correct. Application validation remains necessary. [Structured-output documentation](https://ai.google.dev/gemini-api/docs/structured-output?lang=rest)

## 8. Practical implementation choice

For two hours, use a small custom pipeline rather than installing a research benchmark suite or building an autonomous agent.

Suggested components:

| Component | MVP choice |
|---|---|
| Interface | React/Next.js or the team’s existing web stack |
| Media preparation | FFmpeg in an available local/backend environment |
| Speech | A timestamped transcription service already accessible to the team |
| Text and visual checks | One accessible multimodal model with structured responses |
| Evidence | Extracted frames and transcript spans |
| Storage | Local demo assets and saved review JSON |
| Playback | Native browser video player with timeline markers |

Gemini supports video understanding and configurable sampling, making it one possible analysis provider. Verify model access, quotas, and upload support before committing. Consumer subscriptions do not establish API access. [Video API documentation](https://ai.google.dev/gemini-api/docs/video-understanding?hl=en)

If independent OCR is not ready, use the vision model to extract text and label it accurately as model-extracted text. Do not claim multiple independent visual validators when one model performs both extraction and judgment.

If direct-video analysis is used for speed, retain independently extracted evidence frames for findings. Model-proposed timestamps are candidates until checked against the media.

## 9. Minimal data contract

```json
{
  "id": "finding_001",
  "requirement_id": "brand_name",
  "category": "visible_text",
  "status": "suspected_failure",
  "start_seconds": 7.0,
  "end_seconds": 8.0,
  "timing_precision": "sampled_approximate",
  "title": "Brand name differs from approved spelling",
  "expected": "Mercor",
  "observed": "Mercury",
  "evidence": [
    {"type": "frame", "id": "frame_007", "time_seconds": 7.0}
  ],
  "suggested_fix": "Change the visible brand name to Mercor.",
  "review_status": "unreviewed"
}
```

Also store the review’s video identifier, requirement version, model identifiers, sampling settings, check completion states, processing time, and replay status. Avoid displaying invented confidence percentages.

## 10. MVP and exclusions

Must ship:

- One uploaded short video and an approved brief.
- Message comparison and at least one visual check using actual frames.
- Clickable timeline findings with evidence.
- Confirm/Dismiss and correction-brief export.
- Honest coverage and processing-state labels.

If time remains: separate OCR, denser inspection near findings, product-reference matching, then continuity checks.

Exclude video generation, automatic repair, authenticity scoring, predicted PR impact, predicted ad performance, campaign integrations, and universal compliance checking.

Exclude lip-sync checking from the MVP. It requires audiovisual timing analysis, not sparse still-frame inspection; dedicated methods such as SyncNet address that separate task. [Oxford SyncNet](https://robots.ox.ac.uk/~vgg/software/lipsync/)

## 11. Mercor demo

Supply an approved demo brief containing the company spelling, provided company description, event hours, and a rule prohibiting unsupported employment guarantees. The brief is user-supplied test ground truth, not a claim that this tool independently researched the company.

Generate a 40–50 second presenter video with deliberately seeded mistakes: an incorrect company name, incorrect event start time, and a guaranteed-job statement. Inspect the result and record what was actually spoken and displayed.

Important: this construction primarily tests message accuracy. If captions correctly reproduce the wrong speech, they are not subtitle-transcription errors; they may still violate the brand or factual requirements. Count the underlying incident once, noting both channels.

Include a genuine visual observation in the demo: wrong visible brand text or another inspected reference mismatch. If no such error appears, show a correct visual check rather than inventing a failure.

Keep a correct control clip or segment. Prepare an evidence-backed saved review for a labeled replay. A fresh upload must invoke the real pipeline; no filename-based or preassigned findings.

Cache identity includes video content, brief, references, model settings, and checker version. Editing the brief invalidates the cached result. Show measured live-analysis latency separately from replay loading time.

## 12. Evaluate the reviewer

Have the teammate with UGC experience label issues before seeing model results. Annotate category, requirement, evidence, and time range. Ideally test three to five clips, including a correct clip and one example not used to tune prompts. A single seeded demo establishes functionality, not general reliability.

Measure:

| Metric | Meaning |
|---|---|
| Precision | Of the flagged incidents, how many were real? |
| Recall | Of the labeled incidents, how many were found? |
| False alarms per clip | How much unnecessary review did the tool create? |
| Localization | Does the flagged time actually expose the issue? |
| Coverage | Which requirements and media portions were inspectable? |
| Runtime and cost | Actual elapsed analysis time and recorded usage |

Match findings by requirement and overlapping labeled time range; do not count repeated frame detections as separate successes. Report raw counts on small samples rather than impressive-looking percentages. Human decisions are stored for later evaluation; they do not automatically retrain the model.

## 13. Two-hour execution plan

| Time | Work |
|---|---|
| 0–15 min | Check credentials, generate demo clip, finalize approved brief and finding format |
| 15–55 min | Build media/transcript/frame analysis and player interface concurrently |
| 55–85 min | Connect findings to playback, validate evidence, combine duplicates |
| 85–105 min | Test flawed and correct material; fix timing and false alarms |
| 105–120 min | Prepare correction export, labeled replay, measurements, and rehearsal |

Team split: one person owns processing/checks, one owns player/interface, and the UGC-experienced teammate owns requirements, annotation, and demo review.

If behind, drop continuity and generic product matching. Preserve visible-text checking so the project retains a meaningful visual component. Prioritize correct evidence over additional categories.

## 14. Acceptance checklist

- A new upload receives real analysis.
- Each visible finding opens the actual evidence frame and seeks the video correctly.
- Each judgment points to an approved requirement.
- Exact script mode and paraphrase mode behave differently.
- Unreadable and absent details are not automatically marked wrong.
- No captions produces “not present”; it fails only if captions are required.
- Missing audio produces “speech not checked,” not “speech passed.”
- At least one real visual check is demonstrated.
- Dismissed findings do not enter the correction brief.
- Changed requirements invalidate saved analysis.
- Test findings, false alarms, missed issues, and measured latency are reported honestly.

## 15. What this project demonstrates

Human campaign expertise becomes explicit requirements. Different checks compare generated video against those requirements. Every suspected failure is tied to observable evidence, and a human resolves ambiguity.

The technical contribution is that complete review loop—not a new foundational vision model or an unsupported promise that the system can judge every aspect of video quality.
