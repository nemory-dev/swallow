import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, link, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_PDF_BYTES, MAX_PDF_PAGES, pdfSource } from '../src/learning/pdf.js';
import type { AddDocumentInput, PdfPage } from '../src/shared/types.js';

export function runPdfHelper(executable: string, args: string[], signal?: AbortSignal, timeout = 120_000, maxBytes = 10_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('PDF 작업을 취소했습니다.')); return; }
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let bytes = 0; const chunks: Buffer[] = []; let stderr = ''; let finished = false;
    const finish = (error?: Error, value?: unknown) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) { child.kill('SIGKILL'); reject(error); } else resolve(value);
    };
    const abort = () => finish(new Error('PDF 작업을 취소했습니다.'));
    const timer = setTimeout(() => finish(new Error('PDF 처리 시간이 초과되었습니다. 파일을 작은 단위로 나누어 다시 시도하세요.')), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > maxBytes) finish(new Error('PDF 처리 결과가 제한을 초과했습니다.')); else chunks.push(chunk); });
    child.stderr.on('data', chunk => { if (stderr.length < 2000) stderr += String(chunk).slice(0, 2000 - stderr.length); });
    child.on('error', () => finish(new Error('PDF 도구를 실행하지 못했습니다. macOS에서 npm run build를 실행하고 파일 권한을 확인하세요.')));
    child.on('close', code => {
      if (finished) return;
      if (code !== 0) { finish(new Error(/[가-힣]/.test(stderr) ? stderr.slice(0, 400) : 'PDF 처리에 실패했습니다. 파일 손상과 권한을 확인하세요.')); return; }
      try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(new Error('PDF 처리 결과를 읽을 수 없습니다.')); }
    });
  });
}
async function readPdfBytes(path: string, signal?: AbortSignal): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('PDF 일반 파일을 선택하세요.');
    if (info.size > MAX_PDF_BYTES) throw new Error('PDF 파일은 40MB 이내로 선택해 주세요.');
    const chunks: Buffer[] = []; let size = 0;
    while (true) {
      signal?.throwIfAborted();
      const chunk = Buffer.allocUnsafe(Math.min(1_000_000, MAX_PDF_BYTES + 1 - size));
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_PDF_BYTES) throw new Error('PDF 파일은 40MB 이내로 선택해 주세요.');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, size);
  } finally { await file.close(); }
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function verifyAsset(path: string, assetId: string, signal?: AbortSignal) {
  try {
    if (hash(await readPdfBytes(path, signal)) !== assetId) throw new Error('mismatch');
  } catch {
    if (signal?.aborted) throw new Error('PDF 작업을 취소했습니다.');
    throw new Error('보관한 PDF 원본이 없거나 변경되었습니다. library.json과 pdf 폴더를 함께 백업한 뒤 원본을 확인하세요.');
  }
}
export class PdfStore {
  private rendering: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private readonly cache = new Map<string, string>();
  constructor(private readonly directory: string, private readonly executable: string) {}
  private path(assetId: string) {
    if (!/^[a-f0-9]{64}$/.test(assetId)) throw new Error('PDF 원본 ID가 잘못되었습니다.');
    return join(this.directory, `${assetId}.pdf`);
  }
  async import(path: string, title: string, signal: AbortSignal): Promise<{ input: AddDocumentInput; rollback: () => Promise<void> }> {
    signal.throwIfAborted();
    let bytes: Buffer;
    try {
      bytes = await readPdfBytes(path, signal);
    } catch (error) {
      if (error instanceof Error && /[가-힣]/.test(error.message)) throw error;
      throw new Error('PDF 파일을 읽을 수 없습니다. 파일 권한을 확인하세요.');
    }
    if (bytes.length > MAX_PDF_BYTES || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('올바른 40MB 이내 PDF 파일을 선택하세요.');
    const assetId = hash(bytes);
    const destination = this.path(assetId);
    let created = false;
    const temporary = join(this.directory, `${assetId}.${randomUUID()}.tmp`);
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      try {
        await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
        try { await link(temporary, destination); created = true; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          await verifyAsset(destination, assetId, signal);
        }
      } finally { await rm(temporary, { force: true }); }
    } catch (error) {
      if (created) {
        try { await rm(destination, { force: true }); }
        catch { throw new Error('PDF 저장에 실패했고 새 원본을 정리하지 못했습니다. pdf 폴더의 권한과 남은 파일을 확인하세요.'); }
      }
      if (error instanceof Error && error.message.includes('보관한 PDF')) throw error;
      throw new Error('PDF 원본을 저장하지 못했습니다. 저장 폴더 권한과 디스크 여유 공간을 확인하세요.');
    }
    const rollback = async () => {
      if (!created) return;
      try { await rm(destination, { force: true }); }
      catch { throw new Error('PDF 가져오기에 실패했고 새 원본 파일을 정리하지 못했습니다. pdf 폴더의 권한과 남은 파일을 확인하세요.'); }
    };
    try {
      signal.throwIfAborted();
      const raw = await runPdfHelper(this.executable, ['inspect', destination], signal);
      if (!Array.isArray(raw) || !raw.length || raw.length > MAX_PDF_PAGES || raw.some(p => !p || typeof p.text !== 'string' || !['text', 'ocr', 'empty'].includes(p.method))) throw new Error('PDF 추출 결과가 잘못되었습니다.');
      const result = pdfSource(raw as { text: string; method: PdfPage['method'] }[]);
      signal.throwIfAborted();
      return { input: { title, goal: '', source: result.source, pdf: { assetId, pages: result.pages } }, rollback };
    } catch (error) {
      await rollback();
      if (signal.aborted) throw new Error('PDF 작업을 취소했습니다.');
      throw error;
    }
  }
  render(assetId: string, page: number, signal?: AbortSignal): Promise<string> {
    if (!Number.isInteger(page) || page < 1 || page > MAX_PDF_PAGES) return Promise.reject(new Error('PDF 페이지가 잘못되었습니다.'));
    const path = this.path(assetId);
    if (signal?.aborted) return Promise.reject(new Error('PDF 작업을 취소했습니다.'));
    const key = `${assetId}:${page}`;
    if (this.pending >= 3) return Promise.reject(new Error('PDF 페이지를 여는 중입니다. 잠시 뒤 다시 시도하세요.'));
    this.pending++;
    const operation = this.rendering.then(async () => {
      if (signal?.aborted) throw new Error('PDF 작업을 취소했습니다.');
      await verifyAsset(path, assetId, signal);
      const cached = this.cache.get(key);
      if (cached) return cached;
      const image = await runPdfHelper(this.executable, ['render', path, String(page)], signal, 20_000);
      if (typeof image !== 'string' || !image.startsWith('data:image/jpeg;base64,')) throw new Error('PDF 이미지를 읽을 수 없습니다.');
      this.cache.set(key, image);
      while (this.cache.size > 2) this.cache.delete(this.cache.keys().next().value!);
      return image;
    }).finally(() => { this.pending--; });
    this.rendering = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
