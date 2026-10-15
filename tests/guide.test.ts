import { describe, expect, it } from 'vitest';
import { parseFeedback, parseGuide } from '../src/learning/guide.js';

describe('원문에 근거한 AI 결과 검증', () => {
  const guide = { overview: '회상의 의미', keyPoints: [{ title: '회상', explanation: '머릿속에서 꺼내 확인한다', quote: '회상은 기억을 꺼내는 과정이다.' }], question: '회상이란 무엇인가?' };
  it('정상 JSON과 코드 펜스 JSON을 받는다', () => {
    expect(parseGuide(JSON.stringify(guide), '회상은 기억을 꺼내는 과정이다.')).toEqual(guide);
    expect(parseGuide('```json\n' + JSON.stringify(guide) + '\n```', '회상은 기억을 꺼내는 과정이다.')).toEqual(guide);
  });
  it('지어낸 인용·빈 질문·불완전한 응답을 저장하지 않는다', () => {
    expect(() => parseGuide(JSON.stringify(guide), '다른 원문')).toThrow();
    expect(() => parseGuide(JSON.stringify({ ...guide, question: '' }), guide.keyPoints[0]!.quote)).toThrow();
    expect(() => parseGuide('{"overview":', '')).toThrow();
  });
  it('피드백은 정해진 구조와 길이를 요구한다', () => {
    const feedback = { assessment: '핵심을 설명했다', missingPoints: ['간격을 두고 다시 확인하기'], nextStep: '자신의 예시를 들어보세요' };
    expect(parseFeedback(JSON.stringify(feedback))).toEqual(feedback);
    expect(() => parseFeedback('{"score":100}')).toThrow();
  });
});
