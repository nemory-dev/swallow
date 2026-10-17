import { describe, expect, it } from 'vitest';
import { StudyCoach } from '../electron/coach.js';
import { SourceTranslator } from '../electron/translation.js';
import { PublicError } from '../src/shared/public-errors.js';
import { protectTranslationLiterals } from '../electron/translation-literals.js';
import { createDocument } from '../src/learning/document.js';
import type { CoachRequest } from '../src/shared/types.js';

const source = '여러 변경을 하나로 묶습니다. 모두 성공하면 커밋하고 하나라도 실패하면 전부 롤백합니다. 100에서 30을 출금하면 70입니다.';
const doc = () => createDocument({ title: '합성 제목', goal: '레이블 목표', source });
const guide = { overview: '변경을 함께 처리합니다.', keyPoints: [{ title: '트랜잭션', explanation: '실패하면 모든 변경을 되돌립니다.', quote: '하나라도 실패하면 전부 롤백합니다.' }], question: '잔액이 100에서 30으로 줄었나요?' };
const feedback = { assessment: '정오를 자동 판정하지 않습니다. 아래 원문 근거를 자신의 답변과 비교하세요.', missingPoints: ['하나라도 실패하면 전부 롤백합니다.'], nextStep: '실패했을 때의 처리를 다시 설명하세요.' };
const review = (request: CoachRequest) => !!request.responseSchema?.properties && 'verdict' in (request.responseSchema.properties as object);
const json = (value: unknown) => ({ text: JSON.stringify(value) });
const input = (request: CoachRequest) => JSON.parse((request.input as { content: string }[])[1]!.content);

