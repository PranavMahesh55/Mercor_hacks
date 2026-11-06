# Local face detection

BlazeFace short-range float16 model from the official MediaPipe model distribution:
https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite

Runtime files are copied from the locked `@mediapipe/tasks-vision` npm dependency by `scripts/prepare-ocr.mjs`. Inference runs locally on uploaded frames. Face presence is used only to qualify a playback signal; it does not identify a person or estimate emotion or authenticity.
