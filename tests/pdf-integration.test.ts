import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { localProvider } from './helpers/local-provider.js';
import { PdfStore } from '../electron/pdf.js';
import { LibraryStore } from '../electron/library.js';
import { AppService } from '../electron/app-service.js';
import { createDocument } from '../src/learning/document.js';
const helper = resolve('dist-electron/native/swallow-pdf');
const fixture = (name: string) => resolve('tests/fixtures/pdf', name);
const paths: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), 'swallow-native-pdf-')); paths.push(path); return path; }
afterEach(async () => { for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true }); });
describe.skipIf(process.platform !== 'darwin')('실제 macOS PDF 처리와 학습 흐름', () => {
  beforeAll(() => { execFileSync(process.execPath, ['scripts/build-pdf-helper.mjs'], { timeout: 60_000 }); }, 65_000);
  it('본문·도식·답안·노트·재시작을 보존하고 PDF AI는 차단한다', async () => {
    const root = await directory(); const pdf = new PdfStore(join(root, 'pdf'), helper);
    const imported = await pdf.import(fixture('diagram.pdf'), 'Water', new AbortController().signal);
    expect(imported.input.pdf?.pages).toHaveLength(2);
    expect(imported.input.source).toContain('Water moves from reservoir A');
    const asset = join(root, 'pdf', `${imported.input.pdf!.assetId}.pdf`);
    expect(await readFile(asset)).toEqual(await readFile(fixture('diagram.pdf')));
    expect(await pdf.render(imported.input.pdf!.assetId, 1)).toContain('data:image/jpeg;base64,');
    let calls = 0; const provider = localProvider('test-model');
    provider.streamResponse = async () => { calls++; return { text: '{}' }; };
    const library = join(root, 'library.json');
    const service = new AppService(new LibraryStore(library), provider);
    try {
      await service.initialize(); await service.study({ type: 'select-model', model: 'test-model' });
      await service.addDocument(imported.input);
      const id = service.getState().library.activeDocumentId!;
      await expect(service.generate('guide', id, 'unit-0')).rejects.toThrow('PDF');
      expect(calls).toBe(0);
      await service.study({ type: 'save-recall', documentId: id, unitId: 'unit-0', answer: 'A에서 B로 흐른다.' });
      await service.study({ type: 'save-pdf-note', documentId: id, page: 1, note: '화살표 확인' });
    } finally { service.dispose(); }
    const reopened = new LibraryStore(library);
    try {
      const state = await reopened.load();
      expect(state.documents[0]?.recalls['unit-0']?.answer).toBe('A에서 B로 흐른다.');
      expect(state.documents[0]?.pdf?.pages[0]?.note).toBe('화살표 확인');
      expect(state.documents[0]?.source).toBe(imported.input.source);
      expect(await readFile(asset)).toEqual(await readFile(fixture('diagram.pdf')));
    } finally { reopened.close(); }
  }, 30_000);
  it('기존 원본이 변조되어 있으면 다른 페이지를 원본으로 연결하거나 덮어쓰지 않는다', async () => {
    const root = await directory(); const pdf = new PdfStore(root, helper);
    const result = await pdf.import(fixture('diagram.pdf'), 'original', new AbortController().signal);
    const asset = join(root, `${result.input.pdf!.assetId}.pdf`);
    await pdf.render(result.input.pdf!.assetId, 1);
    const changed = await readFile(fixture('scan.pdf')); await writeFile(asset, changed);
    await expect(pdf.render(result.input.pdf!.assetId, 1)).rejects.toThrow('원본');
    await expect(pdf.import(fixture('diagram.pdf'), 'again', new AbortController().signal)).rejects.toThrow('원본');
    expect(await readFile(asset)).toEqual(changed);
  }, 30_000);
  it('긴 PDF의 페이지 위치를 유지하고 마지막 페이지만 렌더링한다', async () => {
    const pdf = new PdfStore(await directory(), helper);
    const result = await pdf.import(fixture('long.pdf'), 'Long', new AbortController().signal);
    const doc = createDocument(result.input);
    expect(doc.pdf?.pages).toHaveLength(30);
    expect(doc.units.length).toBeGreaterThan(30);
    expect(doc.units.at(-1)?.section).toBe('PDF 30쪽');
    expect(await pdf.render(doc.pdf!.assetId, 30)).toContain('data:image/jpeg;base64,');
  }, 30_000);
  it('텍스트 레이어 없는 스캔 PDF를 로컬 OCR로 읽는다', async () => {
    const pdf = new PdfStore(await directory(), helper);
    const result = await pdf.import(fixture('scan.pdf'), 'Scan', new AbortController().signal);
    expect(result.input.pdf?.pages[0]?.method).toBe('ocr');
    expect(result.input.source).toContain('Heat turns water into vapor');
    expect(result.input.source).toContain('수증기');
  }, 30_000);
  it.each([90, 270])('%i도 회전 PDF의 원본 이미지 비율을 보존한다', async (rotation) => {
    const root = await directory();
    const script = join(root, 'rotate.swift');
    const rotated = join(root, 'rotated.pdf');
    await writeFile(script, `import PDFKit
let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
document.page(at: 0)!.rotation = Int(CommandLine.arguments[3])!
assert(document.write(to: URL(fileURLWithPath: CommandLine.arguments[2])))
`);
    execFileSync('/usr/bin/swift', ['-module-cache-path', join(tmpdir(), 'swallow-swift-module-cache'), script, fixture('diagram.pdf'), rotated, String(rotation)], { timeout: 30_000 });
    const pdf = new PdfStore(join(root, 'assets'), helper);
    const result = await pdf.import(rotated, 'Rotated', new AbortController().signal);
    expect(result.input.source).toContain('Water moves from reservoir A');
    const image = await pdf.render(result.input.pdf!.assetId, 1);
    const jpeg = join(root, 'rendered.jpg');
    await writeFile(jpeg, Buffer.from(image.split(',')[1]!, 'base64'));
    const dimensions = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', jpeg], { encoding: 'utf8' });
    expect(dimensions).toMatch(/pixelWidth: 2400\s+pixelHeight: 1800/);
  }, 35_000);
  it('암호화·손상·301페이지 PDF를 거부하고 신규 원본을 정리한다', async () => {
    const root = await directory(); const pdf = new PdfStore(root, helper);
    const broken = join(await directory(), 'broken.pdf'); await writeFile(broken, '%PDF-1.7\nBROKEN');
    for (const path of [fixture('encrypted.pdf'), fixture('too-many-pages.pdf'), broken]) await expect(pdf.import(path, 'bad', new AbortController().signal)).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  }, 30_000);
  it('크기 초과·읽기/저장 실패·취소를 구분하고 기존 원본은 롤백으로 지우지 않는다', async () => {
    const root = await directory(); const pdf = new PdfStore(join(root, 'pdf'), helper);
    const large = join(root, 'large.pdf'); await writeFile(large, Buffer.alloc(40_000_001));
    await expect(pdf.import(large, 'large', new AbortController().signal)).rejects.toThrow('40MB');
    await expect(pdf.import(join(root, 'missing.pdf'), 'missing', new AbortController().signal)).rejects.toThrow('권한');
    const blocked = join(root, 'blocked'); await writeFile(blocked, 'file');
    await expect(new PdfStore(blocked, helper).import(fixture('diagram.pdf'), 'blocked', new AbortController().signal)).rejects.toThrow('저장');
    const controller = new AbortController(); controller.abort();
    await expect(pdf.import(fixture('diagram.pdf'), 'cancelled', controller.signal)).rejects.toThrow();
    const first = await pdf.import(fixture('diagram.pdf'), 'first', new AbortController().signal);
    const duplicate = await pdf.import(fixture('diagram.pdf'), 'duplicate', new AbortController().signal);
    await duplicate.rollback();
    expect((await readdir(join(root, 'pdf'))).length).toBe(1);
    await first.rollback();
    expect(await readdir(join(root, 'pdf'))).toEqual([]);
  }, 30_000);
});
