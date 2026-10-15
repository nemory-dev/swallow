import type { PdfPage, PdfSource, ReadingUnit, StudyDocument } from '../shared/types.js';
import { splitSource, MAX_SOURCE_LENGTH } from './document.js';

export const MAX_PDF_BYTES = 40_000_000;
export const MAX_PDF_PAGES = 300;
export function pdfSource(extracted: { text: string; method: PdfPage['method'] }[]): { source: string; pages: PdfPage[] } {
  if (!extracted.length || extracted.length > MAX_PDF_PAGES) throw new Error('PDF는 1~300쪽까지 지원합니다.');
  let source = '';
  const pages = extracted.map((value, index) => {
    const start = source.length;
    source += `# PDF ${index + 1}쪽\n\n${value.text.trim() || '[추출된 텍스트 없음: 원본 페이지의 그림을 확인하세요.]'}\n\n`;
    return { page: index + 1, start, end: source.length, method: value.method };
  });
  if (source.length > MAX_SOURCE_LENGTH) throw new Error('PDF 추출 원문은 100만 자 이내여야 합니다. PDF를 나누어 가져오세요.');
  return { source, pages };
}
export function validatePdf(value: unknown, source: string): PdfSource {
  if (!value || typeof value !== 'object') throw new Error('PDF 정보가 잘못되었습니다.');
  const pdf = value as PdfSource;
  if (typeof pdf.assetId !== 'string' || !/^[a-f0-9]{64}$/.test(pdf.assetId) || !Array.isArray(pdf.pages) || !pdf.pages.length || pdf.pages.length > MAX_PDF_PAGES) throw new Error('PDF 원본 정보가 잘못되었습니다.');
  let end = 0;
  for (const [index, page] of pdf.pages.entries()) {
    if (!page || page.page !== index + 1 || page.start !== end || !Number.isInteger(page.end) || page.end <= end || page.end > source.length ||
      !['text', 'ocr', 'empty'].includes(page.method) || (page.note !== undefined && (typeof page.note !== 'string' || page.note.length > 3000))) throw new Error('PDF 페이지 위치나 메모가 잘못되었습니다.');
    end = page.end;
  }
  if (end !== source.length) throw new Error('PDF 페이지가 원문과 다릅니다.');
  return pdf;
}
export function splitPdfSource(source: string, pages: PdfPage[]): ReadingUnit[] {
  return pages.flatMap(page => splitSource(source.slice(page.start, page.end)).map(unit => ({ ...unit, start: page.start + unit.start, end: page.start + unit.end, section: `PDF ${page.page}쪽` })))
    .map((unit, index) => ({ ...unit, id: `unit-${index}` }));
}
export function unitPage(doc: StudyDocument, unit: ReadingUnit): PdfPage | undefined {
  return doc.pdf?.pages.find(page => unit.start >= page.start && unit.end <= page.end);
}
