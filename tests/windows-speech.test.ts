import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WindowsSpeech, installedWindowsVoices } from '../electron/windows-speech.js';

const helper = '/native/swallow-speech.exe';
const voices = [{ id: 'ko-id', name: 'Korean Desktop', lang: 'ko-KR' }, { id: 'en-id', name: 'English Desktop', lang: 'en-US' }];
class Helper extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough();
  input = ''; kills = 0;
  constructor() { super(); this.stdin.on('data', chunk => { this.input += chunk.toString('utf8'); }); }
  kill() { this.kills++; return true; }
  event(value: object) { this.stdout.write(JSON.stringify(value) + '\n'); }
}
function setup(options: Record<string, unknown> = {}) {
  const children: Helper[] = [];
  const launch = vi.fn(() => { const child = new Helper(); children.push(child); return child; });
  const player = new WindowsSpeech(helper, { launch, getVoices: async () => voices, ...options });
  return { player, children, launch };
}
async function start(context: ReturnType<typeof setup>, source = '쉬운 Kubernetes 설명') {
  const pending = context.player.speak(source, 'ko-id', 1);
  await Promise.resolve(); await Promise.resolve();
  context.children.at(-1)!.event({ event: 'speaking' });
  await pending;
}
afterEach(() => { vi.useRealTimers(); });

