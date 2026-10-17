import { afterEach, describe, expect, it } from 'vitest';
import { StudyCoach } from '../electron/coach.js';
import { verifyAIResult } from '../electron/ai-quality.js';
import { createDocument } from '../src/learning/document.js';
import { AppService } from '../electron/app-service.js';
import { LibraryStore } from '../electron/library.js';
import { localProvider } from './helpers/local-provider.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = '트랜잭션은 여러 데이터 변경을 하나의 작업으로 묶습니다. 모든 변경이 성공하면 커밋하고, 하나라도 실패하면 전부 롤백합니다. 이 예제에서는 잔액 100에서 30을 출금한 뒤 70이 됩니다.';
const answer = '변경 하나가 실패해도 성공한 변경은 남기고 커밋합니다. 잔액 100에서 30을 출금하면 130이 됩니다.';
const nextStep = '원문과 자신의 답변을 비교해, 질문에 맞는 핵심을 한 문장으로 다시 설명하세요.';
const assessment = '정오를 자동 판정하지 않습니다. 아래 원문 근거를 자신의 답변과 비교하세요.';
const feedback = { assessment, missingPoints: [source], nextStep };
const bad = { assessment: '정확합니다. ' + source, missingPoints: [], nextStep };
const json = (value: unknown) => ({ text: JSON.stringify(value) });
const review = (request: any) => !!request.responseSchema?.properties?.verdict;
function document() {
  const doc = createDocument({ title: '실제 거짓 칭찬 회귀', source, goal: '' });
  doc.recalls['unit-0'] = { answer, savedAt: new Date().toISOString() };
  return doc;
}

describe('피드백의 결정적 원문 대조 계약', () => {
  it('실제 gemma 거짓 칭찬은 같은 모델이 pass해도 반환하지 않는다', async () => {
    let calls = 0;
    const coach = new StudyCoach({ streamResponse: async request => { calls++; return json(review(request) ? { verdict: 'pass', reason: 'feedback correct' } : bad); } });
    await expect(coach.run('feedback', document(), 'unit-0', () => {}, 'gemma')).rejects.toMatchObject({ code: 'public.aiQuality' });
    expect(calls).toBe(1);
  });
  it.each(['정확합니다.', 'The answer is correct.', '완벽한 이해입니다.'])('빈 인용을 채워도 자유로운 정오 판정은 거절한다 (%s)', async assessment => {
    let calls = 0;
    await expect(verifyAIResult({ streamResponse: async () => { calls++; return json({ verdict: 'pass', reason: 'fixture' }); } }, {
      kind: 'feedback', source, output: { ...feedback, assessment }, model: 'fixture', language: 'ko', signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'public.aiQuality' });
    expect(calls).toBe(0);
  });
  it('중립 안내와 정확한 원문 인용은 의미 재평가 없이 반환한다', async () => {
    let calls = 0;
    const coach = new StudyCoach({ streamResponse: async () => { calls++; return json(feedback); } });
    await expect(coach.run('feedback', document(), 'unit-0', () => {}, 'fixture')).resolves.toEqual(feedback);
    expect(calls).toBe(1);
  });
  it.each([{ missingPoints: [] }, { missingPoints: ['잔액은 130입니다.'] }])('빈 근거나 원문을 바꾼 인용은 거절한다 (%j)', async ({ missingPoints }) => {
    const coach = new StudyCoach({ streamResponse: async () => json({ ...feedback, missingPoints }) });
    await expect(coach.run('feedback', document(), 'unit-0', () => {}, 'fixture')).rejects.toMatchObject({ code: 'public.aiQuality' });
  });
});

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'swallow-feedback-safety-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'library.json'), store = new LibraryStore(path), client = localProvider('gemma');
  let calls = 0; client.streamResponse = async () => { calls++; return json(feedback); };
  const service = new AppService(store, client); cleanups.push(() => service.dispose());
  await service.initialize(['ko']); await service.study({ type: 'select-model', model: 'gemma' });
  await service.addDocument({ title: '거짓 칭찬 저장 회귀', source, goal: '' });
  const id = service.getState().library.activeDocumentId!;
  await service.studySession({ type: 'start', documentId: id });
  await service.studySession({ type: 'step', documentId: id, step: 'check' });
  await service.studySession({ type: 'answer', documentId: id, answer, unknown: false });
  return { service, client, store, id, path, calls: () => calls };
}

describe('거짓 칭찬의 DB·노트 저장 방어', () => {
  it('실제 거짓 칭찬을 거절한 뒤 답안과 원문을 보존하고 노트에도 추가하지 않는다', async () => {
    const { service, client, store, id } = await setup();
    const before = store.exportLibrary(), ws = service.getStudyWorkspace(id);
    client.streamResponse = async request => json(review(request) ? { verdict: 'pass', reason: 'fixture' } : bad);
    await expect(service.feedbackStudy(id)).rejects.toThrow('저장하지');
    expect(service.getStudyWorkspace(id)).toEqual(ws); expect(store.exportLibrary()).toEqual(before);
    expect(service.getState().busy).toBeNull();
    await service.studySession({ type: 'step', documentId: id, step: 'note' });
    const saved = await service.saveStudyNote(id);
    expect(saved.notes[0]!.answerFeedback).toBeUndefined(); expect(saved.notes[0]!.userAnswer).toBe(answer);
  });
  it('revision 5의 기존 칭찬 캐시는 재요청에서 갱신하고 새 기록·재시작은 중립 피드백을 보존한다', async () => {
    const { service, store, id, path, calls } = await setup();
    await service.feedbackStudy(id);
    await store.updateStudySession(id, session => ({ ...session!, answerFeedback: { ...session!.answerFeedback!, result: { ...bad, identity: { ...session!.answerFeedback!.result.identity!, promptRevision: 5 } } } }));
    await service.feedbackStudy(id); expect(calls()).toBe(2);
    const result = service.getStudyWorkspace(id).session!.answerFeedback!.result;
    expect(result.assessment).toBe(assessment); expect(result.identity?.promptRevision).toBe(6);
    await service.feedbackStudy(id); expect(calls()).toBe(2);
    await service.studySession({ type: 'step', documentId: id, step: 'note' }); const saved = await service.saveStudyNote(id);
    expect(saved.notes[0]!.answerFeedback!.result.assessment).toBe(assessment);
    service.dispose(); const reopened = new AppService(new LibraryStore(path)); cleanups.push(() => reopened.dispose());
    await reopened.initialize(); expect(reopened.getStudyWorkspace(id)).toEqual(saved);
  });
  it('생성 중 취소하면 늦게 도착한 중립 피드백도 저장하지 않는다', async () => {
    const { service, client, id } = await setup(); let finish: ((value: { text: string }) => void) | undefined;
    client.streamResponse = async () => new Promise(resolve => { finish = resolve; });
    const pending = service.feedbackStudy(id), rejected = expect(pending).rejects.toThrow('취소');
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    service.cancelRequest(); await rejected; finish(json(feedback)); await Promise.resolve();
    expect(service.getStudyWorkspace(id).session!.answerFeedback).toBeUndefined(); expect(service.getState().busy).toBeNull();
  });
});
