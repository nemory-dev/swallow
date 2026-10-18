import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadImage } from '@napi-rs/canvas';
import { prepareWindowsPdf } from '../scripts/prepare-windows-pdf.mjs';
import { ocrLanguages, pdfFactoryDirectory } from '../native/windows-pdf/runtime.mjs';

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function directory() { const root = await mkdtemp(join(tmpdir(), 'swallow-pdf 한글 ')); roots.push(root); return root; }
const fixture = name => resolve('tests/fixtures/pdf', name);
beforeAll(() => prepareWindowsPdf(process.cwd()));
function worker(command, path, page, cwd) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve('dist-electron/native/pdf-runtime/worker.mjs'), command, path, ...(page === undefined ? [] : [String(page)])], { cwd, stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('worker timeout')); }, 120_000);
    child.stdio[3].on('data', chunk => { output += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); try { resolveResult({ code, ...JSON.parse(output) }); } catch { reject(new Error('worker produced no framed result')); } });
  });
}
describe('Windows PDF 엔진의 실제 로컬 처리', () => {
  it('Windows 로컬 폰트·CMap 경로를 PDF.js가 요구하는 끝 슬래시로 정규화한다', () => {
    expect(pdfFactoryDirectory('C:\\Program Files\\Swallow\\한글\\cmaps')).toBe('C:/Program Files/Swallow/한글/cmaps/');
    expect(pdfFactoryDirectory('/app/standard_fonts/')).toBe('/app/standard_fonts/');
  });
  it('부모 앱이 강제 종료되면 PDF 작업도 종료한다', async () => {
    const root = await directory(), script = join(root, 'parent.cjs');
    await writeFile(script, `const {spawn}=require('node:child_process');
const child=spawn(process.execPath,[process.argv[2],'--parent-pid',String(process.pid),'inspect',process.argv[3]],{stdio:['ignore','ignore','ignore',3]});
child.on('spawn',()=>process.stdout.write(String(child.pid)+'\\n'));
setInterval(()=>{},1000);`);
    const frame = await new Promise((resolveResult, reject) => {
      const parent = spawn(process.execPath, [script, resolve('dist-electron/native/pdf-runtime/worker.mjs'), fixture('scan.pdf')], { stdio: ['ignore', 'pipe', 'ignore', 'pipe'] });
      let output = '', childPid;
      const timer = setTimeout(() => { parent.kill('SIGKILL'); if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch {} } reject(new Error('orphaned PDF worker')); }, 5000);
      parent.stdout.once('data', data => { childPid = Number(String(data).trim()); parent.kill('SIGKILL'); });
      parent.stdio[3].on('data', data => { output += data; });
      parent.on('error', error => { clearTimeout(timer); reject(error); });
      parent.on('close', () => { clearTimeout(timer); try { resolveResult(JSON.parse(output)); } catch { reject(new Error('missing cancelled frame')); } });
    });
    expect(frame).toEqual({ ok: false, error: 'cancelled' });
  }, 10_000);
  it('번들 언어 데이터가 없으면 외부 다운로드 대신 실패한다', async () => {
    const root = await directory();
    await expect(ocrLanguages(root)).rejects.toMatchObject({ code: 'resources' });
    expect(await readdir(root)).toEqual([]);
  });
  it('텍스트 추출과 crop/회전 렌더를 같은 JSON 계약으로 처리한다', async () => {
    const result = await worker('inspect', fixture('diagram.pdf'));
    expect(result).toMatchObject({ code: 0, ok: true });
    expect(result.value).toHaveLength(2);
    expect(result.value[0].text).toContain('Water moves from reservoir A');
    expect(result.value[0].method).toBe('text');
    const rendered = await worker('render', fixture('diagram.pdf'), 1);
    expect(rendered).toMatchObject({ code: 0, ok: true });
    expect(await loadImage(Buffer.from(rendered.value.split(',')[1], 'base64'))).toMatchObject({ width: 1800, height: 2400 });
    const rotated = await worker('render', fixture('rotated.pdf'), 1);
    expect(await loadImage(Buffer.from(rotated.value.split(',')[1], 'base64'))).toMatchObject({ width: 2400, height: 1800 });
  }, 20_000);
  it.each(['encrypted.pdf', 'owner-encrypted.pdf', 'too-many-pages.pdf'])('%s를 처리 전에 거절한다', async name => {
    const result = await worker('inspect', fixture(name));
    expect(result).toMatchObject({ code: 1, ok: false, error: name === 'too-many-pages.pdf' ? 'pages' : 'encrypted' });
  });
  it('빈 파일·잘린 PDF·없는 페이지·잘못된 요청을 거절한다', async () => {
    const root = await directory();
    for (const bytes of ['', '%PDF-1.7\nBROKEN']) {
      const path = join(root, '손상된 문서.pdf'); await writeFile(path, bytes);
      expect(await worker('inspect', path)).toMatchObject({ code: 1, ok: false, error: 'invalid' });
    }
    expect(await worker('render', fixture('diagram.pdf'), 3)).toMatchObject({ code: 1, ok: false, error: 'request' });
    expect(await worker('unexpected', fixture('diagram.pdf'))).toMatchObject({ code: 1, ok: false, error: 'request' });
  }, 30_000);
  it('스캔을 번들 한영 데이터로 읽고 현재 폴더에 캐시를 쓰지 않는다', async () => {
    const root = await directory(); const path = join(root, '한글 스캔 자료.pdf');
    await writeFile(path, await readFile(fixture('scan.pdf')));
    const result = await worker('inspect', path, undefined, root);
    expect(result).toMatchObject({ code: 0, ok: true });
    expect(result.value[0].method).toBe('ocr');
    expect(result.value[0].text).toMatch(/Heat turns water into vapor/i);
    expect(result.value[0].text).toContain('수증기');
    expect(await readdir(root)).toEqual(['한글 스캔 자료.pdf']);
  }, 120_000);
  it('빈 페이지의 위치를 유지한다', async () => {
    const result = await worker('inspect', fixture('blank.pdf'));
    expect(result).toMatchObject({ code: 0, ok: true, value: [{ text: '', method: 'empty' }] });
  }, 60_000);
});
