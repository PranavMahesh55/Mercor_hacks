import { MAX_VIDEO_BYTES } from "@/lib/review";
import { validUploadUrl, validFileName } from "@/lib/video-upload";
export const maxDuration = 60;
const BASE = "https://generativelanguage.googleapis.com";
export async function POST(request: Request) {
  const key = request.headers.get("x-review-key");
  const out = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  if (!key)
    return out(
      { error: "Connect Gemini before uploading for AI review." },
      401,
    );
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(50000)]);
  try {
    if (request.headers.get("x-upload-url")) {
      const url = request.headers.get("x-upload-url")!;
      const offset = Number(request.headers.get("x-upload-offset"));
      if (
        !validUploadUrl(url) ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > MAX_VIDEO_BYTES
      )
        return out({ error: "Invalid upload session." }, 400);
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 1024 * 1024 || !bytes.byteLength)
        return out({ error: "Upload chunk must be at most 1 MB." }, 413);
      const last = request.headers.get("x-upload-final") === "1";
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "x-goog-api-key": key,
          "Content-Type": "application/octet-stream",
          "X-Goog-Upload-Offset": String(offset),
          "X-Goog-Upload-Command": last ? "upload, finalize" : "upload",
        },
        body: bytes,
        signal,
      });
      if (!r.ok)
        return out(
          {
            error: `Google rejected the video upload (HTTP ${r.status}). Retry the upload.`,
          },
          502,
        );
      return last ? out(await r.json()) : out({ ok: true });
    }
    const body = (await request.json()) as {
      action?: string;
      name?: string;
      size?: number;
      type?: string;
    };
    if (body.action === "status" || body.action === "delete") {
      if (!validFileName(body.name ?? ""))
        return out({ error: "Invalid video reference." }, 400);
      const r = await fetch(`${BASE}/v1beta/${body.name}`, {
        method: body.action === "delete" ? "DELETE" : "GET",
        headers: { "x-goog-api-key": key },
        signal,
      });
      if (!r.ok)
        return out(
          {
            error: `Google could not read the uploaded video (HTTP ${r.status}).`,
          },
          502,
        );
      return body.action === "delete" ? out({ ok: true }) : out(await r.json());
    }
    if (
      !Number.isSafeInteger(body.size) ||
      !body.size ||
      body.size > MAX_VIDEO_BYTES ||
      !["video/mp4", "video/webm", "video/quicktime"].includes(body.type ?? "")
    )
      return out({ error: "Use a supported video under 64 MB." }, 400);
    const r = await fetch(`${BASE}/upload/v1beta/files`, {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(body.size),
        "X-Goog-Upload-Header-Content-Type": body.type!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: { display_name: (body.name ?? "ugc-video").slice(0, 150) },
      }),
      signal,
    });
    const url = r.headers.get("x-goog-upload-url");
    if (!r.ok || !url || !validUploadUrl(url))
      return out(
        {
          error: `Google could not start video upload (HTTP ${r.status}). Check API permissions.`,
        },
        502,
      );
    return out({ uploadUrl: url });
  } catch {
    return out(
      { error: "Video upload interrupted. Retry with the same clip." },
      502,
    );
  }
}
