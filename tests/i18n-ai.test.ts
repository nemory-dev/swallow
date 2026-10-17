import { qualityReply } from './helpers/quality-review.js';
import { describe, expect, it } from 'vitest';
import { createDocument, emptyLibrary, validateLibrary } from '../src/learning/document.js';
import { createStudySession, applySessionAction, createStudyNote, validateStudyNote, validateStudySession, studyQuestion } from '../src/learning/session.js';
import { validateGuide, validateFeedback, parseGuide } from '../src/learning/guide.js';
import { buildCoachInput, StudyCoach } from '../electron/coach.js';
import type { AIResultIdentity, CoachRequest } from '../src/shared/types.js';

const doc = createDocument({ title: '사용자 제목', source: '원문 인용 그대로. '.repeat(90), goal: '한국어 목표' });
const hash = 'a'.repeat(64), unit = doc.units[0]!;
const identity: AIResultIdentity = { providerId: 'ollama', connectionId: 'endpoint-one', upstreamModelId: 'fixture', modelFingerprint: 'digest-one', responseLanguage: 'en', promptRevision: 3 };
const guide = { overview: 'English explanation', keyPoints: [{ title: 'Concept', explanation: 'Explain it.', quote: '원문 인용 그대로.' }], question: 'What did you learn?', identity };
describe('AI 언어 snapshot·저장 계약', () => {
  it('현재 구간 언어를 고정하고 다음 구간만 새 기본값을 적용한다', () => {
    let session = createStudySession(doc, hash, undefined, 'en');
    expect(session.responseLanguage).toBe('en');
    expect(studyQuestion(session)).toContain('own words');
    session = applySessionAction(doc, session, { type: 'step', documentId: doc.id, step: 'check' }, undefined, 'ko');
    expect(session.responseLanguage).toBe('en');
    session = applySessionAction(doc, session, { type: 'answer', documentId: doc.id, answer: '사용자 입력', unknown: false });
    session = applySessionAction(doc, session, { type: 'step', documentId: doc.id, step: 'note' });
    const note = createStudyNote(doc, session);
    expect(note.summary).toBe(`원문 발췌\n${note.sourceExcerpt}`);
    expect(note.responseLanguage).toBe('en');
    const next = applySessionAction(doc, { ...session, step: 'done' }, { type: 'next', documentId: doc.id }, undefined, 'ko');
    expect(next.responseLanguage).toBe('ko');
    expect(next.passageIndex).not.toBe(session.passageIndex);
  });
  it('legacy metadata 없음은 ko이며 load만으로 metadata를 추가하지 않는다', () => {
    const legacy = createStudySession(doc, hash);
    expect(legacy.responseLanguage).toBeUndefined();
    expect(studyQuestion(legacy)).toContain('자신의 말');
    expect(validateStudySession(legacy, doc, hash)).toEqual(legacy);
  });
  it('guide/feedback/session/note/library의 identity를 보존한다', () => {
    expect(validateGuide(guide, unit.text).identity).toEqual(identity);
    const feedback = { assessment: 'Good.', missingPoints: [], nextStep: 'Review.', identity: { ...identity, promptRevision: 1 } };
    expect(validateFeedback(feedback).identity).toEqual(feedback.identity);
    let session = { ...createStudySession(doc, hash, undefined, 'en'), guide, guideModel: 'fixture' };
    session = { ...session, step: 'note' as const, answer: '내 답변', unknown: false };
    const note = createStudyNote(doc, session);
    expect(note.guideIdentity).toEqual(identity);
    expect(validateStudyNote(note, doc, hash)).toEqual(note);
    const library = { ...emptyLibrary(), documents: [{ ...doc, guides: { [unit.id]: { model: 'fixture', guide, revision: 3 } } }], activeDocumentId: doc.id };
    expect(validateLibrary(library)).toEqual(library);
  });
  it('잘못된 언어/identity와 원문 접두사 변경을 거부한다', () => {
    expect(() => validateGuide({ ...guide, identity: { ...identity, responseLanguage: 'fr' } }, unit.text)).toThrow();
    expect(() => validateStudySession({ ...createStudySession(doc, hash), responseLanguage: 'fr' }, doc)).toThrow();
    const note = createStudyNote(doc, { ...createStudySession(doc, hash), step: 'note', answer: '답변' });
    expect(() => validateStudyNote({ ...note, summary: `Source excerpt\n${note.sourceExcerpt}` }, doc)).toThrow();
  });
  it('모델이 출력한 identity는 저장 provenance로 신뢰하지 않는다', () => {
    expect(parseGuide(JSON.stringify(guide), unit.text).identity).toBeUndefined();
  });
});

describe('공통 coach 한영 지침', () => {
  it('영어 지침에서 원문을 보존하고 제목·목표를 사실 근거로 보내지 않는다', () => {
    const messages = buildCoachInput('guide', doc, unit, undefined, undefined, { responseLanguage: 'en' });
    expect(messages[0]?.content).toContain('English');
    const payload = JSON.parse(messages[1]!.content as string);
    expect(payload.source).toBe(unit.text); expect(payload).not.toHaveProperty('goal'); expect(payload).not.toHaveProperty('title');
  });
  it('provider request에 UI locale와 별도로 responseLanguage를 전달한다', async () => {
    let captured: CoachRequest | undefined;
    const coach = new StudyCoach({ streamResponse: async request => { const checked = qualityReply(request); if (checked) return checked; captured = request; return { text: JSON.stringify(guide) }; } });
    await coach.run('guide', doc, unit.id, () => {}, 'fixture', { responseLanguage: 'en' });
    expect(captured?.responseLanguage).toBe('en');
    expect(captured).not.toHaveProperty('uiLocale');
  });
});
