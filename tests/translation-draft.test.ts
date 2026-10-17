import { describe, expect, it } from 'vitest';
import { SourceTranslator } from '../electron/translation.js';
import type { CoachRequest } from '../src/shared/types.js';

const source = 'If the server is unavailable, do not delete the saved document. A retry may fail again. Keep the original until the new copy is verified.';
// Actual gemma result: may -> high probability. A saved draft must never imply approval.
const recorded = '서버가 이용 불가능할 경우 저장된 문서를 삭제하지 마세요. 다시 시도하더라도 실패할 가능성이 높습니다. 새로운 복사본이 확인될 때까지 원본을 유지하세요.';
const reference = '서버를 사용할 수 없다면 저장된 문서를 삭제하지 마세요. 재시도도 다시 실패할 수 있습니다. 새 복사본의 검증이 끝날 때까지 원본을 유지하세요.';
const isReview = (request: CoachRequest) => Object.hasOwn((request.responseSchema?.properties ?? {}) as Record<string, unknown>, 'verdict');

describe('번역 초안은 모델의 정확성 승인과 분리한다', () => {
  it.each(['pass', 'fail', 'uncertain'])('정상 초안에 모델의 %s 판정을 요청하거나 저장 조건으로 사용하지 않는다', async verdict => {
    const calls: CoachRequest[] = [];
    const translator = new SourceTranslator({ streamResponse: async request => {
      calls.push(request);
      return { text: JSON.stringify(isReview(request) ? { reason: 'Unreliable self-review', verdict } : { translation: reference }) };
    } });
    expect(await translator.translate(source, 'ko', 'fixture', new AbortController().signal)).toBe(reference);
    expect(calls).toHaveLength(1);
    expect(calls.some(isReview)).toBe(false);
  });
  it.each([['NASA', 'ko'], ['김민수', 'en']] as const)('원문 고유명 %s는 목표 문자 부재만으로 반복 거절하지 않는다', async (name, language) => {
    let calls = 0;
    const translator = new SourceTranslator({ streamResponse: async () => { calls++; return { text: JSON.stringify({ translation: name }) }; } });
    expect(await translator.translate(name, language, 'fixture', new AbortController().signal)).toBe(name);
    expect(calls).toBe(1);
  });
  it('기록된 가능성 강화 오역도 pass를 받아 확정 번역으로 승격하는 경로가 없다', async () => {
    const calls: CoachRequest[] = [];
    const translator = new SourceTranslator({ streamResponse: async request => {
      calls.push(request);
      return { text: JSON.stringify(isReview(request) ? { reason: 'Incorrect approval', verdict: 'pass' } : { translation: recorded }) };
    } });
    // This is an unreviewed draft, not a claim that the mistranslation was corrected.
    expect(await translator.translate(source, 'ko', 'fixture', new AbortController().signal)).toBe(recorded);
    expect(calls).toHaveLength(1); expect(calls.some(isReview)).toBe(false);
  });
});
