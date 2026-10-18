import { describe, expect, it } from 'vitest';
import { runtimePaths, desktopDataDirectory, pdfWorkerEnvironment } from '../electron/runtime.js';
import { join, resolve } from 'node:path';
const paths = (packaged: boolean, devUrl?: string) => runtimePaths({ packaged, resourcesPath: '/Applications/Swallow.app/Contents/Resources', currentDirectory: '/app.asar/dist-electron/electron', devUrl });
describe('배포 앱의 리소스 경로', () => {
  it('PDF 자식에는 외부 Node 로더 설정을 상속하지 않는다', () => {
    const original = { NODE_OPTIONS: '--require /private/agent', Node_Path: 'other-modules', ELECTRON_OVERRIDE_DIST_PATH: 'other-runtime', SystemRoot: 'C:\\Windows' };
    expect(pdfWorkerEnvironment(original)).toEqual({ SystemRoot: 'C:\\Windows', ELECTRON_RUN_AS_NODE: '1' });
    expect(original.NODE_OPTIONS).toContain('--require');
  });
  it('PDF 실행 파일은 ASAR 밖 Resources/native를 사용한다', () => {
    expect(paths(true)?.pdfHelper).toBe(resolve('/Applications/Swallow.app/Contents/Resources/native/swallow-pdf'));
  });
  it('배포 앱은 개발 URL 환경변수를 무시하고 로컬 UI를 연다', () => {
    expect(paths(true, 'https://untrusted.example')?.homeUrl).toBe('swallow://app/');
    expect(paths(true, 'http://127.0.0.1:5173')?.devUrl).toBeUndefined();
  });
  it('개발 실행은 기존 helper 경로와 제한된 개발 서버를 사용한다', () => {
    expect(paths(false, 'http://127.0.0.1:5173')).toMatchObject({ pdfHelper: resolve('/app.asar/dist-electron/native/swallow-pdf'), homeUrl: 'http://127.0.0.1:5173' });
    expect(() => paths(false, 'https://untrusted.example')).toThrow('허용하지 않는 개발 서버');
  });
  it('Windows worker·음성은 고정된 실제 리소스 경로를 사용한다', () => {
    expect(paths(true)).toMatchObject({
      windowsPdfWorker: resolve('/Applications/Swallow.app/Contents/Resources/pdf-runtime/worker.mjs'),
      speechHelper: resolve('/Applications/Swallow.app/Contents/Resources/native/swallow-speech.exe'),
    });
    expect(paths(false)).toMatchObject({
      windowsPdfWorker: resolve('/app.asar/dist-electron/native/pdf-runtime/worker.mjs'),
      speechHelper: resolve('/app.asar/dist-electron/native/swallow-speech.exe'),
    });
  });
  it('Windows는 로컬 사용자 폴더를 사용하고 Mac 기본 저장 경로는 유지한다', () => {
    const local = resolve('fixture-local-data');
    expect(desktopDataDirectory({ platform: 'win32', localAppData: local })).toBe(join(local, 'Swallow'));
    expect(desktopDataDirectory({ platform: 'darwin' })).toBeUndefined();
    expect(desktopDataDirectory({ platform: 'win32', localAppData: local, override: resolve('explicit-data') })).toBe(resolve('explicit-data'));
    expect(() => desktopDataDirectory({ platform: 'win32', localAppData: 'relative' })).toThrow('저장');
    expect(() => desktopDataDirectory({ platform: 'win32' })).toThrow('저장');
    expect(() => desktopDataDirectory({ platform: 'darwin', override: 'relative' })).toThrow('절대');
  });
});
