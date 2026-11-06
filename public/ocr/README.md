English fast language data from the official Tesseract tessdata_fast repository:
https://github.com/tesseract-ocr/tessdata_fast

Apache License 2.0. See LICENSE.

Worker/core assets are copied from the locked tesseract.js and tesseract.js-core npm packages by scripts/prepare-ocr.mjs. These files are generated, not separate application code. All OCR processing runs in the user's browser. The app does not need a third-party CDN to load OCR runtime assets.
