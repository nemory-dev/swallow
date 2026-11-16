import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SourceTranslationPanel } from '../src/renderer/SourceTranslationPanel.js';
import { LanguageProvider } from '../src/renderer/LanguageContext.js';
import { createDocument, emptyLibrary } from '../src/learning/document.js';
import { compareTranslationNumbers } from '../src/learning/translation.js';
import { readingPassages } from '../src/learning/reading.js';
import type { AppState, SwallowBridge } from '../src/shared/types.js';

const translation = { start: async () => {} };

describe('번역 초안의 원문 대조 화면', () => {
  it('저장된 전체 초안 보기에서 이전 버전에 저장한 현재 구간의 번역만 표시한다', () => {
    const source = 'A'.repeat(420) + 'Second passage.';
    const doc = createDocument({ title: 'Draft', source, goal: '' });
    const [first, second] = readingPassages(doc.units[0]!.text);
    const firstDraft = '첫 구간에만 나오는 번역.';
    const secondDraft = '둘째 구간에만 나오는 번역.';
    doc.translations = { 'unit-0': { ko: {
      sourceText: source, text: firstDraft + secondDraft, targetLanguage: 'ko', model: 'fixture',
      identity: { providerId: 'ollama', connectionId: 'fixture-endpoint', upstreamModelId: 'fixture', modelFingerprint: 'fixture-digest', responseLanguage: 'ko', promptRevision: 7 },
      createdAt: '2026-10-17T00:00:00.000Z',
      sentenceEnds: [{ sourceEnd: first!.length, textEnd: firstDraft.length }, { sourceEnd: first!.length + second!.length, textEnd: firstDraft.length + secondDraft.length }],
    } } };
    const state: AppState = { library: { ...emptyLibrary(), documents: [doc], activeDocumentId: doc.id }, models: [], busy: null, streamText: '', notice: null };
    const html = renderToStaticMarkup(createElement(LanguageProvider, { preferences: { uiLocale: 'ko', responseLanguage: 'ko' }, manageDocument: false },
      createElement(SourceTranslationPanel, { state, doc, unitId: 'unit-0', passageIndex: 1, bridge: { mode: 'desktop' } as SwallowBridge, translation })));
    expect(html).toMatch(/<details[^>]*><summary>저장된 자료 번역 초안 보기<\/summary>.*둘째 구간에만 나오는 번역\..*<\/details>/s);
    expect(html).not.toContain(firstDraft);
    expect(doc.translations['unit-0']!.ko!.text).toBe(firstDraft + secondDraft);
  });
  it('동일한 값·단위의 한영 표기는 허용하고 바뀌거나 누락된 수치를 양쪽에서 찾는다', () => {
    expect(compareTranslationNumbers('It weighs +５.０ kg and takes 1,200 seconds.', '1,200초가 걸리고 +5킬로그램입니다.'))
      .toEqual({ source: [], translation: [] });
    expect(compareTranslationNumbers('5 kg and 10 kg, plus 2 kg.', '5g과 11 kg입니다.'))
      .toEqual({ source: ['5 kg', '10 kg', '2 kg'], translation: ['5g', '11 kg'] });
    expect(compareTranslationNumbers('Use `x = 42` and https://example.com/7.', '설정은 `x = 42`과 https://example.com/7. 입니다.'))
      .toEqual({ source: [], translation: [] });
  });
  it.each([['ko', 3], ['en', 3], ['ko', 5], ['en', 5]] as const)('%s 화면에서 revision %s의 기존 초안을 계속 읽을 수 있다', (locale, revision) => {
    const doc = createDocument({ title: 'Draft', source: 'A retry may fail again.', goal: '' });
    doc.translations = { 'unit-0': { ko: {
      sourceText: doc.source, text: '재시도는 실패할 가능성이 높습니다.', targetLanguage: 'ko', model: 'fixture',
      identity: { providerId: 'ollama', connectionId: 'fixture-endpoint', upstreamModelId: 'fixture', modelFingerprint: 'fixture-digest', responseLanguage: 'ko', promptRevision: revision },
      createdAt: '2026-10-17T00:00:00.000Z',
    } } };
    const before = structuredClone(doc);
    const state: AppState = { library: { ...emptyLibrary(), documents: [doc], activeDocumentId: doc.id }, models: [], busy: null, streamText: '', notice: null };
    const html = renderToStaticMarkup(createElement(LanguageProvider, { preferences: { uiLocale: locale, responseLanguage: locale }, manageDocument: false },
      createElement(SourceTranslationPanel, { state, doc, unitId: 'unit-0', bridge: { mode: 'desktop' } as SwallowBridge, translation })));
    expect(html.match(/class="translation-review-status"/g)).toHaveLength(1);
    expect(html).not.toContain('<table');
    expect(html).not.toContain('translation-saved-unit');
    expect(html).toContain(locale === 'ko' ? '검토 전 번역 초안' : 'Unreviewed translation draft');
    expect(html).toContain(locale === 'ko' ? '의미 정확성을 자동 판정하지 않습니다' : 'Meaning accuracy is not automatically assessed');
    expect(html).toContain(doc.translations['unit-0']!.ko!.text);
    expect(doc).toEqual(before);
  });
});
