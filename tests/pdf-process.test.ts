import { afterEach, describe, expect, it } from 'vitest';
import { runPdfHelper } from '../electron/pdf.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const paths: string[] = [];
const startupBudget = process.platform === 'win32' ? 10_000 : 1000;
afterEach(async () => { for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true }); });
describe('PDF 자식 프로세스 실패 경계', () => {
  async function helper(code: string) { const directory = await mkdtemp(join(tmpdir(), 'swallow-pdf-process-')); paths.push(directory); const path = join(directory, 'helper.cjs'); await writeFile(path, code); return path; }
  it('취소하면 종료하고 결과를 저장하지 않는다', async () => {
    const path = await helper('setInterval(() => {}, 1000)');
    const controller = new AbortController();
    const result = runPdfHelper(process.execPath, [path], controller.signal, 1000);
    controller.abort();
    await expect(result).rejects.toThrow('취소');
  });
  it('응답 없는 도구를 시간 제한으로 종료한다', async () => {
    const path = await helper('setInterval(() => {}, 1000)');
    await expect(runPdfHelper(process.execPath, [path], undefined, 30)).rejects.toThrow('시간');
  });
  it('과도한 출력과 잘못된 JSON을 거부한다', async () => {
    const large = await helper("process.stdout.write('x'.repeat(2000))");
    await expect(runPdfHelper(process.execPath, [large], undefined, startupBudget, 100)).rejects.toThrow('제한');
    const bad = await helper("process.stdout.write('bad')");
    await expect(runPdfHelper(process.execPath, [bad])).rejects.toThrow('처리');
  });
  it('Windows 도구의 진단 stdout과 전용 결과 파이프를 분리한다', async () => {
    const path = await helper("console.log('PDF.js warning, not JSON'); require('node:fs').writeSync(3, JSON.stringify({ok:true,value:[{text:process.env.SWALLOW_PDF_TEST,method:'text'}]}));");
    await expect(runPdfHelper({ command: process.execPath, args: [path], env: { ...process.env, SWALLOW_PDF_TEST: '한글 원문' }, resultFd: 3 }, ['inspect', 'ignored']))
      .resolves.toEqual([{ text: '한글 원문', method: 'text' }]);
  });
  it('전용 결과의 알려진 오류만 노출하고 잘못된 frame을 거절한다', async () => {
    const encrypted = await helper("require('node:fs').writeSync(3, JSON.stringify({ok:false,error:'encrypted'})); process.exitCode=1;");
    await expect(runPdfHelper({ command: process.execPath, args: [encrypted], resultFd: 3 }, [])).rejects.toThrow('암호화');
    const privateError = await helper("require('node:fs').writeSync(3, JSON.stringify({ok:false,error:'PRIVATE SOURCE AND PATH'})); process.exitCode=1;");
    await expect(runPdfHelper({ command: process.execPath, args: [privateError], resultFd: 3 }, [])).rejects.toThrow('처리');
    const invalid = await helper("require('node:fs').writeSync(3, JSON.stringify({value:42}));");
    await expect(runPdfHelper({ command: process.execPath, args: [invalid], resultFd: 3 }, [])).rejects.toThrow('결과');
    const large = await helper("require('node:fs').writeSync(3, 'x'.repeat(2000));");
    await expect(runPdfHelper({ command: process.execPath, args: [large], resultFd: 3 }, [], undefined, startupBudget, 100)).rejects.toThrow('제한');
  }, 30_000);
  it('Windows 전용 결과 파이프에서도 취소와 시간 제한이 프로세스를 종료한다', async () => {
    const path = await helper('setInterval(() => {}, 1000)');
    const launch = { command: process.execPath, args: [path], resultFd: 3 as const };
    const controller = new AbortController();
    const pending = runPdfHelper(launch, [], controller.signal, 1000);
    controller.abort();
    await expect(pending).rejects.toThrow('취소');
    await expect(runPdfHelper(launch, [], undefined, 30)).rejects.toThrow('시간');
  });
});
