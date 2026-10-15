import type { AddDocumentInput, LibraryState, ReadingUnit, StudyAction, StudyDocument } from '../shared/types.js';
import { requireText, validateFeedback, validateGuide } from './guide.js';
import { splitPdfSource, validatePdf, unitPage } from './pdf.js';
import { validateSourceUrl } from './reading.js';
import { validateTranslations } from './translation.js';

export const MAX_SOURCE_LENGTH = 1_000_000;
export const MAX_DOCUMENTS = 20;
export function emptyLibrary(): LibraryState { return { version: 1, documents: [], activeDocumentId: null, selectedModel: null }; }

export function splitSource(source: string): ReadingUnit[] {
  requireText(source, '원문', MAX_SOURCE_LENGTH);
  const units: ReadingUnit[] = [];
  let start = 0;
  let section = '본문';
  while (start < source.length) {
    let end = Math.min(start + 1800, source.length);
    if (end < source.length) {
      const window = source.slice(start, end);
      let boundary = window.lastIndexOf('\n\n');
      if (boundary >= 700) end = start + boundary + 2;
      else {
        boundary = window.lastIndexOf('\n');
        if (boundary >= 700) end = start + boundary + 1;
        else {
          const matches = [...window.matchAll(/[.!?。][\s]+/g)];
          const last = matches.at(-1);
          if (last && last.index >= 700) end = start + last.index + last[0].length;
        }
      }
      if (/[\uD800-\uDBFF]/.test(source[end - 1] ?? '')) end--;
    }
    const text = source.slice(start, end);
    const headings = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)];
    if (headings.length) section = headings[0]![1]!.trim().slice(0, 160);
    units.push({ id: `unit-${units.length}`, start, end, text, section });
    if (headings.length) section = headings.at(-1)![1]!.trim().slice(0, 160);
    start = end;
  }
  return units;
}

export function createDocument(input: AddDocumentInput, options: { id?: string; now?: string } = {}): StudyDocument {
  if (!input || typeof input !== 'object') throw new Error('자료 입력이 잘못되었습니다.');
  const title = requireText(input.title, '제목', 160).trim();
  if (typeof input.goal !== 'string' || input.goal.length > 1000) throw new Error('학습 목표는 1,000자 이내로 입력해 주세요.');
  const pdf = input.pdf === undefined ? undefined : validatePdf(input.pdf, input.source);
  return {
    ...(pdf ? { pdf: structuredClone(pdf) } : {}),
    id: options.id ?? crypto.randomUUID(), title, source: input.source, goal: input.goal.trim(),
    createdAt: options.now ?? new Date().toISOString(), units: pdf ? splitPdfSource(input.source, pdf.pages) : splitSource(input.source),
    position: 0, readUnitIds: [], guides: {}, recalls: {},
    ...(input.sourceUrl === undefined ? {} : { sourceUrl: validateSourceUrl(input.sourceUrl) }),
  };
}

export function getDocument(library: LibraryState, id: string): StudyDocument {
  const doc = library.documents.find(document => document.id === id);
  if (!doc) throw new Error('자료를 찾을 수 없습니다.');
  return doc;
}
export function getUnit(doc: StudyDocument, id: string): ReadingUnit {
  const unit = doc.units.find(value => value.id === id);
  if (!unit) throw new Error('읽기 단위를 찾을 수 없습니다.');
  return unit;
}

