import { qualityReply } from './helpers/quality-review.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CoachRequest } from '../src/shared/types.js';
import { localProvider } from './helpers/local-provider.js';
import { AppService } from '../electron/app-service.js';
import { LibraryStore } from '../electron/library.js';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup(sharing = true, lookupSource?: typeof import('../electron/document-url.js').fetchDocumentUrl) {
  const root = await mkdtemp(join(tmpdir(), 'swallow-guided-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const requests: unknown[] = [];
  const client = localProvider();
  client.streamResponse = async (options: CoachRequest) => {
      const checked = qualityReply(options); if (checked) return checked;
      requests.push(options.input);
      const payload = JSON.parse((options.input as { content: string }[])[1]!.content);
      return { text: JSON.stringify({ overview: '짧은 설명입니다.', keyPoints: [{ title: '핵심', explanation: '쉽게 이해하기', quote: payload.source.slice(0, 20) }], question: '무엇을 배웠나요?' }) };
    };
  const store = new LibraryStore(join(root, 'library.json'));
  const service = new AppService(store, sharing ? client : undefined, lookupSource ?? (async url => ({ title: '실제 웹 문서', source: '공개 문서에서 용어를 설명합니다.', sourceUrl: String(url) })));
  cleanups.push(() => service.dispose());
  await service.initialize();
  if (sharing) await service.study({ type: 'select-model', model: 'test' });
  await service.addDocument({ title: '자료', source: '작업 기억을 이해합니다. '.repeat(150), goal: '' });
  const id = service.getState().library.activeDocumentId!;
  return { service, client, store, id, requests };
}
describe('공부 시작 서비스', () => {
  it('원문 대조가 거절한 안내는 DB에 저장하지 않고 원문과 위치를 보존한다', async () => {
    const { service, client, id, store } = await setup();
    await service.studySession({ type: 'start', documentId: id });
    const before = store.exportLibrary(), session = service.getStudyWorkspace(id).session;
    const respond = client.streamResponse;
    client.streamResponse = async request => qualityReply(request) ? { text: JSON.stringify({ reason: '원문과 다름', verdict: 'fail' }) } : respond(request);
    await expect(service.explainStudy(id, 'brief')).rejects.toThrow('저장하지');
    expect(store.exportLibrary()).toEqual(before); expect(service.getStudyWorkspace(id).session).toEqual(session);
    expect(service.getState().busy).toBeNull();
  });
  it('원문 대조 중 학습 위치를 바꾸면 늦은 pass도 저장하지 않는다', async () => {
    const { service, client, id } = await setup(); await service.studySession({ type: 'start', documentId: id });
    const respond = client.streamResponse; let finish: ((value: { text: string }) => void) | undefined;
    client.streamResponse = request => qualityReply(request) ? new Promise(resolve => { finish = resolve; }) : respond(request);
    const pending = service.explainStudy(id, 'brief'), rejected = expect(pending).rejects.toThrow('취소');
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    await service.studySession({ type: 'step', documentId: id, step: 'check' }); await rejected;
    finish({ text: JSON.stringify({ reason: 'late', verdict: 'pass' }) }); await Promise.resolve();
    expect(service.getStudyWorkspace(id).session?.guide).toBeUndefined(); expect(service.getState().busy).toBeNull();
  });
  it('이전 지침으로 만든 설명은 다음 명시적 요청에서 갱신한다', async () => {
    const { service, store, id, requests } = await setup();
    await service.studySession({ type: 'start', documentId: id });
    await service.explainStudy(id, 'brief');
    await store.updateStudySession(id, session => { const { guideRevision: _revision, ...old } = session!; return old; });
    await service.explainStudy(id, 'brief');
    expect(requests).toHaveLength(2);
  });
  it('모름 재설명에는 실제 답변과 이전 질문을 보내며 같은 스타일 캐시를 재사용하지 않는다', async () => {
    const { service, id, requests } = await setup();
    await service.studySession({ type: 'start', documentId: id });
    const first = await service.explainStudy(id, 'simple');
    await service.studySession({ type: 'step', documentId: id, step: 'check' });
    await service.studySession({ type: 'relearn', documentId: id, answer: '아는 건 로드밸런싱뿐이야' });
    const result = await service.explainStudy(id, 'relearn');
    const payload = JSON.parse((requests[1] as { content: string }[])[1]!.content);
    expect(payload.learner).toEqual({ question: first.session!.guide!.question, answer: '아는 건 로드밸런싱뿐이야' });
    expect(result.session?.step).toBe('explain'); expect(result.notes).toHaveLength(0);
    await service.studySession({ type: 'step', documentId: id, step: 'check' });
    await service.studySession({ type: 'relearn', documentId: id, answer: '' });
    await service.explainStudy(id, 'relearn');
    expect(requests).toHaveLength(3);
  });
  it('재설명 실패 뒤 답변과 위치를 유지하고 사용자가 다시 요청할 수 있다', async () => {
    const { service, client, id } = await setup();
    await service.studySession({ type: 'start', documentId: id });
    await service.studySession({ type: 'step', documentId: id, step: 'check' });
    await service.studySession({ type: 'relearn', documentId: id, answer: '일부만 알아요' });
    const respond = client.streamResponse;
    client.streamResponse = async () => { throw new Error('네트워크 실패'); };
    await expect(service.explainStudy(id, 'relearn')).rejects.toThrow();
    expect(service.getStudyWorkspace(id).session).toMatchObject({ step: 'explain', answer: '일부만 알아요', unknown: true });
    expect(service.getState().busy).toBeNull();
    client.streamResponse = respond;
    await expect(service.explainStudy(id, 'relearn')).resolves.toHaveProperty('session.guide');
  });
  it('작은 원문만 설명하고 완성된 기본 설명을 재사용한다', async () => {
    const { service, id, requests } = await setup();
    await service.studySession({ type: 'start', documentId: id });
    const first = await service.explainStudy(id, 'brief');
    expect(first.session?.guide?.overview).toBe('짧은 설명입니다.');
    const payload = JSON.parse((requests[0] as { content: string }[])[1]!.content);
    expect(payload.source.length).toBeLessThanOrEqual(420);
    await service.explainStudy(id, 'brief');
    expect(requests).toHaveLength(1);
  });
  it('AI 없이 모름과 원문 기반 노트를 저장하고 이어간다', async () => {
    const { service, id } = await setup(false);
    await service.studySession({ type: 'start', documentId: id });
    await expect(service.explainStudy(id, 'brief')).rejects.toThrow();
    await service.studySession({ type: 'step', documentId: id, step: 'check' });
    await service.studySession({ type: 'answer', documentId: id, answer: '', unknown: true });
    await service.studySession({ type: 'step', documentId: id, step: 'note' });
    const saved = await service.saveStudyNote(id);
    expect(saved.notes[0]?.summaryOrigin).toBe('source');
    expect(saved.notes[0]?.unknown).toBe(true);
    expect(saved.session?.step).toBe('done');
    const next = await service.studySession({ type: 'next', documentId: id });
    expect(next.session?.passageIndex).toBe(1);
  });
  it('세션 이동 중 도착한 설명을 저장하지 않는다', async () => {
    const { service, client, id } = await setup();
    await service.studySession({ type: 'start', documentId: id });
    client.streamResponse = async () => new Promise(() => {});
    const result = service.explainStudy(id, 'brief');
    const rejected = expect(result).rejects.toThrow('취소');
    await service.studySession({ type: 'step', documentId: id, step: 'check' });
    await rejected;
    expect(service.getStudyWorkspace(id).session?.guide).toBeUndefined();
  });
  it('AI 용어 설명과 실제 URL에서 가져온 근거를 구분한다', async () => {
    const { service, id } = await setup();
    await service.studySession({ type: 'start', documentId: id });
    const ai = await service.explainTerm(id, '작업 기억');
    expect(ai.kind).toBe('ai'); expect(ai.sourceUrl).toBeUndefined();
    const web = await service.explainTerm(id, '작업 기억', 'https://en.wikipedia.org/wiki/Working_memory');
    expect(web.kind).toBe('web'); expect(web.quote).toBe('공개 문서에서 용어를 설명합니다.');
    expect(web.sourceUrl).toBe('https://en.wikipedia.org/wiki/Working_memory');
    expect(service.getStudyWorkspace(id).session?.terms).toEqual([]);
    await service.studySession({ type: 'add-term', documentId: id, term: web });
    expect(service.getStudyWorkspace(id).session?.terms[0]).toEqual(web);
  });
  it('웹 문서를 가져오는 중 취소하면 연결을 중단하고 다음 요청을 허용한다', async () => {
    let prepared: () => void = () => {};
    const entered = new Promise<void>(resolve => { prepared = resolve; });
    let signal: AbortSignal | undefined;
    const { service, id } = await setup(true, async (_url, options) => {
      signal = options?.signal;
      prepared();
      return new Promise(() => {});
    });
    await service.studySession({ type: 'start', documentId: id });
    const request = service.explainTerm(id, '작업 기억', 'https://en.wikipedia.org/wiki/Working_memory');
    const rejected = expect(request).rejects.toThrow('취소');
    await entered;
    service.cancelRequest();
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(service.getState().busy).toBeNull();
    await expect(service.explainStudy(id, 'brief')).resolves.toHaveProperty('session.guide');
  });
});
