import assert from 'node:assert/strict';
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This harness can be copied alone with synthetic fixtures. It never imports checkout code.
const script = fileURLToPath(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const powershell = () => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

export async function verifyBuildResources(app, info) {
  assert.ok(Array.isArray(info.resources) && info.resources.length, 'BUILD-INFO resources missing');
  const seen = new Set();
  for (const file of info.resources) {
    if (typeof file.path !== 'string' || !/^resources\/(?:pdf-runtime|native|licenses)\//.test(file.path)
      || file.path.length + 'Swallow/'.length > 150 || file.path.split('/').some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part))) throw new Error('Invalid BUILD-INFO resource path');
    assert.ok(!seen.has(file.path.toLowerCase()), 'Duplicate resource path'); seen.add(file.path.toLowerCase());
    let current = app;
    for (const part of file.path.split('/')) { current = join(current, part); assert.ok(!(await lstat(current)).isSymbolicLink(), 'Resource symlink'); }
    const bytes = await readFile(current);
    assert.equal(bytes.length, file.bytes, `Resource size mismatch: ${file.path}`);
    assert.equal(hash(bytes), file.sha256, `Resource hash mismatch: ${file.path}`);
  }
}

function execute(command, args, { env = process.env, cwd, input, timeout = 180_000, maxBytes = 1_000_000, allowFailure = false, keepInputOpen = false } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { env, cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = []; let size = 0, finished = false;
    const finish = (error, value) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (error) {
        // Kill only the process tree started by this harness, including an active PDF child.
        if (process.platform === 'win32' && child.pid) spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000, stdio: 'ignore' });
        child.kill(); reject(error);
      } else resolveResult(value);
    };
    const timer = setTimeout(() => finish(new Error('Packaged smoke subprocess timed out.')), timeout);
    child.on('error', error => finish(error));
    child.stdin.on('error', error => finish(error));
    for (const [stream, kind] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { finish(new Error('Packaged smoke subprocess exceeded output limit.')); return; }
      (kind === 'stdout' ? stdout : stderr).push(chunk);
    });
    child.on('close', (code, signal) => {
      try {
        const decode = chunks => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        const out = decode(stdout), err = decode(stderr);
        if (!allowFailure && code !== 0) finish(new Error(`Packaged subprocess failed (${signal ?? code}): ${err.slice(0, 2000)}`));
        else finish(undefined, { code, signal, stdout: out, stderr: err });
      } catch (error) { finish(error); }
    });
    if (keepInputOpen) child.stdin.write(input); else child.stdin.end(input);
  });
}
export { execute as runSmokeProcess };
async function ps(command, env = {}) {
  return execute(powershell(), ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; " + command], { env: { ...process.env, ...env }, timeout: 60_000 });
}
function appEnvironment(data, extra = {}) {
  const env = { ...process.env, PATH: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'), SWALLOW_DATA_DIR: data, SWALLOW_DEV_URL: 'https://packaged-must-ignore.invalid', ...extra };
  for (const key of Object.keys(env)) if (['node_path', 'node_options', 'electron_run_as_node', 'electron_override_dist_path'].includes(key.toLowerCase())) delete env[key];
  return env;
}
async function sourceAbsent(source) {
  if (!source) return false;
  for (const path of ['package.json', 'src', 'electron', 'dist-electron', 'node_modules']) {
    try { await access(join(source, path)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('Source/development dependencies are present in the clean smoke job.');
  }
  return true;
}

async function electronPhase(phase, app, fixtures, data, resultPath) {
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
  assert.equal(resolve(process.execPath).toLowerCase(), resolve(app, 'Swallow.exe').toLowerCase());
  assert.ok(process.versions.electron, 'This phase must run inside packaged Electron, not system Node.');
  const packaged = path => import(pathToFileURL(join(app, 'resources/app.asar', path)).href);
  const [{ LibraryStore }, { PdfStore }, { createDocument, applyStudyAction }] = await Promise.all([
    packaged('dist-electron/electron/library.js'), packaged('dist-electron/electron/pdf.js'), packaged('dist-electron/src/learning/document.js'),
  ]);
  const launch = { command: process.execPath, args: [join(app, 'resources/pdf-runtime/worker.mjs'), '--parent-pid', String(process.pid)], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, resultFd: 3 };
  const pdf = new PdfStore(join(data, 'pdf'), launch), store = new LibraryStore(join(data, 'library.json'));
  const checks = [], timings = {};
  try {
    await store.load();
    if (phase === 'write') {
      for (const [name, id] of [['diagram.pdf', 'packaged-diagram'], ['scan.pdf', 'packaged-scan']]) {
        const start = performance.now(); const result = await pdf.import(join(fixtures, name), name, new AbortController().signal);
        timings[name] = Math.round(performance.now() - start);
        const doc = createDocument(result.input, { id });
        if (name === 'diagram.pdf') assert.match(doc.source, /Water moves from reservoir A/);
        else { assert.equal(doc.pdf.pages[0].method, 'ocr'); assert.match(doc.source, /Heat turns water into vapor/); assert.match(doc.source, /수증기/); }
        const image = await pdf.render(doc.pdf.assetId, 1);
        const jpeg = Buffer.from(image.split(',')[1], 'base64'); assert.equal(jpeg[0], 255); assert.equal(jpeg[1], 216); assert.ok(jpeg.length > 1000);
        await store.update(state => ({ ...state, documents: [...state.documents, doc], activeDocumentId: id }));
        assert.equal(hash(await readFile(join(data, 'pdf', doc.pdf.assetId + '.pdf'))), doc.pdf.assetId);
      }
      await store.select('packaged-diagram');
      await store.update(state => applyStudyAction(state, { type: 'save-recall', documentId: 'packaged-diagram', unitId: 'unit-0', answer: '물은 A에서 B로 흐른다.' }));
      await store.update(state => applyStudyAction(state, { type: 'save-pdf-note', documentId: 'packaged-diagram', page: 1, note: '설치본 한글 메모 보존' }));
      assert.ok(store.search('Water').length);
      checks.push('packaged PDF text', 'packaged native canvas/JPEG', 'cold Korean/English OCR', 'SQLite write/search', 'PDF asset hash');
    } else if (phase === 'read') {
      const state = store.exportLibrary(); assert.equal(state.documents.length, 2);
      const doc = state.documents.find(item => item.id === 'packaged-diagram');
      assert.equal(doc.recalls['unit-0'].answer, '물은 A에서 B로 흐른다.'); assert.equal(doc.pdf.pages[0].note, '설치본 한글 메모 보존');
      const scan = state.documents.find(item => item.id === 'packaged-scan'); assert.equal(scan.pdf.pages[0].method, 'ocr'); assert.match(scan.source, /수증기/);
      assert.match(await pdf.render(doc.pdf.assetId, 1), /^data:image\/jpeg;base64,/);
      const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(join(data, 'library.sqlite'), { readOnly: true });
      try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); } finally { db.close(); }
      checks.push('second process SQLite reopen', 'answer/PDF note persistence', 'PDF rerender', 'SQLite integrity');
    } else if (phase === 'failures') {
      const failureData = join(data, 'failure-pdf'); const failing = new PdfStore(failureData, launch);
      for (const name of ['encrypted.pdf', 'too-many-pages.pdf']) await assert.rejects(failing.import(join(fixtures, name), name, new AbortController().signal));
      const bad = join(data, 'broken.pdf'); await writeFile(bad, '%PDF-1.7\nBROKEN');
      await assert.rejects(failing.import(bad, 'broken', new AbortController().signal));
      const controller = new AbortController(); const pending = failing.import(join(fixtures, 'scan.pdf'), 'cancel', controller.signal);
      const timer = setTimeout(() => controller.abort(), 20);
      try { await assert.rejects(pending); } finally { clearTimeout(timer); }
      assert.deepEqual(await readdir(failureData).catch(error => { if (error.code === 'ENOENT') return []; throw error; }), []);
      const missing = new PdfStore(join(data, 'missing-helper'), { ...launch, args: [join(app, 'resources/pdf-runtime/missing-worker.mjs')] });
      await assert.rejects(missing.import(join(fixtures, 'diagram.pdf'), 'missing', new AbortController().signal));
      assert.deepEqual(await readdir(join(data, 'missing-helper')).catch(error => { if (error.code === 'ENOENT') return []; throw error; }), []);
      assert.equal(store.exportLibrary().documents.length, 2);
      checks.push('encrypted/over-limit/malformed PDF rejection', 'cancel rollback', 'missing helper error', 'existing data retained');
    } else throw new Error('Invalid Electron smoke phase.');
    await writeFile(resultPath, JSON.stringify({ phase, checks, timingsMs: timings, versions: { electron: process.versions.electron, node: process.versions.node } }, null, 2) + '\n');
  } finally { store.close(); }
}

async function extract(zip, destination) {
  await ps(`Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem;
    $archive=[IO.Compression.ZipFile]::OpenRead($env:SWALLOW_SMOKE_ZIP);
    try { foreach($entry in $archive.Entries) {
      $name=$entry.FullName.Replace('\\','/');
      if (!$name.StartsWith('Swallow/') -or $name.Length -gt 150 -or $name -match '(^|/)\\.\\.(/|$)|:|^/' -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Unsafe ZIP entry'; }
    } } finally { $archive.Dispose(); }
    [IO.Compression.ZipFile]::ExtractToDirectory($env:SWALLOW_SMOKE_ZIP,$env:SWALLOW_SMOKE_EXTRACT)`, { SWALLOW_SMOKE_ZIP: zip, SWALLOW_SMOKE_EXTRACT: destination });
}

const ruleIdPattern = '^SwallowSmoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const ruleGuard = `if (!$env:SWALLOW_SMOKE_RULE -or $env:SWALLOW_SMOKE_RULE -cnotmatch '${ruleIdPattern}') { throw 'Invalid smoke rule id'; }`;
const exactRuleNames = "$ruleNames=@(($env:SWALLOW_SMOKE_RULE+'-electron'),($env:SWALLOW_SMOKE_RULE+'-speech'));";
export function restrictionCleanupCommands(id) {
  if (typeof id !== 'string' || !new RegExp(ruleIdPattern).test(id)) throw new Error('Invalid smoke rule id');
  return [
    `${ruleGuard} ${exactRuleNames} Get-NetFirewallRule -Name $ruleNames -ErrorAction SilentlyContinue | Remove-NetFirewallRule;`,
    `${ruleGuard} if (Test-Path -LiteralPath $env:SWALLOW_SMOKE_PROFILES) { (Get-Content -Raw -LiteralPath $env:SWALLOW_SMOKE_PROFILES | ConvertFrom-Json) | ForEach-Object { Set-NetFirewallProfile -Name $_.Name -Enabled $_.Enabled; } }`,
    `${ruleGuard} if (Test-Path -LiteralPath $env:SWALLOW_SMOKE_ACL) { $acl=Get-Acl -LiteralPath $env:SWALLOW_SMOKE_APP; $acl.SetSecurityDescriptorSddlForm([IO.File]::ReadAllText($env:SWALLOW_SMOKE_ACL)); Set-Acl -LiteralPath $env:SWALLOW_SMOKE_APP -AclObject $acl; }`,
  ];
}
export async function cleanupRestrictions(id, run) {
  const commands = restrictionCleanupCommands(id), failures = [];
  // Independent invocations ensure ACL recovery is attempted even when firewall recovery fails.
  for (const command of commands) { try { await run(command); } catch (error) { failures.push(error); } }
  if (failures.length) throw new AggregateError(failures, 'CI restriction cleanup failed: ' + failures.map(error => error.message).join('; '));
}
async function restrictions(app, temporary) {
  assert.equal(process.env.CI, 'true', 'Installation ACL/firewall restrictions are allowed only in the isolated CI runner.');
  const id = 'SwallowSmoke-' + randomUUID();
  const env = { SWALLOW_SMOKE_APP: app, SWALLOW_SMOKE_RULE: id, SWALLOW_SMOKE_ACL: join(temporary, 'acl.txt'), SWALLOW_SMOKE_PROFILES: join(temporary, 'firewall-profiles.json') };
  const cleanup = () => cleanupRestrictions(id, command => ps(command, env));
  try {
    await ps(`
      ${ruleGuard} ${exactRuleNames}
      if ((Get-Service MpsSvc).Status -ne 'Running') { throw 'Windows Firewall service is not running'; }
      Get-NetFirewallProfile | Select-Object Name,Enabled | ConvertTo-Json | Set-Content -LiteralPath $env:SWALLOW_SMOKE_PROFILES;
      Set-NetFirewallProfile -All -Enabled True;
      New-NetFirewallRule -Name $ruleNames[0] -DisplayName 'Swallow isolated smoke Electron' -Direction Outbound -Program (Join-Path $env:SWALLOW_SMOKE_APP 'Swallow.exe') -Action Block -Profile Any | Out-Null;
      New-NetFirewallRule -Name $ruleNames[1] -DisplayName 'Swallow isolated smoke speech' -Direction Outbound -Program (Join-Path $env:SWALLOW_SMOKE_APP 'resources/native/swallow-speech.exe') -Action Block -Profile Any | Out-Null;
      $rules=@(Get-NetFirewallRule -Name $ruleNames); if ($rules.Count -ne 2 -or @($rules | Where-Object { $_.Enabled -ne 'True' -or $_.Action -ne 'Block' }).Count) { throw 'Firewall block verification failed'; }
      $acl=Get-Acl -LiteralPath $env:SWALLOW_SMOKE_APP; [IO.File]::WriteAllText($env:SWALLOW_SMOKE_ACL,$acl.Sddl);
      $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User;
      $rule=[Security.AccessControl.FileSystemAccessRule]::new($identity, [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles', [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Deny);
      $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:SWALLOW_SMOKE_APP -AclObject $acl;`, env);
    return cleanup;
  } catch (error) { await cleanup(); throw error; }
}

async function speechSmoke(app, data, env) {
  const helper = join(app, 'resources/native/swallow-speech.exe'); await access(helper);
  const result = await execute(helper, ['voices', '--parent-pid', String(process.pid)], { env, timeout: 20_000, maxBytes: 65_536 });
  const voices = JSON.parse(result.stdout); assert.ok(Array.isArray(voices), 'TTS voices protocol must return an array.');
  for (const voice of voices) assert.ok(typeof voice.id === 'string' && typeof voice.lang === 'string');
  if (!voices.length) return { resource: 'loaded', enumeration: 'passed', synthesis: 'unavailable-no-SAPI5-voices', physicalAudioVerified: false };
  const wav = join(data, 'speech.wav');
  const speech = await execute(helper, ['speak', '--parent-pid', String(process.pid), '--output-wav', wav], { env, input: JSON.stringify({ rate: 0, chunks: [{ voice: voices[0].id, text: 'Swallow packaged speech test.' }] }) + '\n', keepInputOpen: true, timeout: 30_000, maxBytes: 65_536 });
  const events = speech.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  assert.ok(events.some(event => event.event === 'done'), 'TTS WAV must finish with a done event.');
  assert.ok(!events.some(event => event.event === 'error'), 'TTS helper reported an error.');
  const bytes = await readFile(wav); assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE'); assert.ok(bytes.length > 44);
  return { resource: 'loaded', enumeration: 'passed', voiceLanguages: voices.map(voice => voice.lang), synthesis: 'WAV-passed', physicalAudioVerified: false };
}

async function uiSmoke(app, temporary, fixtures, output, absent) {
  const modulePath = process.env.SWALLOW_PLAYWRIGHT_MODULE;
  const { _electron: electron } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
  const cwd = join(temporary, '다른 작업 폴더'), local = join(temporary, 'local-app-data'); await mkdir(cwd); await mkdir(local);
  const env = appEnvironment(undefined, { LOCALAPPDATA: local }); delete env.SWALLOW_DATA_DIR;
  const errors = [], answer = '작은 부분을 읽고 내 말로 답합니다.';
  let sampleId;
  const runtimeChecks = [];
  async function launch(operation, label) {
    await sourceAbsent(absent);
    const instance = await electron.launch({ executablePath: join(app, 'Swallow.exe'), args: [], cwd, env, timeout: 30_000 });
    let page;
    try {
      page = await instance.firstWindow(); page.setDefaultTimeout(30_000);
      page.on('pageerror', error => errors.push(error.message));
      const runtime = await instance.evaluate(({ app }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData'), arch: process.arch, cwd: process.cwd(), path: process.env.PATH, version: app.getVersion() }));
      assert.equal(runtime.packaged, true); assert.equal(runtime.arch, 'x64');
      assert.equal(resolve(runtime.appPath).toLowerCase(), resolve(app, 'resources/app.asar').toLowerCase());
      assert.equal(resolve(runtime.userData).toLowerCase(), resolve(local, 'Swallow').toLowerCase());
      assert.equal(runtime.cwd, cwd); assert.equal(runtime.path, env.PATH);
      await page.waitForFunction(() => !!window.swallow);
      await page.evaluate(() => window.swallow.setLanguagePreferences({ uiLocale: 'ko', responseLanguage: 'ko' }));
      assert.match(page.url(), /^swallow:\/\/app\//);
      await operation({ page, instance });
      await page.screenshot({ path: join(output, label + '.png'), fullPage: true });
      assert.deepEqual(errors, [], 'renderer page errors'); runtimeChecks.push(label);
    } catch (error) { if (page) await page.screenshot({ path: join(output, 'ui-failure.png') }).catch(() => {}); throw error; }
    finally { await instance.close(); }
  }
  await launch(async ({ page }) => {
    await page.getByRole('button', { name: '짧은 예제 문서로 시작하기 →', exact: true }).click();
    await page.getByRole('button', { name: '공부 시작', exact: true }).click();
    await page.getByRole('button', { name: '한 가지 질문에 답해보기 →', exact: true }).click();
    await page.getByRole('textbox', { name: '내 답변', exact: true }).fill(answer);
    await page.getByRole('button', { name: '답변 저장하고 요점노트 보기', exact: true }).click();
    await page.getByRole('button', { name: '요점노트 저장', exact: true }).click();
    await page.getByRole('heading', { name: '한 부분을 공부하고 노트로 남겼어요.', exact: true }).waitFor();
    sampleId = (await page.evaluate(() => window.swallow.getState())).library.activeDocumentId;
  }, 'first-study');
  await launch(async ({ page, instance }) => {
    const voices = await page.evaluate(() => window.swallow.getSpeechVoices());
    assert.ok(Array.isArray(voices), 'Packaged preload voice IPC must return an array, including when no SAPI5 voice is installed.');
    for (const voice of voices) assert.ok(typeof voice.id === 'string' && typeof voice.lang === 'string');
    runtimeChecks.push('preload speech-voices IPC');
    const workspace = await page.evaluate(id => window.swallow.getStudyWorkspace(id), sampleId);
    assert.equal(workspace.notes[0].userAnswer, answer);
    await instance.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, join(fixtures, 'diagram.pdf'));
    await page.getByRole('button', { name: /^파일 가져오기/ }).click();
    await page.getByRole('heading', { name: 'diagram', exact: true }).waitFor();
    await page.getByRole('button', { name: '자유 읽기', exact: true }).click();
    await page.locator('.pdf-page-preview img').waitFor();
    await page.waitForFunction(() => { const image = document.querySelector('.pdf-page-preview img'); return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0; });
    assert.match(await page.locator('.source-text').innerText(), /Water moves from reservoir A/);
  }, 'reopened-pdf');
  await access(join(local, 'Swallow/library.sqlite'));
  return { checks: runtimeChecks, rendererErrors: errors, defaultDataLocation: 'LOCALAPPDATA/Swallow', path: 'System32-only', physicalAudioVerified: false };
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Packaged Windows smoke requires Windows x64.');
  const args = process.argv.slice(2), values = {}, flags = new Set();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--ci-restrictions') { flags.add(key); continue; }
    if (!['--zip', '--fixtures', '--output', '--absent-source'].includes(key) || !args[index + 1] || values[key]) throw new Error('Usage: node test-packaged-windows.mjs --zip ABSOLUTE.zip --fixtures ABSOLUTE --output ABSOLUTE [--absent-source ABSOLUTE] [--ci-restrictions]');
    values[key] = args[++index]; assert.ok(isAbsolute(values[key]), 'Smoke paths must be absolute.');
  }
  for (const key of ['--zip', '--fixtures', '--output']) assert.ok(values[key], key + ' is required');
  const output = values['--output']; await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), 'swallow-win-smoke-'));
  const extracted = join(temporary, '한글 압축 해제'), data = join(temporary, '학습 데이터'), fixtures = join(temporary, '합성 PDF');
  await mkdir(data); await mkdir(fixtures);
  for (const name of ['diagram.pdf', 'scan.pdf', 'encrypted.pdf', 'too-many-pages.pdf']) await copyFile(join(values['--fixtures'], name), join(fixtures, name));
  let cleanup;
  const report = { status: 'running', platform: 'Windows hosted runner or local Windows', windows11DeviceVerified: false, sourceAbsent: false, restrictions: false, phases: [] };
  try {
    report.sourceAbsent = await sourceAbsent(values['--absent-source']);
    await extract(values['--zip'], extracted);
    assert.deepEqual(await readdir(extracted), ['Swallow']); const app = join(extracted, 'Swallow');
    const info = JSON.parse(await readFile(join(app, 'BUILD-INFO.json'), 'utf8'));
    assert.equal(info.platform, 'win32'); assert.equal(info.arch, 'x64'); assert.equal(info.signing, 'unsigned');
    await verifyBuildResources(app, info);
    const before = hash(await readFile(join(app, 'resources/app.asar')));
    if (flags.has('--ci-restrictions')) { cleanup = await restrictions(app, temporary); report.restrictions = true; }
    const env = appEnvironment(data), executable = join(app, 'Swallow.exe');
    if (cleanup) await execute(executable, ['-e', "const fs=require('node:fs');try{fs.writeFileSync(require('node:path').join(process.env.SWALLOW_SMOKE_APP,'write-probe'),'probe');process.exit(9)}catch(e){if(!['EACCES','EPERM'].includes(e.code))throw e}"], { env: { ...env, ELECTRON_RUN_AS_NODE: '1', SWALLOW_SMOKE_APP: app }, cwd: temporary, timeout: 10_000 });
    for (const phase of ['write', 'read', 'failures']) {
      const result = join(temporary, phase + '.json');
      await execute(executable, [script, '--electron-phase', phase, app, fixtures, data, result], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, cwd: temporary });
      report.phases.push(JSON.parse(await readFile(result, 'utf8')));
    }
    report.speech = await speechSmoke(app, data, env);
    report.ui = await uiSmoke(app, temporary, fixtures, output, values['--absent-source']);
    await verifyBuildResources(app, info); assert.equal(hash(await readFile(join(app, 'resources/app.asar'))), before);
    const unexpected = (await readdir(temporary, { recursive: true })).filter(path => /\.traineddata(?:\.gz)?$/.test(path) && !path.startsWith('한글 압축 해제'));
    assert.deepEqual(unexpected, [], 'OCR must not write language cache outside the installation.');
    await sourceAbsent(values['--absent-source']); report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.message; throw error;
  } finally {
    try { if (cleanup) await cleanup(); }
    catch (error) { report.status = 'failed'; report.cleanupError = error.message; throw error; }
    finally { await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n'); await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  }
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[2] === '--electron-phase') {
  try { await electronPhase(...process.argv.slice(3)); } catch (error) { console.error(error.stack); process.exitCode = 1; }
} else if (process.argv[1] && resolve(process.argv[1]) === script) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
