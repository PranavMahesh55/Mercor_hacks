import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { analyzeEvidence } from "../lib/analysis.ts";
const load = async (name) =>
  JSON.parse(
    await readFile(
      new URL("../tests/fixtures/" + name, import.meta.url),
      "utf8",
    ),
  );
const observer = await load("internal-observer.json");
const judge = await load("internal-judgment.json");
const ocr = await load("internal-ocr-reread.json");
const brief =
  "The visible company title must be spelled MERCOR HACK DAY. Flag any different company spelling.";
const requirements = [{ id: "R1", text: brief }];
const result = await analyzeEvidence(
  {
    observe: async (focus) => (focus ? ocr : observer),
    judge: async () => judge,
  },
  requirements,
  8,
  false,
);
const video = await readFile(
  new URL("../public/demo/visual-check-fixture.mp4", import.meta.url),
);
const report = {
  id: "internal-agent-spelling-diagnostic",
  videoName: "internal-agent-visual-test.mp4",
  duration: 8,
  createdAt: new Date().toISOString(),
  model: "Internal agent + Tesseract diagnostic replay",
  brief,
  script: "",
  requirements,
  ...result,
  analysisMs: 0,
  tokens: null,
  version: "takecheck-2.0",
  scriptMode: "meaning",
  cacheKey: "",
  referenceNames: [],
  sourceSha256: createHash("sha256").update(video).digest("hex"),
  provenance:
    "Saved internal-agent observations and judgment; independent local Tesseract reread. Not a Gemini request. Original agent inference latency was not benchmarked.",
};
report.passes = report.passes.map((p) => ({
  ...p,
  name: "Saved diagnostic: " + p.name,
  ms: 0,
}));
await writeFile(
  new URL("../public/demo/internal-agent-review.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    source: "internal agent diagnostic replay",
    findings: result.findings.map((f) => ({
      start: f.start,
      end: f.end,
      observed: f.observed,
    })),
    rejected: result.audit.rejected,
    originalModelLatency: "not benchmarked",
  }),
);
