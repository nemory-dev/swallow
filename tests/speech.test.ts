import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { NativeSpeech, parseVoices } from '../electron/speech.js';

class FakeProcess extends EventEmitter {
  signals: string[] = []; text = '';
  stdin = { end: (text: string) => { this.text = text; }, on: () => this.stdin };
  kill(signal: string) { this.signals.push(signal); return true; }
}
describe('local macOS speech', () => {
  it('언어 전환 도중 중지나 실패가 발생하면 남은 구절을 재생하지 않는다', async () => {
    const processes: FakeProcess[] = [];
    const player = new NativeSpeech(async () => [
      { id: 'Yuna', name: 'Yuna', lang: 'ko-KR' }, { id: 'Samantha', name: 'Samantha', lang: 'en-US' },
    ], () => { const p = new FakeProcess(); processes.push(p); return p; });
    await player.speak('쉬운 Kubernetes 설명', 'Yuna', 1);
    player.control('stop'); processes[0]?.emit('close', 0);
    expect(processes).toHaveLength(1);
    await player.speak('쉬운 Kubernetes 설명', 'Yuna', 1);
    processes[1]?.emit('close', 0); processes[2]?.emit('error', new Error('failed'));
    processes[2]?.emit('close', 0);
    expect(processes).toHaveLength(3); expect(player.state.status).toBe('idle'); expect(player.state.error).toContain('음성');
  });
  it('구절 경계에서 일시정지한 상태를 다음 음성에서도 유지한다', async () => {
    const processes: FakeProcess[] = [];
    const player = new NativeSpeech(async () => [
      { id: 'Yuna', name: 'Yuna', lang: 'ko-KR' }, { id: 'Samantha', name: 'Samantha', lang: 'en-US' },
    ], () => { const p = new FakeProcess(); processes.push(p); return p; });
    await player.speak('쉬운 Kubernetes 설명', 'Yuna', 1);
    player.control('pause'); processes[0]?.emit('close', 0);
    expect(player.state.status).toBe('paused'); expect(processes[1]?.signals).toEqual(['SIGSTOP']);
    player.control('resume'); expect(processes[1]?.signals).toEqual(['SIGSTOP', 'SIGCONT']);
    player.control('stop');
  });
  it('한국어와 영어 구절을 해당 언어의 음성으로 순서대로 읽고 중지 후 다음 구절을 시작하지 않는다', async () => {
    const processes: FakeProcess[] = [], calls: string[][] = [];
    const player = new NativeSpeech(async () => [
      { id: 'Yuna', name: 'Yuna', lang: 'ko-KR' }, { id: 'Samantha', name: 'Samantha', lang: 'en-US' },
    ], (_command, args) => { calls.push(args); const p = new FakeProcess(); processes.push(p); return p; });
    await player.speak('쿠버네티스는 Kubernetes cluster를 관리합니다.', 'Yuna', 1);
    expect(processes[0]?.text).toBe('쿠버네티스는 ');
    processes[0]?.emit('close', 0);
    expect(calls[1]).toEqual(['-v', 'Samantha', '-r', '180']);
    expect(processes[1]?.text).toBe('Kubernetes cluster');
    processes[1]?.emit('close', 0);
    expect(processes[2]?.text).toBe('를 관리합니다.');
    player.control('stop'); processes[2]?.emit('close', 0);
    expect(processes).toHaveLength(3); expect(player.state.status).toBe('idle');
  });
  it('parses names with spaces and languages', () => {
    expect(parseVoices('Yuna                ko_KR    # 안녕하세요\nEddy (English (US)) en_US # Hello\ninvalid')).toEqual([
      { id: 'Yuna', name: 'Yuna', lang: 'ko-KR' }, { id: 'Eddy (English (US))', name: 'Eddy (English (US))', lang: 'en-US' },
    ]);
  });
  it('uses fixed executable, known voice, bounded rate and stdin instead of shell interpolation', async () => {
    const processes: FakeProcess[] = []; const calls: unknown[][] = [];
    const player = new NativeSpeech(async () => [{ id: 'Yuna', name: 'Yuna', lang: 'ko-KR' }], (command, args) => {
      calls.push([command, args]); const process = new FakeProcess(); processes.push(process); return process;
    });
    await expect(player.speak('text', 'unknown', 1)).rejects.toThrow();
    await expect(player.speak('text', 'Yuna', 99)).rejects.toThrow();
    await player.speak('`$() 위험한 텍스트`', 'Yuna', 1);
    expect(calls).toEqual([['/usr/bin/say', ['-v', 'Yuna', '-r', '180']]]);
    expect(processes[0]?.text).toBe('$() 위험한 텍스트');
    expect(player.state.status).toBe('speaking');
    player.control('pause'); expect(player.state.status).toBe('paused');
    player.control('resume'); expect(player.state.status).toBe('speaking');
    player.control('stop'); expect(player.state.status).toBe('idle');
    expect(processes[0]?.signals).toEqual(['SIGSTOP', 'SIGCONT', 'SIGTERM']);
  });
  it('ignores completion from a cancelled utterance and reports process errors', async () => {
    const processes: FakeProcess[] = [];
    const player = new NativeSpeech(async () => [{ id: 'Yuna', name: 'Yuna', lang: 'ko-KR' }], () => {
      const process = new FakeProcess(); processes.push(process); return process;
    });
    await player.speak('첫째', 'Yuna', 1); player.control('pause');
    await player.speak('둘째', 'Yuna', 1);
    expect(processes[0]?.signals).toEqual(['SIGSTOP', 'SIGCONT', 'SIGTERM']);
    processes[0]?.emit('close', 0); expect(player.state.status).toBe('speaking');
    processes[1]?.emit('error', new Error('private details'));
    expect(player.state).toEqual({ status: 'idle', error: expect.stringContaining('음성') });
    expect(player.state.error).not.toContain('private details');
  });
  it('does not start delayed speech after navigating away or hiding the source', async () => {
    let finish!: (voices: { id: string; name: string; lang: string }[]) => void;
    let starts = 0;
    const player = new NativeSpeech(() => new Promise(resolve => { finish = resolve; }), () => { starts++; return new FakeProcess(); });
    const pending = player.speak('구간', 'Yuna', 1);
    player.control('stop');
    finish([{ id: 'Yuna', name: 'Yuna', lang: 'ko-KR' }]);
    await pending;
    expect(starts).toBe(0); expect(player.state.status).toBe('idle');
  });
  it('cannot leave a completed process showing as speaking after an invalid voice request', async () => {
    const process = new FakeProcess();
    const player = new NativeSpeech(async () => [{ id: 'Yuna', name: 'Yuna', lang: 'ko-KR' }], () => process);
    await player.speak('원문', 'Yuna', 1);
    await expect(player.speak('다른 원문', 'missing', 1)).rejects.toThrow();
    process.emit('close', 0);
    expect(player.state.status).toBe('idle');
  });
});
