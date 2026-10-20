import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Prepare build resources; the app never downloads or caches OCR data at runtime. */
export async function prepareWindowsPdf(root) {
  const destination = join(root, 'dist-electron/native/pdf-runtime');
  await mkdir(join(destination, 'tessdata'), { recursive: true });
  for (const name of ['worker.mjs', 'runtime.mjs']) await copyFile(join(root, 'native/windows-pdf', name), join(destination, name));
  for (const lang of ['kor', 'eng']) {
    await copyFile(join(root, 'node_modules/@tesseract.js-data', lang, '4.0.0_best_int', `${lang}.traineddata.gz`), join(destination, 'tessdata', `${lang}.traineddata.gz`));
  }
  return destination;
}
