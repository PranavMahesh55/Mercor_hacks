import type { Review } from "./review.ts";
export function crossCheckPlayback(review: Review): Review {
  const signals = review.mediaScan?.signals ?? [];
  if (!signals.length) return review;
  const silence = signals.filter((s) => s.kind === "audio_dropout");
  const transcript = review.transcript.map((segment) => {
    const overlap = silence.reduce(
      (sum, s) =>
        sum +
        Math.max(
          0,
          Math.min(s.end, segment.end) - Math.max(s.start, segment.start),
        ),
      0,
    );
    return overlap >= 0.75
      ? {
          ...segment,
          clear: false,
          note: "This transcript span overlaps locally measured near silence. Some words may have been inferred from captions; listen before relying on them.",
        }
      : segment;
  });
  const checks = review.checks.map((check) => {
    if (check.status !== "pass") return check;
    const requirement =
      review.requirements.find((r) => r.id === check.requirementId)?.text ?? "";
    const text = requirement + " " + check.detail;
    const continuityConflict =
      signals.some((s) => s.kind === "frozen_presenter") &&
      /continuity|smooth|uninterrupted|natural.*(?:movement|delivery)|continuous/i.test(
        text,
      );
    const audioConflict =
      silence.length > 0 &&
      /audio|spoken|speech|delivery|audible|sound|voice/i.test(text);
    return continuityConflict || audioConflict
      ? {
          ...check,
          status: "cannot_verify" as const,
          detail:
            "The model's positive assessment conflicts with a measured playback signal. Inspect the flagged picture/audio section before accepting this requirement.",
        }
      : check;
  });
  const limitations = [...review.limitations];
  if (transcript.some((s) => s.clear === false))
    limitations.push(
      "A model transcript span overlaps independently measured near silence. It is marked uncertain; visible captions are not proof that those words were spoken.",
    );
  if (checks.some((c, i) => c.status !== review.checks[i].status))
    limitations.push(
      "Positive delivery/continuity assessments that conflict with local measurements were downgraded to cannot verify.",
    );
  return {
    ...review,
    transcript,
    checks,
    limitations: [...new Set(limitations)],
  };
}
