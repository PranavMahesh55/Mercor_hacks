import test from "node:test";
import assert from "node:assert/strict";
import {
  validateFindings,
  reconcileChecks,
  correctionBrief,
  requirementsFromBrief,
} from "../lib/review.ts";
const requirements = [
  { id: "R1", text: "Company name is Mercor." },
  { id: "R2", text: "Starts at 11 a.m." },
];
const candidate = {
  id: "model-id",
  requirementId: "R1",
  category: "brand",
  severity: "high",
  title: "Wrong name",
  start: 4,
  end: 6,
  expected: "Mercor",
  observed: "Mercury",
  explanation: "Visible title differs.",
  suggestion: "Correct title.",
  evidenceType: "frame",
  evidenceQuote: "MERCURY",
};
const pass = (findings) => ({
  findings,
  checks: [],
  transcript: [],
  limitations: [],
});
test("rejects invented requirement IDs, impossible times, and unsupported observations", () => {
  assert.equal(
    validateFindings(
      pass([
        { ...candidate, requirementId: "not-approved" },
        { ...candidate, start: -1 },
        { ...candidate, end: 99 },
        { ...candidate, evidenceQuote: "" },
      ]),
      45,
      requirements,
    ).length,
    0,
  );
});
test("merges repeated nearby observations but keeps separate incidents", () => {
  const findings = validateFindings(
    pass([
      candidate,
      { ...candidate, start: 6, end: 8 },
      { ...candidate, start: 20, end: 22 },
    ]),
    45,
    requirements,
  );
  assert.equal(findings.length, 2);
  assert.equal(findings[0].end, 8);
  assert.notEqual(findings[0].id, findings[1].id);
});
test("a missing or invalid check never silently passes", () => {
  const checks = reconcileChecks(
    [
      {
        requirementId: "R1",
        status: "suspected_failure",
        detail: "Claim without time",
      },
    ],
    [],
    requirements,
  );
  assert.deepEqual(
    checks.map((c) => c.status),
    ["cannot_verify", "cannot_verify"],
  );
});
test("valid timestamped findings override a model pass", () => {
  const findings = validateFindings(pass([candidate]), 45, requirements);
  assert.equal(
    reconcileChecks(
      [{ requirementId: "R1", status: "pass", detail: "Looks fine" }],
      findings,
      requirements,
    )[0].status,
    "suspected_failure",
  );
});
test("correction export excludes dismissed and unreviewed findings", () => {
  const content = correctionBrief({
    videoName: "test.mp4",
    brief: "Approved",
    findings: [
      { ...candidate, reviewStatus: "confirmed" },
      { ...candidate, title: "DO NOT EXPORT", reviewStatus: "dismissed" },
      { ...candidate, title: "UNREVIEWED", reviewStatus: "unreviewed" },
    ],
  });
  assert.match(content, /Wrong name/);
  assert.doesNotMatch(content, /DO NOT EXPORT|UNREVIEWED/);
});
test("blank lines do not create requirements", () => {
  assert.deepEqual(
    requirementsFromBrief("- Name is Mercor.\n\n- Starts at 11."),
    [
      { id: "R1", text: "Name is Mercor." },
      { id: "R2", text: "Starts at 11." },
    ],
  );
});

test("cache identity changes when video, brief, model, mode, or reference contents change", async () => {
  const { cacheIdentity } = await import("../lib/storage.ts");
  const video = new Blob(["video-one"]);
  const base = await cacheIdentity(
    video,
    "approved",
    "script",
    "gemini-test",
    [],
    "meaning",
  );
  assert.equal(
    base,
    await cacheIdentity(
      new Blob(["video-one"]),
      "approved",
      "script",
      "gemini-test",
      [],
      "meaning",
    ),
  );
  const changed = await Promise.all([
    cacheIdentity(
      new Blob(["video-two"]),
      "approved",
      "script",
      "gemini-test",
      [],
      "meaning",
    ),
    cacheIdentity(
      video,
      "different brief",
      "script",
      "gemini-test",
      [],
      "meaning",
    ),
    cacheIdentity(video, "approved", "script", "gemini-other", [], "meaning"),
    cacheIdentity(video, "approved", "script", "gemini-test", [], "exact"),
    cacheIdentity(
      video,
      "approved",
      "script",
      "gemini-test",
      [new File(["reference"], "ref.png", { type: "image/png" })],
      "meaning",
    ),
  ]);
  for (const key of changed) assert.notEqual(key, base);
});
