import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSpeechHelper } from '../scripts/build-speech-helper.mjs';

describe('Windows speech compiler launcher', () => {
  it('rejects unsupported hosts before invoking a compiler', async () => {
    await expect(buildSpeechHelper({ platform: 'darwin', arch: 'arm64' })).rejects.toThrow('Windows x64');
  });
  it('rejects a missing source before invoking a compiler', async () => {
    const root = await mkdtemp(join(tmpdir(), 'swallow-speech-no-source-'));
    let called = false;
    try {
      await expect(buildSpeechHelper({ platform: 'win32', arch: 'x64', root, windowsDirectory: '/Windows', run: () => { called = true; return { status: 0 }; } })).rejects.toThrow('source');
      expect(called).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('uses builtin x64 csc and framework references with no shell and fails missing output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'swallow-speech-build-'));
    try {
      await mkdir(join(root, 'native/windows'), { recursive: true });
      await writeFile(join(root, 'native/windows/speech.cs'), '// fixture');
      let invocation;
      const run = (command, args, options) => { invocation = { command, args, options }; return { status: 0 }; };
      await expect(buildSpeechHelper({ platform: 'win32', arch: 'x64', root, windowsDirectory: '/Windows', run })).rejects.toThrow('output');
      expect(invocation.command).toContain('Framework64');
      expect(invocation.command).toMatch(/csc.exe$/);
      expect(invocation.args).toContain('/platform:x64');
      expect(invocation.args.some(value => value.includes('System.Speech.dll'))).toBe(true);
      expect(invocation.args.some(value => value.includes('System.Web.Extensions.dll'))).toBe(true);
      expect(invocation.options.shell).toBe(false);
      const output = join(root, 'dist-electron/native/swallow-speech.exe');
      const result = await buildSpeechHelper({ platform: 'win32', arch: 'x64', root, windowsDirectory: '/Windows', run: () => ({ status: 9 }) }).catch(error => error);
      expect(result.message).toContain('compile');
      await buildSpeechHelper({ platform: 'win32', arch: 'x64', root, windowsDirectory: '/Windows', run: () => {
        writeFileSync(output, Buffer.from('MZfixture')); return { status: 0 };
      } });
      expect((await readFile(output)).subarray(0, 2).toString()).toBe('MZ');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
