import { describe, expect, it } from 'vitest';
import { createDocument, emptyLibrary, validateLibrary, applyStudyAction } from '../src/learning/document.js';
import { pdfSource, splitPdfSource } from '../src/learning/pdf.js';
const assetId = 'a'.repeat(64);
function document() {
  const extracted = pdfSource([{ text: 'First page. '.repeat(400), method: 'text' }, { text: 'Diagram: A to B.', method: 'ocr' }]);
  return createDocument({ title: 'PDF', goal: '', ...extracted, pdf: { assetId, pages: extracted.pages } });
}
describe('PDF 페이지와 기존 데이터 호환', () => {
  it('페이지 경계를 넘지 않고 원문을 누락 없이 나눈다', () => {
    const doc = document();
    expect(doc.units.map(u => u.text).join('')).toBe(doc.source);
    expect(doc.units.every(u => doc.pdf!.pages.some(p => u.start >= p.start && u.end <= p.end))).toBe(true);
    expect(doc.units.at(-1)?.section).toBe('PDF 2쪽');
    expect(splitPdfSource(doc.source, doc.pdf!.pages)).toEqual(doc.units);
    expect(validateLibrary({ ...emptyLibrary(), documents: [doc] }).documents[0]).toEqual(doc);
  });
  it('빈 스캔/그림 페이지도 원본 위치와 학습 구간을 유지한다', () => {
    const extracted = pdfSource([{ text: '', method: 'empty' }]);
    const doc = createDocument({ title: '그림', goal: '', source: extracted.source, pdf: { assetId, pages: extracted.pages } });
    expect(doc.units).toHaveLength(1);
    expect(doc.units[0]?.text).toContain('추출된 텍스트 없음');
    expect(doc.pdf?.pages[0]?.method).toBe('empty');
  });
  it('기존 v1 문서를 변경하지 않는다', () => {
    const doc = createDocument({ title: '기존', source: '기존 본문', goal: '' });
    expect(validateLibrary({ ...emptyLibrary(), documents: [doc] }).documents[0]).toEqual(doc);
  });
  it('변조한 위치·파일 키·추출 방법을 거부한다', () => {
    for (const change of [(d: ReturnType<typeof document>) => { d.pdf!.assetId = '../x'; }, (d: ReturnType<typeof document>) => { d.pdf!.pages[0]!.end--; }, (d: ReturnType<typeof document>) => { d.pdf!.pages[0]!.method = 'bad' as 'text'; }]) {
      const doc = document(); change(doc);
      expect(() => validateLibrary({ ...emptyLibrary(), documents: [doc] })).toThrow();
    }
  });
  it('그림 메모 변경 시 같은 페이지의 가이드·피드백을 초기화하며 답안은 보존한다', () => {
    const doc = document();
    doc.recalls['unit-0'] = { answer: 'A에서 B로 흐른다', savedAt: new Date().toISOString(), feedback: { assessment: '맞음', missingPoints: [], nextStep: '복습' } };
    doc.guides['unit-0'] = { model: 'm', guide: { overview: '개요', keyPoints: [{ title: '핵심', explanation: '설명', quote: 'First' }], question: '질문' } };
    const next = applyStudyAction({ ...emptyLibrary(), documents: [doc] }, { type: 'save-pdf-note', documentId: doc.id, page: 1, note: 'A → B 관계' });
    expect(next.documents[0]?.pdf?.pages[0]?.note).toBe('A → B 관계');
    expect(next.documents[0]?.guides['unit-0']).toBeUndefined();
    expect(next.documents[0]?.recalls['unit-0']?.feedback).toBeUndefined();
    expect(next.documents[0]?.recalls['unit-0']?.answer).toBe('A에서 B로 흐른다');
  });
});
