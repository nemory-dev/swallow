import { qualityReply } from './helpers/quality-review.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localProvider } from './helpers/local-provider.js';
import { AppService } from '../electron/app-service.js';
import { LibraryStore } from '../electron/library.js';
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
async function setup() {
  const path = await mkdtemp(join(tmpdir(), 'swallow-service-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  let calls = 0;
  const client = localProvider('account-model');
  client.streamResponse = async request => {
    const checked = qualityReply(request); if (checked) return checked;
    calls++;
    return { text: JSON.stringify({ overview: '회상하기', keyPoints: [{ title: '기억', explanation: '꺼내기', quote: '회상한다.' }], question: '무엇을 하나요?' }) };
  };
  const store = new LibraryStore(join(path, 'library.json'));
  const service = new AppService(store, client);
  cleanup.push(() => service.dispose());
  await service.initialize();
  await service.study({ type: 'select-model', model: 'account-model' });
  await service.addDocument({ title: '회상', source: '회상한다.', goal: '' });
  const documentId = service.getState().library.activeDocumentId!;
  return { service, client, store, documentId, calls: () => calls };
}
describe('로컬 모델과 학습 결과 경계', () => {
  it('모델 목록에서만 선택하고 같은 모델의 완성된 안내는 재사용한다', async () => {
    const { service, documentId, calls } = await setup();
    await expect(service.study({ type: 'select-model', model: 'invented' })).rejects.toThrow();
    await service.generate('guide', documentId, 'unit-0');
    await service.generate('guide', documentId, 'unit-0');
    expect(calls()).toBe(1);
    expect(service.getState().busy).toBeNull();
  });
  it('답변을 바꾸면 진행 중 피드백을 취소하고 이전 결과를 저장하지 않는다', async () => {
    const { service, client, documentId } = await setup();
    await service.study({ type: 'save-recall', documentId, unitId: 'unit-0', answer: '첫 답안' });
    client.streamResponse = () => new Promise(() => {});
    const request = service.generate('feedback', documentId, 'unit-0');
    const rejected = expect(request).rejects.toThrow('취소');
    await service.study({ type: 'save-recall', documentId, unitId: 'unit-0', answer: '새 답안' });
    await rejected;
    const record = service.getState().library.documents[0]?.recalls['unit-0'];
    expect(record?.answer).toBe('새 답안');
    expect(record?.feedback).toBeUndefined();
  });
  it('연결 해제 중 완료된 AI 응답도 저장 대기열에서 다시 검사한다', async () => {
    const { service, client, store, documentId } = await setup();
    let resolveResponse: (result: { text: string }) => void = () => {};
    client.streamResponse = () => new Promise(resolve => { resolveResponse = resolve; });
    const request = service.generate('guide', documentId, 'unit-0');
    const rejected = expect(request).rejects.toThrow();
    await service.disconnectOllama();
    resolveResponse({ text: JSON.stringify({ overview: '배움', keyPoints: [{ title: '회상', explanation: '꺼내기', quote: '회상한다.' }], question: '왜?' }) });
    await rejected;
    expect(store.snapshot().documents[0]?.guides).toEqual({});
    expect(service.getState().models).toEqual([]);
  });
});
