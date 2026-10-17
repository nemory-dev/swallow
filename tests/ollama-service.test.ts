import { qualityReply } from './helpers/quality-review.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppService } from '../electron/app-service.js';
import { LibraryStore } from '../electron/library.js';
import type { AIModel, OllamaState, CoachRequest } from '../src/shared/types.js';
import { aiUnavailableReason } from '../src/shared/ai.js';
import { pdfSource } from '../src/learning/pdf.js';
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const model: AIModel = { slug: 'ollama:opaque', displayName: '시험 모델 · Ollama', providerId: 'ollama', connectionId: 'fixture', upstreamModelId: 'fixture', modelFingerprint: 'a'.repeat(64), capabilities: { text: 'unknown', vision: 'unsupported', structuredOutput: 'unknown', executionLocation: 'unknown' } };
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'swallow-ollama-service-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const state: OllamaState = { status: 'ready', endpoint: { host: '127.0.0.1', port: 11434 }, revision: 1, models: [model], message: 'fixture' };
  const ollama = { state, initialize: async () => {}, connect: async () => {}, refresh: async () => {}, disconnect: async () => { state.status = 'disconnected'; state.models = []; }, cancel() {}, dispose() {}, streamResponse: async (request: CoachRequest) => { const checked = qualityReply(request); if (checked) return checked; calls++; return { text: JSON.stringify({ overview: '로컬 설명', keyPoints: [{ title: '회상', explanation: '꺼내기', quote: '회상한다.' }], question: '무엇을 하나요?' }) }; } };
  const service = new AppService(new LibraryStore(join(root, 'library.json')), ollama);
  cleanup.push(() => service.dispose()); await service.initialize(); await service.refreshOllama();
  await service.addDocument({ title: '회상', source: '회상한다.', goal: '' });
  await service.study({ type: 'select-model', model: model.slug });
  return { service, id: service.getState().library.activeDocumentId!, state, ollama, calls: () => calls };
}
describe('제공자 독립 로컬 학습', () => {
  it('구독 클라이언트 없이 로컬 텍스트 안내를 저장한다', async () => {
    const { service, id, calls } = await setup();
    expect(aiUnavailableReason(service.getState(), true)).toBeNull();
    await service.studySession({ type: 'start', documentId: id });
    const result = await service.explainStudy(id, 'brief');
    expect(result.session?.guide?.overview).toBe('로컬 설명'); expect(calls()).toBe(1);
  });
  it('서버 중단과 삭제된 모델은 선택을 보존하며 자동 전환하지 않는다', async () => {
    const { service, state, id, calls } = await setup(); state.models = []; state.status = 'unavailable'; await service.refreshOllama();
    expect(service.getState().library.selectedModel).toBe(model.slug);
    await expect(service.generate('guide', id, 'unit-0')).rejects.toThrow(); expect(calls()).toBe(0);
  });
  it('PDF AI 요청만 차단하고 원문 기반 노트는 저장한다', async () => {
    const { service, calls } = await setup(); const pdf = pdfSource([{ text: 'PDF 원문입니다.', method: 'text' }]);
    await service.addDocument({ title: 'PDF', source: pdf.source, goal: '', pdf: { assetId: 'a'.repeat(64), pages: pdf.pages } });
    const id = service.getState().library.activeDocumentId!; await service.studySession({ type: 'start', documentId: id });
    await expect(service.explainStudy(id, 'brief')).rejects.toThrow('PDF'); expect(calls()).toBe(0);
    await service.studySession({ type: 'step', documentId: id, step: 'check' });
    await service.studySession({ type: 'answer', documentId: id, answer: '답안', unknown: false });
    await service.studySession({ type: 'step', documentId: id, step: 'note' });
    expect((await service.saveStudyNote(id)).notes[0]?.summaryOrigin).toBe('source');
  });
  it('로컬 연결 해제 뒤 늦게 도착한 응답은 저장하지 않는다', async () => {
    const { service, id, ollama } = await setup();
    let finish: ((value: { text: string }) => void) | undefined;
    ollama.streamResponse = () => new Promise(resolve => { finish = resolve; });
    await service.studySession({ type: 'start', documentId: id });
    const pending = service.explainStudy(id, 'brief'); const rejected = expect(pending).rejects.toThrow('취소');
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    await service.disconnectOllama(); finish({ text: '{}' }); await rejected;
    expect(service.getStudyWorkspace(id).session?.guide).toBeUndefined(); expect(service.getState().busy).toBeNull();
  });
  it('원문에 없는 인용은 저장하지 않는다', async () => {
    const { service, id, ollama } = await setup(); ollama.streamResponse = async () => ({ text: JSON.stringify({ overview: '설명', keyPoints: [{ title: '회상', explanation: '설명', quote: '없는 인용' }], question: '질문?' }) });
    await service.studySession({ type: 'start', documentId: id });
    await expect(service.explainStudy(id, 'brief')).rejects.toThrow('인용'); expect(service.getStudyWorkspace(id).session?.guide).toBeUndefined();
  });
});
