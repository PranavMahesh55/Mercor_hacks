import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  analyzeEvidence,
  evidenceFromObservations,
  groundingReason,
} from "../lib/analysis.ts";
const observed = JSON.parse(
  await readFile(
    new URL("./fixtures/internal-observer.json", import.meta.url),
    "utf8",
  ),
);
const judged = JSON.parse(
  await readFile(
    new URL("./fixtures/internal-judgment.json", import.meta.url),
    "utf8",
  ),
);
const ocr = JSON.parse(
  await readFile(
    new URL("./fixtures/internal-ocr-reread.json", import.meta.url),
    "utf8",
  ),
);
const requirements = [
  {
    id: "R1",
    text: "The visible company title must be spelled MERCOR HACK DAY.",
  },
];
const clone = (x) => JSON.parse(JSON.stringify(x));
function driver(j = judged, reread = ocr) {
  return {
    observe: async (focus) => clone(focus ? reread : observed),
    judge: async () => clone(j),
  };
}
test("actual internal-agent finding is grounded and independently reproduced by OCR", async () => {
  const result = await analyzeEvidence(driver(), requirements, 8, false);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].start, 2);
  assert.equal(result.findings[0].end, 6);
  assert.equal(result.findings[0].evidenceQuote, "MERCURY HACK DAY");
  assert.equal(result.audit.verificationPerformed, true);
});
test("invented observation IDs are rejected before verification", async () => {
  const j = clone(judged);
  j.findings[0].evidenceIds = ["V999"];
  const result = await analyzeEvidence(driver(j), requirements, 8, false);
  assert.equal(result.findings.length, 0);
  assert.match(result.audit.rejectionReasons.join(" "), /unknown/);
});
test("a fabricated quote cannot be promoted into a finding", async () => {
  const j = clone(judged);
  j.findings[0].evidenceQuote = "GUARANTEED JOB";
  const result = await analyzeEvidence(driver(j), requirements, 8, false);
  assert.equal(result.findings.length, 0);
  assert.equal(result.checks[0].status, "cannot_verify");
});
test("time ranges must overlap the actual cited evidence", () => {
  const e = evidenceFromObservations(observed, 8);
  assert.match(
    groundingReason({ ...judged.findings[0], start: 20, end: 22 }, e, false),
    /overlaps/,
  );
});
test("disagreement on the blind reread withholds the issue", async () => {
  const changed = clone(ocr);
  changed.visuals = changed.visuals.map((v) => ({
    ...v,
    text: "MERCOR HACK DAY",
  }));
  const result = await analyzeEvidence(
    driver(judged, changed),
    requirements,
    8,
    false,
  );
  assert.equal(result.findings.length, 0);
  assert.equal(result.checks[0].status, "cannot_verify");
});
test("failed reread never silently publishes unverified findings", async () => {
  const d = driver();
  d.observe = async (focus) => {
    if (focus) throw new Error("provider failed");
    return observed;
  };
  const result = await analyzeEvidence(d, requirements, 8, false);
  assert.equal(result.findings.length, 0);
  assert.equal(result.passes.at(-1).status, "failed");
});
test("no observations cannot masquerade as a clean review", async () => {
  const d = driver();
  d.observe = async () => ({ speech: [], visuals: [], limitations: [] });
  await assert.rejects(
    analyzeEvidence(d, requirements, 8, false),
    /NO_OBSERVATIONS/,
  );
});
test("subtitle mismatch requires both actual caption and speech evidence", () => {
  const candidate = { ...judged.findings[0], category: "captions" };
  assert.match(
    groundingReason(candidate, evidenceFromObservations(observed, 8), false),
    /speech/,
  );
});
test("SCRIPT findings are impossible without an approved script", () => {
  const candidate = { ...judged.findings[0], requirementId: "SCRIPT" };
  assert.match(
    groundingReason(candidate, evidenceFromObservations(observed, 8), false),
    /No approved script/,
  );
});
test("clean control produces zero findings without requiring a verification call", async () => {
  let rereadCalls = 0;
  const clean = {
    ...clone(observed),
    visuals: observed.visuals.map((v) =>
      v.kind === "title" ? { ...v, text: "MERCOR HACK DAY" } : v,
    ),
  };
  const d = {
    observe: async (focus) => {
      if (focus) rereadCalls++;
      return clean;
    },
    judge: async () => ({
      findings: [],
      checks: [
        {
          requirementId: "R1",
          status: "pass",
          detail: "Title matches in checked frames.",
          evidenceIds: ["V1", "V2", "V3"],
        },
      ],
      limitations: [],
    }),
  };
  const result = await analyzeEvidence(d, requirements, 8, false);
  assert.equal(result.findings.length, 0);
  assert.equal(result.checks[0].status, "pass");
  assert.equal(rereadCalls, 0);
});

