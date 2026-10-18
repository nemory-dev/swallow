import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const versions = { 'pdfjs-dist': '6.4.299', '@napi-rs/canvas': '1.0.11', 'tesseract.js': '7.0.0', '@tesseract.js-data/eng': '1.0.0', '@tesseract.js-data/kor': '1.0.0' };

function pe(imports = []) {
  const bytes = Buffer.alloc(2048);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128);
  bytes.writeUInt16LE(0x8664, 132); bytes.writeUInt16LE(1, 134); bytes.writeUInt16LE(240, 148);
  bytes.writeUInt16LE(0x20b, 152); bytes.writeUInt32LE(16, 260);
  bytes.writeUInt32LE(0x1000, 272); bytes.writeUInt32LE((imports.length + 1) * 20, 276);
  bytes.write('.rdata', 392); bytes.writeUInt32LE(1536, 400); bytes.writeUInt32LE(0x1000, 404);
  bytes.writeUInt32LE(1536, 408); bytes.writeUInt32LE(512, 412);
  imports.forEach((name, i) => { bytes.writeUInt32LE(0x1200 + i * 64, 512 + i * 20 + 12); bytes.write(name + '\0', 1024 + i * 64); });
  return bytes;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'swallow-win-stage-')); roots.push(root);
  const put = async (path, bytes = 'fixture') => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), bytes); };
  const metadata = { name: 'swallow', version: '0.1.0', type: 'module', main: 'dist-electron/electron/main.js', license: 'MIT', dependencies: { runtime: '1.0.0' }, devDependencies: versions };
  const lock = { lockfileVersion: 3, packages: { '': metadata } };
  async function pkg(name, version, extra = {}, installed = true) {
    lock.packages['node_modules/' + name] = { version, integrity: 'sha512-fixture', ...extra };
    if (installed) {
      await put(`node_modules/${name}/package.json`, JSON.stringify({ name, version, license: 'MIT', ...extra }));
      await put(`node_modules/${name}/index.js`, 'module.exports = {};');
      await put(`node_modules/${name}/LICENSE`, 'ORIGINAL LICENSE ' + name);
    }
  }
  await pkg('runtime', '1.0.0', { dependencies: { shared: '^2.0.0' } });
  await pkg('shared', '2.0.0');
  await pkg('tooling', '9.0.0', { dev: true });
  await pkg('pdfjs-dist', versions['pdfjs-dist'], { dev: true, optionalDependencies: { '@napi-rs/canvas': '^1.0.10' } });
  await pkg('@napi-rs/canvas', versions['@napi-rs/canvas'], { dev: true, optionalDependencies: { '@napi-rs/canvas-win32-x64-msvc': '1.0.11', '@napi-rs/canvas-darwin-arm64': '1.0.11' } });
  await pkg('@napi-rs/canvas-win32-x64-msvc', '1.0.11', { dev: true, optional: true, os: ['win32'], cpu: ['x64'] });
  await pkg('@napi-rs/canvas-darwin-arm64', '1.0.11', { dev: true, optional: true, os: ['darwin'], cpu: ['arm64'] }, false);
  await pkg('tesseract.js', versions['tesseract.js'], { dev: true, dependencies: { 'tesseract.js-core': '^7.0.0', shared: '^2.0.0' } });
  await pkg('tesseract.js-core', '7.0.0', { dev: true });
  for (const lang of ['eng', 'kor']) {
    await pkg('@tesseract.js-data/' + lang, '1.0.0', { dev: true });
    await put(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, Buffer.from([31, 139, 8, 0]));
    await put(`dist-electron/native/pdf-runtime/tessdata/${lang}.traineddata.gz`, Buffer.from([31, 139, 8, 0]));
  }
  for (const path of ['dist/index.html', 'electron/main.ts', 'src/shared/types.ts', 'src/learning/document.ts', 'dist-electron/electron/main.js', 'dist-electron/electron/preload.cjs', 'dist-electron/src/shared/types.js', 'dist-electron/src/learning/document.js', 'native/windows-pdf/worker.mjs', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) await put(path);
  await put('dist/index.html', '<script src="./assets/main.js"></script>'); await put('dist/assets/main.js');
  for (const path of ['build/pdf.mjs', 'build/pdf.worker.mjs', 'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs', 'cmaps/test.bcmap', 'standard_fonts/test.pfb', 'wasm/openjpeg.wasm']) await put('node_modules/pdfjs-dist/' + path);
  for (const path of ['tesseract-core.wasm.js', 'tesseract-core.wasm']) await put('node_modules/tesseract.js-core/' + path);
  await put('node_modules/tesseract.js/src/worker-script/node/index.js');
  await put('dist-electron/native/pdf-runtime/worker.mjs');
  await put('dist-electron/native/pdf-runtime/runtime.mjs');
  await put('node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node', pe(['KERNEL32.dll', 'api-ms-win-crt-runtime-l1-1-0.dll']));
  await put('dist-electron/native/swallow-speech.exe', pe(['mscoree.dll']));
  for (const path of ['.env', 'docs/release/private.md', 'docs/superpowers/private.md', 'artifacts/private.txt', 'dist/private.sqlite', 'dist/assets/private.json', 'dist-electron/electron/stale.js']) await put(path, 'PRIVATE');
  await put('package.json', JSON.stringify(metadata)); await put('package-lock.json', JSON.stringify(lock));
  return { root, put, metadata, lock, stage: join(root, 'stage'), pdfRuntime: join(root, 'pdf-runtime'), native: join(root, 'native-stage'), licenses: join(root, 'licenses') };
}
async function api() { return import('../scripts/windows-package.mjs'); }

