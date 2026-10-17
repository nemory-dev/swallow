import { qualityReply } from './helpers/quality-review.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppService } from '../electron/app-service.js';
import { LibraryStore } from '../electron/library.js';
import { localProvider } from './helpers/local-provider.js';
import { pdfSource } from '../src/learning/pdf.js';
import type { CoachRequest } from '../src/shared/types.js';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup(source = 'Technical documents keep `config.json` and https://example.com unchanged.') {
  const root = await mkdtemp(join(tmpdir(), 'swallow-translation-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'library.json'), store = new LibraryStore(path), client = localProvider();
  const calls: CoachRequest[] = [];
  client.streamResponse = async options => {
    const checked = qualityReply(options); if (checked) return checked;
    calls.push(options);
    const payload = JSON.parse((options.input as { content: string }[])[1]!.content);
    return { text: JSON.stringify({ translation: `${options.responseLanguage === 'ko' ? '한국어번역을검증하는합성결과입니다'.repeat(4) : 'en'}: ${payload.source}` }) };
  };
  const service = new AppService(store, client);
  cleanups.push(() => service.dispose());
  await service.initialize();
  await service.study({ type: 'select-model', model: 'test' });
  await service.addDocument({ title: 'Technical document', source, goal: '' });
  const id = service.getState().library.activeDocumentId!;
  const document = () => service.getState().library.documents.find(doc => doc.id === id)!;
  return { service, store, client, calls, id, document, path };
}
describe('원문 번역 서비스와 저장', () => {
  it('구간 번역을 별도 저장하고 원문·회상·학습 세션을 보존하며 언어별 캐시를 재사용한다', async () => {
    const { service, id, document, calls } = await setup();
    await service.study({ type: 'save-recall', documentId: id, unitId: 'unit-0', answer: '내 답안' });
    await service.studySession({ type: 'start', documentId: id });
    const before = document(), workspace = service.getStudyWorkspace(id);
    await service.translateDocument(id, 'ko', 'unit', 'unit-0');
    expect(document().translations?.['unit-0']?.ko).toMatchObject({ sourceText: before.source, text: `${'한국어번역을검증하는합성결과입니다'.repeat(4)}: ${before.source}`, model: 'test', targetLanguage: 'ko', identity: { responseLanguage: 'ko', providerId: 'ollama', promptRevision: 5 } });
    expect({ ...document(), translations: undefined }).toEqual({ ...before, translations: undefined });
    expect(service.getStudyWorkspace(id)).toEqual(workspace);
    await service.translateDocument(id, 'ko', 'unit', 'unit-0');
    expect(calls).toHaveLength(1);
    await service.translateDocument(id, 'en', 'unit', 'unit-0');
    expect(calls).toHaveLength(2);
    expect(document().translations?.['unit-0']?.ko).toBeDefined();
    expect(document().translations?.['unit-0']?.en?.text).toContain('en:');
  });
  it.each([true, false])('언어 재생성 결과만 저장하고 반복 혼입은 원문·답안을 보존한다 (복구 %s)', async recovered => {
    const { service, client, id, document, path } = await setup('A cache stores a copy. It may become stale.');
    await service.study({ type: 'save-recall', documentId: id, unitId: 'unit-0', answer: '내 답안' });
    const before = document();
    let generations = 0;
    client.streamResponse = async request => {
      const reviewed = qualityReply(request); if (reviewed) return reviewed;
      generations++;
      // Neither rejected draft may be persisted before the repaired result passes review.
      expect(document()).toEqual(before);
      return { text: JSON.stringify({ translation: recovered && generations === 2
        ? '캐시는 복사본을 저장합니다. 오래된 값이 남을 수 있습니다.' : '캐시에는 陈旧한 값이 있습니다.' }) };
    };
    if (recovered) {
      await service.translateDocument(id, 'ko', 'unit');
      expect(document().translations?.['unit-0']?.ko?.identity.promptRevision).toBe(5);
      expect(document().translations?.['unit-0']?.ko?.text).not.toContain('陈旧');
    } else {
      await expect(service.translateDocument(id, 'ko', 'unit')).rejects.toMatchObject({ code: 'public.aiQuality' });
      expect(document()).toEqual(before);
    }
    expect(generations).toBe(2);
    expect({ ...document(), translations: undefined }).toEqual({ ...before, translations: undefined });
    expect(service.getState().busy).toBeNull();
    const saved = document(); service.dispose();
    const reopened = new AppService(new LibraryStore(path)); cleanups.push(() => reopened.dispose()); await reopened.initialize();
    expect(reopened.getState().library.documents.find(doc => doc.id === id)).toEqual(saved);
  });
  it('알려진 오역도 의미 승인 없이 초안으로만 저장하고 원문·답안을 보존한다', async () => {
    const source = 'A retry may fail again.';
    const text = '재시도는 실패할 가능성이 높습니다.';
    const { service, client, id, document, path } = await setup(source);
    await service.study({ type: 'save-recall', documentId: id, unitId: 'unit-0', answer: '내 답안' });
    const before = document(); let generations = 0, reviews = 0;
    client.streamResponse = async request => {
      if (Object.hasOwn((request.responseSchema?.properties ?? {}) as Record<string, unknown>, 'verdict')) {
        reviews++; return { text: JSON.stringify({ reason: 'Incorrect approval', verdict: 'pass' }) };
      }
      generations++; return { text: JSON.stringify({ translation: text }) };
    };
    await service.translateDocument(id, 'ko', 'unit');
    const saved = document();
    expect(saved.translations?.['unit-0']?.ko?.text).toBe(text);
    expect({ ...saved, translations: undefined }).toEqual({ ...before, translations: undefined });
    await service.translateDocument(id, 'ko', 'unit');
    expect(generations).toBe(1); expect(reviews).toBe(0);
    service.dispose();
    const reopened = new AppService(new LibraryStore(path)); cleanups.push(() => reopened.dispose()); await reopened.initialize();
    expect(reopened.getState().library.documents[0]).toEqual(saved);
  });
  it('revision 4 번역은 읽을 수 있지만 명시적 재요청에서 초안 지침으로 갱신한다', async () => {
    const { service, store, id, document, calls } = await setup();
    await service.translateDocument(id, 'ko', 'unit');
    await store.update(library => {
      library.documents[0]!.translations!['unit-0']!.ko!.identity.promptRevision = 4;
      return library;
    });
    await service.study({ type: 'select-document', documentId: id });
    expect(document().translations?.['unit-0']?.ko?.identity.promptRevision).toBe(4);
    expect(calls).toHaveLength(1);
    const before = document();
    await service.translateDocument(id, 'ko', 'unit');
    expect(document().translations?.['unit-0']?.ko?.identity.promptRevision).toBe(5);
    expect(calls).toHaveLength(2);
    expect({ ...document(), translations: undefined }).toEqual({ ...before, translations: undefined });
  });
  it('수치 문장은 저장 전에 차단하고 원문·답안·노트를 보존한다', async () => {
    const { service, id, document, calls } = await setup('잔액 100에서 30을 출금하면 70입니다.');
    await service.study({ type: 'save-recall', documentId: id, unitId: 'unit-0', answer: '내 답안' });
    const before = document(), workspace = service.getStudyWorkspace(id);
    await expect(service.translateDocument(id, 'en', 'unit')).rejects.toMatchObject({ code: 'public.translationNumbers' });
    expect(document()).toEqual(before); expect(service.getStudyWorkspace(id)).toEqual(workspace);
    expect(calls).toHaveLength(0); expect(service.getState().busy).toBeNull();
  });
  it('전체 문서는 순차 저장하고 중간 실패 뒤 완료 구간을 재사용해 이어간다', async () => {
    const { service, client, id, document, calls } = await setup('First sentence. '.repeat(130) + '\n\n' + 'Second sentence. '.repeat(130));
    const respond = client.streamResponse;
    client.streamResponse = async options => {
      if (document().translations?.['unit-0']?.ko) throw new Error('server stopped');
      return respond(options);
    };
    await expect(service.translateDocument(id, 'ko', 'document')).rejects.toThrow();
    expect(document().translations?.['unit-0']?.ko).toBeDefined();
    expect(Object.keys(document().translations ?? {})).toHaveLength(1);
    expect(service.getState().busy).toBeNull();
    const firstCalls = calls.length, progress: number[] = [];
    const unsubscribe = service.subscribe(state => { if (state.busy?.progress) progress.push(state.busy.progress.completed); });
    client.streamResponse = respond;
    await service.translateDocument(id, 'ko', 'document'); unsubscribe();
    expect(Object.keys(document().translations ?? {})).toHaveLength(document().units.length);
    expect(calls.length).toBeGreaterThan(firstCalls);
    expect(progress).toContain(document().units.length);
    const count = calls.length;
    await service.translateDocument(id, 'ko', 'document');
    expect(calls).toHaveLength(count); expect(count).toBeGreaterThan(firstCalls);
  });
  it('모델 fingerprint가 달라지면 저장된 번역을 자동 사용하지 않고 다시 생성한다', async () => {
    const { service, client, id, calls, document } = await setup();
    await service.translateDocument(id, 'ko', 'unit');
    client.state.models[0]!.modelFingerprint = 'version-two';
    await service.refreshOllama();
    await service.translateDocument(id, 'ko', 'unit');
    expect(calls).toHaveLength(2);
    expect(document().translations?.['unit-0']?.ko?.identity.modelFingerprint).toBe('version-two');
  });
  it.each(['cancel', 'select-unit', 'disconnect', 'select-document', 'select-model', 'archive', 'delete-document'] as const)('%s 후 늦은 응답을 저장하지 않고 busy를 해제한다', async operation => {
    const { service, client, id, store } = await setup('Section. '.repeat(300));
    await service.addDocument({ title: 'Other', source: 'Other source.', goal: '' });
    const other = service.getState().library.activeDocumentId!;
    await service.study({ type: 'select-document', documentId: id });
    client.state.models.push({ ...client.state.models[0]!, slug: 'second-model', upstreamModelId: 'second' });
    await service.refreshOllama();
    let finish: ((result: { text: string }) => void) | undefined;
    client.streamResponse = () => new Promise(resolve => { finish = resolve; });
    const pending = service.translateDocument(id, 'ko', 'document');
    const rejected = expect(pending).rejects.toThrow();
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    await expect(service.translateDocument(id, 'en', 'unit')).rejects.toThrow();
    if (operation === 'cancel') service.cancelRequest();
    if (operation === 'select-unit') await service.study({ type: 'select-unit', documentId: id, position: 1 });
    if (operation === 'disconnect') await service.disconnectOllama();
    if (operation === 'select-document') await service.study({ type: 'select-document', documentId: other });
    if (operation === 'select-model') await service.study({ type: 'select-model', model: 'second-model' });
    if (operation === 'archive') await service.archiveDocument(id);
    if (operation === 'delete-document') await service.study({ type: 'delete-document', documentId: id });
    await rejected;
    finish({ text: '{"translation":"late"}' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.exportLibrary().documents.find(doc => doc.id === id)?.translations).toBeUndefined();
    expect(service.getState().busy).toBeNull();
  });
  it('한 구간 저장 후 다음 요청을 취소해도 완료 구간을 유지하고 재개한다', async () => {
    const { service, client, id, document } = await setup('First section. '.repeat(140) + '\n\n' + 'Second section. '.repeat(130));
    const respond = client.streamResponse;
    let finish: ((result: { text: string }) => void) | undefined;
    client.streamResponse = options => document().translations?.['unit-0']?.ko
      ? new Promise(resolve => { finish = resolve; }) : respond(options);
    const pending = service.translateDocument(id, 'ko', 'document'), rejected = expect(pending).rejects.toThrow();
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    const saved = document().translations!['unit-0']!.ko;
    service.cancelRequest(); await rejected; finish({ text: '{"translation":"late"}' });
    expect(document().translations).toEqual({ 'unit-0': { ko: saved } });
    client.streamResponse = respond;
    await service.translateDocument(id, 'ko', 'document');
    expect(document().translations!['unit-0']!.ko).toEqual(saved);
    expect(Object.keys(document().translations!)).toHaveLength(document().units.length);
  });
  it('저장 실패 시 번역과 기존 원문·답변을 덮어쓰지 않는다', async () => {
    const { service, store, id, document } = await setup();
    const before = document();
    vi.spyOn(store, 'update').mockRejectedValueOnce(new Error('disk full'));
    await expect(service.translateDocument(id, 'ko', 'unit')).rejects.toThrow();
    expect(document()).toEqual(before); expect(service.getState().busy).toBeNull();
  });
  it('문서 전환 저장이 진행 중이면 이전 문서의 새 번역을 시작하지 않는다', async () => {
    const { service, client, id } = await setup();
    await service.addDocument({ title: 'Other', source: 'Other source.', goal: '' });
    const other = service.getState().library.activeDocumentId!;
    await service.study({ type: 'select-document', documentId: id });
    client.streamResponse = () => new Promise(() => {});
    const switching = service.study({ type: 'select-document', documentId: other });
    const translating = service.translateDocument(id, 'ko', 'document');
    // Attach immediately; also tear down the intentionally ignored provider on failure.
    const result = translating.then(() => 'completed', () => 'rejected');
    await switching;
    const busy = service.getState().busy;
    service.cancelRequest();
    expect(await result).toBe('rejected');
    expect(busy).toBeNull();
    expect(service.getState().library.activeDocumentId).toBe(other);
  });
  it('PDF는 추출 텍스트만 보내고 기존 이미지 설명 차단을 유지한다', async () => {
    const { service, calls } = await setup();
    const pdf = pdfSource([{ text: 'Extracted paper text.', method: 'text' }]);
    await service.addDocument({ title: 'Paper', source: pdf.source, goal: '', pdf: { assetId: 'a'.repeat(64), pages: pdf.pages } });
    const id = service.getState().library.activeDocumentId!;
    await service.translateDocument(id, 'ko', 'unit');
    expect(JSON.stringify(calls)).not.toContain('input_image');
    expect(service.getState().library.documents[0]!.translations?.['unit-0']?.ko?.sourceText).toBe(pdf.source);
    await expect(service.generate('guide', id, 'unit-0')).rejects.toThrow('PDF');
  });
  it('텍스트가 없는 PDF 페이지는 모델 요청 없이 거절한다', async () => {
    const { service, calls } = await setup();
    const pdf = pdfSource([{ text: '', method: 'empty' }]);
    await service.addDocument({ title: 'Empty paper', source: pdf.source, goal: '', pdf: { assetId: 'a'.repeat(64), pages: pdf.pages } });
    const id = service.getState().library.activeDocumentId!;
    await expect(service.translateDocument(id, 'ko', 'unit')).rejects.toThrow(); expect(calls).toHaveLength(0);
  });
  it('전체 PDF 번역에서 text/OCR만 번역하고 빈 페이지를 건너뛴다', async () => {
    const { service, calls } = await setup();
    const pdf = pdfSource([{ text: 'Text page.', method: 'text' }, { text: '', method: 'empty' }, { text: 'OCR page.', method: 'ocr' }]);
    await service.addDocument({ title: 'Mixed paper', source: pdf.source, goal: '', pdf: { assetId: 'b'.repeat(64), pages: pdf.pages } });
    const id = service.getState().library.activeDocumentId!;
    const progress: { completed: number; total: number }[] = [];
    const unsubscribe = service.subscribe(state => { if (state.busy?.progress) progress.push(state.busy.progress); });
    await service.translateDocument(id, 'ko', 'document'); unsubscribe();
    expect(Object.keys(service.getState().library.documents[0]!.translations!)).toEqual(['unit-0', 'unit-2']);
    expect(calls).toHaveLength(2); expect(progress).toContainEqual({ completed: 2, total: 2 });
  });
  it('재실행·보관·복원 시 번역을 보존하고 AI 연결 없이 읽는다', async () => {
    const { service, id, document, path } = await setup();
    await service.translateDocument(id, 'ko', 'unit');
    const before = document();
    await service.archiveDocument(id); await service.restoreDocument(id);
    await service.study({ type: 'select-document', documentId: id });
    expect(document()).toEqual(before);
    service.dispose();
    const reopened = new AppService(new LibraryStore(path)); cleanups.push(() => reopened.dispose()); await reopened.initialize();
    expect(reopened.getState().library.documents[0]).toEqual(before);
    expect(reopened.getState().models).toEqual([]);
  });
  it('잘못된 IPC 인수·없는 구간·비활성 문서는 AI 요청 전에 거절한다', async () => {
    const { service, calls, id } = await setup();
    for (const [language, scope, unit] of [['fr', 'unit', 'unit-0'], ['ko', 'all', 'unit-0'], ['ko', 'unit', 'missing']] as const)
      await expect(service.translateDocument(id, language as 'ko', scope as 'unit', unit)).rejects.toThrow();
    await service.addDocument({ title: 'Other', source: 'Other document.', goal: '' });
    await expect(service.translateDocument(id, 'ko', 'unit')).rejects.toThrow(); expect(calls).toHaveLength(0);
  });
});
