import { afterEach, describe, expect, it } from 'vitest';
import { runPdfHelper } from '../electron/pdf.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const paths: string[] = [];
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
    await expect(runPdfHelper(process.execPath, [large], undefined, 1000, 100)).rejects.toThrow('제한');
    const bad = await helper("process.stdout.write('bad')");
    await expect(runPdfHelper(process.execPath, [bad])).rejects.toThrow('처리');
  });
});
