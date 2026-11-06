import type { Finding } from "./review.ts";

export type MediaSample = {
  time: number;
  face: boolean;
  motion: number | null;
  db: number | null;
};
export type MediaSignal = {
  kind: "frozen_presenter" | "audio_dropout";
  start: number;
  end: number;
  detail: string;
};
export type MediaScan = {
  samples: MediaSample[];
  signals: MediaSignal[];
  ms: number;
  fps: number;
  limitations: string[];
};

// Conservative engineering thresholds, not learned quality or authenticity scores.
export function detectMediaSignals(
  samples: MediaSample[],
  duration: number,
): MediaSignal[] {
  if (samples.length < 3) return [];
  const step = samples[1].time - samples[0].time;
  const output: MediaSignal[] = [];
  function runs(matches: (s: MediaSample) => boolean) {
    const groups: MediaSample[][] = [];
    for (const s of samples) {
      if (!matches(s)) continue;
      const last = groups.at(-1);
      if (last && s.time - last.at(-1)!.time <= step * 1.5) last.push(s);
      else groups.push([s]);
    }
    return groups;
  }
  for (const run of runs(
    (s) => s.face && s.motion !== null && s.motion <= 0.0008,
  )) {
    const start = Math.max(0, run[0].time - step);
    const end = Math.min(duration, run.at(-1)!.time);
    if (end - start < 1.5) continue;
    const audio = run.filter((s) => s.db !== null);
    if (
      !audio.length ||
      audio.filter((s) => s.db! > -45).length / audio.length < 0.6
    )
      continue;
    const before = samples.filter((s) => s.time >= start - 1 && s.time < start);
    const after = samples.filter((s) => s.time > end && s.time <= end + 1);
    if (![...before, ...after].some((s) => s.face && (s.motion ?? 0) > 0.003))
      continue;
    output.push({
      kind: "frozen_presenter",
      start,
      end,
      detail: `A face was detected and the sampled presenter region stayed nearly identical for ${(end - start).toFixed(1)}s while audio energy continued. Inspect for an unintended freeze.`,
    });
  }
  for (const run of runs((s) => s.db !== null && s.db < -80)) {
    const start = run[0].time;
    const end = Math.min(duration, run.at(-1)!.time + step);
    if (end - start < 1 || start < 0.5 || end > duration - 0.25) continue;
    const before = samples.filter((s) => s.time >= start - 1 && s.time < start);
    const after = samples.filter((s) => s.time >= end && s.time <= end + 1);
    if (
      !before.some((s) => (s.db ?? -100) > -45) ||
      !after.some((s) => (s.db ?? -100) > -45)
    )
      continue;
    if (run.filter((s) => s.face).length / run.length < 0.6) continue;
    output.push({
      kind: "audio_dropout",
      start,
      end,
      detail: `Audio drops to near digital silence for ${(end - start).toFixed(1)}s between audible sections while a face remains visible. It may be an intentional pause; listen before accepting.`,
    });
  }
  return output.sort((a, b) => a.start - b.start);
}

export function mediaFindings(scan: MediaScan): Finding[] {
  return scan.signals.map((s, i) => ({
    id: `media-${i + 1}`,
    requirementId: "MEDIA",
    category: "continuity",
    severity: "medium",
    title:
      s.kind === "frozen_presenter"
        ? "Presenter picture may freeze"
        : "Audio drops to near silence",
    start: s.start,
    end: s.end,
    expected:
      "Playback continuity: inspect unexpected picture freezes and audio dropouts before posting.",
    observed: s.detail,
    explanation:
      "This is a measured playback signal, not a claim that the presenter is fake or the campaign brief was violated.",
    suggestion:
      s.kind === "frozen_presenter"
        ? "Check this section in motion. If unintended, regenerate or replace the frozen section while preserving the voice track."
        : "Listen to this section. If unintended, restore or regenerate the missing audio and recheck the cut.",
    evidenceType: s.kind === "frozen_presenter" ? "both" : "speech",
    evidenceQuote: s.detail,
    reviewStatus: "unreviewed",
    verification: {
      method: "local_media_scan",
      status: "supported",
      detail: `Computed from actual decoded frames and audio at ${scan.fps} samples/s with local face detection. No transcript or text recognition is used. This signal needs editorial confirmation.`,
    },
  }));
}
