import { describe, expect, it } from 'vitest';
import { createDocument } from '../src/learning/document.js';
import { pdfSource } from '../src/learning/pdf.js';
import { StudyCoach, buildCoachInput } from '../electron/coach.js';
import { parseGuide, parseFeedback } from '../src/learning/guide.js';
const image = 'data:image/jpeg;base64,/9j/2Q==';
function document() {
  const value = pdfSource([{ text: 'First page text.', method: 'text' }, { text: 'Diagram A to B.', method: 'text' }]);
  return createDocument({ title: 'PDF', source: value.source, goal: '', pdf: { assetId: 'a'.repeat(64), pages: value.pages } });
}
const guide = { overview: 'A → B', keyPoints: [{ title: '흐름', explanation: 'A에서 B로 전달', quote: 'Diagram A to B.' }], question: '화살표를 설명하세요.', visualEvidence: [{ page: 2, description: 'A에서 B로 향하는 화살표', uncertainty: '작은 글자는 불확실' }] };
describe('그림과 페이지 근거를 포함한 학습', () => {
  it('현재 페이지 하나의 이미지와 메모를 본문과 함께 보낸다', async () => {
    const doc = document(); doc.pdf!.pages[1]!.note = '화살표 방향 확인';
    let pageRequested = 0;
    const coach = new StudyCoach({ streamResponse: async options => {
      const content = typeof options.input !== 'string' ? options.input[1]!.content : ''; 
      expect(content).toEqual(expect.arrayContaining([{ type: 'input_image', image_url: image, detail: 'high' }]));
      expect(JSON.stringify(content)).toContain('화살표 방향 확인');
      expect(JSON.stringify(content)).toContain('page');
      return { text: JSON.stringify(guide) };
    } }, 1000, async (_doc, page) => { pageRequested = page; return image; });
    expect(await coach.run('guide', doc, doc.units[1]!.id, () => {}, 'm')).toEqual(guide);
    expect(pageRequested).toBe(2);
  });
  it('다른 페이지 인용과 그림 근거 누락을 저장하지 않는다', () => {
    expect(() => parseGuide(JSON.stringify(guide), 'Diagram A to B.', [1])).toThrow('페이지');
    expect(() => parseGuide(JSON.stringify({ ...guide, visualEvidence: undefined }), 'Diagram A to B.', [2])).toThrow('그림');
    expect(() => parseFeedback(JSON.stringify({ assessment: '설명', missingPoints: [], nextStep: '확인', visualEvidence: guide.visualEvidence }), [1])).toThrow('페이지');
  });
  it('이미지만 근거인 개념은 지어낸 텍스트 인용 대신 페이지 근거를 요구한다', () => {
    const visual = { ...guide, keyPoints: [{ title: '흐름', explanation: 'A → B', quote: '' }] };
    expect(parseGuide(JSON.stringify(visual), '[텍스트 없음]', [2])).toEqual(visual);
    expect(() => parseGuide(JSON.stringify({ ...visual, visualEvidence: undefined }), '[텍스트 없음]')).toThrow();
  });
  it('렌더링 실패 시 텍스트만으로 그림을 읽었다고 처리하지 않는다', async () => {
    let called = false;
    const coach = new StudyCoach({ streamResponse: async () => { called = true; return { text: '' }; } }, 1000, async () => { throw new Error('PDF 이미지 실패'); });
    await expect(coach.run('guide', document(), 'unit-0', () => {}, 'm')).rejects.toThrow('이미지');
    expect(called).toBe(false);
  });
  it('이미지 준비 중에도 취소·시간 제한을 적용한다', async () => {
    const coach = new StudyCoach({ streamResponse: async () => ({ text: '' }) }, 15, async () => new Promise(() => {}));
    await expect(coach.run('guide', document(), 'unit-0', () => {}, 'm')).rejects.toThrow('시간');
    expect(coach.running).toBe(false);
  });
  it('PDF 이미지를 제공하지 않으면 명시적으로 실패한다', () => {
    const doc = document();
    expect(() => buildCoachInput('guide', doc, doc.units[0]!, undefined)).toThrow('이미지');
  });
});