describe('실제 모델에서 발견한 학습 품질 회귀', () => {
  it.each([
    { assessment: '잘 설명한 점과 잘못 이해한 점', missingPoints: [], nextStep: '더 잘 기억하기 위한 한 번의 구체적인 행동' },
    { assessment: '실패해도 부분 커밋합니다. 잔액은 130입니다.', missingPoints: [], nextStep: '복습하세요.' },
  ])('예시 문구나 오답을 그대로 반복한 피드백은 저장용 결과로 반환하지 않는다 (%#)', async output => {
    const document = doc(); document.recalls['unit-0'] = { answer: '실패해도 부분 커밋합니다. 잔액은 130입니다.', savedAt: new Date().toISOString() };
    let calls = 0;
    const coach = new StudyCoach({ streamResponse: async request => { calls++; return review(request) ? json({ reason: 'fixture', verdict: 'pass' }) : json(output); } });
    await expect(coach.run('feedback', document, 'unit-0', () => {}, 'fixture', { question: '실패하면 어떻게 처리하나요?' })).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it.each(['fail', 'uncertain', 'PASS', null])('별도 원문 대조의 %s 판정을 거절한다', async verdict => {
    let calls = 0;
    const coach = new StudyCoach({ streamResponse: async request => { calls++; return review(request) ? json({ reason: '근거 불일치', verdict }) : json(guide); } });
    await expect(coach.run('guide', doc(), 'unit-0', () => {}, 'fixture', { style: 'brief' })).rejects.toThrow();
    expect(calls).toBe(2);
  });
  it('대조 결과에 알 수 없는 필드가 있으면 통과시키지 않는다', async () => {
    const coach = new StudyCoach({ streamResponse: async request => review(request) ? json({ reason: 'ok', verdict: 'pass', extra: true }) : json(guide) });
    await expect(coach.run('guide', doc(), 'unit-0', () => {}, 'fixture', { style: 'brief' })).rejects.toThrow();
  });
  it('짧은 확인 질문은 검증된 원문 인용에 고정하고 제목·목표를 사실 입력에서 제외한다', async () => {
    const seen: CoachRequest[] = [];
    const coach = new StudyCoach({ streamResponse: async request => { seen.push(request); return review(request) ? json({ reason: '원문과 일치', verdict: 'pass' }) : json(guide); } });
    const result = await coach.run('guide', doc(), 'unit-0', () => {}, 'fixture', { style: 'brief' });
    expect(result).toHaveProperty('question');
    expect((result as typeof guide).question).toContain(guide.keyPoints[0]!.quote);
    expect((result as typeof guide).question).not.toContain('100에서 30으로');
    expect(input(seen[0]!)).not.toHaveProperty('title');
    expect(input(seen[0]!)).not.toHaveProperty('goal');
    expect(seen).toHaveLength(2);
    expect(input(seen[1]!).source).toBe(source);
  });
  it('한국어 피드백에 원문에 없는 중국어가 섞이면 대조 호출 전 거부한다', async () => {
    const document = doc(); document.recalls['unit-0'] = { answer: '답안', savedAt: new Date().toISOString() };
    let calls = 0;
    const coach = new StudyCoach({ streamResponse: async () => { calls++; return json({ ...feedback, assessment: '因此 답안은 정확합니다.' }); } });
    await expect(coach.run('feedback', document, 'unit-0', () => {}, 'fixture')).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it.each(['ko', 'en'] as const)('다음 행동은 모델의 잘못된 교정 문장 대신 앱의 %s 재설명 지시를 쓴다', async language => {
    const document = doc(); document.recalls['unit-0'] = { answer: '실패해도 부분 커밋합니다.', savedAt: new Date().toISOString() };
    const output = { assessment: language === 'ko' ? feedback.assessment : 'Correctness is not automatically graded. Compare the source evidence below with your answer.', missingPoints: [source], nextStep: language === 'ko' ? '잔액은 70이 되지 않는다고 다시 답하세요.' : 'Answer again: the balance will not be 70.' };
    const coach = new StudyCoach({ streamResponse: async request => review(request) ? json({ reason: 'fixture', verdict: 'pass' }) : json(output) });
    const result = await coach.run('feedback', document, 'unit-0', () => {}, 'fixture', { responseLanguage: language }) as typeof feedback;
    expect(result.assessment).toBe(output.assessment); expect(result.missingPoints).toEqual([source]);
    expect(result.nextStep).not.toContain('70'); expect(result.nextStep).toContain(language === 'ko' ? '원문과 자신의 답변을 비교' : 'Compare your answer with the source');
  });
  it('피드백 인용 선택에 현재 질문과 학습자 답안을 보내고 같은 모델로 정오를 재판정하지 않는다', async () => {
    const document = doc(); document.recalls['unit-0'] = { answer: '실패해도 부분 커밋합니다.', savedAt: new Date().toISOString() };
    const seen: CoachRequest[] = [];
    const coach = new StudyCoach({ streamResponse: async request => { seen.push(request); return json(feedback); } });
    await expect(coach.run('feedback', document, 'unit-0', () => {}, 'fixture', { question: '실패하면 어떻게 처리하나요?' })).resolves.toMatchObject({ assessment: feedback.assessment, missingPoints: feedback.missingPoints });
    expect(seen).toHaveLength(1); expect(input(seen[0]!).answer).toBe('실패해도 부분 커밋합니다.');
    expect(input(seen[0]!).question).toBe('실패하면 어떻게 처리하나요?');
  });
  it('원문 대조 중에도 같은 timeout과 취소 신호를 적용한다', async () => {
    let signal: AbortSignal | undefined;
    const coach = new StudyCoach({ streamResponse: async request => {
      if (!review(request)) return json(guide);
      signal = request.signal; return new Promise(() => {});
    } }, 15);
    await expect(coach.run('guide', doc(), 'unit-0', () => {}, 'fixture')).rejects.toThrow('시간');
    expect(signal?.aborted).toBe(true); expect(coach.running).toBe(false);
  });
  it('모름 재설명은 같은 원문에서도 더 작은 질문으로 바꾼다', async () => {
    const coach = new StudyCoach({ streamResponse: async request => review(request) ? json({ reason: 'fixture', verdict: 'pass' }) : json(guide) });
    const normal = await coach.run('guide', doc(), 'unit-0', () => {}, 'fixture', { style: 'brief' }) as typeof guide;
    const retry = await coach.run('guide', doc(), 'unit-0', () => {}, 'fixture', { style: 'relearn', learner: { question: normal.question, answer: '모르겠습니다.' } }) as typeof guide;
    expect(retry.question).not.toBe(normal.question); expect(retry.question).toContain('한 문장');
  });
  it('생성 grammar의 인용과 보완점을 실제 원문 후보로 제한한다', async () => {
    const seen: CoachRequest[] = [], document = doc();
    document.recalls['unit-0'] = { answer: '모두 성공하면 커밋합니다.', savedAt: new Date().toISOString() };
    const coach = new StudyCoach({ streamResponse: async request => { seen.push(request); return review(request) ? json({ reason: '원문 일치', verdict: 'pass' }) : json(request.responseSchema?.properties && 'assessment' in (request.responseSchema.properties as object) ? feedback : guide); } });
    await coach.run('guide', document, 'unit-0', () => {}, 'fixture', { style: 'brief' });
    await coach.run('feedback', document, 'unit-0', () => {}, 'fixture');
    const guideSchema = seen[0]!.responseSchema as any, feedbackSchema = seen[2]!.responseSchema as any;
    const quotes = guideSchema.properties.keyPoints.items.properties.quote.enum;
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes.every((quote: string) => source.includes(quote))).toBe(true);
    expect(feedbackSchema.properties.missingPoints.items.enum).toEqual(quotes);
  });
});

describe('실제 모델에서 발견한 번역 품질 회귀', () => {
  it.each([['Hello.', 'ko'], ['캐시는 복사본입니다.', 'en'], ['缓存可能过期。', 'ko']] as const)('짧고 모호한 문자열에도 의미 승인을 요청하지 않으며 정확성을 보증하지 않는다 (%s)', async (source, language) => {
    let calls = 0;
    const translator = new SourceTranslator({ streamResponse: async request => { calls++; return review(request) ? json({ reason: 'wrong target language', verdict: 'fail' }) : json({ translation: input(request).source }); } });
    expect(await translator.translate(source, language, 'fixture', new AbortController().signal)).toBe(source);
    expect(calls).toBe(1);
  });
  it('생성 문맥이 부족하면 한 번만 작은 조각으로 재생성한다', async () => {
    let generation = 0, checks = 0;
    const source = 'A cache stores a copy of data so that repeated reads can be faster. It may retain outdated values, so check freshness before using it. '.repeat(2);
    const translator = new SourceTranslator({ streamResponse: async request => {
      if (review(request)) { checks++; return json({ reason: 'unused', verdict: 'pass' }); }
      generation++;
      if (input(request).source.length > 150) throw new PublicError('public.ollamaContext');
      return json({ translation: '캐시는 복사본을 저장하며 오래된 값이 남을 수 있습니다.' });
    } });
    expect(await translator.translate(source, 'ko', 'fixture', new AbortController().signal)).toContain('캐시는');
    expect(generation).toBeGreaterThan(1); expect(checks).toBe(0);
  });
  it('기술 문자열·숫자와 양끝 공백은 모델이 아니라 앱이 보존한다', async () => {
    const source = '  A cache stores a copy, so repeated reads can be faster. It may become stale. Keep `config.json`, `curl --fail`, https://example.com/v1?q=ok, a + b = c, and `42` unchanged.\n';
    const seen: CoachRequest[] = [];
    const translator = new SourceTranslator({ streamResponse: async request => {
      seen.push(request); return review(request) ? json({ reason: 'literal references preserved', verdict: 'pass' }) : json({ translation: '기술 문자열을 다음과 같이 보존합니다: ' + input(request).source });
    } });
    const result = await translator.translate(source, 'ko', 'fixture', new AbortController().signal);
    for (const literal of ['`config.json`', '`curl --fail`', 'https://example.com/v1?q=ok', 'a + b = c', '42']) expect(result).toContain(literal);
    expect(result.startsWith('  ')).toBe(true); expect(result.endsWith('\n')).toBe(true);
    const sent = seen.filter(request => !review(request)).map(request => input(request).source).join('');
    expect(sent).not.toContain('config.json'); expect(sent).not.toContain('42');
    expect(seen.filter(request => !review(request))).toHaveLength(1);
  });
  it('번역에서 보호 토큰을 누락·변형하면 복원하거나 저장하지 않는다', async () => {
    const translator = new SourceTranslator({ streamResponse: async () => json({ translation: '모든 내용을 바꿨습니다.' }) });
    await expect(translator.translate('Keep `config.json` and 42.', 'ko', 'fixture', new AbortController().signal)).rejects.toThrow();
  });
  it('한국어 번역의 예상하지 않은 중국어 혼입은 거절한다', async () => {
    const translator = new SourceTranslator({ streamResponse: async request => review(request) ? json({ reason: 'pass', verdict: 'pass' }) : json({ translation: '캐시가 복사본을 저장한다.因此 반복 읽기가 빠르다. 그러나它는 오래될 수 있다.' }) });
    await expect(translator.translate('A cache stores a copy. It may become stale.', 'ko', 'fixture', new AbortController().signal)).rejects.toThrow();
  });
  it('형식을 통과한 초안에 의미 대조 승인을 요청하지 않는다', async () => {
    let calls = 0;
    const translator = new SourceTranslator({ streamResponse: async request => { calls++; return review(request) ? json({ reason: 'stale meaning changed', verdict: 'fail' }) : json({ translation: '시각적으로 오버해질 수 있습니다.' }); } });
    expect(await translator.translate('It may become stale.', 'ko', 'fixture', new AbortController().signal)).toBe('시각적으로 오버해질 수 있습니다.');
    expect(calls).toBe(1);
  });
  it.each(['잔액 100에서 30을 출금하면 70입니다.', 'Keep -42 and +7.5% unchanged.', 'Balance １００ minus ３０ is ７０.'])('수치 관계를 보증할 수 없는 일반 문장은 추론·저장 전에 차단한다 (%s)', async source => {
    let calls = 0;
    const translator = new SourceTranslator({ streamResponse: async () => { calls++; return json({ translation: 'wrong' }); } });
    await expect(translator.translate(source, 'en', 'fixture', new AbortController().signal)).rejects.toMatchObject({ code: 'public.translationNumbers' });
    expect(calls).toBe(0);
  });
  it('일반 문장 없는 숫자·코드·URL·수식은 추론 없이 보존한다', async () => {
    const translator = new SourceTranslator({ streamResponse: async () => { throw new Error('must not infer'); } });
    const source = '-42 +7.5%\n`v2` https://example.com/v1 x = 42';
    expect(await translator.translate(source, 'en', 'fixture', new AbortController().signal)).toBe(source);
  });
  it('PDF 쪽 표제는 보존하되 본문의 수치는 계속 차단한다', async () => {
    const translator = new SourceTranslator({ streamResponse: async request => review(request) ? json({ reason: 'fixture', verdict: 'pass' }) : json({ translation: input(request).source }) });
    const source = '# PDF 1쪽\n\nA cache stores a copy.';
    expect(await translator.translate(source, 'en', 'fixture', new AbortController().signal)).toBe(source);
    await expect(translator.translate(source + ' It holds 100 items.', 'en', 'fixture', new AbortController().signal)).rejects.toMatchObject({ code: 'public.translationNumbers' });
  });
  it('코드·URL·수식만 있는 원문은 추론 없이 그대로 보존한다', async () => {
    let calls = 0; const translator = new SourceTranslator({ streamResponse: async () => { calls++; return json({ translation: '오류' }); } });
    const source = '```ts\nconst a = 42;\n```\nhttps://example.com\na + b = c';
    expect(await translator.translate(source, 'ko', 'fixture', new AbortController().signal)).toBe(source);
    expect(calls).toBe(0);
  });
  it.each(['duplicate', 'reorder', 'unknown'] as const)('보호 토큰의 %s 변형은 거부한다', async operation => {
    const translator = new SourceTranslator({ streamResponse: async request => {
      let text = input(request).source as string;
      if (operation === 'duplicate') text += '__SWA_0__';
      if (operation === 'reorder') text = text.replace('__SWA_0__', 'TEMP').replace('__SWA_1__', '__SWA_0__').replace('TEMP', '__SWA_1__');
      if (operation === 'unknown') text = text.replace('__SWA_0__', '__SWA_99__');
      return json({ translation: text });
    } });
    await expect(translator.translate('Keep `one` and `two`.', 'en', 'fixture', new AbortController().signal)).rejects.toThrow();
  });
  it('원문에 보호 토큰처럼 보이는 문자열이 있어도 충돌 없이 복원한다', () => {
    const source = '__SWA_0__ Keep `config.json`.';
    const protectedSource = protectTranslationLiterals(source);
    expect(protectedSource.restore(protectedSource.text)).toBe(source);
  });
  it('숫자의 부호·소수점·백분율도 보호 문자열에 포함한다', () => {
    const protectedSource = protectTranslationLiterals('Keep -42 and +7.5% unchanged.');
    expect(protectedSource.text).not.toContain('-42'); expect(protectedSource.text).not.toContain('+7.5%');
    expect(protectedSource.forReview(protectedSource.text)).toContain('-42 and +7.5%');
  });
  it('문단 줄바꿈과 들여쓰기를 모델이 공백으로 바꿀 수 없다', async () => {
    const source = 'First line.\n\n  Second line.';
    const translator = new SourceTranslator({ streamResponse: async request => review(request) ? json({ reason: 'fixture', verdict: 'pass' }) : json({ translation: input(request).source.replace(/\n/g, ' ') }) });
    expect(await translator.translate(source, 'en', 'fixture', new AbortController().signal)).toBe(source);
  });
  it('번역 초안 생성 중 취소해도 늦은 결과를 반환하지 않는다', async () => {
    const controller = new AbortController(); let finish: ((value: { text: string }) => void) | undefined;
    const translator = new SourceTranslator({ streamResponse: async () => new Promise(resolve => { finish = resolve; }) });
    const pending = translator.translate('It stores a copy.', 'ko', 'fixture', controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'public.translationCancelled' });
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    controller.abort(); await rejected; finish(json({ translation: '복사본을 저장합니다.' }));
  });
});
