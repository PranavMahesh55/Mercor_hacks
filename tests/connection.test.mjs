import test from "node:test";
import assert from "node:assert/strict";
import {
  usableModels,
  probeCandidates,
  classifyFailure,
  describeFailure,
} from "../lib/gemini-connection.ts";
test("connection probes newer catalog-listed models before older defaults", () => {
  const models = usableModels(
    [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash-image",
      "gemini-3.6-flash-tts",
    ].map((id) => ({
      name: `models/${id}`,
      supportedGenerationMethods: ["generateContent"],
    })),
  );
  assert.deepEqual(
    probeCandidates(models).map((m) => m.id),
    [
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ],
  );
});
test("model choices are discovered, deduplicated and bounded", () => {
  assert.deepEqual(
    probeCandidates([
      { id: "gemini-5-flash-preview", name: "preview" },
      { id: "gemini-4-pro", name: "pro" },
      { id: "gemini-4-pro", name: "pro" },
    ]).map((m) => m.id),
    ["gemini-4-pro", "gemini-5-flash-preview"],
  );
});
test("zero quota differs from a temporary rate limit without leaking raw errors", () => {
  const f = classifyFailure("gemini-3.5-flash-lite", 429, {
    error: {
      message: "SECRET-KEY limit: 0",
      details: [{ violations: [{ quotaValue: "0" }] }, { retryDelay: "12.8s" }],
    },
  });
  assert.equal(f.reason, "quota_zero");
  assert.equal(f.retrySeconds, 13);
  assert.ok(!JSON.stringify(f).includes("SECRET"));
  assert.ok(!describeFailure(f).includes("SECRET"));
});
test("daily quota, permission and model availability have distinct diagnoses", () => {
  assert.equal(
    classifyFailure("m", 429, {
      error: {
        details: [{ violations: [{ quotaId: "GenerateRequestsPerDay" }] }],
      },
    }).reason,
    "quota_daily",
  );
  assert.equal(classifyFailure("m", 403, {}).reason, "permission");
  assert.equal(classifyFailure("m", 404, {}).reason, "model_unavailable");
  assert.equal(classifyFailure("m", 400, {}).reason, "request_rejected");
});
