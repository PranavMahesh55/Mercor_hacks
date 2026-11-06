import type { Finding } from "./review";
function normalized(t: string) {
  return t
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function ocrSupportsQuote(text: string, quote: string) {
  const q = normalized(quote);
  return q.length >= 2 && ` ${normalized(text)} `.includes(` ${q} `);
}
function bounded<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("OCR operation timed out."));
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    promise.then(
      (value) => {
        finish();
        resolve(value);
      },
      (error) => {
        finish();
        reject(error);
      },
    );
  });
}
export async function verifyTextWithOcr(
  findings: Finding[],
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
) {
  const eligible = findings.filter(
    (f) =>
      f.frame &&
      f.evidenceType !== "speech" &&
      ["brand", "captions"].includes(f.category),
  );
  if (!eligible.length)
    return { findings, checked: 0, supported: 0, limitations: [] as string[] };
  const started = performance.now();
  const { createWorker } = await import("tesseract.js");
  onProgress?.("Loading an independent text reader");
  const pending = createWorker("eng", 1, {
    workerPath: new URL("/ocr/worker.min.js", location.origin).href,
    corePath: new URL("/ocr/core", location.origin).href,
    langPath: new URL("/ocr", location.origin).href,
    gzip: false,
    workerBlobURL: false,
  });
  const worker = await bounded(pending, 15000, signal).catch((error) => {
    void pending.then((w) => w.terminate()).catch(() => {});
    throw error;
  });
  let checked = 0,
    supported = 0;
  try {
    const output: Finding[] = [];
    for (const f of findings) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (!eligible.includes(f)) {
        output.push(f);
        continue;
      }
      if (performance.now() - started > 30000) {
        output.push({
          ...f,
          verification: {
            method: "tesseract_ocr",
            status: "unconfirmed",
            detail:
              "The OCR time budget was reached. This finding needs manual verification.",
          },
        });
        continue;
      }
      onProgress?.(
        `Checking visible text independently · ${checked + 1}/${eligible.length}`,
      );
      const samples = f.evidenceFrames?.length
        ? f.evidenceFrames
        : [{ time: f.start, image: f.frame! }];
      let allText = "";
      let match: { time: number; image: string } | undefined;
      let confidence = 0;
      for (const sample of samples.slice(0, 3)) {
        const { data } = await bounded(
          worker.recognize(sample.image),
          8000,
          signal,
        );
        allText += data.text + "\n";
        confidence = Math.max(confidence, data.confidence);
        if (
          data.confidence >= 45 &&
          ocrSupportsQuote(data.text, f.evidenceQuote)
        ) {
          match = sample;
          break;
        }
      }
      checked++;
      if (match) {
        supported++;
        output.push({
          ...f,
          frame: match.image,
          frameTime: match.time,
          verification: {
            method: "tesseract_ocr",
            status: "supported",
            detail:
              "A separate OCR engine reproduced the quoted visible text in an actual extracted frame. This verifies the text observation, not the whole judgment.",
            ocrText: allText.trim(),
          },
        });
      } else
        output.push({
          ...f,
          verification: {
            method: "tesseract_ocr",
            status: "unconfirmed",
            detail:
              confidence >= 45
                ? "The independent text reader did not reproduce the quoted text. Inspect the source before accepting this issue."
                : "The independent text reader could not read this region reliably. Manual review is required.",
            ocrText: allText.trim(),
          },
        });
    }
    return {
      findings: output,
      checked,
      supported,
      limitations:
        supported < eligible.length
          ? [
              "Some visual quotes were not independently confirmed by OCR. They remain human-review candidates.",
            ]
          : [],
    };
  } finally {
    await worker.terminate();
  }
}
