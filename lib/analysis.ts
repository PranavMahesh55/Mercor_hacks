import { z } from "zod";
import {
  validateFindings,
  reconcileChecks,
  type Finding,
  type Requirement,
  type ReviewPass,
} from "./review.ts";

export const observationsSchema = z.object({
  speech: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      text: z.string(),
      clear: z.boolean(),
    }),
  ),
  visuals: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      kind: z.enum(["caption", "title", "brand_text", "appearance"]),
      text: z.string(),
      detail: z.string(),
      cue: z
        .enum([
          "face_leaves_frame",
          "mouth_obscured",
          "scene_cut",
          "visible_product",
          "hand_gesture",
        ])
        .nullable()
        .optional(),
      clear: z.boolean(),
    }),
  ),
  limitations: z.array(z.string()),
});
export type Observations = z.infer<typeof observationsSchema>;
export type Evidence = {
  id: string;
  start: number;
  end: number;
  channel: "speech" | "visual";
  kind: string;
  text: string;
  detail: string;
  clear: boolean;
  cue?: string | null;
};
export const judgmentSchema = z.object({
  findings: z.array(
    z.object({
      id: z.string(),
      requirementId: z.string(),
      evidenceIds: z.array(z.string()),
      category: z.enum([
        "message",
        "captions",
        "brand",
        "continuity",
        "creative",
      ]),
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
    }),
  ),
  checks: z.array(
    z.object({
      requirementId: z.string(),
      status: z.enum(["pass", "suspected_failure", "cannot_verify"]),
      detail: z.string(),
      evidenceIds: z.array(z.string()),
    }),
  ),
  limitations: z.array(z.string()),
});
export type Judgment = z.infer<typeof judgmentSchema>;
export type Driver = {
  observe: (focus?: { start: number; end: number }[]) => Promise<Observations>;
  judge: (
    evidence: Evidence[],
    requirements: Requirement[],
  ) => Promise<Judgment>;
};
export type PipelineAudit = {
  candidates: number;
  rejected: number;
  rejectionReasons: string[];
  verificationPerformed: boolean;
  evidence: Evidence[];
  recheckEvidence: Evidence[];
};

export function normalizeEvidence(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function evidenceFromObservations(
  input: Observations,
  duration: number,
  prefix = "",
): Evidence[] {
  const valid = (s: { start: number; end: number }) =>
    Number.isFinite(s.start) &&
    Number.isFinite(s.end) &&
    s.start >= 0 &&
    s.end > s.start &&
    s.start < duration &&
    s.end <= duration + 0.25;
  return [
    ...input.speech
      .filter(valid)
      .filter((s) => s.text.trim())
      .map((s, i) => ({
        ...s,
        end: Math.min(duration, s.end),
        id: `${prefix}S${i + 1}`,
        channel: "speech" as const,
        kind: "speech",
        detail: "",
      })),
    ...input.visuals
      .filter(valid)
      .filter((v) => v.text.trim() || v.detail.trim())
      .map((v, i) => ({
        ...v,
        end: Math.min(duration, v.end),
        id: `${prefix}V${i + 1}`,
        channel: "visual" as const,
      })),
  ];
}
function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
  tolerance = 0.75,
) {
  return a.start <= b.end + tolerance && a.end >= b.start - tolerance;
}
function containsQuote(haystack: string, quote: string) {
  const h = normalizeEvidence(haystack),
    q = normalizeEvidence(quote);
  return q.length >= 2 && ` ${h} `.includes(` ${q} `);
}
export function groundingReason(
  candidate: Judgment["findings"][number],
  evidence: Evidence[],
  scriptPresent: boolean,
): string | null {
  if (candidate.requirementId === "SCRIPT" && !scriptPresent)
    return "No approved script was supplied.";
  const ids = new Set(candidate.evidenceIds);
  const linked = evidence.filter((e) => ids.has(e.id));
  if (!ids.size || linked.length !== ids.size)
    return "Evidence ID is missing or unknown.";
  if (!linked.some((e) => e.clear && overlaps(e, candidate)))
    return "No clear linked observation overlaps the proposed time.";
  const expectedChannel =
    candidate.evidenceType === "speech"
      ? "speech"
      : candidate.evidenceType === "frame"
        ? "visual"
        : null;
  if (expectedChannel && !linked.some((e) => e.channel === expectedChannel))
    return "Evidence channel does not match the finding.";
  if (
    !linked.some(
      (e) =>
        e.clear &&
        overlaps(e, candidate) &&
        containsQuote(e.text || e.detail, candidate.evidenceQuote),
    )
  )
    return "Quoted evidence is absent from the linked observation.";
  if (
    candidate.category === "captions" &&
    !linked.some((e) => e.channel === "speech")
  )
    return "A caption/speech mismatch requires speech evidence too.";
  if (
    candidate.category === "captions" &&
    !linked.some((e) => e.channel === "visual" && e.kind === "caption")
  )
    return "No actual caption observation supports a subtitle finding.";
  return null;
}

