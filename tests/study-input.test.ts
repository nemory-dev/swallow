import { describe, expect, it } from 'vitest';
import { createDocument } from '../src/learning/document.js';
import { createStudySession } from '../src/learning/session.js';
import { readingPassages } from '../src/learning/reading.js';
import { studyInputDocument, termSearchUrl } from '../electron/study-input.js';
describe('짧은 학습 입력과 외부 검색 경계', () => {
  it('작은 구간과 이전 맥락을 분리하며 원문 offset을 유지한다', () => {
    const doc = createDocument({ title: '자료', source: '한 문장입니다. '.repeat(300), goal: '' });
    const session = { ...createStudySession(doc, 'a'.repeat(64)), passageIndex: 1 };
    const input = studyInputDocument(doc, session), unit = input.document.units[0]!;
    expect(unit.text).toBe(readingPassages(doc.units[0]!.text)[1]);
    expect(doc.source.slice(unit.start, unit.end)).toBe(unit.text);
    expect(input.previousContext).toBe(readingPassages(doc.units[0]!.text)[0]);
    expect(doc.units[0]!.start).toBe(0);
  });
  it('외부 검색은 고정 HTTPS 주소와 인코딩한 용어만 사용한다', () => {
    expect(termSearchUrl('state & node')).toBe('https://www.google.com/search?q=state%20%26%20node');
    expect(termSearchUrl('javascript:alert(1)')).toMatch(/^https:\/\/www.google.com\/search\?q=javascript%3A/);
    for (const value of ['', 'x'.repeat(121), 'hello\nworld', null]) expect(() => termSearchUrl(value)).toThrow();
  });
});
