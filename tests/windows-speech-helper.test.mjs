import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSpeechHelper } from '../scripts/build-speech-helper.mjs';

// Allow a 15s cold start, 5s control response, then process/file cleanup.
const helperTimeoutMs = 25000;
const testTimeoutMs = 30000;
// This suite intentionally requires Windows: a Mac mock cannot prove SAPI synthesis.
describe.skipIf(process.platform !== 'win32')('System.Speech helper on Windows', () => {
  let helper, voices;
  function launch(args = [], input = '', parentPid = process.pid) {
    const child = spawn(helper, [...args, '--parent-pid', String(parentPid)], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => { /* A deliberate invalid-input case may close its pipe early. */ });
    const events = []; let stdout = '', stderr = '', bytes = 0, buffer = '';
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Speech helper smoke timed out')); }, helperTimeoutMs);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        bytes += Buffer.byteLength(chunk); if (bytes > 65536) { child.kill(); reject(new Error('Speech helper output too large')); return; }
        stdout += chunk; buffer += chunk;
        for (let end; (end = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try { events.push(JSON.parse(line)); } catch { child.kill(); reject(new Error('Speech helper invalid JSON')); }
        }
      });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, events }); });
    });
    if (input) child.stdin.write(input);
    return { child, closed, events };
  }
  beforeAll(async () => {
    helper = process.env.SWALLOW_SPEECH_HELPER || await buildSpeechHelper();
    const listing = launch(['voices']); listing.child.stdin.end();
    const result = await listing.closed;
    expect(result.code).toBe(0); voices = JSON.parse(result.stdout);
    expect(Array.isArray(voices)).toBe(true);
    for (const voice of voices) { expect(voice.id).toBeTruthy(); expect(voice.name).toBeTruthy(); expect(voice.lang).toMatch(/^[a-z]+-/i); }
  }, 60000); // csc cold start/build plus the separate voice-list helper invocation.
  it('preserves Korean, quotes, newline and supplementary Unicode through UTF-8 stdin', async () => {
    const text = '한글 "따옴표"\n$() café 😀';
    const run = launch(['speak', '--selftest-echo'], JSON.stringify({ rate: 0, chunks: [{ voice: 'echo-only', text }] }) + '\n');
    run.child.stdin.end(); const result = await run.closed;
    expect(result.code).toBe(0);
    expect(result.events).toEqual([{ event: 'echo', sha256: createHash('sha256').update(text, 'utf8').digest('hex') }]);
    expect(result.stdout).not.toContain(text);
  }, testTimeoutMs);
  it('synthesizes installed English speech into a real nonempty PCM WAV', async () => {
    const english = voices.find(voice => voice.lang.toLowerCase().startsWith('en'));
    expect(english, 'Windows CI must provide an enabled English SAPI voice for real synthesis').toBeTruthy();
    const directory = await mkdtemp(join(tmpdir(), 'swallow-speech-한글 '));
    try {
      const output = join(directory, '영어 합성.wav');
      const run = launch(['speak', '--output-wav', output], JSON.stringify({ rate: 0, chunks: [{ voice: english.id, text: 'Water moves from the sea into the air.' }] }) + '\n');
      const result = await run.closed;
      expect(result.code).toBe(0); expect(result.events.map(event => event.event)).toEqual(['speaking', 'done']);
      const bytes = await readFile(output);
      expect(bytes.subarray(0, 4).toString()).toBe('RIFF'); expect(bytes.subarray(8, 12).toString()).toBe('WAVE');
      expect(bytes.length).toBeGreaterThan(44);
      const dataOffset = bytes.indexOf(Buffer.from('data'));
      expect(dataOffset).toBeGreaterThanOrEqual(12);
      expect(bytes.subarray(dataOffset + 8).some(value => value !== 0)).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, testTimeoutMs);
  it('acknowledges real pause/resume/stop commands and exits', async () => {
    expect(voices.length).toBeGreaterThan(0);
    const directory = await mkdtemp(join(tmpdir(), 'swallow-speech-control-'));
    try {
      const input = [{ rate: 0, chunks: [{ voice: voices[0].id, text: 'This is a long speech passage. '.repeat(45) }, { voice: voices[0].id, text: 'The next chunk.' }] },
        { command: 'pause' }, { command: 'resume' }, { command: 'stop' }].map(value => JSON.stringify(value)).join('\n') + '\n';
      const run = launch(['speak', '--output-wav', join(directory, 'control.wav')], input);
      const result = await run.closed;
      expect(result.code).toBe(0);
      expect(result.events.map(event => event.event)).toEqual(['speaking', 'paused', 'speaking', 'done']);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, testTimeoutMs);
  it('rejects unavailable voices with a fixed code and no source or diagnostic text', async () => {
    const privateText = 'private 한글 input';
    const run = launch(['speak'], JSON.stringify({ rate: 0, chunks: [{ voice: 'swallow-not-an-installed-voice', text: privateText }] }) + '\n');
    const result = await run.closed;
    expect(result.code).toBe(1); expect(result.events).toEqual([{ event: 'error', code: 'voice' }]);
    expect(result.stdout + result.stderr).not.toContain(privateText);
  }, testTimeoutMs);
  it('rejects malformed or oversized input', async () => {
    for (const input of ['{bad}\n', 'x'.repeat(65537) + '\n']) {
      const run = launch(['speak'], input); const result = await run.closed;
      expect(result.code).toBe(1); expect(result.events).toEqual([{ event: 'error', code: 'input' }]);
    }
  }, 60000); // Two sequential helper invocations, each with its own deadline.
  it('exits on EOF while paused without leaving a helper running', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'swallow-speech-eof-'));
    try {
      const input = [{ rate: 0, chunks: [{ voice: voices[0].id, text: 'A paused passage. '.repeat(90) }] }, { command: 'pause' }].map(value => JSON.stringify(value)).join('\n') + '\n';
      const run = launch(['speak', '--output-wav', join(directory, 'eof.wav')], input);
      // EOF follows the two complete input frames; the helper must cancel rather than hang.
      run.child.stdin.end(); const result = await run.closed;
      expect(result.code).toBe(0); expect(result.events.at(-1)).toEqual({ event: 'done' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, testTimeoutMs);
  it('exits after the watched parent terminates even while its input pipe stays open', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'swallow-speech-parent-'));
    const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
    const parentClosed = new Promise((resolve, reject) => { parent.once('close', resolve); parent.once('error', reject); });
    let run;
    try {
      expect(parent.pid).toBeGreaterThan(0);
      const input = [{ rate: 0, chunks: [{ voice: voices[0].id, text: 'A long passage. '.repeat(100) }] }, { command: 'pause' }].map(value => JSON.stringify(value)).join('\n') + '\n';
      // Vitest owns stdin; killing the watched process cannot close this pipe and fake EOF cleanup.
      run = launch(['speak', '--output-wav', join(directory, 'parent.wav')], input, parent.pid);
      const result = run.closed; void result.catch(() => {});
      for (let attempt = 0; attempt < 400 && !run.events.some(event => event.event === 'paused'); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(run.events.some(event => event.event === 'paused')).toBe(true);
      expect(run.child.stdin.writableEnded).toBe(false);
      parent.kill(); await parentClosed;
      expect((await result).code).toBe(0);
      expect(run.child.stdin.writableEnded).toBe(false);
    } finally {
      parent.kill(); await parentClosed.catch(() => {});
      if (run) { run.child.kill(); await run.closed.catch(() => {}); }
      await rm(directory, { recursive: true, force: true });
    }
  }, testTimeoutMs);
});
