import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SourceTranslationPanel } from '../src/renderer/SourceTranslationPanel.js';
import { LanguageProvider } from '../src/renderer/LanguageContext.js';
import { createDocument, emptyLibrary } from '../src/learning/document.js';
import type { AppState, SwallowBridge } from '../src/shared/types.js';

describe('번역 초안의 원문 대조 화면', () => {
  it.each([['ko', 3], ['en', 3], ['ko', 5], ['en', 5]] as const)('%s 화면에서 revision %s의 현재·저장 결과 모두 검토 전임을 표시한다', (locale, revision) => {
    const doc = createDocument({ title: 'Draft', source: 'A retry may fail again.', goal: '' });
    doc.translations = { 'unit-0': { ko: {
      sourceText: doc.source, text: '재시도는 실패할 가능성이 높습니다.', targetLanguage: 'ko', model: 'fixture',
      identity: { providerId: 'ollama', connectionId: 'fixture-endpoint', upstreamModelId: 'fixture', modelFingerprint: 'fixture-digest', responseLanguage: 'ko', promptRevision: revision },
      createdAt: '2026-10-17T00:00:00.000Z',
    } } };
    const before = structuredClone(doc);
    const state: AppState = { library: { ...emptyLibrary(), documents: [doc], activeDocumentId: doc.id }, models: [], busy: null, streamText: '', notice: null };
    const html = renderToStaticMarkup(createElement(LanguageProvider, { preferences: { uiLocale: locale, responseLanguage: locale }, manageDocument: false },
      createElement(SourceTranslationPanel, { state, doc, unitId: 'unit-0', bridge: { mode: 'desktop' } as SwallowBridge })));
    expect(html.match(/class="translation-review-status"/g)).toHaveLength(2);
    expect(html).toContain(locale === 'ko' ? '검토 전 번역 초안' : 'Unreviewed translation draft');
    expect(html).toContain(locale === 'ko' ? '의미 정확성을 자동 판정하지 않습니다' : 'Meaning accuracy is not automatically assessed');
    expect(html).toContain(doc.source); expect(html).toContain(doc.translations['unit-0']!.ko!.text);
    expect(doc).toEqual(before);
  });
});
