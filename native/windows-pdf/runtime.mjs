import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
export class PdfFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new PdfFailure(code); };
export const pdfFactoryDirectory = directory => directory.replaceAll('\\', '/').replace(/\/+$/, '') + '/';

/** Require local bundled languages before starting OCR; no cache or CDN fallback. */
export async function ocrLanguages(directory) {
  for (const code of ['kor', 'eng']) {
    const path = join(directory, `${code}.traineddata.gz`);
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size < 100 || info.size > 16_000_000) fail('resources');
      const data = await readFile(path);
      if (data[0] !== 31 || data[1] !== 139) fail('resources');
    } catch { fail('resources'); }
  }
  return ['kor', 'eng'];
}

function image(page, document, longest) {
  const size = page.getViewport({ scale: 1 });
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) fail('pageSize');
  const viewport = page.getViewport({ scale: Math.min(longest / Math.max(size.width, size.height), 4) });
  const width = Math.max(1, Math.floor(viewport.width)), height = Math.max(1, Math.floor(viewport.height));
  if (width * height > 6_000_000) fail('pageSize');
  const result = document.canvasFactory.create(width, height);
  return { ...result, viewport };
}
async function render(page, document, longest, format) {
  const { canvas, context, viewport } = image(page, document, longest);
  try {
    await page.render({ canvasContext: context, viewport, background: 'rgb(255,255,255)' }).promise;
    const bytes = await canvas.encode(format, format === 'jpeg' ? 85 : undefined);
    if (bytes.length > 6_000_000) fail('render');
    return bytes;
  } finally { document.canvasFactory.destroy({ canvas, context }); }
}

export async function processPdf(command, path, pageNumber) {
  if (!['inspect', 'render'].includes(command) || typeof path !== 'string' ||
      (command === 'render' && (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 300))) fail('request');
  let bytes;
  try {
    const info = await stat(path);
    if (!info.isFile() || !info.size) fail('invalid');
    if (info.size > 40_000_000) fail('size');
    bytes = await readFile(path);
    if (bytes.length > 40_000_000) fail('size');
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) fail('invalid');
  } catch (error) { if (error instanceof PdfFailure) throw error; fail('invalid'); }
  let pdf, runtime;
  try {
    runtime = dirname(require.resolve('pdfjs-dist/package.json'));
    pdf = await import(pathToFileURL(join(runtime, 'legacy/build/pdf.mjs')).href);
  } catch { fail('resources'); }
  let task;
  try {
    task = pdf.getDocument({
      data: new Uint8Array(bytes), cMapUrl: pdfFactoryDirectory(join(runtime, 'cmaps')), cMapPacked: true,
      standardFontDataUrl: pdfFactoryDirectory(join(runtime, 'standard_fonts')), wasmUrl: pdfFactoryDirectory(join(runtime, 'wasm')),
      isEvalSupported: false, enableXfa: false, useSystemFonts: false, useWorkerFetch: false,
      isOffscreenCanvasSupported: false, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 24_000_000, verbosity: 0,
    });
  } catch { fail('resources'); }
  let document, ocr;
  try {
    document = await task.promise;
    if (document.numPages < 1 || document.numPages > 300) fail('pages');
    const metadata = await document.getMetadata();
    if (metadata.info?.EncryptFilterName) fail('encrypted');
    if (command === 'render') {
      if (pageNumber > document.numPages) fail('request');
      const page = await document.getPage(pageNumber);
      return `data:image/jpeg;base64,${(await render(page, document, 2400, 'jpeg')).toString('base64')}`;
    }
    const pages = []; let length = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
        if (length + text.length + 100 > 1_000_000) fail('textLimit');
      }
      text = text.trim(); let method = 'text';
      if (!text) {
        if (!ocr) {
          const localData = join(here, 'tessdata');
          const languages = await ocrLanguages(localData);
          const { createWorker, OEM } = require('tesseract.js');
          ocr = await createWorker(languages, OEM.LSTM_ONLY, {
            cacheMethod: 'none', gzip: true,
            langPath: localData,
            workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
            corePath: dirname(require.resolve('tesseract.js-core/package.json')),
            logger: () => {}, errorHandler: () => {},
          });
        }
        try { text = (await ocr.recognize(await render(page, document, 1800, 'png'))).data.text.trim(); }
        catch { fail('ocr'); }
        method = text ? 'ocr' : 'empty';
      }
      length += text.length + 100;
      if (length > 1_000_000) fail('textLimit');
      pages.push({ text, method });
      page.cleanup();
    }
    return pages;
  } catch (error) {
    if (error instanceof PdfFailure) throw error;
    if (error?.name === 'PasswordException') fail('encrypted');
    fail('invalid');
  } finally {
    if (ocr) await ocr.terminate();
    await task.destroy();
  }
}
