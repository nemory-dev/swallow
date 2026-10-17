import { qualityReply } from './helpers/quality-review.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppService } from '../electron/app-service.js';
import { LibraryStore } from '../electron/library.js';
import { localProvider } from './helpers/local-provider.js';
import type { CoachRequest } from '../src/shared/types.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const source = '원문 인용 그대로. '.repeat(100);
const guide = JSON.stringify({ overview: '설명을 확인합니다.', keyPoints: [{ title: '개념', explanation: '원문에 근거한 설명.', quote: '원문 인용 그대로.' }], question: '무슨 뜻인가요?' });
const englishGuide = JSON.stringify({ overview: 'An explanation.', keyPoints: [{ title: 'Concept', explanation: 'An idea.', quote: '원문 인용 그대로.' }], question: 'What is the idea?' });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'swallow-i18n-service-')); cleanups.push(() => rm(root, { recursive: true, force: true }));
  const store = new LibraryStore(join(root, 'library.json')); cleanups.push(() => store.close());
  const requests: CoachRequest[] = [];
  const client = localProvider('fixture');
  client.streamResponse = async request => { const checked = qualityReply(request); if (checked) return checked; requests.push(request); return { text: request.responseLanguage === 'en' ? englishGuide : guide }; };
  const service = new AppService(store, client); cleanups.push(() => service.dispose());
  await service.initialize(['ko']); await service.study({ type: 'select-model', model: 'fixture' }); await service.addDocument({ title: '원제목', source, goal: '원목표' });
  const id = service.getState().library.activeDocumentId!;
  return { store, service, id, requests, client, changeFingerprint: () => { client.state.models = [{ ...client.state.models[0]!, modelFingerprint: 'version-two' }]; } };
}
describe('서비스 언어/캐시/저장 통합', () => {
  it('UI 변경은 AI 호출/학습 데이터 변경 없이 기존 가이드를 재사용한다', async () => {
    const { service, id, requests, store } = await setup();
    await service.studySession({ type: 'start', documentId: id });
    await service.explainStudy(id, 'brief');
    const before = service.getStudyWorkspace(id), library = store.exportLibrary();
    await service.setLanguagePreferences({ uiLocale: 'en', responseLanguage: 'ko' });
    expect(service.getStudyWorkspace(id)).toEqual(before); expect(store.exportLibrary()).toEqual(library);
    await service.explainStudy(id, 'brief'); expect(requests).toHaveLength(1);
    expect(before.session?.guide?.identity).toMatchObject({ providerId: 'ollama', responseLanguage: 'ko', modelFingerprint: 'version-one' });
  });
  it('설명 기본값 변경 후 현재 구간은 ko, 다음 구간만 en이다', async () => {
    const { service, id, requests } = await setup();
    await service.studySession({ type: 'start', documentId: id });
    await service.setLanguagePreferences({ uiLocale: 'en', responseLanguage: 'en' });
    await service.explainStudy(id, 'brief');
    expect((requests[0]?.input as { content: string }[])[0]?.content).toContain('한국어');
    await service.studySession({ type: 'step', documentId: id, step: 'check' });
    await service.studySession({ type: 'answer', documentId: id, answer: '내 답안', unknown: false });
    await service.studySession({ type: 'step', documentId: id, step: 'note' }); await service.saveStudyNote(id);
    await service.studySession({ type: 'next', documentId: id });
    expect(service.getStudyWorkspace(id).session?.responseLanguage).toBe('en');
    await service.explainStudy(id, 'brief');
    expect((requests[1]?.input as { content: string }[])[0]?.content).toContain('English');
    expect(service.getStudyWorkspace(id).notes[0]?.userAnswer).toBe('내 답안');
  });
  it('같은 모델 slug라도 fingerprint 변경은 캐시를 재사용하지 않는다', async () => {
    const { service, id, requests, changeFingerprint } = await setup();
    await service.studySession({ type: 'start', documentId: id }); await service.explainStudy(id, 'brief');
    changeFingerprint(); await service.refreshOllama(); await service.explainStudy(id, 'brief');
    expect(requests).toHaveLength(2);
    expect(service.getStudyWorkspace(id).session?.guide?.identity?.modelFingerprint).toBe('version-two');
  });
  it('구형 가이드와 용어 설명에도 요청 identity/언어를 남긴다', async () => {
    const { service, id } = await setup();
    await service.setLanguagePreferences({ uiLocale: 'ko', responseLanguage: 'en' });
    await service.generate('guide', id, 'unit-0');
    expect(service.getState().library.documents[0]?.guides['unit-0']?.guide.identity?.responseLanguage).toBe('en');
    await service.studySession({ type: 'start', documentId: id });
    const term = await service.explainTerm(id, '인용');
    expect(term.responseLanguage).toBe('en'); expect(term.identity?.responseLanguage).toBe('en');
  });
  it('진행 중 언어 설정 변경은 요청을 취소하지 않고 시작 시 언어로 저장한다', async () => {
    const { service, id, client } = await setup();
    await service.studySession({ type: 'start', documentId: id });
    let release!: () => void, started!: () => void;
    const start = new Promise<void>(resolve => { started = resolve; });
    client.streamResponse = async request => { const checked = qualityReply(request); if (checked) return checked; started(); await new Promise<void>(resolve => { release = resolve; }); return { text: guide }; };
    const pending = service.explainStudy(id, 'brief'); await start;
    await service.setLanguagePreferences({ uiLocale: 'en', responseLanguage: 'en' });
    release(); await pending;
    expect(service.getStudyWorkspace(id).session?.guide?.identity?.responseLanguage).toBe('ko');
  });
  it('피드백 identity를 저장하고 보관/복원/재시작에도 노트와 질문을 보존한다', async () => {
    const { service, id, client, store } = await setup();
    await service.setLanguagePreferences({ uiLocale: 'ko', responseLanguage: 'en' });
    await service.studySession({ type: 'start', documentId: id }); await service.explainStudy(id, 'brief');
    await service.studySession({ type: 'step', documentId: id, step: 'check' });
    await service.studySession({ type: 'answer', documentId: id, answer: '한국어 사용자 답변', unknown: false });
    let feedbackCalls = 0;
    client.streamResponse = async request => { const checked = qualityReply(request); if (checked) return checked; feedbackCalls++; return { text: JSON.stringify({ assessment: 'Correctness is not automatically graded. Compare the source evidence below with your answer.', missingPoints: [source.slice(0, 100)], nextStep: 'Review it.' }) }; };
    await service.feedbackStudy(id); await service.feedbackStudy(id); expect(feedbackCalls).toBe(1);
    await service.studySession({ type: 'step', documentId: id, step: 'note' }); await service.saveStudyNote(id);
    const before = service.getStudyWorkspace(id);
    expect(before.notes[0]?.answerFeedback?.result.identity?.responseLanguage).toBe('en');
    await service.archiveDocument(id); await service.restoreDocument(id);
    expect(service.getStudyWorkspace(id)).toEqual(before);
    const path = store.databasePath.replace(/library\.sqlite$/, 'library.json');
    store.close(); const reopened = new LibraryStore(path); cleanups.push(() => reopened.close()); await reopened.load();
    expect(reopened.studyWorkspace(id)).toEqual(before);
  });
  it('로컬 제공자 오류 원문은 getState/publish 경계를 통과하지 않는다', async () => {
    const { service, client } = await setup();
    client.state.status = 'error'; client.state.message = '오류 SECRET /private/data';
    const published: unknown[] = []; service.subscribe(state => published.push(state));
    await service.refreshOllama();
    expect(JSON.stringify(published)).not.toContain('SECRET');
    expect(JSON.stringify(service.getState())).not.toContain('/private/data');
  });
  it('구형 가이드도 기존 구간 생성 언어를 global 설정 변경으로 덮어쓰지 않는다', async () => {
    const { service, id, requests, changeFingerprint } = await setup();
    await service.setLanguagePreferences({ uiLocale: 'ko', responseLanguage: 'en' });
    await service.generate('guide', id, 'unit-0');
    await service.setLanguagePreferences({ uiLocale: 'en', responseLanguage: 'ko' });
    changeFingerprint(); await service.refreshOllama(); await service.generate('guide', id, 'unit-0');
    expect(requests).toHaveLength(2);
    expect(service.getState().library.documents[0]?.guides['unit-0']?.guide.identity?.responseLanguage).toBe('en');
  });
  it('guide 없는 legacy 회상 피드백은 metadata 없는 ko 계약을 유지한다', async () => {
    const { service, id, client } = await setup();
    await service.study({ type: 'save-recall', documentId: id, unitId: 'unit-0', answer: '과거 회상 답안' });
    await service.setLanguagePreferences({ uiLocale: 'en', responseLanguage: 'en' });
    client.streamResponse = async request => qualityReply(request) ?? ({ text: JSON.stringify({ assessment: '정오를 자동 판정하지 않습니다. 아래 원문 근거를 자신의 답변과 비교하세요.', missingPoints: [source.slice(0, 100)], nextStep: '복습' }) });
    await service.generate('feedback', id, 'unit-0');
    expect(service.getState().library.documents[0]?.recalls['unit-0']?.feedback?.identity?.responseLanguage).toBe('ko');
  });
});
