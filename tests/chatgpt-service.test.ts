import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppService } from '../electron/app-service.js';
import { LibraryStore } from '../electron/library.js';
import { aiUnavailableReason } from '../src/shared/ai.js';
import { localProvider } from './helpers/local-provider.js';
import { qualityReply } from './helpers/quality-review.js';
import type { ChatGPTState } from '../src/shared/chatgpt.js';
import type { CoachRequest } from '../src/shared/types.js';
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'swallow-chatgpt-service-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const state: ChatGPTState = { status: 'ready', activeAccountId: 'fixture', accounts: [], firstUsePending: false,
    models: [{ slug: 'chatgpt:fixture:model', displayName: 'Fixture', providerId: 'chatgpt', connectionId: 'fixture', upstreamModelId: 'model' }] };
  const listeners = new Set<() => void>();
  const provider = {
    state, initialize: async () => {}, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    signIn: async () => {}, refresh: async () => {}, cancelSignIn() {}, cancel() {}, dispose() {}, acknowledgeFirstUse: async () => {},
    disconnect: async () => { state.status = 'disconnected'; state.models = []; listeners.forEach(fn => fn()); },
    streamResponse: async (request: CoachRequest) => qualityReply(request) ?? { text: JSON.stringify({ overview: '읽은 내용을 회상합니다.', keyPoints: [{ title: '회상', explanation: '원문을 떠올립니다.', quote: '회상한다.' }], question: '무엇을 하나요?' }) },
  };
  const service = new AppService(new LibraryStore(join(directory, 'library.json')), localProvider('ollama:fixture'), undefined, provider);
  cleanup.push(() => service.dispose()); await service.initialize();
  await service.addDocument({ title: '회상', source: '회상한다.', goal: '' });
  const id = service.getState().library.activeDocumentId!;
  await service.study({ type: 'select-model', model: state.models[0]!.slug });
  return { service, provider, id };
}
describe('ChatGPT 선택과 학습 기록', () => {
  it('선택한 ChatGPT로 설명을 저장하고 제공자·계정 출처를 보존한다', async () => {
    const { service, id } = await fixture();
    expect(aiUnavailableReason(service.getState(), true)).toBeNull();
    await service.studySession({ type: 'start', documentId: id });
    const result = await service.explainStudy(id, 'brief');
    expect(result.session?.guide?.identity).toMatchObject({ providerId: 'chatgpt', connectionId: 'fixture', upstreamModelId: 'model' });
  });
  it('로그아웃 뒤 늦게 도착한 결과를 저장하지 않고 Ollama는 계속 사용할 수 있다', async () => {
    const { service, provider, id } = await fixture();
    let finish: ((value: { text: string }) => void) | undefined;
    provider.streamResponse = () => new Promise(resolve => { finish = resolve; });
    await service.studySession({ type: 'start', documentId: id });
    const request = service.explainStudy(id, 'brief'); const rejected = expect(request).rejects.toThrow();
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    await service.disconnectChatGPT(); finish({ text: '{}' }); await rejected;
    expect(service.getStudyWorkspace(id).session?.guide).toBeUndefined();
    expect(service.getState().library.selectedModel).toBe('chatgpt:fixture:model');
    await service.study({ type: 'select-model', model: 'ollama:fixture' });
    expect(aiUnavailableReason(service.getState(), true)).toBeNull();
  });
});
