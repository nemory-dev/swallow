import { describe, expect, it } from 'vitest';
import {
  catalogs, createTranslator, formatDate, formatNumber, normalizeLocale,
  resolveLanguagePreferences, translate,
} from '../src/shared/i18n.js';

describe('언어 초기값과 정규화', () => {
  it.each(['ko', 'ko-KR', 'KO-kr', 'ko_KR'])('%s를 ko로 합친다', value => {
    expect(normalizeLocale(value)).toBe('ko');
  });
  it.each(['en', 'en-GB', 'EN-us'])('%s를 en으로 합친다', value => {
    expect(normalizeLocale(value)).toBe('en');
  });
  it.each([undefined, null, '', 'fr-FR', 'english', 123, '__proto__'])('지원하지 않는 값 %s는 지정 fallback을 사용한다', value => {
    expect(normalizeLocale(value)).toBe('ko');
    expect(normalizeLocale(value, 'en')).toBe('en');
  });
  it('기존 설치는 OS 언어와 무관하게 ko/ko를 유지한다', () => {
    expect(resolveLanguagePreferences({ installation: 'existing', systemLocales: ['en-US'] })).toEqual({
      preferences: { uiLocale: 'ko', responseLanguage: 'ko' }, status: 'missing', invalidFields: [],
    });
  });
  it.each([
    [['ko-KR'], 'ko'], [['en-GB'], 'en'], [['fr-FR', 'ko-KR'], 'en'],
    [[], 'en'], [['', '@@', 'ko-KR'], 'ko'],
  ] as const)('새 설치의 OS 우선순위 %s를 %s로 결정한다', (systemLocales, expected) => {
    expect(resolveLanguagePreferences({ installation: 'new', systemLocales }).preferences).toEqual({
      uiLocale: expected, responseLanguage: expected,
    });
  });
  it('저장된 두 설정을 독립적으로 존중하고 원본을 바꾸지 않는다', () => {
    const stored = Object.freeze({ uiLocale: 'en', responseLanguage: 'ko', extra: 'preserve' });
    expect(resolveLanguagePreferences({ installation: 'existing', systemLocales: ['ko-KR'], stored })).toEqual({
      preferences: { uiLocale: 'en', responseLanguage: 'ko' }, status: 'valid', invalidFields: [],
    });
    expect(stored.extra).toBe('preserve');
  });
  it('손상 설정은 missing과 구분하고 정상 필드만 보존한다', () => {
    expect(resolveLanguagePreferences({ installation: 'new', systemLocales: ['en'], stored: { uiLocale: 'en', responseLanguage: 'fr' } })).toEqual({
      preferences: { uiLocale: 'en', responseLanguage: 'ko' }, status: 'invalid', invalidFields: ['responseLanguage'],
    });
  });
  it.each([null, [], '{broken', 1, {}, { uiLocale: 'en-US', responseLanguage: null }])('손상 설정 %s를 자동 저장하거나 OS 기본값으로 덮어쓰지 않는다', stored => {
    const original = JSON.stringify(stored);
    expect(resolveLanguagePreferences({ installation: 'new', systemLocales: ['en'], stored })).toEqual({
      preferences: { uiLocale: 'ko', responseLanguage: 'ko' }, status: 'invalid', invalidFields: ['uiLocale', 'responseLanguage'],
    });
    expect(JSON.stringify(stored)).toBe(original);
  });
  it('prototype에서 상속된 설정은 신뢰하지 않는다', () => {
    expect(resolveLanguagePreferences({ installation: 'existing', stored: Object.create({ uiLocale: 'en', responseLanguage: 'en' }) }).status).toBe('invalid');
  });
});

