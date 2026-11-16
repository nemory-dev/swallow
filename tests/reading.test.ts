import { describe, expect, it } from 'vitest';
import { readingPassages, speechText } from '../src/learning/reading.js';
import { createDocument, emptyLibrary, validateLibrary } from '../src/learning/document.js';

describe('reading aids', () => {
  it('prefers a quoted sentence ending over a line break inside the next PDF sentence', () => {
    const first = '“' + 'Read this sentence carefully '.repeat(9).trimEnd() + '.” ';
    const second = 'The next sentence ' + 'has more text '.repeat(6) + '\n' + 'that continues here '.repeat(7) + 'until its final period.';
    const source = first + second;
    expect(readingPassages(source)).toEqual([first, second]);
  });
  it('keeps a short sentence intact when the next sentence fits in its own passage', () => {
    const first = '첫 문장입니다. ';
    const second = '긴 문장의 원문을 그대로 읽습니다 '.repeat(22).trimEnd() + '。';
    const third = '마지막 문장은 별도로 이어집니다.';
    expect(readingPassages(first + second + third)).toEqual([first, second, third]);
    expect(readingPassages(first + second + third, 1)[0]).not.toBe(first);
  });
  it('falls back to a word boundary when a single sentence is longer than 420 characters', () => {
    const source = 'This long sentence '.repeat(30).trimEnd() + '.';
    const parts = readingPassages(source);
    expect(parts[0]).toMatch(/\s$/);
    expect(parts.join('')).toBe(source);
    expect(parts.every(part => part.length <= 420)).toBe(true);
  });
  it('keeps all original text and Unicode while splitting long and short sources', () => {
    for (const source of ['짧은 문장.', '# 제목\n\n첫 문단. 둘째 문장!\n\n다음 문단.', '가'.repeat(419) + '😀끝'.repeat(200)]) {
      const passages = readingPassages(source);
      expect(passages.join('')).toBe(source);
      expect(passages.every(p => p.length <= 420 && !/[\uD800-\uDBFF]$/.test(p))).toBe(true);
    }
    expect(readingPassages('')).toEqual([]);
  });
  it('removes Markdown decoration for speech without discarding code or link labels', () => {
    expect(speechText('# 읽기\n\n[상태](https://example.com)와 `node`\n```ts\nconst x = 1;\n```')).toBe('읽기\n\n상태와 node\nconst x = 1;');
  });
  it('preserves old documents and optional public source URL metadata', () => {
    const old = createDocument({ title: '기존', source: '원문', goal: '' });
    const linked = createDocument({ title: '링크', source: '본문', goal: '', sourceUrl: 'https://react.dev/learn' });
    const saved = { ...emptyLibrary(), documents: [old, linked], activeDocumentId: old.id };
    expect(validateLibrary(saved).documents[1]?.sourceUrl).toBe('https://react.dev/learn');
    for (const sourceUrl of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:password@example.com', 'https://example.com/\nsecret']) {
      expect(() => createDocument({ title: '링크', source: '본문', goal: '', sourceUrl })).toThrow();
      expect(() => validateLibrary({ ...saved, documents: [{ ...old, sourceUrl }] })).toThrow();
    }
  });
});
