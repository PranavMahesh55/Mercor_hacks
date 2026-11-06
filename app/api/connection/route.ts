import {
  classifyFailure,
  describeFailure,
  probeCandidates,
  usableModels,
  type CatalogModel,
  type ProbeFailure,
} from "@/lib/gemini-connection";
const BASE = "https://generativelanguage.googleapis.com/v1beta";
export async function POST(request: Request) {
  const key = request.headers.get("x-review-key")?.trim();
  const headers = { "Cache-Control": "no-store" };
  if (!key || key.length < 15)
    return Response.json(
      { error: "Enter a valid Gemini API key." },
      { status: 400, headers },
    );
  const deadline = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(55000),
  ]);
  try {
    const catalog = await fetch(`${BASE}/models?pageSize=1000`, {
      headers: { "x-goog-api-key": key },
      signal: deadline,
    });
    const catalogBody = await catalog.json();
    if (!catalog.ok) {
      const failure = classifyFailure(
        "Model discovery",
        catalog.status,
        catalogBody,
      );
      return Response.json(
        { error: describeFailure(failure), diagnostics: [failure] },
        { status: catalog.status === 429 ? 429 : 401, headers },
      );
    }
    const models = usableModels(
      (catalogBody as { models?: CatalogModel[] }).models ?? [],
    );
    const choices = probeCandidates(models);
    if (!choices.length)
      return Response.json(
        { error: "This key did not list a supported Gemini generation model." },
        { status: 400, headers },
      );
    const diagnostics: ProbeFailure[] = [];
    for (const choice of choices) {
      if (deadline.aborted) break;
      try {
        // Raw REST separates provider quota/permission failures from SDK parsing.
        // A 16-token budget can be exhausted before a reasoning model replies.
        const response = await fetch(
          `${BASE}/models/${choice.id}:generateContent`,
          {
            method: "POST",
            headers: {
              "x-goog-api-key": key,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [
                { role: "user", parts: [{ text: "Reply with the word OK." }] },
              ],
              generationConfig: { maxOutputTokens: 512 },
            }),
            signal: AbortSignal.any([deadline, AbortSignal.timeout(12000)]),
          },
        );
        const body = (await response.json()) as {
          candidates?: {
            content?: { parts?: { text?: string; thought?: boolean }[] };
          }[];
        };
        if (!response.ok) {
          const failure = classifyFailure(choice.id, response.status, body);
          diagnostics.push(failure);
          if (failure.reason === "permission") break;
          continue;
        }
        const text = body.candidates
          ?.flatMap((c) => c.content?.parts ?? [])
          .filter((p) => !p.thought)
          .map((p) => p.text ?? "")
          .join("")
          .trim();
        if (!text) {
          diagnostics.push({
            model: choice.id,
            status: 200,
            reason: "no_output",
          });
          continue;
        }
        return Response.json(
          {
            models,
            preferredModel: choice.id,
            quotaVerified: true,
            diagnostics,
          },
          { headers },
        );
      } catch {
        if (request.signal.aborted)
          throw new DOMException("Cancelled", "AbortError");
        diagnostics.push({
          model: choice.id,
          status: 504,
          reason: "unavailable",
        });
      }
    }
    const quota = diagnostics.some((d) => d.status === 429);
    return Response.json(
      {
        error: `Gemini could list models, but generation failed. ${diagnostics.map(describeFailure).join(". ")}. ${quota ? "Check this API project's active limits in Google AI Studio. Another key in the same project does not reset project quota." : "The generation errors above identify the remaining connection problem."}`,
        diagnostics,
      },
      { status: quota ? 429 : 502, headers },
    );
  } catch {
    return Response.json(
      {
        error:
          "Gemini model discovery could not finish. Check the network and retry.",
      },
      { status: 502, headers },
    );
  }
}
