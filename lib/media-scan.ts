import {
  detectMediaSignals,
  type MediaSample,
  type MediaScan,
} from "./media-signals";

function waitEvent(
  target: HTMLVideoElement,
  event: "loadeddata" | "seeked",
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, ok);
      target.removeEventListener("error", bad);
      signal?.removeEventListener("abort", abort);
    };
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error("Video decoding failed during motion check."));
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Motion check timed out."));
    }, 10000);
    target.addEventListener(event, ok, { once: true });
    target.addEventListener("error", bad, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function scanMedia(
  blob: Blob,
  onProgress?: (text: string) => void,
  signal?: AbortSignal,
): Promise<MediaScan> {
  const started = performance.now();
  const limitations = [
    "Checks sampled at 4 fps can miss short events. Face detection is not identity, emotion, authenticity or lip-sync verification.",
    "Audio energy is not speech recognition. Intentional still shots and pauses can resemble defects; confirm in the player.",
  ];
  const { FaceDetector, FilesetResolver } =
    await import("@mediapipe/tasks-vision");
  onProgress?.("Loading the local face and motion check");
  const files = await FilesetResolver.forVisionTasks("/vision/wasm");
  const detector = await FaceDetector.createFromOptions(files, {
    baseOptions: {
      modelAssetPath: "/vision/blaze_face_short_range.tflite",
      delegate: "CPU",
    },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.65,
  });
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  const url = URL.createObjectURL(blob);
  let audio: AudioBuffer | null = null;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  try {
    const loaded = waitEvent(video, "loadeddata", signal);
    video.src = url;
    await loaded;
    if (video.duration > 65)
      throw new Error("Motion checks support clips up to 60 seconds.");
    onProgress?.("Decoding the audio track locally");
    const context = new AudioContext();
    try {
      audio = await context.decodeAudioData(await blob.arrayBuffer());
    } catch {
      limitations.push(
        "The browser could not decode an audio track. Audio dropout and audio/visual freeze checks were not completed.",
      );
    } finally {
      await context.close();
    }
    const samples: MediaSample[] = [];
    let previous: Uint8ClampedArray | null = null;
    for (let i = 0; i < Math.ceil(video.duration * 4); i++) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (performance.now() - started > 80000)
        throw new Error(
          "Motion check exceeded its time budget. Try a shorter video.",
        );
      const time = Math.min(i / 4, video.duration - 0.02);
      if (Math.abs(video.currentTime - time) > 0.01) {
        const seek = waitEvent(video, "seeked", signal);
        video.currentTime = time;
        await seek;
      }
      const result = detector.detectForVideo(video, i * 250);
      const box = result.detections[0]?.boundingBox;
      // Use the same fixed central crop for frame comparison. Following a jittering
      // detector box could manufacture motion in an otherwise frozen image.
      const sw = video.videoWidth * 0.8,
        sh = Math.min(video.videoHeight * 0.65, video.videoWidth * 1.2);
      ctx.drawImage(video, video.videoWidth * 0.1, 0, sw, sh, 0, 0, 64, 64);
      const pixels = ctx.getImageData(0, 0, 64, 64).data;
      let motion: number | null = null;
      if (previous) {
        let sum = 0;
        for (let p = 0; p < pixels.length; p += 4)
          sum +=
            Math.abs(pixels[p] - previous[p]) +
            Math.abs(pixels[p + 1] - previous[p + 1]) +
            Math.abs(pixels[p + 2] - previous[p + 2]);
        motion = sum / (64 * 64 * 3 * 255);
      }
      previous = new Uint8ClampedArray(pixels);
      let db: number | null = null;
      if (audio) {
        let sum = 0,
          count = 0;
        const a = Math.floor(time * audio.sampleRate),
          b = Math.min(
            audio.length,
            Math.floor((time + 0.25) * audio.sampleRate),
          );
        for (let ch = 0; ch < audio.numberOfChannels; ch++) {
          const data = audio.getChannelData(ch);
          for (let p = a; p < b; p++) {
            sum += data[p] * data[p];
            count++;
          }
        }
        db = count
          ? 20 * Math.log10(Math.max(1e-8, Math.sqrt(sum / count)))
          : -160;
      }
      samples.push({ time, face: !!box, motion, db });
      if (i % 8 === 0) {
        onProgress?.(
          `Checking picture and audio · ${Math.round(time)} / ${Math.round(video.duration)}s`,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return {
      samples,
      signals: detectMediaSignals(samples, video.duration),
      fps: 4,
      ms: Math.round(performance.now() - started),
      limitations,
    };
  } finally {
    detector.close();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
