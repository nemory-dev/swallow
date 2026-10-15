import { describe, expect, it } from 'vitest';
import { createDocument } from '../src/learning/document.js';
import { pdfSource } from '../src/learning/pdf.js';
import { readingPassages } from '../src/learning/reading.js';
import { applySessionAction, createStudyNote, createStudySession, studyPassage, validateStudyNote, validateStudySession } from '../src/learning/session.js';
const hash = 'a'.repeat(64), now = '2026-10-11T00:00:00.000Z';
const document = () => createDocument({ title: '이해하기', source: '# 원문\n' + '한글 😀 코드 `x` 를 보존합니다.\n'.repeat(150), goal: '' }, { id: 'doc', now });
describe('읽기 세션', () => {
  it('모름은 이전 질문과 실제 답변을 보존하고 재설명 뒤 다시 질문할 수 있다', () => {
    const doc = document(), initial = createStudySession(doc, hash, now);
    const guide = { overview: '설명', keyPoints: [{ title: '원문', explanation: '설명', quote: '원문' }], question: '어떻게 관리하나요?' };
    const check = { ...initial, step: 'check' as const, guide, guideStyle: 'simple' as const, guideModel: 'test' };
    const retry = applySessionAction(doc, check, { type: 'relearn', documentId: doc.id, answer: '로드밸런싱밖에 모르겠어' });
    expect(retry).toMatchObject({ step: 'explain', answer: '로드밸런싱밖에 모르겠어', unknown: true,
      relearning: [{ question: guide.question, answer: '로드밸런싱밖에 모르겠어' }] });
    expect(retry.guide).toBeUndefined(); expect(retry.guideStyle).toBeUndefined();
    expect(() => createStudyNote(doc, retry)).toThrow();
    const answered = applySessionAction(doc, { ...retry, step: 'check' }, { type: 'answer', documentId: doc.id, answer: '자원에 맞춰 배치합니다.', unknown: false });
    const note = createStudyNote(doc, { ...answered, step: 'note' });
    expect(note.relearning).toEqual(retry.relearning); expect(note.unknown).toBe(false);
    expect(validateStudyNote(note, doc, hash).relearning).toEqual(retry.relearning);
    expect(applySessionAction(doc, { ...answered, step: 'done' }, { type: 'next', documentId: doc.id }).relearning).toBeUndefined();
    expect(() => applySessionAction(doc, initial, { type: 'relearn', documentId: doc.id, answer: '' })).toThrow();
    expect(() => validateStudySession({ ...retry, relearning: [{ question: '', answer: '' }] }, doc, hash)).toThrow();
    expect(() => validateStudyNote({ ...note, relearning: [{ question: '질문', answer: 'a'.repeat(10001) }] }, doc, hash)).toThrow();
  });
  it('현재 단위에서 시작하고 420자 구간을 원문 그대로 반환한다', () => {
    const doc = document(); doc.position = 1;
    const session = createStudySession(doc, hash, now);
    expect(session).toMatchObject({ documentId: doc.id, unitId: doc.units[1]!.id, passageIndex: 0, step: 'explain', answer: '', unknown: false });
    expect(studyPassage(doc, session)).toBe(readingPassages(doc.units[1]!.text)[0]);
    expect(readingPassages(doc.units[1]!.text).join('')).toBe(doc.units[1]!.text);
  });
  it('단계를 건너뛰거나 저장 없이 완료할 수 없고 이전 단계 재열람은 답변을 보존한다', () => {
    const doc = document(); const initial = createStudySession(doc, hash, now);
    expect(() => applySessionAction(doc, initial, { type: 'step', documentId: doc.id, step: 'note' })).toThrow();
    expect(() => applySessionAction(doc, initial, { type: 'next', documentId: doc.id })).toThrow();
    const check = applySessionAction(doc, initial, { type: 'step', documentId: doc.id, step: 'check' });
    expect(() => applySessionAction(doc, check, { type: 'step', documentId: doc.id, step: 'note' })).toThrow();
    const answer = applySessionAction(doc, check, { type: 'answer', documentId: doc.id, answer: '  실제 답변\n', unknown: false });
    const note = applySessionAction(doc, answer, { type: 'step', documentId: doc.id, step: 'note' });
    expect(() => applySessionAction(doc, note, { type: 'step', documentId: doc.id, step: 'done' })).toThrow();
    expect(applySessionAction(doc, note, { type: 'step', documentId: doc.id, step: 'explain' }).answer).toBe('  실제 답변\n');
    expect(initial.answer).toBe('');
  });
  it('빈 답변과 모름을 구별하고 다음 구간에서 답변·설명·용어를 초기화한다', () => {
    const doc = document(); const session = createStudySession(doc, hash, now);
    expect(() => createStudyNote(doc, { ...session, step: 'note' }, now)).toThrow();
    const unknown = { ...session, step: 'note' as const, unknown: true };
    const note = createStudyNote(doc, unknown, now);
    expect(note.userAnswer).toBe(''); expect(note.unknown).toBe(true); expect(note.unresolved.length).toBeGreaterThan(0);
    const next = applySessionAction(doc, { ...unknown, step: 'done', terms: [{ term: '용어', explanation: '설명', kind: 'ai' }] }, { type: 'next', documentId: doc.id });
    expect(next).toMatchObject({ passageIndex: 1, step: 'explain', answer: '', unknown: false, terms: [] });
  });
  it('단위 경계와 마지막 구간을 검증한다', () => {
    const doc = document(); const session = createStudySession(doc, hash, now);
    const last = readingPassages(doc.units[0]!.text).length - 1;
    const next = applySessionAction(doc, { ...session, passageIndex: last, step: 'done', unknown: true }, { type: 'next', documentId: doc.id });
    expect(next.unitId).toBe(doc.units[1]!.id); expect(next.passageIndex).toBe(0);
    const final = { ...next, unitId: doc.units.at(-1)!.id, passageIndex: readingPassages(doc.units.at(-1)!.text).length - 1, step: 'done' as const, unknown: true };
    expect(applySessionAction(doc, final, { type: 'next', documentId: doc.id })).toEqual(final);
  });
  it('변조된 문서·해시·구간·답변·용어와 로컬 URL을 거절한다', () => {
    const doc = document(); const session = createStudySession(doc, hash, now);
    for (const patch of [{ documentId: 'other' }, { sourceHash: 'bad' }, { unitId: 'missing' }, { passageIndex: -1 }, { passageIndex: 1000 }, { answer: 'x'.repeat(10001) }, { terms: Array(21).fill({ term: 'a', explanation: 'b', kind: 'ai' }) }]) {
      expect(() => validateStudySession({ ...session, ...patch }, doc, hash)).toThrow();
    }
    expect(() => validateStudySession(session, doc, 'b'.repeat(64))).toThrow();
    for (const sourceUrl of ['file:///tmp/a', 'http://localhost/a', 'http://127.0.0.1/a', 'http://[::1]/a', 'http://user:pass@example.com']) {
      expect(() => applySessionAction(doc, session, { type: 'add-term', documentId: doc.id, term: { term: 'a', explanation: 'b', kind: 'web', sourceUrl } })).toThrow();
    }
    expect(() => applySessionAction(doc, session, { type: 'add-term', documentId: 'other', term: { term: 'a', explanation: 'b', kind: 'ai' } })).toThrow();
  });
  it('다른 자료에서 찾은 용어 근거를 보존하되 같은 자료의 잘못된 근거는 거절한다', () => {
    const doc = document(); const session = createStudySession(doc, hash, now);
    const reference = { documentId: 'other', unitId: 'unit-1', sourceHash: 'b'.repeat(64) };
    const next = applySessionAction(doc, session, { type: 'add-term', documentId: doc.id, term: { term: '회상', explanation: '다른 자료의 설명', kind: 'source', quote: '다른 자료의 원문', reference } });
    expect(next.terms[0]!.reference).toEqual(reference);
    const note = createStudyNote(doc, { ...next, step: 'note', unknown: true }, now);
    expect(validateStudyNote(note, doc, hash).terms[0]!.reference).toEqual(reference);
    expect(() => applySessionAction(doc, session, { type: 'add-term', documentId: doc.id, term: { term: '회상', explanation: '설명', kind: 'source', quote: '다른 자료의 원문', reference: { ...reference, documentId: doc.id } } })).toThrow();
  });
  it('새 세션과 다음 구간은 공백 구간·단위를 건너뛰면서 원래 인덱스를 유지한다', () => {
    const leading = createDocument({ title: '공백 앞부분', source: ' '.repeat(420) + '실제 본문', goal: '' }, { id: 'leading', now });
    expect(createStudySession(leading, hash, now).passageIndex).toBe(1);
    const doc = createDocument({ title: '공백 중간', source: '첫 본문 ' + ' '.repeat(3600) + '마지막 본문', goal: '' }, { id: 'middle', now });
    const session = { ...createStudySession(doc, hash, now), step: 'done' as const, unknown: true };
    const next = applySessionAction(doc, session, { type: 'next', documentId: doc.id });
    expect(next.unitId).toBe(doc.units.at(-1)!.id); expect(studyPassage(doc, next)).toContain('마지막');
    const trailing = createDocument({ title: '공백 끝부분', source: '첫 본문 ' + ' '.repeat(3600), goal: '' }, { id: 'trailing', now });
    const final = { ...createStudySession(trailing, hash, now), step: 'done' as const, unknown: true };
    expect(applySessionAction(trailing, final, { type: 'next', documentId: trailing.id })).toEqual(final);
  });
  it('용어의 출처 종류에 필요한 근거가 없으면 저장하지 않는다', () => {
    const doc = document(); const session = createStudySession(doc, hash, now);
    const base = { term: '용어', explanation: '설명' }, reference = { documentId: doc.id, unitId: session.unitId, sourceHash: hash };
    for (const term of [
      { ...base, kind: 'web' as const, sourceUrl: 'https://example.com' },
      { ...base, kind: 'source' as const, quote: '원문' },
      { ...base, kind: 'source' as const, reference },
      { ...base, kind: 'note' as const, reference },
      { ...base, kind: 'note' as const, sourceTitle: '출처 노트' },
      { ...base, kind: 'ai' as const, sourceUrl: 'https://example.com' },
    ]) expect(() => applySessionAction(doc, session, { type: 'add-term', documentId: doc.id, term })).toThrow();
    const note = applySessionAction(doc, session, { type: 'add-term', documentId: doc.id, term: { ...base, kind: 'note', reference, sourceTitle: '출처 노트' } });
    expect(note.terms[0]!.sourceTitle).toBe('출처 노트');
  });
  it('공백만 있는 원문 구간도 삭제하거나 정규화하지 않는다', () => {
    const doc = createDocument({ title: '공백 보존', source: '본문 ' + ' '.repeat(4000), goal: '' }, { id: 'spaces', now });
    doc.position = 1;
    const session = { documentId: doc.id, sourceHash: hash, unitId: doc.units[1]!.id, passageIndex: 0, step: 'note' as const, answer: '', unknown: true, terms: [], updatedAt: now };
    expect(createStudyNote(doc, session, now).sourceExcerpt).toBe(studyPassage(doc, session));
  });
  it('PDF 노트는 실제 학습 구간의 페이지를 저장한다', () => {
    const extracted = pdfSource([{ text: '첫 페이지 원문', method: 'text' }, { text: '둘째 페이지 원문', method: 'ocr' }]);
    const doc = createDocument({ title: 'PDF', source: extracted.source, goal: '', pdf: { assetId: hash, pages: extracted.pages } }, { id: 'pdf', now });
    doc.position = 1;
    const note = createStudyNote(doc, { ...createStudySession(doc, hash, now), step: 'note', unknown: true }, now);
    const visualEvidence = [{ page: 2, description: '그림 설명', uncertainty: '작은 글자는 읽을 수 없음' }];
    const guide = { overview: 'PDF 설명', keyPoints: [{ title: '본문', explanation: '내용', quote: '둘째 페이지 원문' }], question: '둘째 페이지의 의미는?', visualEvidence };
    const ai = createStudyNote(doc, { ...createStudySession(doc, hash, now), step: 'note', unknown: true, guide, guideModel: 'test-pdf-model' }, now);
    expect(ai.guideModel).toBe('test-pdf-model'); expect(ai.evidenceQuotes).toEqual(['둘째 페이지 원문']); expect(ai.visualEvidence).toEqual(visualEvidence);
    expect(validateStudyNote(ai, doc, hash).visualEvidence![0]!.uncertainty).toBe('작은 글자는 읽을 수 없음');
    expect(() => validateStudyNote({ ...ai, evidenceQuotes: ['없는 인용'] }, doc, hash)).toThrow();
    expect(() => validateStudyNote({ ...ai, visualEvidence: [{ ...visualEvidence[0], page: 1 }] }, doc, hash)).toThrow();
    expect(note.page).toBe(2); expect(note.sourceExcerpt).toContain('둘째');
    expect(() => validateStudyNote({ ...note, page: 1 }, doc, hash)).toThrow();
  });
  it('노트는 실제 답변·원문·출처를 복사하고 AI 설명을 구분한다', () => {
    const doc = document(); const session = { ...createStudySession(doc, hash, now), step: 'note' as const, answer: '  내 답변\n', terms: [{ term: '코드', explanation: '내 설명', kind: 'ai' as const }] };
    const note = createStudyNote(doc, session, now);
    expect(note.id).toBe('doc:unit-0:0'); expect(note.userAnswer).toBe(session.answer);
    expect(note.sourceExcerpt).toBe(studyPassage(doc, session)); expect(note.summaryOrigin).toBe('source'); expect(note.summary).toContain(note.sourceExcerpt);
    expect(note.source).toEqual({ documentId: doc.id, unitId: session.unitId, sourceHash: hash });
    session.terms[0]!.explanation = '변경'; expect(note.terms[0]!.explanation).toBe('내 설명');
    const guide = { overview: '개요', keyPoints: [{ title: '코드', explanation: '의미', quote: '코드' }], question: '코드란?' };
    const ai = createStudyNote(doc, { ...session, guide, guideModel: 'test' }, now);
    expect(ai.summaryOrigin).toBe('ai'); expect(ai.summary).toContain('개요'); expect(ai.summary).toContain('의미'); expect(ai.question).toBe('코드란?');
    expect(validateStudyNote(ai, doc, hash)).toEqual(ai);
    expect(() => validateStudyNote({ ...ai, sourceExcerpt: '조작' }, doc, hash)).toThrow();
  });
});

