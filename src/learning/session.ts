import ipaddr from 'ipaddr.js';
import type { EvidenceReference, LearningAttempt, SessionAction, StudyAnswerFeedback, StudyDocument, StudyNote, StudySession, StudyStep, TermNote } from '../shared/types.js';
import { getUnit } from './document.js';
import { requireText, validateFeedback, validateGuide } from './guide.js';
import { unitPage } from './pdf.js';
import { readingPassages, validateSourceUrl } from './reading.js';
import { validateAIResultIdentity, validateResponseLanguage } from '../shared/ai-identity.js';
import type { ResponseLanguage } from '../shared/types.js';

const steps: StudyStep[] = ['explain', 'check', 'note', 'done'];
export function studyQuestion(session: Pick<StudySession, 'guide' | 'responseLanguage'>): string {
  return session.guide?.question ?? (session.responseLanguage === 'en' ? 'Explain the main idea of this passage in your own words.' : '이 구간의 핵심 내용을 자신의 말로 설명해 보세요.');
}
function answerFeedback(value: unknown, question: string, answer: string, unknown: boolean, page?: number): StudyAnswerFeedback {
  const raw = object(value);
  if (unknown || !answer.trim() || raw.question !== question || raw.answer !== answer) throw new Error('피드백의 질문이나 답변이 현재 기록과 다릅니다. 다시 요청하세요.');
  return { question, answer, model: requireText(raw.model, '피드백 모델', 200), result: validateFeedback(raw.result, page ? [page] : []) };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('학습 기록 형식이 잘못되었습니다.');
  return value as Record<string, unknown>;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('학습 기록 날짜가 잘못되었습니다.');
  return value;
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}은(는) ${max.toLocaleString()}자 이내여야 합니다.`);
  return value;
}
function reference(value: unknown): EvidenceReference {
  const raw = object(value);
  const documentId = requireText(raw.documentId, '자료 ID', 200), unitId = requireText(raw.unitId, '읽기 단위', 200);
  if (typeof raw.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sourceHash)) throw new Error('원문 해시가 잘못되었습니다.');
  return { documentId, unitId, sourceHash: raw.sourceHash };
}
/** URL 저장만 수행한다. 실제 문서 요청은 DNS와 리다이렉트까지 검사하는 서버 가져오기를 사용한다. */
function termUrl(value: unknown): string {
  const href = validateSourceUrl(value), url = new URL(href);
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (url.port) throw new Error('공개 HTTP(S) 출처 주소를 사용하세요.');
  if (ipaddr.isValid(host)) {
    const address = ipaddr.parse(host);
    if (address.range() !== 'unicast' || (address.kind() === 'ipv6' && !address.match(ipaddr.parse('2000::'), 3))) throw new Error('내부망 주소는 출처로 저장할 수 없습니다.');
  } else if (!host.includes('.') || /(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|corp|test|invalid|onion)$/.test(host) || host.endsWith('.home.arpa')) throw new Error('공개 HTTP(S) 출처 주소를 사용하세요.');
  return href;
}
function term(value: unknown): TermNote {
  const raw = object(value);
  if (!['ai', 'source', 'web', 'note'].includes(String(raw.kind))) throw new Error('용어 설명 출처가 잘못되었습니다.');
  if (raw.kind === 'web' && (raw.sourceUrl === undefined || raw.sourceTitle === undefined || typeof raw.quote !== 'string' || !raw.quote.trim())) throw new Error('웹 용어 설명에는 출처 URL·제목·인용이 필요합니다.');
  if (raw.kind === 'source' && (raw.reference === undefined || typeof raw.quote !== 'string' || !raw.quote.trim())) throw new Error('원문 용어 설명에는 원문 참조와 인용이 필요합니다.');
  if (raw.kind === 'note' && (raw.reference === undefined || raw.sourceTitle === undefined)) throw new Error('저장된 노트 설명에는 원문 참조와 출처 제목이 필요합니다.');
  if (raw.kind === 'ai' && raw.sourceUrl !== undefined) throw new Error('AI 설명에는 확인하지 않은 웹 출처를 표시할 수 없습니다.');
  return {
    term: requireText(raw.term, '용어', 120), explanation: requireText(raw.explanation, '용어 설명', 6000), kind: raw.kind as TermNote['kind'],
    ...(raw.responseLanguage === undefined ? {} : { responseLanguage: validateResponseLanguage(raw.responseLanguage) }),
    ...(raw.identity === undefined ? {} : { identity: validateAIResultIdentity(raw.identity) }),
    ...(raw.sourceTitle === undefined ? {} : { sourceTitle: requireText(raw.sourceTitle, '출처 제목', 300) }),
    ...(raw.sourceUrl === undefined ? {} : { sourceUrl: termUrl(raw.sourceUrl) }),
    ...(raw.quote === undefined ? {} : { quote: text(raw.quote, '인용', 6000) }),
    ...(raw.reference === undefined ? {} : { reference: reference(raw.reference) }),
  };
}
function terms(value: unknown): TermNote[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('용어는 구간마다 최대 20개까지 저장할 수 있습니다.');
  return value.map(term);
}
function learningAttempts(value: unknown): LearningAttempt[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('재학습 기록은 최근 20회까지 저장할 수 있습니다.');
  return value.map(item => {
    const raw = object(item);
    return { question: requireText(raw.question, '이전 질문', 1500), answer: text(raw.answer, '이전 답변', 10_000) };
  });
}
function requireAnswer(session: Pick<StudySession, 'answer' | 'unknown'>) {
  if (!session.unknown && !session.answer.trim()) throw new Error('답변을 입력하거나 모름을 선택해 주세요.');
}
function readableLocation(doc: StudyDocument, startUnit: number, startPassage: number): { unitId: string; passageIndex: number } | undefined {
  for (let unitIndex = startUnit; unitIndex < doc.units.length; unitIndex++) {
    const unit = doc.units[unitIndex]!, passages = readingPassages(unit.text);
    for (let passageIndex = unitIndex === startUnit ? startPassage : 0; passageIndex < passages.length; passageIndex++) {
      if (passages[passageIndex]!.trim()) return { unitId: unit.id, passageIndex };
    }
  }
  return undefined;
}
export function createStudySession(doc: StudyDocument, sourceHash: string, now = new Date().toISOString(), responseLanguage?: ResponseLanguage): StudySession {
  const unit = doc.units[doc.position];
  if (!unit) throw new Error('현재 읽기 단위를 찾을 수 없습니다.');
  const location = readableLocation(doc, doc.position, 0);
  if (!location) throw new Error('현재 위치 이후에 읽을 원문이 없습니다. 이전 읽기 단위를 선택하세요.');
  return validateStudySession({ documentId: doc.id, sourceHash, ...location, step: 'explain', answer: '', unknown: false, terms: [], updatedAt: now,
    ...(responseLanguage === undefined ? {} : { responseLanguage }) }, doc, sourceHash);
}
export function studyPassage(doc: StudyDocument, session: Pick<StudySession, 'documentId' | 'unitId' | 'passageIndex'>): string {
  if (session.documentId !== doc.id) throw new Error('학습 자료가 세션과 다릅니다.');
  const unit = getUnit(doc, session.unitId);
  if (!Number.isInteger(session.passageIndex) || session.passageIndex < 0) throw new Error('읽기 구간이 잘못되었습니다.');
  const passage = readingPassages(unit.text)[session.passageIndex];
  if (passage === undefined) throw new Error('읽기 구간이 원문 범위를 벗어났습니다.');
  return passage;
}
export function validateStudySession(value: unknown, doc: StudyDocument, expectedSourceHash?: string): StudySession {
  const raw = object(value), source = reference(raw);
  if (expectedSourceHash !== undefined && source.sourceHash !== expectedSourceHash) throw new Error('세션의 원문 버전이 변경되었습니다.');
  const passage = studyPassage(doc, { ...source, passageIndex: raw.passageIndex as number });
  if (!steps.includes(raw.step as StudyStep) || typeof raw.unknown !== 'boolean') throw new Error('학습 단계나 모름 상태가 잘못되었습니다.');
  const unit = getUnit(doc, source.unitId), page = unitPage(doc, unit)?.page;
  if (raw.guideStyle !== undefined && !['brief', 'simple', 'example', 'relearn'].includes(String(raw.guideStyle))) throw new Error('설명 방식이 잘못되었습니다.');
  if (raw.guideRevision !== undefined && (!Number.isInteger(raw.guideRevision) || Number(raw.guideRevision) < 1 || Number(raw.guideRevision) > 1000)) throw new Error('설명 지침 버전이 잘못되었습니다.');
  const session: StudySession = {
    ...(raw.responseLanguage === undefined ? {} : { responseLanguage: validateResponseLanguage(raw.responseLanguage) }),
    ...source, passageIndex: raw.passageIndex as number, step: raw.step as StudyStep,
    answer: text(raw.answer, '회상 답변', 10_000), unknown: raw.unknown, terms: terms(raw.terms), updatedAt: date(raw.updatedAt),
    ...(raw.guide === undefined ? {} : { guide: validateGuide(raw.guide, passage, page ? [page] : []) }),
    ...(raw.guideModel === undefined ? {} : { guideModel: requireText(raw.guideModel, '설명 모델', 200) }),
    ...(raw.guideStyle === undefined ? {} : { guideStyle: raw.guideStyle as StudySession['guideStyle'] }),
    ...(raw.relearning === undefined ? {} : { relearning: learningAttempts(raw.relearning) }),
    ...(raw.guideRevision === undefined ? {} : { guideRevision: raw.guideRevision as number }),
  };
  if (raw.answerFeedback !== undefined) session.answerFeedback = answerFeedback(raw.answerFeedback, studyQuestion(session), session.answer, session.unknown, page);
  for (const item of session.terms) if (item.reference && item.reference.documentId === doc.id && (item.reference.sourceHash !== source.sourceHash || !doc.units.some(unit => unit.id === item.reference!.unitId))) throw new Error('용어의 원문 근거가 현재 자료와 다릅니다.');
  if (session.step === 'note' || session.step === 'done') requireAnswer(session);
  return structuredClone(session);
}
export function applySessionAction(doc: StudyDocument, session: StudySession, action: SessionAction, now = new Date().toISOString(), nextResponseLanguage?: ResponseLanguage): StudySession {
  const next = validateStudySession(session, doc);
  if (!action || typeof action !== 'object' || action.documentId !== doc.id) throw new Error('학습 동작의 자료가 잘못되었습니다.');
  switch (action.type) {
    case 'start': return next;
    case 'relearn': {
      if (next.step !== 'check') throw new Error('확인 질문에서 모름을 선택해 주세요.');
      const answer = text(action.answer, '회상 답변', 10_000);
      next.relearning = [...(next.relearning ?? []), { question: studyQuestion(next), answer }].slice(-20);
      next.answer = answer; next.unknown = true; next.step = 'explain';
      delete next.guide; delete next.guideModel; delete next.guideStyle; delete next.guideRevision; delete next.answerFeedback;
      break;
    }
    case 'step': {
      const target = steps.indexOf(action.step), current = steps.indexOf(next.step);
      if (target < 0 || target > current + 1 || (action.step === 'done' && next.step !== 'done')) throw new Error('학습 단계를 순서대로 진행하고 노트를 저장해 주세요.');
      if (action.step === 'note') requireAnswer(next);
      next.step = action.step; break;
    }
    case 'answer':
      if (action.answer !== next.answer || action.unknown !== next.unknown) delete next.answerFeedback;
      next.answer = text(action.answer, '회상 답변', 10_000);
      if (typeof action.unknown !== 'boolean') throw new Error('모름 상태가 잘못되었습니다.');
      next.unknown = action.unknown;
      // 완료 후 답변을 수정했다면 노트를 다시 저장해야 한다.
      if (next.step === 'done' || (next.step === 'note' && !next.unknown && !next.answer.trim())) next.step = 'check';
      break;
    case 'add-term':
      if (next.terms.length >= 20) throw new Error('용어는 구간마다 최대 20개까지 저장할 수 있습니다.');
      next.terms.push(term(action.term));
      if (next.step === 'done') next.step = 'note';
      break;
    case 'next': {
      if (next.step !== 'done') throw new Error('노트를 저장한 뒤 다음 구간으로 이동하세요.');
      const unitIndex = doc.units.findIndex(unit => unit.id === next.unitId);
      const location = readableLocation(doc, unitIndex, next.passageIndex + 1);
      if (!location) return next;
      return validateStudySession({ documentId: doc.id, sourceHash: next.sourceHash, ...location, step: 'explain', answer: '', unknown: false, terms: [], updatedAt: now,
        ...(nextResponseLanguage === undefined ? {} : { responseLanguage: nextResponseLanguage }) }, doc, next.sourceHash);
    }
    default: throw new Error('지원하지 않는 학습 동작입니다.');
  }
  next.updatedAt = now;
  return validateStudySession(next, doc, next.sourceHash);
}
export function createStudyNote(doc: StudyDocument, session: StudySession, now = new Date().toISOString()): StudyNote {
  const valid = validateStudySession(session, doc);
  if (valid.step !== 'note' && valid.step !== 'done') throw new Error('회상 답변을 확인한 뒤 노트를 저장하세요.');
  requireAnswer(valid);
  const sourceExcerpt = studyPassage(doc, valid), page = unitPage(doc, getUnit(doc, valid.unitId))?.page;
  const guide = valid.guide;
  const note: StudyNote = {
    ...(valid.responseLanguage === undefined ? {} : { responseLanguage: valid.responseLanguage }),
    ...(guide?.identity === undefined ? {} : { guideIdentity: structuredClone(guide.identity) }),
    id: `${doc.id}:${valid.unitId}:${valid.passageIndex}`, source: { documentId: doc.id, unitId: valid.unitId, sourceHash: valid.sourceHash }, passageIndex: valid.passageIndex,
    ...(page === undefined ? {} : { page }), title: doc.title,
    summary: guide ? [guide.overview, ...guide.keyPoints.map(point => `${point.title}: ${point.explanation}`)].join('\n\n') : `원문 발췌\n${sourceExcerpt}`,
    summaryOrigin: guide ? 'ai' : 'source', sourceExcerpt,
    ...(valid.guideModel ? { guideModel: valid.guideModel } : {}),
    ...(guide ? { evidenceQuotes: guide.keyPoints.map(point => point.quote) } : {}),
    ...(guide?.visualEvidence ? { visualEvidence: structuredClone(guide.visualEvidence) } : {}), question: studyQuestion(valid),
    userAnswer: valid.answer, unknown: valid.unknown, unresolved: valid.unknown ? [valid.responseLanguage === 'en' ? 'Review the content of this passage.' : '이 구간의 내용을 다시 확인해 주세요.'] : [],
    ...(valid.answerFeedback ? { answerFeedback: structuredClone(valid.answerFeedback) } : {}),
    terms: structuredClone(valid.terms), createdAt: now, updatedAt: now,
    ...(valid.relearning ? { relearning: structuredClone(valid.relearning) } : {}),
  };
  return validateStudyNote(note, doc, valid.sourceHash);
}
export function validateStudyNote(value: unknown, doc?: StudyDocument, expectedSourceHash?: string): StudyNote {
  const raw = object(value), source = reference(raw.source);
  if (expectedSourceHash !== undefined && source.sourceHash !== expectedSourceHash) throw new Error('노트의 원문 버전이 변경되었습니다.');
  if (!Number.isInteger(raw.passageIndex) || Number(raw.passageIndex) < 0 || Number(raw.passageIndex) > 1_000_000 || raw.id !== `${source.documentId}:${source.unitId}:${raw.passageIndex}`) throw new Error('노트 구간과 ID가 잘못되었습니다.');
  if (!['ai', 'source'].includes(String(raw.summaryOrigin)) || typeof raw.unknown !== 'boolean' || !Array.isArray(raw.unresolved) || raw.unresolved.length > 20) throw new Error('노트 요약과 확인 상태가 잘못되었습니다.');
  const note: StudyNote = {
    ...(raw.responseLanguage === undefined ? {} : { responseLanguage: validateResponseLanguage(raw.responseLanguage) }),
    ...(raw.guideIdentity === undefined ? {} : { guideIdentity: validateAIResultIdentity(raw.guideIdentity) }),
    id: raw.id as string, source, passageIndex: raw.passageIndex as number,
    title: requireText(raw.title, '노트 제목', 160), summary: requireText(raw.summary, '요약', 20_000), summaryOrigin: raw.summaryOrigin as StudyNote['summaryOrigin'],
    sourceExcerpt: text(raw.sourceExcerpt, '원문 발췌', 420), question: requireText(raw.question, '회상 질문', 1500),
    userAnswer: text(raw.userAnswer, '회상 답변', 10_000), unknown: raw.unknown,
    unresolved: raw.unresolved.map(item => requireText(item, '미해결 내용', 6000)), terms: terms(raw.terms), createdAt: date(raw.createdAt), updatedAt: date(raw.updatedAt),
  };
  if (raw.relearning !== undefined) note.relearning = learningAttempts(raw.relearning);
  if (raw.page !== undefined) {
    if (!Number.isInteger(raw.page) || Number(raw.page) < 1 || Number(raw.page) > 300) throw new Error('노트의 PDF 페이지가 잘못되었습니다.');
    note.page = Number(raw.page);
  }
  if (raw.answerFeedback !== undefined) note.answerFeedback = answerFeedback(raw.answerFeedback, note.question, note.userAnswer, note.unknown, note.page);
  if (raw.guideModel !== undefined) note.guideModel = requireText(raw.guideModel, '설명 모델', 200);
  if (raw.visualEvidence !== undefined) {
    if (!Array.isArray(raw.visualEvidence) || !raw.visualEvidence.length || raw.visualEvidence.length > 4 || note.page === undefined) throw new Error('노트의 PDF 그림 근거가 잘못되었습니다.');
    note.visualEvidence = raw.visualEvidence.map(item => {
      const visual = object(item);
      if (visual.page !== note.page) throw new Error('노트의 그림 근거 페이지가 다릅니다.');
      return { page: note.page!, description: requireText(visual.description, '그림 설명', 2000), uncertainty: requireText(visual.uncertainty, '그림 해석의 불확실성', 1000) };
    });
  }
  if (raw.evidenceQuotes !== undefined) {
    if (!Array.isArray(raw.evidenceQuotes) || raw.evidenceQuotes.length > 5) throw new Error('노트의 원문 인용이 잘못되었습니다.');
    note.evidenceQuotes = raw.evidenceQuotes.map(item => {
      const quote = text(item, '근거 인용', 800);
      if ((!quote.trim() && !note.visualEvidence?.length) || !note.sourceExcerpt.includes(quote)) throw new Error('노트의 인용이 원문 구간에 없습니다.');
      return quote;
    });
  }
  if (!note.sourceExcerpt.length) throw new Error('노트의 원문 발췌가 비어 있습니다.');
  requireAnswer({ answer: note.userAnswer, unknown: note.unknown });
  if (note.unknown && !note.unresolved.length) throw new Error('모름으로 저장한 노트에는 미해결 내용이 필요합니다.');
  if (note.summaryOrigin === 'source' && note.summary !== `원문 발췌\n${note.sourceExcerpt}`) throw new Error('노트의 원문 요약이 발췌와 다릅니다.');
  if (doc) {
    if (studyPassage(doc, { ...source, passageIndex: note.passageIndex }) !== note.sourceExcerpt || unitPage(doc, getUnit(doc, source.unitId))?.page !== note.page) throw new Error('노트의 원문 구간이나 페이지가 다릅니다.');
    for (const item of note.terms) if (item.reference && item.reference.documentId === doc.id && (item.reference.sourceHash !== source.sourceHash || !doc.units.some(unit => unit.id === item.reference!.unitId))) throw new Error('노트 용어의 원문 근거가 다릅니다.');
  }
  return structuredClone(note);
}