describe('Windows x64 패키징', () => {
  it('호스트와 Node 주 버전이 다르면 일찍 실패한다', async () => {
    const { assertWindowsHost } = await api();
    expect(() => assertWindowsHost({ platform: 'darwin', arch: 'arm64', node: '24.22.0' })).toThrow(/Windows/);
    expect(() => assertWindowsHost({ platform: 'win32', arch: 'arm64', node: '24.22.0' })).toThrow(/x64/);
    expect(() => assertWindowsHost({ platform: 'win32', arch: 'x64', node: '22.0.0' })).toThrow(/Node 24/);
    expect(() => assertWindowsHost({ platform: 'win32', arch: 'x64', node: '24.22.0' })).not.toThrow();
  });
  it('일반 production 앱과 Windows PDF closure를 나누고 내부 파일을 복사하지 않는다', async () => {
    const input = await fixture(); const result = await (await api()).stageWindowsApp(input);
    expect((await readdir(input.stage)).sort()).toEqual(['LICENSE', 'THIRD_PARTY_NOTICES.md', 'dist', 'dist-electron', 'node_modules', 'package.json'].sort());
    expect((await readdir(join(input.stage, 'node_modules'))).sort()).toEqual(['runtime', 'shared'].sort());
    expect((await readdir(join(input.stage, 'dist/assets'))).sort()).toEqual(['main.js'].sort());
    expect((await readdir(join(input.stage, 'dist-electron/electron'))).sort()).toEqual(['main.js', 'preload.cjs'].sort());
    const packages = result.pdfDependencies.map(record => record.name);
    expect(packages).toContain('@napi-rs/canvas-win32-x64-msvc'); expect(packages).toContain('shared');
    expect(packages).not.toContain('@napi-rs/canvas-darwin-arm64'); expect(packages).not.toContain('tooling');
    expect(await readFile(join(input.pdfRuntime, 'tessdata/kor.traineddata.gz'))).toEqual(Buffer.from([31, 139, 8, 0]));
    expect(JSON.parse(await readFile(join(input.stage, 'package.json'), 'utf8'))).not.toHaveProperty('scripts');
    const note = await readFile(join(input.licenses, 'npm-notices.md'), 'utf8');
    expect(note).toContain('ORIGINAL LICENSE @napi-rs/canvas');
    expect(JSON.stringify(result)).not.toContain(input.root);
    const worker = result.resources.find(file => file.path === 'pdf-runtime/worker.mjs');
    expect(worker.sha256).toBe(hash(await readFile(join(input.pdfRuntime, 'worker.mjs'))));
    expect(await readFile(join(input.pdfRuntime, 'runtime.mjs'), 'utf8')).toBe('fixture');
  });
  it('대상 optional native 모듈의 누락도 거부한다', async () => {
    const input = await fixture(); await rm(join(input.root, 'node_modules/@napi-rs/canvas-win32-x64-msvc'), { recursive: true });
    await expect((await api()).stageWindowsApp(input)).rejects.toThrow(/canvas-win32-x64-msvc/);
  });
  it('manifest 키 순서와 무관하게 중첩된 잠금 의존성을 해석한다', async () => {
    const input = await fixture();
    input.lock.packages['node_modules/runtime'].dependencies = { shared: '^2.0.0', nested: '3.0.0' };
    input.lock.packages['node_modules/runtime/node_modules/nested'] = { version: '3.0.0' };
    await input.put('node_modules/runtime/package.json', JSON.stringify({ name: 'runtime', version: '1.0.0', dependencies: { nested: '3.0.0', shared: '^2.0.0' } }));
    await input.put('node_modules/runtime/node_modules/nested/package.json', '{"name":"nested","version":"3.0.0","license":"MIT"}');
    await input.put('node_modules/runtime/node_modules/nested/LICENSE', 'Nested original license');
    await input.put('node_modules/runtime/node_modules/nested/index.js', 'module.exports = {};');
    await input.put('package-lock.json', JSON.stringify(input.lock));
    const result = await (await api()).stageWindowsApp(input);
    expect(result.dependencies.some(item => item.path === 'node_modules/runtime/node_modules/nested')).toBe(true);
  });
  it('설치 버전과 잠금 파일·고정 루트 의존성 불일치를 거부한다', async () => {
    const input = await fixture(); await input.put('node_modules/runtime/package.json', '{"name":"runtime","version":"2.0.0"}');
    await expect((await api()).stageWindowsApp(input)).rejects.toThrow(/runtime.*version/i);
    await input.put('node_modules/runtime/package.json', '{"name":"runtime","version":"1.0.0","dependencies":{"shared":"^2.0.0"}}');
    input.metadata.devDependencies = { ...versions, 'pdfjs-dist': '^6.4.299' }; await input.put('package.json', JSON.stringify(input.metadata));
    await expect((await api()).stageWindowsApp(input)).rejects.toThrow(/pdfjs-dist.*pinned/i);
  });
  it('루트 선언만 고정되고 실제 잠금 버전이 바뀐 PDF 패키지를 거부한다', async () => {
    const input = await fixture(); input.lock.packages['node_modules/pdfjs-dist'].version = '6.5.0';
    await input.put('package-lock.json', JSON.stringify(input.lock));
    await input.put('node_modules/pdfjs-dist/package.json', JSON.stringify({ name: 'pdfjs-dist', version: '6.5.0', optionalDependencies: { '@napi-rs/canvas': '^1.0.10' } }));
    await expect((await api()).stageWindowsApp(input)).rejects.toThrow(/pdfjs-dist.*version/i);
  });
  it('잠금 경로 이탈과 라이선스 원문 누락을 거부한다', async () => {
    const input = await fixture(); input.lock.packages['node_modules/../../secret'] = { version: '1' };
    await input.put('package-lock.json', JSON.stringify(input.lock));
    await expect((await api()).stageWindowsApp(input)).rejects.toThrow(/dependency path/);
    delete input.lock.packages['node_modules/../../secret']; await input.put('package-lock.json', JSON.stringify(input.lock));
    await rm(join(input.root, 'node_modules/runtime/LICENSE'));
    await expect((await api()).stageWindowsApp(input)).rejects.toThrow(/license.*runtime/i);
  });
  it('symlink와 긴 상대 경로를 거부한다', async () => {
    const input = await fixture(); await input.put('node_modules/runtime/' + 'x'.repeat(151), 'not allowed');
    await expect((await api()).stageWindowsApp(input)).rejects.toThrow(/150/);
    await rm(join(input.root, 'node_modules/runtime/' + 'x'.repeat(151)));
    await symlink(join(input.root, '.env'), join(input.root, 'node_modules/runtime/leak.js'));
    await expect((await api()).stageWindowsApp(input)).rejects.toThrow(/symbolic link/);
  });
  it('필수 PDF 자원·언어 데이터·helper 누락을 거부한다', async () => {
    for (const path of ['node_modules/pdfjs-dist/wasm/openjpeg.wasm', 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'dist-electron/native/swallow-speech.exe']) {
      const input = await fixture(); await rm(join(input.root, path));
      await expect((await api()).stageWindowsApp(input)).rejects.toThrow();
    }
  }, 30_000);
  it('PE imports를 검사하고 별도 VC++ DLL이 필요하면 조용히 통과하지 않는다', async () => {
    const { peImports, stageWindowsApp } = await api();
    expect(peImports(pe(['KERNEL32.dll', 'VCRUNTIME140.dll']))).toEqual(['kernel32.dll', 'vcruntime140.dll']);
    expect(() => peImports(Buffer.from('not PE'))).toThrow(/PE/);
    const input = await fixture();
    await input.put('node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node', pe(['VCRUNTIME140.dll']));
    await expect(stageWindowsApp(input)).rejects.toThrow(/vcruntime140.dll/i);
  });
  it('런타임이 사용하는 legacy PDF 파일이 없으면 modern 파일이 있어도 거부한다', async () => {
    for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
      const input = await fixture(); await rm(join(input.root, 'node_modules/pdfjs-dist/legacy/build', name));
      await expect((await api()).stageWindowsApp(input)).rejects.toThrow(/legacy/);
    }
  });
  it('Windows 시스템 winspool.drv import를 지원한다', async () => {
    const input = await fixture();
    expect((await api()).peImports(pe(['winspool.drv']))).toEqual(['winspool.drv']);
    await input.put('dist-electron/native/swallow-speech.exe', pe(['winspool.drv']));
    await expect((await api()).stageWindowsApp(input)).resolves.toHaveProperty('version', '0.1.0');
  });
  it('패키징 임시·완성 폴더를 같은 출력 parent 아래에 만든다', async () => {
    const input = await fixture(); const parent = join(input.root, 'output-volume');
    const { createPackageWorkspace } = await api(); const paths = await createPackageWorkspace(parent);
    expect(dirname(paths.output)).toBe(parent);
    expect(dirname(paths.temporary)).toBe(parent);
    expect(paths.output).not.toBe(paths.temporary);
  });
  it('ASAR의 Windows 경로를 정규화해 필수 파일과 금지 파일을 같은 기준으로 검사한다', async () => {
    const { verifyAppArchive } = await api();
    const files = ['\\package.json', '\\dist\\index.html', '\\dist-electron\\electron\\main.js', '\\dist-electron\\electron\\preload.cjs'];
    expect(verifyAppArchive(files)).toContain('/package.json');
    expect(() => verifyAppArchive(files.slice(1))).toThrow(/missing/);
    for (const extra of ['\\docs\\release\\private.md', '\\userData\\library.sqlite']) expect(() => verifyAppArchive([...files, extra])).toThrow(/private\/source/);
  });
  it('PowerShell 환경변수 문법과 ZIP 어셈블리 로드를 검사한다', async () => {
    const files = ['scripts/package-windows.mjs', 'scripts/test-packaged-windows.mjs'];
    for (const file of files) expect(await readFile(new URL('../' + file, import.meta.url), 'utf8')).not.toMatch(/\$env\./);
    expect(await readFile(new URL('../scripts/package-windows.mjs', import.meta.url), 'utf8')).toContain('System.IO.Compression, System.IO.Compression.FileSystem');
  });
  it('cleanup은 UUID가 잘못되면 실행하지 않고 정확한 두 rule만 다룬다', async () => {
    const { cleanupRestrictions, restrictionCleanupCommands } = await import('../scripts/test-packaged-windows.mjs');
    const calls = [];
    for (const id of [undefined, '', '*', 'SwallowSmoke-*', 'SwallowSmoke-not-a-uuid']) await expect(cleanupRestrictions(id, async command => calls.push(command))).rejects.toThrow(/rule id/i);
    expect(calls).toEqual([]);
    const commands = restrictionCleanupCommands('SwallowSmoke-12345678-1234-4234-8234-123456789abc');
    expect(commands).toHaveLength(3);
    expect(commands[0]).toContain("'-electron'"); expect(commands[0]).toContain("'-speech'");
    expect(commands[0]).not.toContain("+'*'");
    expect(commands[1]).toMatch(/\(Get-Content[^\n]+ConvertFrom-Json\)\s*\|\s*ForEach-Object/);
  });
  it('방화벽·프로필 복구가 실패해도 ACL 복구를 각각 시도한다', async () => {
    const { cleanupRestrictions } = await import('../scripts/test-packaged-windows.mjs'); const calls = [];
    await expect(cleanupRestrictions('SwallowSmoke-12345678-1234-4234-8234-123456789abc', async command => {
      calls.push(command); if (calls.length < 3) throw new Error('simulated firewall recovery failure');
    })).rejects.toThrow(/cleanup/i);
    expect(calls).toHaveLength(3); expect(calls[2]).toContain('Set-Acl');
  });
  it('native/WASM 원문 고지의 고정 출처와 변조를 검증한다', async () => {
    const { NATIVE_NOTICE_SOURCES, RUST_NOTICE_ARCHIVES, validateOriginalNotice } = await api();
    const source = NATIVE_NOTICE_SOURCES.find(item => item.id === 'canvas-LICENSE');
    const bytes = await readFile(new URL('../node_modules/@napi-rs/canvas/LICENSE', import.meta.url));
    expect(() => validateOriginalNotice(source, bytes)).not.toThrow();
    expect(() => validateOriginalNotice(source, Buffer.from('changed'))).toThrow(/notice hash/i);
    for (const component of ['Skia', 'freetype', 'harfbuzz', 'libpng', 'libjpeg-turbo', 'libwebp', 'zlib', 'tesseract', 'leptonica']) expect(NATIVE_NOTICE_SOURCES.some(item => item.component === component)).toBe(true);
    expect(RUST_NOTICE_ARCHIVES.length).toBeGreaterThan(80);
    expect(RUST_NOTICE_ARCHIVES.every(item => /^[a-f0-9]{64}$/.test(item.sha256) && item.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)))).toBe(true);
  });
  it('smoke가 BUILD-INFO 리소스 변조와 경로 이탈을 거부한다', async () => {
    const { verifyBuildResources } = await import('../scripts/test-packaged-windows.mjs');
    const input = await fixture(); await input.put('resources/pdf-runtime/worker.mjs', 'known');
    const info = { resources: [{ path: 'resources/pdf-runtime/worker.mjs', bytes: 5, sha256: hash('known') }] };
    await expect(verifyBuildResources(input.root, info)).resolves.toBeUndefined();
    await input.put('resources/pdf-runtime/worker.mjs', 'changed');
    await expect(verifyBuildResources(input.root, info)).rejects.toThrow(/hash|size/i);
    info.resources[0].path = '../secret';
    await expect(verifyBuildResources(input.root, info)).rejects.toThrow(/resource path/i);
  });
  it('smoke 자식의 분할 UTF-8 출력을 보존하고 WAV 합성 중 stdin을 열어 둔다', async () => {
    const { runSmokeProcess } = await import('../scripts/test-packaged-windows.mjs');
    const result = await runSmokeProcess(process.execPath, ['-e', "process.stdin.once('data',()=>{const b=Buffer.from('한글');process.stdout.write(b.subarray(0,1));setTimeout(()=>{process.stdout.write(b.subarray(1));process.exit(0)},30)});process.stdin.on('end',()=>process.exit(8));"], { input: '{}\n', keepInputOpen: true, timeout: 1000 });
    expect(result.stdout).toBe('한글');
  });
  it('stderr가 빈 실패도 stdout·종료코드·작업 이름으로 진단한다', async () => {
    const { runSmokeProcess } = await import('../scripts/test-packaged-windows.mjs');
    let failure;
    try { await runSmokeProcess(process.execPath, ['-e', "process.stdout.write('synthetic PowerShell failure');process.exitCode=23"], { label: 'CI restriction setup' }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('synthetic PowerShell failure');
    expect(failure.message).toContain('CI restriction setup');
    expect(failure.diagnostic).toMatchObject({ exitCode: 23, signal: null, stdout: 'synthetic PowerShell failure', stderr: '' });
  });
  it('제한 설정 실패와 cleanup 실패를 모두 보존해 JSON 진단으로 내보낸다', async () => {
    const { applyRestrictionsWithCleanup, serializeSmokeError } = await import('../scripts/test-packaged-windows.mjs');
    const primary = Object.assign(new Error('synthetic apply failure'), { diagnostic: { exitCode: 1, stdout: 'apply details', stderr: '' } });
    const cleanup = new Error('synthetic cleanup failure'); let failure;
    try { await applyRestrictionsWithCleanup(async () => { throw primary; }, async () => { throw cleanup; }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.cause).toBe(primary);
    expect(serializeSmokeError(failure)).toMatchObject({ errors: [{ message: 'synthetic apply failure', diagnostic: { stdout: 'apply details' } }, { message: 'synthetic cleanup failure' }] });
  });
});