describe('번역 계약', () => {
  it('ko/en 사전의 모든 key와 placeholder 및 복수형 branch가 일치한다', () => {
    expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs.ko).sort());
    const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
    for (const key of Object.keys(catalogs.ko) as (keyof typeof catalogs.ko)[]) {
      const ko = catalogs.ko[key], en = catalogs.en[key];
      expect(typeof ko, key).toBe(typeof en);
      if (typeof ko === 'string' && typeof en === 'string') expect(placeholders(en), key).toEqual(placeholders(ko));
      else if (typeof ko !== 'string' && typeof en !== 'string') {
        expect(Object.keys(en).sort(), key).toEqual(['one', 'other']);
        expect(placeholders(ko.one), key).toEqual(placeholders(ko.other));
        expect(placeholders(en.one), key).toEqual(placeholders(ko.other));
        expect(placeholders(en.other), key).toEqual(placeholders(ko.other));
      }
    }
  });
  it('완성 문장에 값을 한 번만 보간하고 숫자는 locale로 표시한다', () => {
    expect(translate('en', 'document.characterLimit', { count: 1234, max: 1000000 })).toBe('1,234 / 1,000,000 characters');
    expect(translate('ko', 'folder.manage', { name: '{page} <script>$&</script>' })).toBe('{page} <script>$&</script> 폴더 관리');
  });
  it('모든 사전 항목이 보간 누락 없이 plain text로 렌더링된다', () => {
    // Dynamic catalog enumeration is intentionally outside the static call-site type contract.
    const render = translate as (locale: 'ko' | 'en', key: keyof typeof catalogs.ko, params: Record<string, string | number>) => string;
    const numeric = new Set(['count', 'max', 'page', 'total', 'index', 'active', 'archived']);
    for (const locale of ['ko', 'en'] as const) {
      for (const key of Object.keys(catalogs.ko) as (keyof typeof catalogs.ko)[]) {
        const entry = catalogs.ko[key];
        const template = typeof entry === 'string' ? entry : entry.other;
        const params = Object.fromEntries([...template.matchAll(/\{(\w+)\}/g)].map(match => {
          const name = match[1]!;
          return [name, numeric.has(name) ? 2 : 'sample'];
        }));
        const result = render(locale, key, params);
        expect(result.length, `${locale}:${key}`).toBeGreaterThan(0);
        expect(result, `${locale}:${key}`).not.toMatch(/\{\w+\}/);
      }
    }
  });
  it('영어 0/1/2와 한국어 복수형을 처리한다', () => {
    const en = createTranslator('en'), ko = createTranslator('ko');
    expect(en('count.items', { count: 0 })).toBe('0 items');
    expect(en('count.items', { count: 1 })).toBe('1 item');
    expect(en('count.items', { count: 2 })).toBe('2 items');
    expect(en('count.days', { count: 1 })).toBe('1 day');
    expect(en('count.pages', { count: 2 })).toBe('2 pages');
    expect(en('count.characters', { count: 1 })).toBe('1 character');
    expect(ko('count.items', { count: 1 })).toBe('1개');
    expect(ko('count.items', { count: 2 })).toBe('2개');
  });
  it('지원하지 않는 runtime locale/key는 안전한 한국어/일반 오류로 fallback한다', () => {
    expect(translate('xx' as 'ko', 'common.close')).toBe('닫기');
    expect(translate('en', 'provider-secret' as 'common.close')).toBe(translate('en', 'errors.unexpected'));
    expect(translate('en', '__proto__' as 'common.close')).toBe(translate('en', 'errors.unexpected'));
  });
  it('필수 보간값 누락/타입 오류/비정상 숫자를 raw 값 없이 거부한다', () => {
    // @ts-expect-error 필수 params 누락은 compile-time에도 거부한다.
    expect(() => translate('en', 'pdf.page')).toThrow(TypeError);
    // @ts-expect-error 페이지 번호는 number여야 한다.
    expect(() => translate('en', 'pdf.page', { page: 'secret' })).toThrow(TypeError);
    expect(() => translate('en', 'count.items', { count: NaN })).toThrow(RangeError);
    expect(() => translate('en', 'count.items', { count: -1 })).toThrow(RangeError);
    expect(() => translate('en', 'pdf.page', Object.create({ page: 1 }))).toThrow(TypeError);
  });
});

describe('표시 전용 formatter', () => {
  it('숫자 옵션을 지원하고 비정상 숫자를 거부한다', () => {
    expect(formatNumber('en', 1234.5, { maximumFractionDigits: 0 })).toBe('1,235');
    expect(formatNumber('ko', 1234)).toBe('1,234');
    expect(() => formatNumber('en', Infinity)).toThrow(RangeError);
  });
  it('동일 ISO 시각을 locale/시간대로 표시하며 저장값을 바꾸지 않는다', () => {
    const iso = '2026-10-14T15:30:00Z';
    const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' };
    expect(formatDate('en', iso, options)).toBe(new Intl.DateTimeFormat('en-US', options).format(new Date(iso)));
    expect(formatDate('ko', iso, options)).toBe(new Intl.DateTimeFormat('ko-KR', options).format(new Date(iso)));
    expect(formatDate('en', iso, options)).not.toBe(formatDate('en', iso, { ...options, timeZone: 'UTC' }));
    expect(iso).toBe('2026-10-14T15:30:00Z');
  });
  it('기본 시간대는 기기를 따르며 잘못된 날짜는 번역된 빈 값으로 표시한다', () => {
    const date = new Date('2026-10-14T00:00:00Z'), original = date.getTime();
    expect(formatDate('en', date)).toBe(new Intl.DateTimeFormat('en-US').format(date));
    expect(date.getTime()).toBe(original);
    expect(formatDate('en', 'invalid')).toBe('Date unavailable');
    expect(formatDate('ko', new Date(NaN))).toBe('날짜 없음');
  });
});

// TypeScript 검사 전용: 실행하지 않아도 key/params 계약의 회귀를 검사한다.
function translationTypeContract() {
  // @ts-expect-error 사전에 없는 key
  translate('en', 'missing.key');
  // @ts-expect-error 보간 없는 key에 임의 params 금지
  translate('en', 'common.close', { rawError: 'secret' });
  // @ts-expect-error 잘못된 보간 이름
  translate('en', 'folder.manage', { title: 'name' });
  // @ts-expect-error 숫자 보간 key에도 필수 params 필요
  createTranslator('en')('count.days');
}
void translationTypeContract;