describe('확인 질문 피드백의 세션·노트 호환', () => {
  const feedback = { question: '코드란?', answer: '실행할 명령입니다.', model: 'gemini:gemini-3.8-flash-medium', result: { assessment: '질문에 답했습니다.', missingPoints: [], nextStep: '코드 예를 하나 말해 보세요.' } };
  function answered() {
    const doc = document();
    const session = { ...createStudySession(doc, hash, now), step: 'check' as const, answer: feedback.answer,
      guide: { overview: '설명', keyPoints: [{ title: '코드', explanation: '설명', quote: '코드' }], question: feedback.question }, answerFeedback: structuredClone(feedback) };
    return { doc, session };
  }
  it('피드백이 없는 기존 기록은 그대로 읽고 새 피드백은 세션과 노트에 복사한다', () => {
    const { doc, session } = answered();
    expect(validateStudySession(session, doc, hash).answerFeedback).toEqual(feedback);
    const note = createStudyNote(doc, { ...session, step: 'note' }, now);
    expect(note.answerFeedback).toEqual(feedback);
    expect(validateStudyNote(note, doc, hash).answerFeedback).toEqual(feedback);
    session.answerFeedback.result.assessment = '바뀜'; expect(note.answerFeedback?.result.assessment).toBe('질문에 답했습니다.');
    expect(validateStudySession(createStudySession(doc, hash, now), doc, hash).answerFeedback).toBeUndefined();
    const { answerFeedback: _feedback, ...legacy } = note;
    expect(validateStudyNote(legacy, doc, hash)).toEqual(legacy);
  });
  it('답변 변경·모름·재학습·다음 구간에서 피드백을 초기화하며 같은 답변 저장은 유지한다', () => {
    const { doc, session } = answered();
    expect(applySessionAction(doc, session, { type: 'answer', documentId: doc.id, answer: session.answer, unknown: false }).answerFeedback).toEqual(feedback);
    for (const action of [
      { type: 'answer' as const, documentId: doc.id, answer: '새 답변', unknown: false },
      { type: 'answer' as const, documentId: doc.id, answer: session.answer, unknown: true },
      { type: 'relearn' as const, documentId: doc.id, answer: session.answer },
    ]) expect(applySessionAction(doc, session, action).answerFeedback).toBeUndefined();
    expect(applySessionAction(doc, { ...session, step: 'done' }, { type: 'next', documentId: doc.id }).answerFeedback).toBeUndefined();
  });
  it('다른 질문·답변 및 잘못된 피드백은 저장 기록으로 받아들이지 않는다', () => {
    const { doc, session } = answered();
    const note = createStudyNote(doc, { ...session, step: 'note' }, now);
    for (const patch of [{ question: '다른 질문' }, { answer: '다른 답변' }, { model: '' }, { result: { assessment: '평가', missingPoints: 'invalid', nextStep: '다음' } }]) {
      expect(() => validateStudySession({ ...session, answerFeedback: { ...feedback, ...patch } }, doc, hash)).toThrow();
      expect(() => validateStudyNote({ ...note, answerFeedback: { ...feedback, ...patch } }, doc, hash)).toThrow();
    }
    expect(() => validateStudySession({ ...session, unknown: true }, doc, hash)).toThrow();
  });
});
