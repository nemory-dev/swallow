import { describe, expect, it } from 'vitest';
import { readingPassages, speechText } from '../src/learning/reading.js';
import { createDocument, emptyLibrary, validateLibrary } from '../src/learning/document.js';

describe('reading aids', () => {
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