describe('Windows local speech adapter', () => {
  it('sends UTF-8 JSON chunks to the fixed executable without a shell and follows acknowledged states', async () => {
    const context = setup(); const states: string[] = [];
    const unsubscribe = context.player.subscribe(state => states.push(state.status));
    await start(context, '한글 "따옴표"와 $() Kubernetes\n설명');
    const child = context.children[0]!;
    expect(context.launch).toHaveBeenCalledWith(helper, ['speak', '--parent-pid', String(process.pid)], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const payload = JSON.parse(child.input.trim());
    expect(payload.rate).toBe(0);
    expect(payload.chunks.map((chunk: { text: string }) => chunk.text).join('')).toBe('한글 "따옴표"와 $() Kubernetes\n설명');
    expect(payload.chunks.some((chunk: { voice: string; text: string }) => chunk.voice === 'en-id' && chunk.text === 'Kubernetes')).toBe(true);
    context.player.control('pause'); expect(context.player.state.status).toBe('speaking');
    child.event({ event: 'paused' }); expect(context.player.state.status).toBe('paused');
    context.player.control('resume'); child.event({ event: 'speaking' });
    expect(context.player.state.status).toBe('speaking');
    child.event({ event: 'done' }); expect(context.player.state).toEqual({ status: 'idle', error: null });
    expect(child.input).toContain('{"command":"pause"}\n{"command":"resume"}\n');
    child.emit('close', 0); unsubscribe();
    expect(states).toEqual(['idle', 'speaking', 'paused', 'speaking', 'idle']);
  });
  it.each([[0.75, -3], [1, 0], [1.25, 3], [1.5, 5]])('maps rate %s to the bounded SAPI rate %s', async (rate, sapi) => {
    const context = setup(); const pending = context.player.speak('본문', 'ko-id', rate);
    await Promise.resolve(); await Promise.resolve();
    const child = context.children[0]!; expect(JSON.parse(child.input).rate).toBe(sapi);
    child.event({ event: 'speaking' }); await pending; child.event({ event: 'done' }); child.emit('close', 0);
  });
  it('validates source, voice and rate before starting a helper', async () => {
    const context = setup();
    for (const source of ['', '  ', '가'.repeat(1801)]) await expect(context.player.speak(source, 'ko-id', 1)).rejects.toThrow('원문');
    await expect(context.player.speak('본문', 'ko-id', 99)).rejects.toThrow('속도');
    await expect(context.player.speak('본문', 'missing', 1)).rejects.toThrow('음성');
    expect(context.launch).not.toHaveBeenCalled();
    expect(() => context.player.control('bad' as 'stop')).toThrow('동작');
    expect(() => new WindowsSpeech('relative.exe')).toThrow('음성');
  });
  it('does not start after stop while voices are loading', async () => {
    let finish!: (value: typeof voices) => void;
    const context = setup({ getVoices: () => new Promise(resolve => { finish = resolve; }) });
    const pending = context.player.speak('본문', 'ko-id', 1); context.player.control('stop');
    finish(voices); await pending;
    expect(context.launch).not.toHaveBeenCalled(); expect(context.player.state.status).toBe('idle');
  });
  it('stops paused speech, kills a non-exiting helper, and ignores its late events', async () => {
    vi.useFakeTimers(); const context = setup(); await start(context);
    const first = context.children[0]!; context.player.control('pause'); first.event({ event: 'paused' });
    context.player.control('stop'); expect(first.input).toContain('{"command":"stop"}'); expect(first.stdin.writableEnded).toBe(true);
    await start(context, '새 문장');
    first.event({ event: 'done' }); first.emit('error', new Error('private source')); first.emit('close', 9);
    expect(context.player.state.status).toBe('speaking');
    // A close event proves the old process exited; no kill is then needed.
    await vi.advanceTimersByTimeAsync(500); expect(first.kills).toBe(0);
    const second = context.children[1]!; context.player.control('stop');
    await vi.advanceTimersByTimeAsync(500); expect(second.kills).toBe(1);
    second.emit('close', 0);
  });
  it('settles a pending start when stopped before the helper acknowledgement', async () => {
    const context = setup(); const pending = context.player.speak('본문', 'ko-id', 1);
    await Promise.resolve(); await Promise.resolve(); context.player.control('stop'); await pending;
    context.children[0]!.event({ event: 'speaking' }); expect(context.player.state.status).toBe('idle');
    context.children[0]!.emit('close', 0);
  });
  it.each(['startup', 'control'])('bounds %s acknowledgement time', async phase => {
    vi.useFakeTimers(); const context = setup({ timeoutMs: 50 });
    if (phase === 'control') {
      await start(context); context.player.control('pause');
      await vi.advanceTimersByTimeAsync(51);
    } else {
      const pending = context.player.speak('본문', 'ko-id', 1);
      const rejection = expect(pending).rejects.toThrow('시간');
      await vi.advanceTimersByTimeAsync(51); await rejection;
    }
    expect(context.player.state.status).toBe('idle'); expect(context.player.state.error).toContain('시간');
    await vi.advanceTimersByTimeAsync(500); context.children[0]!.emit('close', 1);
  });
  it('allows 15 seconds for cold start but only 5 seconds for pause acknowledgement', async () => {
    vi.useFakeTimers(); const context = setup(); let failure: unknown;
    const pending = context.player.speak('본문', 'ko-id', 1); void pending.catch(error => { failure = error; });
    await vi.advanceTimersByTimeAsync(14999);
    expect(failure).toBeUndefined();
    const child = context.children[0]!; child.event({ event: 'speaking' }); await pending;
    context.player.control('pause'); await vi.advanceTimersByTimeAsync(4999);
    expect(context.player.state.status).toBe('speaking');
    await vi.advanceTimersByTimeAsync(1); expect(context.player.state.error).toContain('시간');
    child.emit('close', 1);
  });
  it('times out cold start exactly at the default 15 second boundary', async () => {
    vi.useFakeTimers(); const context = setup(); let failure: unknown;
    const pending = context.player.speak('본문', 'ko-id', 1); void pending.catch(error => { failure = error; });
    await vi.advanceTimersByTimeAsync(14999); expect(failure).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1); await expect(pending).rejects.toThrow('시간');
    context.children[0]!.emit('close', 1);
  });
  it('gives startupTimeoutMs precedence while retaining timeoutMs for resume', async () => {
    vi.useFakeTimers(); const context = setup({ startupTimeoutMs: 100, timeoutMs: 20 }); let failure: unknown;
    const pending = context.player.speak('본문', 'ko-id', 1); void pending.catch(error => { failure = error; });
    await vi.advanceTimersByTimeAsync(99); expect(failure).toBeUndefined();
    const child = context.children[0]!; child.event({ event: 'speaking' }); await pending;
    context.player.control('pause'); child.event({ event: 'paused' }); context.player.control('resume');
    await vi.advanceTimersByTimeAsync(19); expect(context.player.state.status).toBe('paused');
    await vi.advanceTimersByTimeAsync(1); expect(context.player.state.error).toContain('시간'); child.emit('close', 1);
  });
  it.each(['spawn', 'pipe', 'exit', 'json', 'oversize', 'error-code', 'stderr'])('sanitizes %s failures and stops playback', async failure => {
    const context = setup(); await start(context); const child = context.children[0]!;
    if (failure === 'spawn') child.emit('error', new Error('private source'));
    if (failure === 'pipe') child.stdin.emit('error', new Error('private source'));
    if (failure === 'exit') child.emit('close', 0);
    if (failure === 'json') child.stdout.write('private source\n');
    if (failure === 'oversize') child.stdout.write('x'.repeat(65537));
    if (failure === 'error-code') child.event({ event: 'error', code: 'private source', message: 'private source' });
    if (failure === 'stderr') child.stderr.write('x'.repeat(65537));
    expect(context.player.state.status).toBe('idle'); expect(context.player.state.error).toBeTruthy();
    expect(context.player.state.error).not.toContain('private source'); child.emit('close', 1);
  });
  it('handles a synchronous launch failure and a lookup failure without exposing details', async () => {
    const context = setup({ launch: () => { throw new Error('private'); } });
    await expect(context.player.speak('본문', 'ko-id', 1)).rejects.toThrow('음성');
    const lookup = setup({ getVoices: async () => { throw new Error('private'); } });
    await expect(lookup.player.speak('본문', 'ko-id', 1)).rejects.toThrow('음성');
    expect(context.player.state.error).not.toContain('private'); expect(lookup.player.state.error).not.toContain('private');
  });
  it('parses partial UTF-8/event frames and keeps a detached state copy', async () => {
    const context = setup(); await start(context); const child = context.children[0]!;
    const copy = context.player.state; copy.status = 'idle'; expect(context.player.state.status).toBe('speaking');
    const frame = Buffer.from('{"event":"error","code":"voice","ignored":"한글"}\n');
    const position = frame.indexOf(Buffer.from('한')) + 1;
    child.stdout.write(frame.subarray(0, position)); child.stdout.write(frame.subarray(position));
    expect(context.player.state.error).toContain('로컬 음성'); child.emit('close', 1);
  });
  it('rejects corrupt UTF-8 instead of acknowledging a corrupted control response', async () => {
    const context = setup(); await start(context); const child = context.children[0]!;
    context.player.control('pause');
    child.stdout.write(Buffer.concat([Buffer.from('{"event":"paused","ignored":"'), Buffer.from([255]), Buffer.from('"}\n')]));
    expect(context.player.state.status).toBe('idle'); expect(context.player.state.error).toContain('응답');
    child.emit('close', 1);
  });
});

