import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppService } from '../electron/app-service.js';
import { LibraryStore } from '../electron/library.js';
import { createDocument, emptyLibrary } from '../src/learning/document.js';
import { pdfSource } from '../src/learning/pdf.js';
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'swallow-local-only-'));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
describe('구독 없는 앱과 기존 데이터 보존', () => {
  it('계정 클라이언트 없이 초기화하고 원문·답안·노트를 저장한다', async () => {
    const path = await root();
    const service = new AppService(new LibraryStore(join(path, 'library.json')));
    cleanups.push(() => service.dispose());
    await service.initialize();
    expect(service.getState().models).toEqual([]);
    await service.addDocument({ title: '자료', source: '기억에서 꺼내 확인합니다.', goal: '' });
    const id = service.getState().library.activeDocumentId!;
    await service.studySession({ type: 'start', documentId: id });
    await expect(service.explainStudy(id, 'brief')).rejects.toThrow();
    await service.studySession({ type: 'step', documentId: id, step: 'check' });
    await service.studySession({ type: 'answer', documentId: id, answer: '원문을 이해했어요.', unknown: false });
    await service.studySession({ type: 'step', documentId: id, step: 'note' });
    const workspace = await service.saveStudyNote(id);
    expect(workspace.notes[0]?.summaryOrigin).toBe('source');
    expect(workspace.notes[0]?.userAnswer).toBe('원문을 이해했어요.');
  });
  it('이전 구독 선택·완성 결과·PDF·legacy JSON·인증·백업을 보존한다', async () => {
    const path = await root();
    const page = pdfSource([{ text: '기존 PDF 본문입니다.', method: 'text' }]);
    const doc = createDocument({ title: '기존 자료', source: page.source, goal: '보존', pdf: { assetId: 'a'.repeat(64), pages: page.pages } }, { id: 'legacy' });
    doc.guides['unit-0'] = { model: 'old-subscription-model', guide: { overview: '과거 완성 설명', keyPoints: [{ title: '본문', explanation: '보존', quote: '기존 PDF 본문입니다.' }], question: '무엇을 읽었나요?', visualEvidence: [{ page: 1, description: '기존 페이지', uncertainty: '없음' }] } };
    doc.recalls['unit-0'] = { answer: '기존 답변', savedAt: '2026-10-01T00:00:00.000Z', rating: 'good', reviewAt: '2026-11-01T00:00:00.000Z' };
    // Seed SQLite without migration so the synthetic PDF does not need a matching content hash.
    const store = new LibraryStore(join(path, 'library.json')); await store.load();
    const before = { ...emptyLibrary(), documents: [doc], activeDocumentId: doc.id, selectedModel: 'old-subscription-model' };
    await store.update(() => structuredClone(before)); store.close();
    const sentinels = { 'library.json': JSON.stringify(before), 'pdf/original.pdf': 'SYNTHETIC_PDF', 'backups/original.json.gz': 'SYNTHETIC_BACKUP', 'chatgpt/chatgpt-auth.json': 'SYNTHETIC_AUTH_NOT_REAL' };
    for (const [name, body] of Object.entries(sentinels)) { await mkdir(join(path, name, '..'), { recursive: true }); await writeFile(join(path, name), body); }
    const reopened = new LibraryStore(join(path, 'library.json'));
    const service = new AppService(reopened); cleanups.push(() => service.dispose());
    await service.initialize();
    expect(reopened.exportLibrary()).toEqual(before);
    expect(service.getState().library.selectedModel).toBe('old-subscription-model');
    expect(service.getState().models).toEqual([]);
    await expect(service.generate('guide', doc.id, 'unit-0')).rejects.toThrow();
    expect(reopened.exportLibrary()).toEqual(before);
    for (const [name, body] of Object.entries(sentinels)) expect(await readFile(join(path, name), 'utf8')).toBe(body);
  });
});
