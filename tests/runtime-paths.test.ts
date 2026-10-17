import { describe, expect, it } from 'vitest';
import { runtimePaths } from '../electron/runtime.js';
const paths = (packaged: boolean, devUrl?: string) => runtimePaths({ packaged, resourcesPath: '/Applications/Swallow.app/Contents/Resources', currentDirectory: '/app.asar/dist-electron/electron', devUrl });
describe('배포 앱의 리소스 경로', () => {
  it('PDF 실행 파일은 ASAR 밖 Resources/native를 사용한다', () => {
    expect(paths(true)?.pdfHelper).toBe('/Applications/Swallow.app/Contents/Resources/native/swallow-pdf');
  });
  it('배포 앱은 개발 URL 환경변수를 무시하고 로컬 UI를 연다', () => {
    expect(paths(true, 'https://untrusted.example')?.homeUrl).toBe('swallow://app/');
    expect(paths(true, 'http://127.0.0.1:5173')?.devUrl).toBeUndefined();
  });
  it('개발 실행은 기존 helper 경로와 제한된 개발 서버를 사용한다', () => {
    expect(paths(false, 'http://127.0.0.1:5173')).toMatchObject({ pdfHelper: '/app.asar/dist-electron/native/swallow-pdf', homeUrl: 'http://127.0.0.1:5173' });
    expect(() => paths(false, 'https://untrusted.example')).toThrow('허용하지 않는 개발 서버');
  });
});