export function applyStudyAction(library: LibraryState, action: StudyAction, now = new Date().toISOString()): LibraryState {
  if (!action || typeof action !== 'object') throw new Error('학습 동작이 잘못되었습니다.');
  const next = structuredClone(library);
  if (action.type === 'select-model') {
    next.selectedModel = requireText(action.model, '모델', 200);
    return next;
  }
  const doc = getDocument(next, action.documentId);
  switch (action.type) {
    case 'save-pdf-note': {
      const page = doc.pdf?.pages.find(value => value.page === action.page);
      if (!page || typeof action.note !== 'string' || action.note.length > 3000) throw new Error('PDF 페이지와 3,000자 이내 메모를 확인하세요.');
      if ((page.note ?? '') === action.note.trim()) break;
      page.note = action.note.trim();
      for (const unit of doc.units.filter(unit => unitPage(doc, unit)?.page === page.page)) {
        delete doc.guides[unit.id];
        const record = doc.recalls[unit.id];
        if (record) { delete record.feedback; delete record.rating; delete record.reviewAt; }
      }
      break;
    }
    case 'select-document': next.activeDocumentId = doc.id; break;
    case 'select-unit':
      if (!Number.isInteger(action.position) || action.position < 0 || action.position >= doc.units.length) throw new Error('읽기 위치가 잘못되었습니다.');
      doc.position = action.position;
      break;
    case 'mark-read':
      getUnit(doc, action.unitId);
      if (!doc.readUnitIds.includes(action.unitId)) doc.readUnitIds.push(action.unitId);
      break;
    case 'save-recall': {
      getUnit(doc, action.unitId);
      if (typeof action.answer !== 'string' || action.answer.length > 10_000) throw new Error('회상 답변은 10,000자 이내로 입력해 주세요.');
      if (doc.recalls[action.unitId]?.answer !== action.answer) doc.recalls[action.unitId] = { answer: action.answer, savedAt: now };
      break;
    }
    case 'rate-recall': {
      getUnit(doc, action.unitId);
      const record = doc.recalls[action.unitId];
      if (!record?.answer.trim()) throw new Error('먼저 회상 답변을 저장해 주세요.');
      const days = { again: 1, hard: 3, good: 7 };
      if (!Object.hasOwn(days, action.rating)) throw new Error('복습 평가가 잘못되었습니다.');
      record.rating = action.rating;
      record.reviewAt = new Date(Date.parse(now) + days[action.rating] * 86_400_000).toISOString();
      break;
    }
    case 'delete-document':
      next.documents = next.documents.filter(value => value.id !== doc.id);
      if (next.activeDocumentId === doc.id) next.activeDocumentId = next.documents[0]?.id ?? null;
      break;
    default: throw new Error('지원하지 않는 학습 동작입니다.');
  }
  return next;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('저장 파일 구조가 잘못되었습니다.');
  return value as Record<string, unknown>;
}
function date(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('저장된 날짜가 잘못되었습니다.');
}
export function validateLibrary(raw: unknown): LibraryState {
  const value = object(raw);
  if (value.version !== 1 || !Array.isArray(value.documents) || value.documents.length > MAX_DOCUMENTS) throw new Error('지원하지 않는 저장 파일입니다.');
  const ids = new Set<string>();
  for (const item of value.documents) {
    const doc = object(item);
    const id = requireText(doc.id, '자료 ID', 200);
    if (ids.has(id)) throw new Error('중복된 자료 ID입니다.');
    ids.add(id);
    requireText(doc.title, '제목', 160);
    if (doc.sourceUrl !== undefined) validateSourceUrl(doc.sourceUrl);
    const source = requireText(doc.source, '원문', MAX_SOURCE_LENGTH);
    if (typeof doc.goal !== 'string' || doc.goal.length > 1000) throw new Error('저장된 학습 목표가 잘못되었습니다.');
    date(doc.createdAt);
    const pdf = doc.pdf === undefined ? undefined : validatePdf(doc.pdf, source);
    const expected = pdf ? splitPdfSource(source, pdf.pages) : splitSource(source);
    if (doc.translations !== undefined) validateTranslations(doc.translations, expected);
    if (JSON.stringify(doc.units) !== JSON.stringify(expected)) throw new Error('저장된 읽기 단위가 원문과 다릅니다.');
    if (!Number.isInteger(doc.position) || (doc.position as number) < 0 || (doc.position as number) >= expected.length) throw new Error('저장된 읽기 위치가 잘못되었습니다.');
    const unitIds = new Set(expected.map(unit => unit.id));
    if (!Array.isArray(doc.readUnitIds) || doc.readUnitIds.some(id => !unitIds.has(id)) || new Set(doc.readUnitIds).size !== doc.readUnitIds.length) throw new Error('저장된 읽음 기록이 잘못되었습니다.');
    for (const [unitId, cached] of Object.entries(object(doc.guides))) {
      if (!unitIds.has(unitId)) throw new Error('학습 안내 위치가 잘못되었습니다.');
      const guide = object(cached);
      requireText(guide.model, '모델', 200);
      if (guide.revision !== undefined && (!Number.isInteger(guide.revision) || Number(guide.revision) < 1 || Number(guide.revision) > 1000)) throw new Error('Invalid guide revision.');
      validateGuide(guide.guide, expected.find(unit => unit.id === unitId)!.text, pdf ? [unitPage(doc as unknown as StudyDocument, expected.find(unit => unit.id === unitId)!)!.page] : []);
    }
    for (const [unitId, recalled] of Object.entries(object(doc.recalls))) {
      if (!unitIds.has(unitId)) throw new Error('회상 기록 위치가 잘못되었습니다.');
      const record = object(recalled);
      if (typeof record.answer !== 'string' || record.answer.length > 10_000) throw new Error('회상 답변이 잘못되었습니다.');
      date(record.savedAt);
      if (record.feedback !== undefined) validateFeedback(record.feedback, pdf ? [unitPage(doc as unknown as StudyDocument, expected.find(unit => unit.id === unitId)!)!.page] : []);
      if (record.rating !== undefined) {
        if (!['again', 'hard', 'good'].includes(record.rating as string) || !record.answer.trim()) throw new Error('복습 평가가 잘못되었습니다.');
        date(record.reviewAt);
      } else if (record.reviewAt !== undefined) throw new Error('복습 평가 없이 복습일이 저장되었습니다.');
    }
  }
  if (value.activeDocumentId !== null && !ids.has(value.activeDocumentId as string)) throw new Error('선택된 자료가 없습니다.');
  if (value.selectedModel !== null) requireText(value.selectedModel, '모델', 200);
  return structuredClone(value) as unknown as LibraryState;
}
