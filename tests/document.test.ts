import { describe, expect, it } from 'vitest';
import { applyStudyAction, createDocument, emptyLibrary, splitSource, validateLibrary } from '../src/learning/document.js';

describe('원문과 읽기 단위', () => {
  it('짧은 글도 공백까지 원문 그대로 유지한다', () => {
    const source = '  # 제목\n\n본문입니다.\n  ';
    const units = splitSource(source);
    expect(units).toHaveLength(1);
    expect(units[0]?.text).toBe(source);
    expect(units[0]?.start).toBe(0);
    expect(units[0]?.end).toBe(source.length);
  });
  it('긴 글을 겹침·누락 없이 나누고 UTF-16 문자 중간을 자르지 않는다', () => {
    const source = '# 첫 장\n\n' + '한글과 🐦 문장을 배웁니다.\n\n'.repeat(350) + '마지막 문장';
    const units = splitSource(source);
    expect(units.length).toBeGreaterThan(3);
    expect(units.map(unit => unit.text).join('')).toBe(source);
    units.forEach((unit, index) => {
      expect(unit.start).toBe(index === 0 ? 0 : units[index - 1]?.end);
      expect(unit.text).toBe(source.slice(unit.start, unit.end));
      expect(unit.text.length).toBeLessThanOrEqual(2200);
      expect(unit.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    });
  });
  it('빈 자료·과도한 길이를 거부한다', () => {
    expect(() => splitSource(' \n')).toThrow();
    expect(() => splitSource('a'.repeat(1_000_001))).toThrow();
  });
});

describe('학습 상태', () => {
  const document = () => createDocument({ title: '기억', source: '반복해서 떠올리면 기억을 확인할 수 있다.', goal: '설명하기' }, { id: 'doc1', now: '2026-10-09T00:00:00Z' });
  const library = () => ({ ...emptyLibrary(), documents: [document()], activeDocumentId: 'doc1' });
  it('읽음 표시가 회상 완료를 대신하지 않는다', () => {
    const state = applyStudyAction(library(), { type: 'mark-read', documentId: 'doc1', unitId: 'unit-0' });
    expect(state.documents[0]?.readUnitIds).toEqual(['unit-0']);
    expect(state.documents[0]?.recalls).toEqual({});
  });
  it('회상을 먼저 저장하고 평가에 따라 다음 복습일을 정한다', () => {
    const input = library();
    const saved = applyStudyAction(input, { type: 'save-recall', documentId: 'doc1', unitId: 'unit-0', answer: '기억을 꺼내서 확인한다' }, '2026-10-09T00:00:00Z');
    const rated = applyStudyAction(saved, { type: 'rate-recall', documentId: 'doc1', unitId: 'unit-0', rating: 'hard' }, '2026-10-09T00:00:00Z');
    expect(rated.documents[0]?.recalls['unit-0']?.reviewAt).toBe('2026-10-12T00:00:00.000Z');
    expect(input.documents[0]?.recalls).toEqual({});
    const changed = applyStudyAction(rated, { type: 'save-recall', documentId: 'doc1', unitId: 'unit-0', answer: '새 답변' });
    expect(changed.documents[0]?.recalls['unit-0']?.rating).toBeUndefined();
    expect(changed.documents[0]?.recalls['unit-0']?.reviewAt).toBeUndefined();
  });
  it('잘못된 문서·읽기 단위·평가·상태를 거부한다', () => {
    expect(() => applyStudyAction(library(), { type: 'select-unit', documentId: 'doc1', position: 90 })).toThrow();
    expect(() => applyStudyAction(library(), { type: 'rate-recall', documentId: 'doc1', unitId: 'unit-0', rating: 'good' })).toThrow();
    expect(() => validateLibrary({ ...library(), activeDocumentId: 'missing' })).toThrow();
    const bad = library();
    bad.documents[0]!.units[0]!.text = '변조';
    expect(() => validateLibrary(bad)).toThrow();
  });
});
