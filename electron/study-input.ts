import type { StudyDocument, StudySession } from '../src/shared/types.js';
import { readingPassages } from '../src/learning/reading.js';
import { getUnit } from '../src/learning/document.js';

/** Keep original offsets and PDF page boundaries while sending one small passage. */
export function studyInputDocument(doc: StudyDocument, session: StudySession): { document: StudyDocument; previousContext: string } {
  const unit = getUnit(doc, session.unitId);
  const passages = readingPassages(unit.text);
  const text = passages[session.passageIndex];
  if (text === undefined) throw new Error('학습 위치가 원문과 다릅니다. 다시 시작해 주세요.');
  const offset = passages.slice(0, session.passageIndex).join('').length;
  const previousContext = session.passageIndex ? passages[session.passageIndex - 1]! : doc.units[doc.units.findIndex(value => value.id === unit.id) - 1]?.text ?? '';
  return { document: { ...doc, units: doc.units.map(value => value.id === unit.id ? { ...unit, text, start: unit.start + offset, end: unit.start + offset + text.length } : value) }, previousContext: previousContext.slice(-600) };
}

export function termSearchUrl(term: unknown): string {
  if (typeof term !== 'string' || !term.trim() || term.length > 120 || /[\x00-\x1f\x7f]/.test(term)) throw new Error('검색할 용어를 120자 이내로 입력하세요.');
  return `https://www.google.com/search?q=${encodeURIComponent(term.trim())}`;
}
