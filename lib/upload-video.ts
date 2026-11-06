type UploadedFile = {name:string;uri:string;state:string};

export async function uploadVideo(
  blob: Blob,
  name: string,
  type: string,
  key: string,
  onProgress: (s: string) => void,
  signal: AbortSignal,
) {
  const call = async <T,>(body: BodyInit, headers: Record<string, string>): Promise<T> => {
    const r = await fetch("/api/video-upload", {
      method: "POST",
      headers: { "x-review-key": key, ...headers },
      body,
      signal,
    });
    const data = await r.json() as {error?:string};
    if (!r.ok) throw new Error(data.error ?? "Video upload failed.");
    return data as T;
  };
  onProgress("Preparing secure video upload");
  const start = await call<{uploadUrl:string}>(JSON.stringify({ name, type, size: blob.size }), {
    "Content-Type": "application/json",
  });
  const chunk = 1024 * 1024;
  let uploaded: { name: string; uri: string; state: string } | undefined;
  for (let offset = 0; offset < blob.size; offset += chunk) {
    onProgress(`Uploading video · ${Math.round((offset / blob.size) * 100)}%`);
    const last = offset + chunk >= blob.size;
    const data = await call<{file?:UploadedFile}>(blob.slice(offset, offset + chunk), {
      "x-upload-url": start.uploadUrl,
      "x-upload-offset": String(offset),
      "x-upload-final": last ? "1" : "0",
    });
    if (last) uploaded = data.file;
  }
  if (!uploaded?.name)
    throw new Error("Google did not return an uploaded video reference.");
  let current: UploadedFile = uploaded;
  const started = Date.now();
  while (current.state === "PROCESSING") {
    if (Date.now() - started > 90000)
      throw new Error(
        "Google is still preparing the video. Try again shortly.",
      );
    onProgress("Google is preparing the video for review");
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 1500);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new DOMException("Cancelled", "AbortError"));
        },
        { once: true },
      );
    });
    current = await call<UploadedFile>(
      JSON.stringify({ action: "status", name: current.name }),
      { "Content-Type": "application/json" },
    );
  }
  if (current.state !== "ACTIVE" || !current.uri)
    throw new Error("Google could not prepare this video. Try an H.264 MP4.");
  return current;
}
