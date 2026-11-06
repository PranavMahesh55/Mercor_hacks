import { z } from "zod";

export const CHECKER_VERSION = "takecheck-2.2";
export const MAX_VIDEO_BYTES = 14 * 1024 * 1024;
export const categorySchema = z.enum([
  "message",
  "captions",
  "brand",
  "continuity",
  "creative",
]);
export const findingSchema = z.object({
  id: z.string(),
  requirementId: z.string(),
  category: categorySchema,
  severity: z.enum(["high", "medium", "low"]),
  title: z.string(),
  start: z.number(),
  end: z.number(),
  expected: z.string(),
  observed: z.string(),
  explanation: z.string(),
  suggestion: z.string(),
  evidenceType: z.enum(["speech", "frame", "both"]),
  evidenceQuote: z.string(),
});
export const passSchema = z.object({
  findings: z.array(findingSchema),
  transcript: z.array(
    z.object({ start: z.number(), end: z.number(), text: z.string() }),
  ),
  checks: z.array(
    z.object({
      requirementId: z.string(),
      status: z.enum(["pass", "suspected_failure", "cannot_verify"]),
      detail: z.string(),
    }),
  ),
  limitations: z.array(z.string()),
});
export type Finding = z.infer<typeof findingSchema> & {
  reviewStatus: "unreviewed" | "confirmed" | "dismissed";
  frame?: string;
  frameTime?: number;
  evidenceFrames?: { time: number; image: string }[];
  evidenceIds?: string[];
  verification?: {
    method: string;
    status: string;
    detail: string;
    ocrText?: string;
  };
};
export type Requirement = { id: string; text: string };
export type ReviewPass = z.infer<typeof passSchema>;
export type Review = {
  id: string;
  videoName: string;
  duration: number;
  createdAt: string;
  model: string;
  brief: string;
  script: string;
  requirements: Requirement[];
  findings: Finding[];
  transcript: (ReviewPass["transcript"][number] & {
    clear?: boolean;
    note?: string;
  })[];
  checks: ReviewPass["checks"];
  limitations: string[];
  analysisMs: number;
  endToEndMs?: number;
  tokens: number | null;
  version: string;
  scriptMode: string;
  passes: { name: string; status: "complete" | "failed"; ms: number }[];
  cacheKey: string;
  referenceNames: string[];
  audit?: unknown;
  mediaScan?: import("./media-signals").MediaScan;
};

export function normalizeReviewText(text: string) {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function requirementsFromBrief(brief: string): Requirement[] {
  return brief
    .split("\n")
    .map((t) => t.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    .filter(Boolean)
    .map((text, i) => ({ id: `R${i + 1}`, text }));
}

export function validateFindings(
  pass: ReviewPass,
  duration: number,
  requirements: Requirement[],
): Finding[] {
  const allowed = new Set([...requirements.map((r) => r.id), "SCRIPT"]);
  const valid = pass.findings.filter(
    (f) =>
      allowed.has(f.requirementId) &&
      Number.isFinite(f.start) &&
      Number.isFinite(f.end) &&
      f.start >= 0 &&
      f.end > f.start &&
      f.end <= duration + 0.25 &&
      f.observed.trim() &&
      f.evidenceQuote.trim(),
  );
  const result: Finding[] = [];
  for (const f of valid.sort((a, b) => a.start - b.start)) {
    const previous = result.find(
      (p) =>
        p.requirementId === f.requirementId &&
        p.category === f.category &&
        f.start <= p.end + 1 &&
        f.observed.toLowerCase() === p.observed.toLowerCase(),
    );
    if (previous)
      previous.end = Math.min(duration, Math.max(previous.end, f.end));
    else
      result.push({
        ...f,
        end: Math.min(duration, f.end),
        id: `finding-${result.length + 1}`,
        reviewStatus: "unreviewed",
      });
  }
  return result;
}

export function correctionBrief(review: Review): string {
  const confirmed = review.findings.filter(
    (f) => f.reviewStatus === "confirmed",
  );
  return `# Correction brief — ${review.videoName}\n\nApproved brief:\n${review.brief}\n\n${confirmed.length ? confirmed.map((f, i) => `${i + 1}. ${formatTime(f.start)}–${formatTime(f.end)} · ${f.title}\n   Observed: ${f.observed}\n   Expected: ${f.expected}\n   Change: ${f.suggestion}`).join("\n\n") : "No findings confirmed. Confirm findings in the review before requesting corrections."}\n\nPreserve content outside these requested changes. Re-review the revised video; this brief does not guarantee generation results.\n`;
}
export function formatTime(value: number) {
  const s = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

export function reconcileChecks(
  checks: ReviewPass["checks"],
  findings: Finding[],
  requirements: Requirement[],
): ReviewPass["checks"] {
  return requirements.map((r) => {
    if (findings.some((f) => f.requirementId === r.id))
      return {
        requirementId: r.id,
        status: "suspected_failure",
        detail: "See timestamped evidence.",
      };
    const observations = checks.filter((c) => c.requirementId === r.id);
    // A model-only failure without valid evidence cannot become a supported finding.
    if (observations.some((c) => c.status === "suspected_failure"))
      return {
        requirementId: r.id,
        status: "cannot_verify",
        detail: "A candidate issue lacked valid timestamped evidence.",
      };
    const supported = observations.find((c) => c.status === "pass");
    return (
      supported ?? {
        requirementId: r.id,
        status: "cannot_verify",
        detail:
          observations[0]?.detail ??
          "No completed check supports this requirement.",
      }
    );
  });
}
