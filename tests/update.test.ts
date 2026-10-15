import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateService, type UpdateRuntime } from '../electron/update.js';

class NativeUpdater extends EventEmitter {
  setFeedURL = vi.fn();
  checkForUpdates = vi.fn();
  quitAndInstall = vi.fn();
}
const runtime: UpdateRuntime = { currentVersion: '0.1.0', platform: 'darwin', arch: 'arm64', packaged: true,
  configuration: { feeds: { darwin: { arm64: 'https://updates.example.com/mac-arm64.json' } } } };
const services: UpdateService[] = [];
function setup(overrides: Partial<UpdateRuntime> = {}) {
  const native = new NativeUpdater();
  const service = new UpdateService(native, { ...runtime, ...overrides });
  services.push(service); return { native, service };
}
afterEach(() => { services.splice(0).forEach(service => service.dispose()); vi.useRealTimers(); });

describe('PC 업데이트', () => {
  it('개발 실행·미등록·지원하지 않는 설치는 네트워크 요청을 하지 않는다', () => {
    for (const option of [{ packaged: false }, { configuration: undefined }, { platform: 'linux' }, { platform: 'win32', windowsInstaller: false }]) {
      const { service, native } = setup(option);
      expect(service.state.status).toBe('unavailable');
      expect(() => service.check()).toThrow();
      expect(native.setFeedURL).not.toHaveBeenCalled(); expect(native.checkForUpdates).not.toHaveBeenCalled();
    }
  });
  it.each(['http://updates.example.com/feed', 'https://user:secret@updates.example.com/feed', 'https://updates.example.com/feed#fragment', 'not a URL'])('배포 피드 %s를 거부한다', url => {
    const { service, native } = setup({ configuration: { feeds: { darwin: { arm64: url } } } });
    expect(service.state.status).toBe('unavailable'); expect(native.setFeedURL).not.toHaveBeenCalled();
  });
  it('CPU별 HTTPS 피드를 사용하고 확인·다운로드 중 중복 호출을 막는다', () => {
    const { service, native } = setup();
    service.check(); service.check();
    expect(native.setFeedURL).toHaveBeenCalledWith({ url: 'https://updates.example.com/mac-arm64.json', serverType: 'json' });
    expect(native.checkForUpdates).toHaveBeenCalledTimes(1); expect(service.state.status).toBe('checking');
    native.emit('update-available'); service.check();
    expect(service.state.status).toBe('downloading'); expect(native.checkForUpdates).toHaveBeenCalledTimes(1);
    native.emit('update-downloaded', {}, '<script>plain text</script>', '0.2.0');
    expect(service.state).toMatchObject({ status: 'downloaded', releaseName: '0.2.0', releaseNotes: '<script>plain text</script>' });
    service.check(); expect(native.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(native.quitAndInstall).not.toHaveBeenCalled();
  });
  it('완료 이벤트를 받은 경우에만 최신 버전으로 표시한다', () => {
    const { service, native } = setup(); service.check();
    expect(service.state.checkedAt).toBeUndefined();
    native.emit('update-not-available'); expect(service.state.status).toBe('current'); expect(service.state.checkedAt).toBeTruthy();
    service.check(); expect(native.checkForUpdates).toHaveBeenCalledTimes(2);
  });
  it('외부 오류 내용을 노출하지 않고 실패 후 재시도한다', () => {
    const { service, native } = setup(); service.check();
    native.emit('error', new Error('secret credential and URL'));
    expect(service.state.status).toBe('error'); expect(JSON.stringify(service.state)).not.toContain('secret');
    service.check(); expect(native.checkForUpdates).toHaveBeenCalledTimes(2);
  });
  it('동기 확인 오류도 복구한다', () => {
    const { service, native } = setup(); native.checkForUpdates.mockImplementationOnce(() => { throw new Error('private path'); });
    service.check(); expect(service.state.status).toBe('error');
    service.check(); expect(service.state.status).toBe('checking');
  });
  it('시간 초과 후 취소되지 않은 요청을 중복 실행하지 않고 늦은 완료를 반영한다', () => {
    vi.useFakeTimers(); const { service, native } = setup(); service.check();
    vi.advanceTimersByTime(60_000); expect(service.state.status).toBe('stalled');
    service.check(); expect(native.checkForUpdates).toHaveBeenCalledTimes(1);
    native.emit('update-available'); expect(service.state.status).toBe('downloading');
    vi.advanceTimersByTime(15 * 60_000); expect(service.state.status).toBe('stalled');
    native.emit('update-downloaded', {}, '', '0.2.0'); expect(service.state.status).toBe('downloaded');
  });
  it('다운로드 전에는 설치하지 않는다', async () => {
    const { service, native } = setup(); const save = vi.fn();
    await expect(service.install(save)).rejects.toThrow('다운로드'); expect(save).not.toHaveBeenCalled(); expect(native.quitAndInstall).not.toHaveBeenCalled();
  });
  it('저장 실패 시 설치하지 않고 다운로드를 유지한다', async () => {
    const { service, native } = setup(); service.check(); native.emit('update-downloaded', {}, '', '0.2.0');
    await expect(service.install(async () => { throw new Error('답안 저장 실패'); })).rejects.toThrow('저장');
    expect(native.quitAndInstall).not.toHaveBeenCalled(); expect(service.state.status).toBe('downloaded');
    await service.install(async () => {}); expect(native.quitAndInstall).toHaveBeenCalledTimes(1);
  });
  it('저장이 완료될 때까지 기다리고 중복 설치를 차단한다', async () => {
    const { service, native } = setup(); service.check(); native.emit('update-downloaded', {}, '', '0.2.0');
    let finish!: () => void;
    const installing = service.install(() => new Promise<void>(resolve => { finish = resolve; }));
    expect(service.state.status).toBe('preparing'); expect(native.quitAndInstall).not.toHaveBeenCalled();
    await expect(service.install(async () => {})).rejects.toThrow();
    finish(); await installing; expect(service.state.status).toBe('installing'); expect(native.quitAndInstall).toHaveBeenCalledTimes(1);
  });
  it('설치 시작 후 네이티브 오류가 와도 다운로드를 유지하고 재시도를 허용한다', async () => {
    const { service, native } = setup(); service.check(); native.emit('update-downloaded', {}, '', '0.2.0');
    await service.install(async () => {}); native.emit('error', new Error('private installation path'));
    expect(service.state.status).toBe('downloaded'); expect(JSON.stringify(service.state)).not.toContain('private');
    await service.install(async () => {}); expect(native.quitAndInstall).toHaveBeenCalledTimes(2);
  });
  it('손상된 배포 설정과 배포 준비 전을 구분한다', () => {
    const { service } = setup({ configurationError: true }); expect(service.state.status).toBe('unavailable');
    expect(service.state.message).toContain('설정');
  });
  it('Windows는 macOS JSON 옵션 없이 설치 피드를 사용하며 첫 실행 잠금 중에는 확인하지 않는다', () => {
    const options = { platform: 'win32', arch: 'x64', windowsInstaller: true, configuration: { feeds: { win32: { x64: 'https://updates.example.com/windows/' } } } };
    const { service, native } = setup(options); service.check(); expect(native.setFeedURL).toHaveBeenCalledWith({ url: 'https://updates.example.com/windows/' });
    const first = setup({ ...options, windowsFirstRun: true });
    expect(first.service.state.status).toBe('unavailable'); expect(first.native.setFeedURL).not.toHaveBeenCalled();
  });
});
