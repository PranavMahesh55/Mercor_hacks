import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { detectMediaSignals, mediaFindings } from "../lib/media-signals.ts";
const load = async (name) =>
  JSON.parse(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
const stress = await load("talking-head-stress-signals.json");
const clean = await load("talking-head-clean-signals.json");

test("actual browser scan detects a controlled freeze and mute in talking-head footage", () => {
  const signals = detectMediaSignals(stress.samples, 12);
  assert.deepEqual(
    signals.map((s) => s.kind),
    ["frozen_presenter", "audio_dropout"],
  );
  assert.ok(signals[0].start >= 5 && signals[0].start <= 5.5);
  assert.ok(signals[0].end >= 7.5 && signals[0].end <= 8);
  assert.ok(signals[1].start >= 9 && signals[1].start <= 9.5);
  assert.equal(signals[1].end, 11.5);
});
test("untouched talking-head clip produces no playback flags", () => {
  assert.deepEqual(detectMediaSignals(clean.samples, 12), []);
});
test("browser measurements are tied to the exact source clips", async () => {
  for (const [name, scan] of [
    ["stress", stress],
    ["clean", clean],
  ]) {
    const bytes = await readFile(
      new URL(`../public/demo/talking-head-${name}.mp4`, import.meta.url),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      scan.sourceSha256,
    );
  }
});
test("a static text card cannot become a frozen-presenter issue without a detected face", () => {
  const samples = stress.samples.map((s) => ({ ...s, face: false }));
  assert.deepEqual(detectMediaSignals(samples, 12), []);
});
test("missing audio is unknown, not evidence of a dropout or audiovisual freeze", () => {
  const samples = stress.samples.map((s) => ({ ...s, db: null }));
  assert.deepEqual(detectMediaSignals(samples, 12), []);
});
test("short still moments below the duration threshold are not freeze flags", () => {
  const samples = stress.samples.map((s) => ({
    ...s,
    motion: s.time >= 5.5 && s.time <= 6 ? 0 : 0.02,
    db: -20,
  }));
  assert.deepEqual(detectMediaSignals(samples, 12), []);
});
test("playback notes do not invent campaign violations or AI-authenticity claims", () => {
  const findings = mediaFindings(stress);
  assert.ok(
    findings.every(
      (f) => f.requirementId === "MEDIA" && f.reviewStatus === "unreviewed",
    ),
  );
  assert.ok(
    findings.every((f) => f.verification.method === "local_media_scan"),
  );
  assert.ok(findings.every((f) => f.explanation.includes("not a claim")));
});
