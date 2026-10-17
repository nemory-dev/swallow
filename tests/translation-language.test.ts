import { describe, expect, it, vi } from 'vitest';
import { SourceTranslator } from '../electron/translation.js';
import type { CoachRequest } from '../src/shared/types.js';

const output = (translation: string) => ({ text: JSON.stringify({ translation }) });
const isReview = (request: CoachRequest) => Object.hasOwn((request.responseSchema?.properties ?? {}) as Record<string, unknown>, 'verdict');
const pass = { text: JSON.stringify({ reason: 'Synthetic meaning check', verdict: 'pass' }) };
const source = 'A cache stores a copy. It may become stale.';
const good = '캐시는 복사본을 저장합니다. 오래된 값이 남을 수 있습니다.';
const messages = (request: CoachRequest) => request.input as { content: string }[];

describe('한국어 번역의 제한된 언어 복구', () => {
  it.each([
    '캐시가 복사본을 저장한다. 그러나它는 오래될 수 있다.',
    '캐시는 복사본을 저장합니다. 그러나 陈旧해질 수 있습니다.',
    '캐시가 복사본을 저장한다, इसल로 반복적으로 읽는 경우 더 빠르다.',
  ])('실제 혼입 응답은 원문에서 한 번 재생성한 후 모든 검사를 통과해야 반환한다 (%s)', async bad => {
    const seen: CoachRequest[] = [];
    const translator = new SourceTranslator({ streamResponse: async request => {
      seen.push(request);
      if (isReview(request)) return pass;
      return output(seen.length === 1 ? bad : good);
    } });
    expect(await translator.translate(source, 'ko', 'fixture', new AbortController().signal)).toBe(good);
    expect(seen).toHaveLength(2); // Initial generation and language repair, no semantic verdict.
    expect(JSON.parse(messages(seen[0]!)[1]!.content)).toEqual(JSON.parse(messages(seen[1]!)[1]!.content));
    expect(JSON.stringify(seen[1]!.input)).not.toContain(bad);
    expect(messages(seen[1]!)[0]!.content).toContain('한국어');
    expect(seen.every(request => request.signal === seen[0]!.signal)).toBe(true);
  });
  it('재생성에도 혼입이 있으면 두 번만 생성하고 저장용 결과를 반환하지 않는다', async () => {
    let generation = 0, reviews = 0;
    const translator = new SourceTranslator({ streamResponse: async request => {
      if (isReview(request)) { reviews++; return pass; }
      generation++; return output('캐시에는 陈旧한 값이 있습니다.');
    } });
    await expect(translator.translate(source, 'ko', 'fixture', new AbortController().signal)).rejects.toMatchObject({ code: 'public.aiQuality' });
    expect(generation).toBe(2); expect(reviews).toBe(0);
  });
  it('초안에 의미 대조를 요청하지 않고 생성은 한 번만 한다', async () => {
    let generation = 0;
    const translator = new SourceTranslator({ streamResponse: async request => {
      if (isReview(request)) return { text: JSON.stringify({ reason: 'changed uncertainty', verdict: 'fail' }) };
      generation++; return output(good);
    } });
    expect(await translator.translate(source, 'ko', 'fixture', new AbortController().signal)).toBe(good);
    expect(generation).toBe(1);
  });
  it('코드·URL 누락은 언어 재생성으로 덮지 않는다', async () => {
    let generation = 0;
    const translator = new SourceTranslator({ streamResponse: async () => { generation++; return output('캐시에는 陈旧한 값이 있습니다.'); } });
    await expect(translator.translate(source + ' Keep `config.json`.', 'ko', 'fixture', new AbortController().signal)).rejects.toMatchObject({ code: 'public.translationIntegrity' });
    expect(generation).toBe(1);
  });
  it('원문 한자 이름은 기존 허용 범위대로 보존하고 불필요하게 재생성하지 않는다', async () => {
    let generation = 0;
    const translator = new SourceTranslator({ streamResponse: async request => {
      if (isReview(request)) return pass;
      generation++; return output('맹자(孟子)는 학습을 논의합니다.');
    } });
    expect(await translator.translate('Mencius (孟子) discusses learning.', 'ko', 'fixture', new AbortController().signal)).toContain('孟子');
    expect(generation).toBe(1);
  });
  it('재생성 중 취소하면 이전 생성의 늦은 delta와 늦은 정상 응답도 반환하지 않는다', async () => {
    const controller = new AbortController();
    let generation = 0, first: CoachRequest | undefined, finish: ((value: { text: string }) => void) | undefined;
    const translator = new SourceTranslator({ streamResponse: async request => {
      if (isReview(request)) return pass;
      generation++;
      if (generation === 1) { first = request; return output('캐시에 陈旧한 값이 있습니다.'); }
      return new Promise(resolve => { finish = resolve; });
    } });
    const pending = translator.translate(source, 'ko', 'fixture', controller.signal).then(() => null, error => error);
    for (let i = 0; i < 20 && !finish; i++) await new Promise(resolve => setTimeout(resolve, 1));
    expect(finish).toBeDefined();
    first?.onDelta?.('x'.repeat(12_001));
    expect(first?.signal?.aborted).toBe(false);
    controller.abort();
    expect(await pending).toMatchObject({ code: 'public.translationCancelled' });
    finish?.(output(good));
  });
  it('재생성을 시작해도 전체 시간 제한을 초기화하지 않는다', async () => {
    vi.useFakeTimers();
    try {
      let generation = 0;
      const translator = new SourceTranslator({ streamResponse: async () => {
        generation++;
        if (generation === 1) return new Promise(resolve => setTimeout(() => resolve(output('캐시에 陈旧한 값이 있습니다.')), 20));
        return new Promise(() => {});
      } }, 30);
      const pending = translator.translate(source, 'ko', 'fixture', new AbortController().signal).then(() => null, error => error);
      await vi.advanceTimersByTimeAsync(20); expect(generation).toBe(2);
      await vi.advanceTimersByTimeAsync(10);
      expect(await pending).toMatchObject({ code: 'public.translationTimeout' });
      expect(generation).toBe(2);
    } finally { vi.useRealTimers(); }
  });
});
