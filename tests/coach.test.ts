import { qualityReply } from './helpers/quality-review.js';
import { describe, expect, it } from 'vitest';
import { StudyCoach, buildCoachInput } from '../electron/coach.js';
import { createDocument } from '../src/learning/document.js';
const guide = JSON.stringify({ overview: '배울 내용', keyPoints: [{ title: '기억', explanation: '꺼내서 확인하기', quote: '회상한다.' }], question: '왜 회상하나요?' });
const doc = () => createDocument({ title: '회상', source: '회상한다.\n\n' + '긴 내용 '.repeat(1000), goal: '학습' });
describe('학습 요청', () => {
  it('현재 단위와 제한된 이전 맥락만 요청에 넣는다', () => {
    const document = doc();
    const input = buildCoachInput('guide', document, document.units[1]!, undefined);
    const payload = JSON.parse(input[1]!.content as string);
    expect(payload.source).toBe(document.units[1]?.text);
    expect(payload.previousContext.length).toBeLessThanOrEqual(600);
    expect(JSON.stringify(input)).not.toContain(document.source);
    expect(input[0]?.role).toBe('developer');
  });
  it('확인 질문 피드백은 지정한 질문·답변과 현재 원문만 평가한다', () => {
    const document = doc(), question = '왜 회상하나요?', answer = '기억에서 꺼내 확인하려고요.';
    const input = buildCoachInput('feedback', document, document.units[1]!, { answer, savedAt: new Date().toISOString() }, undefined, { question });
    const payload = JSON.parse(input[1]!.content as string);
    expect(payload.question).toBe(question); expect(payload.answer).toBe(answer);
    expect(payload.source).toBe(document.units[1]!.text); expect(payload.previousContext).toBe('');
    expect(input[0]!.content).toContain('현재 질문');
    expect(input[0]!.content).toContain('다른 개념');
  });
  it('완료된 응답만 검증해 반환한다', async () => {
    const coach = new StudyCoach({ streamResponse: async request => qualityReply(request) ?? ({ text: guide }) });
    const result = await coach.run('guide', doc(), 'unit-0', () => {}, 'account-model');
    expect('question' in result).toBe(true);
  });
  it('중복 요청을 막고 취소 뒤 다시 사용할 수 있다', async () => {
    let aborted = false;
    const coach = new StudyCoach({ streamResponse: options => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('abort')); });
    }) });
    const request = coach.run('guide', doc(), 'unit-0', () => {}, 'account-model');
    await expect(coach.run('guide', doc(), 'unit-0', () => {}, 'account-model')).rejects.toThrow('진행');
    coach.cancel();
    await expect(request).rejects.toThrow('취소');
    expect(aborted).toBe(true);
    expect(coach.running).toBe(false);
  });
  it('응답을 멈춘 클라이언트에도 시간 제한을 적용한다', async () => {
    const coach = new StudyCoach({ streamResponse: async () => new Promise(() => {}) }, 15);
    await expect(coach.run('guide', doc(), 'unit-0', () => {}, 'account-model')).rejects.toThrow('시간');
    expect(coach.running).toBe(false);
  });
  it('저장된 회상 없이 피드백을 요청하지 않는다', async () => {
    const coach = new StudyCoach({ streamResponse: async request => qualityReply(request) ?? ({ text: guide }) });
    await expect(coach.run('feedback', doc(), 'unit-0', () => {}, 'account-model')).rejects.toThrow('회상');
  });
});
