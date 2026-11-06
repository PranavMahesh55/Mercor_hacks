export type CatalogModel = {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
};
export type GeminiModel = { id: string; name: string };
export type ProbeFailure = {
  model: string;
  status: number;
  reason:
    | "quota_zero"
    | "quota_daily"
    | "rate_limit"
    | "permission"
    | "model_unavailable"
    | "request_rejected"
    | "unavailable"
    | "no_output";
  retrySeconds?: number;
};
export function usableModels(catalog: CatalogModel[]): GeminiModel[] {
  return catalog
    .filter(
      (m) =>
        m.supportedGenerationMethods?.includes("generateContent") &&
        /^models\/gemini-/.test(m.name) &&
        !/image|tts|robotics|embedding|live|computer-use|research|agent|audio|custom|tuned/i.test(
          m.name,
        ),
    )
    .map((m) => ({
      id: m.name.slice(7),
      name: m.displayName ?? m.name.slice(7),
    }));
}
export function probeCandidates(models: GeminiModel[]): GeminiModel[] {
  const sorted = [...models].sort((a, b) =>
    b.id.localeCompare(a.id, undefined, { numeric: true }),
  );
  const stable = sorted.filter(
    (m) => !/-preview|-exp|-latest|experimental/i.test(m.id),
  );
  const flash = stable.filter((m) => /flash/.test(m.id) && !/lite/.test(m.id));
  const lite = stable.filter((m) => /flash/.test(m.id) && /lite/.test(m.id));
  const ordered = [
    flash[0],
    lite[0],
    flash[1],
    lite[1],
    ...stable,
    ...sorted,
  ].filter((m): m is GeminiModel => !!m);
  return [...new Map(ordered.map((m) => [m.id, m])).values()].slice(0, 4);
}
// Whitelist diagnostic fields; never expose raw errors, project IDs, URLs or keys.
export function classifyFailure(
  model: string,
  status: number,
  body: unknown,
): ProbeFailure {
  const root =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const err =
    root.error && typeof root.error === "object"
      ? (root.error as Record<string, unknown>)
      : {};
  const message = typeof err.message === "string" ? err.message : "";
  const details: Record<string, unknown>[] = Array.isArray(err.details)
    ? err.details.filter((d) => d && typeof d === "object")
    : [];
  const violations = details.flatMap((d) =>
    Array.isArray(d.violations) ? d.violations : [],
  );
  const zero =
    violations.some((v) => String(v.quotaValue) === "0") ||
    /limit\s*:\s*0\b/i.test(message);
  const daily = violations.some((v) =>
    /perday|per.day|daily/i.test(
      String(v.quotaId ?? "") + String(v.quotaMetric ?? ""),
    ),
  );
  const retry = details.find((d) => typeof d.retryDelay === "string");
  const retrySeconds = retry
    ? Number.parseFloat(String(retry.retryDelay))
    : undefined;
  return {
    model,
    status,
    reason:
      status === 429
        ? zero
          ? "quota_zero"
          : daily
            ? "quota_daily"
            : "rate_limit"
        : status === 401 || status === 403
          ? "permission"
          : status === 404
            ? "model_unavailable"
            : status === 400
              ? "request_rejected"
              : "unavailable",
    ...(Number.isFinite(retrySeconds)
      ? { retrySeconds: Math.ceil(retrySeconds!) }
      : {}),
  };
}
export function describeFailure(f: ProbeFailure) {
  const reason = {
    quota_zero: "Google reports zero available quota",
    quota_daily: "daily quota reached",
    rate_limit: "rate limit or quota reached",
    permission: "key or project permission denied",
    model_unavailable: "model unavailable for this key",
    request_rejected: "Google rejected the test request",
    unavailable: "service or network request failed",
    no_output: "Google returned no usable reply",
  }[f.reason];
  return `${f.model}: ${reason} (HTTP ${f.status})${f.retrySeconds ? `; retry after ${f.retrySeconds}s` : ""}`;
}
