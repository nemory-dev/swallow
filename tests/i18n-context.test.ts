import { createElement, useEffect, useState, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../src/renderer/LanguageContext.js';
import type { LanguagePreferences } from '../src/shared/i18n.js';

describe('controlled LanguageProvider', () => {
  let root: Root;
  let container: HTMLElement;
  let mounts: number;
  let setDraft: (text: string) => void;
  let childNode: HTMLElement | null;

  function Consumer() {
    const { t, uiLocale, responseLanguage, formatNumber, formatDate } = useLanguage();
    const [draft, edit] = useState('내 원문과 answer');
    setDraft = edit;
    useEffect(() => { mounts += 1; }, []);
    return createElement('section', { lang: uiLocale, 'data-response': responseLanguage },
      createElement('span', null, t('common.close')),
      createElement('input', { value: draft, readOnly: true, 'aria-label': t('study.answer') }),
      createElement('output', null, formatNumber(1234), ' · ', formatDate('invalid')));
  }
  async function render(preferences: LanguagePreferences, manageDocument = true) {
    await act(async () => {
      root.render(createElement(LanguageProvider, { preferences, manageDocument }, createElement(Consumer)));
    });
  }
  beforeEach(() => {
    const { window, document } = parseHTML('<!doctype html><html lang="fr"><head><title>Existing title</title></head><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', document);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.getElementById('root') as unknown as HTMLElement;
    root = createRoot(container);
    mounts = 0;
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it('UI 언어와 설명 언어를 독립적으로 제공한다', async () => {
    await render({ uiLocale: 'en', responseLanguage: 'ko' });
    expect(container.querySelector('span')?.textContent).toBe('Close');
    expect(container.querySelector('section')?.getAttribute('data-response')).toBe('ko');
    expect(container.querySelector('output')?.textContent).toBe('1,234 · Date unavailable');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('Swallow · Learn one passage at a time');
  });
  it('전환 시 자식 컴포넌트와 입력 DOM/초안/원문을 보존한다', async () => {
    await render({ uiLocale: 'ko', responseLanguage: 'en' });
    await act(async () => setDraft('사용자 작성 {text} <raw>'));
    childNode = container.querySelector('input');
    await render({ uiLocale: 'en', responseLanguage: 'en' });
    expect(container.querySelector('input')).toBe(childNode);
    expect(container.querySelector('input')?.value).toBe('사용자 작성 {text} <raw>');
    expect(container.querySelector('input')?.getAttribute('aria-label')).toBe('My answer');
    expect(mounts).toBe(1);
  });
  it('설명 언어만 바꾸면 UI와 문서 언어는 그대로이다', async () => {
    await render({ uiLocale: 'ko', responseLanguage: 'ko' });
    await render({ uiLocale: 'ko', responseLanguage: 'en' });
    expect(container.querySelector('span')?.textContent).toBe('닫기');
    expect(container.querySelector('section')?.getAttribute('data-response')).toBe('en');
    expect(document.documentElement.lang).toBe('ko');
    expect(mounts).toBe(1);
  });
  it('metadata 관리를 끌 수 있고 unmount 시 이전 metadata를 복원한다', async () => {
    await render({ uiLocale: 'en', responseLanguage: 'ko' }, false);
    expect(document.title).toBe('Existing title');
    expect(document.documentElement.lang).toBe('fr');
    await render({ uiLocale: 'en', responseLanguage: 'ko' });
    await act(async () => root.render(null));
    expect(document.title).toBe('Existing title');
    expect(document.documentElement.lang).toBe('fr');
  });
});

describe('SSR 및 context 사용 계약', () => {
  function Label() { return createElement('p', null, useLanguage().t('folder.manage', { name: '<script>alert(1)</script>' })); }
  it('브라우저 전역 없이 렌더링하고 보간된 사용자 문자열을 React가 escape한다', () => {
    expect(renderToStaticMarkup(createElement(LanguageProvider, {
      preferences: { uiLocale: 'en', responseLanguage: 'ko' },
    }, createElement(Label)))).toBe('<p>Manage folder &lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });
  it('Provider 없이 hook을 사용하면 조용한 기본값 대신 사용 오류를 알린다', () => {
    expect(() => renderToStaticMarkup(createElement(Label))).toThrow('useLanguage requires LanguageProvider.');
  });
});
