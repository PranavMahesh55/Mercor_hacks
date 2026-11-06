import { mkdir, copyFile, readdir } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
await mkdir(path.join(root, "public/ocr/core"), { recursive: true });
await copyFile(
  path.join(root, "node_modules/tesseract.js/dist/worker.min.js"),
  path.join(root, "public/ocr/worker.min.js"),
);
for (const name of await readdir(
  path.join(root, "node_modules/tesseract.js-core"),
))
  if (/\.wasm(\.js)?$/.test(name))
    await copyFile(
      path.join(root, "node_modules/tesseract.js-core", name),
      path.join(root, "public/ocr/core", name),
    );
console.log(
  "Local OCR worker and core prepared. No image data is sent to a hosted OCR service.",
);

await mkdir(path.join(root, "public/vision/wasm"), { recursive: true });
for (const name of await readdir(
  path.join(root, "node_modules/@mediapipe/tasks-vision/wasm"),
))
  await copyFile(
    path.join(root, "node_modules/@mediapipe/tasks-vision/wasm", name),
    path.join(root, "public/vision/wasm", name),
  );
console.log("Local MediaPipe face detector runtime prepared.");
