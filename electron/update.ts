import type { EventEmitter } from 'node:events';
import { readFile, stat } from 'node:fs/promises';
import type { UpdateState } from '../src/shared/types.js';

interface NativeUpdater extends Pick<EventEmitter, 'on' | 'removeListener'> {
  setFeedURL(options: { url: string; serverType?: string }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
}
export interface UpdateRuntime {
  currentVersion: string; platform: string; arch: string; packaged: boolean;
  configuration?: unknown; configurationError?: boolean; windowsInstaller?: boolean; windowsFirstRun?: boolean; store?: boolean;
}
export async function readUpdateConfiguration(path: string): Promise<unknown> {
  try {
    if ((await stat(path)).size > 64_000) throw new Error('업데이트 설정이 너무 큽니다.');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
    throw new Error('업데이트 배포 설정을 읽지 못했습니다.');
  }
}
function feedFor(runtime: UpdateRuntime): string | null {
  const config = runtime.configuration as { feeds?: Record<string, Record<string, unknown>> } | undefined;
  const raw = config?.feeds?.[runtime.platform]?.[runtime.arch];
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    return url.href;
  } catch { return null; }
}

/** Only main owns the native updater and the bundled feed. No renderer URLs or credentials. */
export class UpdateService {
  private value: UpdateState;
  private readonly feed: string | null;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(state: UpdateState) => void>();
  private readonly handlers: [string, (...args: unknown[]) => void][];
  constructor(private readonly native: NativeUpdater, private readonly runtime: UpdateRuntime) {
    this.feed = feedFor(runtime);
    const unavailable = !runtime.packaged ? '개발 실행에서는 업데이트를 사용할 수 없습니다. 배포된 앱에서 확인하세요.'
      : runtime.store ? '스토어에서 설치한 앱은 스토어에서 업데이트해 주세요.'
      : !['darwin', 'win32'].includes(runtime.platform) ? '이 기기에서는 앱 내 업데이트를 지원하지 않습니다.'
      : runtime.platform === 'win32' && !runtime.windowsInstaller ? '이 설치 방식에서는 앱 내 업데이트를 지원하지 않습니다.'
      : runtime.windowsFirstRun ? '설치가 마무리되는 중입니다. 앱을 종료한 뒤 다시 열어 확인하세요.'
      : runtime.configurationError ? '업데이트 설정을 읽지 못했습니다. 앱을 다시 설치하거나 배포 지원에 문의하세요.'
      : !this.feed ? '아직 업데이트 배포가 준비되지 않았습니다.' : null;
    this.value = { currentVersion: runtime.currentVersion, status: unavailable ? 'unavailable' : 'idle', message: unavailable ?? '업데이트를 확인하면 새 버전이 있을 때 자동으로 내려받습니다.' };
    this.handlers = [
      ['update-available', () => {
        if (!this.inFlight) return;
        this.publish({ status: 'downloading', message: '새 버전을 내려받고 있습니다. 학습을 계속해도 됩니다.' }); this.watch(15 * 60_000);
      }],
      ['update-not-available', () => {
        if (!this.inFlight) return;
        this.finish(); this.publish({ status: 'current', message: '최신 버전입니다.', checkedAt: new Date().toISOString() });
      }],
      ['update-downloaded', (_event, notes, name) => {
        if (!this.inFlight) return;
        this.finish(); this.publish({ status: 'downloaded', message: '업데이트 준비가 끝났습니다. 학습 내용을 저장하고 재시작할 수 있습니다.', checkedAt: new Date().toISOString(),
          releaseName: typeof name === 'string' ? name.slice(0, 200) : undefined,
          releaseNotes: typeof notes === 'string' ? notes.slice(0, 6000) : undefined });
      }],
      ['error', () => {
        if (this.inFlight) this.fail();
        else if (this.value.status === 'installing') this.publish({ status: 'downloaded', message: '업데이트 설치를 시작하지 못했습니다. 다시 시도하거나 앱을 종료한 뒤 다시 열어 주세요.' });
      }],
    ];
    for (const [event, handler] of this.handlers) native.on(event, handler);
  }
  get state(): UpdateState { return { ...this.value }; }
  subscribe(listener: (state: UpdateState) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(next: Partial<UpdateState>) {
    this.value = { ...this.value, ...next };
    for (const listener of this.listeners) listener(this.state);
  }
  private finish() { this.inFlight = false; if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private watch(milliseconds: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.publish({ status: 'stalled', message: '업데이트 응답이 지연되고 있습니다. 네트워크를 확인하고 기다려 주세요. 계속 지연되면 앱을 다시 열어 확인하세요.' });
    }, milliseconds);
    this.timer.unref?.();
  }
  private fail() {
    this.finish(); this.publish({ status: 'error', message: '업데이트를 완료하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도하세요. 계속 실패하면 배포 지원에 문의하세요.' });
  }
  check(): void {
    if (this.value.status === 'unavailable') throw new Error(this.value.message);
    if (this.inFlight || ['downloaded', 'preparing', 'installing'].includes(this.value.status)) return;
    this.inFlight = true;
    this.publish({ status: 'checking', message: '새 버전이 있는지 확인하고 있습니다.' }); this.watch(60_000);
    try {
      this.native.setFeedURL({ url: this.feed!, ...(this.runtime.platform === 'darwin' ? { serverType: 'json' } : {}) });
      this.native.checkForUpdates();
    } catch { this.fail(); }
  }
  async install(prepare: () => Promise<void>): Promise<void> {
    if (this.value.status !== 'downloaded') throw new Error('업데이트 다운로드가 끝난 뒤 다시 시도하세요.');
    this.publish({ status: 'preparing', message: '학습 내용을 확인하고 재시작을 준비하고 있습니다.' });
    try { await prepare(); }
    catch (error) {
      this.publish({ status: 'downloaded', message: '학습 내용을 저장하지 못했거나 다른 작업이 진행 중입니다. 확인 후 다시 시도하세요.' });
      throw error;
    }
    this.publish({ status: 'installing', message: '앱을 재시작하고 업데이트를 적용합니다.' });
    try { this.native.quitAndInstall(); }
    catch {
      this.publish({ status: 'downloaded', message: '업데이트 설치를 시작하지 못했습니다. 다시 시도하거나 앱을 종료한 뒤 다시 열어 주세요.' });
      throw new Error(this.value.message);
    }
  }
  dispose(): void {
    this.finish(); this.listeners.clear();
    for (const [event, handler] of this.handlers) this.native.removeListener(event, handler);
  }
}