test("a concrete visual cue can be supported without OCR or repeated wording", async () => {
  const source = {
    speech: [],
    visuals: [
      {
        start: 2,
        end: 3,
        kind: "appearance",
        cue: "mouth_obscured",
        text: "",
        detail: "The cup covers the presenter's mouth.",
        clear: true,
      },
    ],
    limitations: [],
  };
  const reread = {
    speech: [],
    visuals: [
      {
        start: 2.1,
        end: 2.9,
        kind: "appearance",
        cue: "mouth_obscured",
        text: "",
        detail: "A drinking glass is in front of the lips.",
        clear: true,
      },
    ],
    limitations: [],
  };
  const j = {
    findings: [
      {
        ...judged.findings[0],
        category: "continuity",
        start: 2,
        end: 3,
        evidenceIds: ["V1"],
        observed: source.visuals[0].detail,
        evidenceQuote: source.visuals[0].detail,
      },
    ],
    checks: [],
    limitations: [],
  };
  const result = await analyzeEvidence(
    {
      observe: async (focus) => (focus ? reread : source),
      judge: async () => j,
    },
    requirements,
    8,
    false,
  );
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].verification.method, "visual_reread");
});
test("a visual cue that disagrees on reread is withheld", async () => {
  const source = {
    speech: [],
    visuals: [
      {
        start: 2,
        end: 3,
        kind: "appearance",
        cue: "mouth_obscured",
        text: "",
        detail: "A cup covers the mouth.",
        clear: true,
      },
    ],
    limitations: [],
  };
  const reread = {
    ...source,
    visuals: [
      {
        ...source.visuals[0],
        cue: "hand_gesture",
        detail: "The hand is raised beside the face.",
      },
    ],
  };
  const j = {
    findings: [
      {
        ...judged.findings[0],
        category: "continuity",
        start: 2,
        end: 3,
        evidenceIds: ["V1"],
        evidenceQuote: source.visuals[0].detail,
      },
    ],
    checks: [],
    limitations: [],
  };
  const result = await analyzeEvidence(
    {
      observe: async (focus) => (focus ? reread : source),
      judge: async () => j,
    },
    requirements,
    8,
    false,
  );
  assert.equal(result.findings.length, 0);
});
test("generic appearance opinions are not promoted as verified visual defects", async () => {
  const source = {
    speech: [],
    visuals: [
      {
        start: 2,
        end: 3,
        kind: "appearance",
        text: "",
        detail: "The face looks unnatural.",
        clear: true,
      },
    ],
    limitations: [],
  };
  const j = {
    findings: [
      {
        ...judged.findings[0],
        start: 2,
        end: 3,
        evidenceIds: ["V1"],
        evidenceQuote: source.visuals[0].detail,
      },
    ],
    checks: [],
    limitations: [],
  };
  const result = await analyzeEvidence(
    { observe: async () => source, judge: async () => j },
    requirements,
    8,
    false,
  );
  assert.equal(result.findings.length, 0);
});
