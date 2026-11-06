import { createGoogle } from "@ai-sdk/google";
import { generateText, APICallError } from "ai";

export async function POST(request: Request) {
  const key = request.headers.get("x-review-key");
  if (!key || key.length < 15)
    return Response.json(
      { error: "Enter a valid Gemini API key." },
      { status: 400 },
    );
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      {
        headers: { "x-goog-api-key": key },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      return Response.json(
        {
          error:
            response.status === 429
              ? "Google is rate-limiting model discovery. Try again shortly."
              : "Google could not validate this key. Check its API permissions.",
        },
        { status: response.status === 429 ? 429 : 401 },
      );
    const data = (await response.json()) as {
      models?: {
        name: string;
        displayName: string;
        supportedGenerationMethods?: string[];
      }[];
    };
    const models = (data.models ?? [])
      .filter(
        (m) =>
          m.supportedGenerationMethods?.includes("generateContent") &&
          m.name.includes("gemini") &&
          !/image|tts|robotics|embedding|live|computer-use/.test(m.name),
      )
      .map((m) => ({ id: m.name.replace("models/", ""), name: m.displayName }));
    // Discover first, then prove generation quota with a tiny real request.
    // These candidate IDs are used only if the account's live catalog lists them.
    const choices = [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.5-flash-lite",
    ]
      .map((id) => models.find((m) => m.id === id))
      .filter((m): m is { id: string; name: string } => !!m);
    if (!choices.length) {
      const stable = models
        .filter((m) => /^gemini-[0-9.]+-flash$/.test(m.id))
        .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
      choices.push(...stable.slice(0, 2));
    }
    if (!choices.length)
      return Response.json(
        { error: "No supported Flash model was found for this key." },
        { status: 400 },
      );
    const google = createGoogle({ apiKey: key });
    let lastStatus = 502;
    for (const candidate of choices.slice(0, 2)) {
      try {
        await generateText({
          model: google(candidate.id),
          prompt: "Reply with the word OK.",
          maxOutputTokens: 16,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(20000),
        });
        return Response.json(
          { models, preferredModel: candidate.id, quotaVerified: true },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (error) {
        lastStatus = APICallError.isInstance(error)
          ? (error.statusCode ?? 502)
          : 502;
        if (![429, 503, 404].includes(lastStatus)) break;
      }
    }
    return Response.json(
      {
        error:
          lastStatus === 429
            ? "Your key can list models, but Google rejected test generation on the available Flash models because of quota. Check the project’s API quota or connect another key. A ChatGPT/Gemini website subscription does not provide API quota."
            : "The key could list models but could not complete a test generation. Check model permissions and retry.",
      },
      { status: lastStatus === 429 ? 429 : 502 },
    );
  } catch {
    return Response.json(
      { error: "Could not reach Gemini. Check your connection and try again." },
      { status: 502 },
    );
  }
}
