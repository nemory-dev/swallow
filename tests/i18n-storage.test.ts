import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LibraryStore } from '../electron/library.js';
import { createBrowserPreview } from '../src/renderer/browser-preview.js';
import { emptyLibrary } from '../src/learning/document.js';

const roots: string[] = [], stores: LibraryStore[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const store of stores.splice(0)) store.close(); for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture(existing = false) {
  const root = await mkdtemp(join(tmpdir(), 'swallow-i18n-')); roots.push(root);
  const path = join(root, 'library.json');
  if (existing) await writeFile(path, JSON.stringify(emptyLibrary()));
  const store = new LibraryStore(path); stores.push(store); await store.load();
  return { store, root, path };
}
describe('SQLite 독립 언어 설정', () => {
  it('새 설치 OS 기본값을 저장하여 재시작/OS 변경에도 유지한다', async () => {
    const { store, path } = await fixture();
    expect((await store.initializeLanguagePreferences(['en-US'])).preferences).toEqual({ uiLocale: 'en', responseLanguage: 'en' });
    const before = store.exportLibrary();
    await store.setLanguagePreferences({ uiLocale: 'en', responseLanguage: 'ko' });
    expect(store.exportLibrary()).toEqual(before);
    store.close(); const next = new LibraryStore(path); stores.push(next); await next.load();
    expect((await next.initializeLanguagePreferences(['ko-KR'])).preferences).toEqual({ uiLocale: 'en', responseLanguage: 'ko' });
  });
  it('비어 있는 기존 설치도 ko/ko이며 손상 설정을 읽기로 덮어쓰지 않는다', async () => {
    const { store, root } = await fixture(true);
    expect((await store.initializeLanguagePreferences(['en'])).preferences).toEqual({ uiLocale: 'ko', responseLanguage: 'ko' });
    const db = new DatabaseSync(join(root, 'library.sqlite'));
    try {
      db.prepare('UPDATE settings SET value=? WHERE key=?').run('{broken', 'language-preferences');
      const result = await store.initializeLanguagePreferences(['en']);
      expect(result.status).toBe('invalid'); expect(result.preferences.uiLocale).toBe('ko');
      expect(db.prepare('SELECT value FROM settings WHERE key=?').get('language-preferences')?.value).toBe('{broken');
    } finally { db.close(); }
  });
  it('입력 allowlist와 저장 실패에서 확정값/라이브러리를 보존한다', async () => {
    const { store, root } = await fixture();
    await store.initializeLanguagePreferences(['ko']);
    // @ts-expect-error main runtime 경계에서도 검증한다.
    await expect(store.setLanguagePreferences({ uiLocale: 'fr', responseLanguage: 'ko' })).rejects.toThrow();
    const db = new DatabaseSync(join(root, 'library.sqlite'));
    try {
      db.exec("CREATE TRIGGER fail_language BEFORE UPDATE ON settings WHEN NEW.key='language-preferences' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
      const before = store.exportLibrary();
      await expect(store.setLanguagePreferences({ uiLocale: 'en', responseLanguage: 'ko' })).rejects.toThrow();
      expect((await store.initializeLanguagePreferences(['en'])).preferences).toEqual({ uiLocale: 'ko', responseLanguage: 'ko' });
      expect(store.exportLibrary()).toEqual(before);
    } finally { db.close(); }
  });
});

function browserFixture(existing = false) {
  const entries = new Map<string, string>();
  if (existing) entries.set('swallow.library.v1', JSON.stringify(emptyLibrary()));
  vi.stubGlobal('window', { speechSynthesis: undefined });
  vi.stubGlobal('navigator', { languages: ['en-US'] });
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
  vi.stubGlobal('localStorage', storage);
  return { entries, storage, bridge: createBrowserPreview() };
}
describe('browser 독립 언어 설정', () => {
  it('새 설치 en/en, 기존 빈 저장소 ko/ko, 별도 key에만 저장한다', async () => {
    const fresh = browserFixture();
    expect((await fresh.bridge.getState()).language?.preferences).toEqual({ uiLocale: 'en', responseLanguage: 'en' });
    await fresh.bridge.setLanguagePreferences({ uiLocale: 'ko', responseLanguage: 'en' });
    expect(fresh.entries.has('swallow.library.v1')).toBe(false);
    expect((await createBrowserPreview().getState()).language?.preferences).toEqual({ uiLocale: 'ko', responseLanguage: 'en' });
    const existing = browserFixture(true);
    expect((await existing.bridge.getState()).language?.preferences).toEqual({ uiLocale: 'ko', responseLanguage: 'ko' });
  });
  it('손상된 설정 원본과 학습 데이터는 보존하고 오류 상태를 제공한다', async () => {
    const { entries, bridge } = browserFixture(true);
    entries.set('swallow.preferences.v1', '{broken');
    const before = entries.get('swallow.library.v1');
    expect((await bridge.getState()).language?.status).toBe('invalid');
    expect(entries.get('swallow.preferences.v1')).toBe('{broken');
    expect(entries.get('swallow.library.v1')).toBe(before);
  });
  it('설정 쓰기 권한 실패는 이전 확정값과 학습 저장소를 유지한다', async () => {
    const { storage, entries, bridge } = browserFixture(true);
    const before = await bridge.getState(), library = entries.get('swallow.library.v1');
    vi.stubGlobal('localStorage', { ...storage, setItem: () => { throw new Error('quota SECRET'); } });
    await expect(bridge.setLanguagePreferences({ uiLocale: 'en', responseLanguage: 'en' })).rejects.toThrow();
    expect((await bridge.getState()).language).toEqual(before.language);
    expect(entries.get('swallow.library.v1')).toBe(library);
  });
});