describe('Windows voice listing', () => {
  it('keeps a cold voice lookup alive for 15 seconds and rejects at the boundary', async () => {
    vi.useFakeTimers(); const child = new Helper(); let failure: unknown;
    const pending = installedWindowsVoices('/native/cold-voices.exe', { launch: () => child }); void pending.catch(error => { failure = error; });
    await vi.advanceTimersByTimeAsync(14999); expect(failure).toBeUndefined(); expect(child.kills).toBe(0);
    await vi.advanceTimersByTimeAsync(1); await expect(pending).rejects.toThrow('음성'); expect(child.kills).toBe(1);
  });
  it('prefers startupTimeoutMs over the legacy timeoutMs for voice listing', async () => {
    vi.useFakeTimers(); const child = new Helper(); let failure: unknown;
    const pending = installedWindowsVoices('/native/custom-cold-voices.exe', { launch: () => child, startupTimeoutMs: 100, timeoutMs: 20 });
    void pending.catch(error => { failure = error; });
    await vi.advanceTimersByTimeAsync(99); expect(failure).toBeUndefined();
    child.stdout.write('[]'); child.emit('close', 0); expect(await pending).toEqual([]);
  });
  it('rejects an entire malformed voice list instead of silently filtering an invalid culture', async () => {
    const child = new Helper();
    const pending = installedWindowsVoices('/native/invalid-culture.exe', { launch: () => child });
    child.stdout.write(JSON.stringify([...voices, { id: 'bad-id', name: 'Invalid', lang: '../private' }])); child.emit('close', 0);
    await expect(pending).rejects.toThrow('음성');
  });
  it('rejects corrupt UTF-8 voice metadata without caching replacement characters', async () => {
    const child = new Helper();
    const pending = installedWindowsVoices('/native/invalid-utf8.exe', { launch: () => child });
    child.stdout.write(Buffer.concat([Buffer.from('[{"id":"voice","name":"'), Buffer.from([255]), Buffer.from('","lang":"en-US"}]')]));
    child.emit('close', 0);
    await expect(pending).rejects.toThrow('음성');
  });
  it('returns cloned validated voice metadata and caches a successful lookup', async () => {
    const child = new Helper(), launch = vi.fn(() => child);
    const pending = installedWindowsVoices('/native/list-a.exe', { launch });
    child.stdout.write(JSON.stringify(voices)); child.emit('close', 0);
    const first = await pending; first[0]!.name = 'mutated';
    expect(await installedWindowsVoices('/native/list-a.exe', { launch })).toEqual(voices);
    expect(launch).toHaveBeenCalledTimes(1);
  });
  it('allows an empty list and retries a failed lookup', async () => {
    const children: Helper[] = [];
    const launch = () => { const child = new Helper(); children.push(child); return child; };
    const pending = installedWindowsVoices('/native/list-b.exe', { launch });
    children[0]!.stdout.write('{bad}'); children[0]!.emit('close', 0);
    await expect(pending).rejects.toThrow('음성');
    const retried = installedWindowsVoices('/native/list-b.exe', { launch });
    children[1]!.stdout.write('[]'); children[1]!.emit('close', 0); expect(await retried).toEqual([]);
  });
  it.each(['timeout', 'oversize', 'bad-shape', 'exit', 'spawn'])('rejects %s voice listing without raw diagnostics', async failure => {
    vi.useFakeTimers(); const child = new Helper();
    const pending = installedWindowsVoices('/native/' + failure + '.exe', { launch: () => child, timeoutMs: 50 });
    const assertion = expect(pending).rejects.toThrow('음성');
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(51);
    if (failure === 'oversize') child.stdout.write('x'.repeat(65537));
    if (failure === 'bad-shape') { child.stdout.write('[{"id":"private"}]'); child.emit('close', 0); }
    if (failure === 'exit') { child.stderr.write('private'); child.emit('close', 1); }
    if (failure === 'spawn') child.emit('error', new Error('private'));
    await assertion;
  });
});
