import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { crossCheckPlayback } from "../lib/playback-grounding.ts";
const actual = JSON.parse(
  await readFile(
    new URL("./fixtures/gemini-playback-conflict.json", import.meta.url),
    "utf8",
  ),
);
test("actual Gemini positive delivery claim is downgraded when local playback evidence conflicts", () => {
  const result = crossCheckPlayback(structuredClone(actual));
  assert.equal(result.checks[0].status, "cannot_verify");
  assert.ok(result.transcript.some((s) => s.clear === false));
  assert.match(result.limitations.join(" "), /captions are not proof/);
});
test("playback uncertainty does not override unrelated supported brand spelling", () => {
  const input = {
    ...structuredClone(actual),
    requirements: [{ id: "R1", text: "The visible title must say Mercor." }],
    checks: [
      {
        requirementId: "R1",
        status: "pass",
        detail: "Visible title spells Mercor.",
      },
    ],
  };
  assert.equal(crossCheckPlayback(input).checks[0].status, "pass");
});
test("the cross-check preserves original model quotes and does not invent speech", () => {
  const result = crossCheckPlayback(structuredClone(actual));
  assert.deepEqual(
    result.transcript.map((s) => s.text),
    actual.transcript.map((s) => s.text),
  );
  assert.deepEqual(result.mediaScan, actual.mediaScan);
  assert.deepEqual(crossCheckPlayback(result), result);
});