export async function analyzeEvidence(
  driver: Driver,
  requirements: Requirement[],
  duration: number,
  scriptPresent: boolean,
) {
  const stages: { name: string; status: "complete" | "failed"; ms: number }[] =
    [];
  const t = performance.now();
  const observed = await driver.observe();
  stages.push({
    name: "Read source without brief",
    status: "complete",
    ms: Math.round(performance.now() - t),
  });
  const evidence = evidenceFromObservations(observed, duration);
  if (!evidence.length) throw new Error("NO_OBSERVATIONS");
  const j = performance.now();
  const judgment = await driver.judge(evidence, requirements);
  stages.push({
    name: "Check against campaign brief",
    status: "complete",
    ms: Math.round(performance.now() - j),
  });
  const reasons: string[] = [];
  const validRequirement = new Set([
    ...requirements.map((r) => r.id),
    ...(scriptPresent ? ["SCRIPT"] : []),
  ]);
  const candidates = judgment.findings
    .filter((c) => {
      const reason = !validRequirement.has(c.requirementId)
        ? "Unknown requirement."
        : groundingReason(c, evidence, scriptPresent);
      if (reason) reasons.push(`${c.id}: ${reason}`);
      return !reason;
    })
    .slice(0, 8);
  let recheckEvidence: Evidence[] = [];
  let verified = false;
  if (candidates.length) {
    const windows = candidates.map((c) => ({
      start: Math.max(0, c.start - 1),
      end: Math.min(duration, c.end + 1),
    }));
    const v = performance.now();
    try {
      const reread = await driver.observe(windows);
      recheckEvidence = evidenceFromObservations(reread, duration, "check-");
      verified = true;
      stages.push({
        name: "Reread flagged moments without verdict",
        status: "complete",
        ms: Math.round(performance.now() - v),
      });
    } catch {
      stages.push({
        name: "Reread flagged moments without verdict",
        status: "failed",
        ms: Math.round(performance.now() - v),
      });
    }
  }
  const accepted = candidates
    .filter((c) => {
      const linked = evidence.filter((e) => c.evidenceIds.includes(e.id));
      const visualOnly = linked.every(
        (e) => e.channel === "visual" && e.kind === "appearance",
      );
      if (visualOnly && !linked.some((e) => e.cue)) {
        reasons.push(
          `${c.id}: Unstructured appearance claim cannot be verified.`,
        );
        return false;
      }
      const supported = recheckEvidence.some(
        (e) =>
          e.clear &&
          overlaps(e, c) &&
          (visualOnly
            ? linked.some(
                (source) =>
                  source.cue && source.cue === e.cue && overlaps(source, e),
              )
            : containsQuote(e.text || e.detail, c.evidenceQuote)),
      );
      if (!supported)
        reasons.push(
          `${c.id}: The blind reread did not reproduce the source observation.`,
        );
      return supported;
    })
    .filter(
      (c, i, all) =>
        c.category !== "creative" ||
        all.slice(0, i).filter((x) => x.category === "creative").length < 2,
    )
    .map((c) => ({
      ...c,
      severity: c.category === "creative" ? ("low" as const) : c.severity,
    }));
  const validated = validateFindings(
    { findings: accepted, transcript: [], checks: [], limitations: [] },
    duration,
    requirements,
  );
  const findings: Finding[] = validated.map((f) => {
    const original = accepted.find(
      (a) =>
        a.requirementId === f.requirementId &&
        a.category === f.category &&
        overlaps(a, f),
    );
    const isVisualCue =
      original?.evidenceIds.some((id) =>
        evidence.some((e) => e.id === id && e.cue),
      ) && original.evidenceType === "frame";
    return {
      ...f,
      evidenceIds: original?.evidenceIds ?? [],
      verification: {
        method: isVisualCue ? "visual_reread" : "blind_reread",
        status: "supported",
        detail: isVisualCue
          ? "The same visible event type appeared at overlapping times in two fresh video reads. Both use the same model; inspect the before/after frames and playback before confirming."
          : "Quoted observation appeared in source extraction and a separate reread. Both use the same model; this is consistency evidence, not independent proof.",
      },
    };
  });
  const groundingChecks: ReviewPass["checks"] = judgment.checks.map((c) => {
    const supported =
      c.evidenceIds.length > 0 &&
      c.evidenceIds.every((id) => evidence.some((e) => e.id === id && e.clear));
    return {
      requirementId: c.requirementId,
      status: c.status === "pass" && !supported ? "cannot_verify" : c.status,
      detail:
        c.status === "pass" && !supported
          ? "No clear source observation supports a pass."
          : c.detail,
    };
  });
  const checks = reconcileChecks(groundingChecks, findings, requirements);
  const rejected = judgment.findings.length - findings.length;
  const limitations = [
    ...observed.limitations,
    ...judgment.limitations,
    "Visual sampling can miss brief events. Model transcript timestamps are approximate.",
    "The extraction and blind reread use the same model and can share errors.",
    "Visual event notes require the same event type on a blind reread. Anatomy, attractiveness, emotion, identity and subtle lip-sync judgments are not verified.",
    ...(rejected
      ? [
          `${rejected} candidate(s) were withheld or combined. See the audit data for details.`,
        ]
      : []),
  ];
  return {
    findings,
    transcript: evidence
      .filter((e) => e.channel === "speech")
      .map((e) => ({ start: e.start, end: e.end, text: e.text })),
    checks,
    limitations,
    passes: stages,
    audit: {
      candidates: judgment.findings.length,
      rejected,
      rejectionReasons: reasons,
      verificationPerformed: verified,
      evidence,
      recheckEvidence,
    } satisfies PipelineAudit,
  };
}
