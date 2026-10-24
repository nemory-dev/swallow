import { appendFile, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { packager } from '@electron/packager';
import { listPackage } from '@electron/asar';
import { assertWindowsHost, createPackageWorkspace, NATIVE_NOTICE_SOURCES, RUST_NOTICE_ARCHIVES, resourceInventory, sha256, stageNativeNotices, stageWindowsApp, TESSDATA_LICENSE, TR46_LICENSE, verifyAppArchive } from './windows-package.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
function run(command, args, { env = process.env, timeout = 600_000, capture = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, env, timeout, windowsHide: true, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status}).${capture ? '\n' + result.stderr.slice(0, 2000) : ''}`);
  return result.stdout?.trim();
}
async function fetchPinned(source, maxBytes = 2_000_000) {
  const response = await fetch(source.url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Original notice download failed (${response.status}): ${source.url}`);
  const raw = Buffer.from(await response.arrayBuffer());
  const bytes = source.encoding === 'base64' ? Buffer.from(raw.toString('ascii').trim(), 'base64') : raw;
  if (bytes.length > maxBytes || sha256(bytes) !== source.sha256) throw new Error(`Pinned original notice/source archive hash mismatch: ${source.url}`);
  return bytes;
}
async function mapLimited(items, operation) {
  let next = 0;
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (next < items.length) { const index = next++; await operation(items[index]); }
  }));
  const failure = outcomes.find(item => item.status === 'rejected');
  if (failure) throw failure.reason;
}
async function prepareNativeNotices(root, licenses, temporary) {
  const documents = new Map(), rustDocuments = new Map();
  await mapLimited(NATIVE_NOTICE_SOURCES, async source => documents.set(source.id, await fetchPinned(source)));
  const sourceDirectory = join(temporary, 'notice-sources'); await mkdir(sourceDirectory);
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/tar.exe');
  await mapLimited(RUST_NOTICE_ARCHIVES, async source => {
    const archive = join(sourceDirectory, `${source.name}-${source.version}.crate`);
    await writeFile(archive, await fetchPinned(source, 32_000_000));
    const originals = [];
    for (const file of source.files) {
      // Extract only the pinned notice to stdout; no archive-controlled paths are written to disk.
      const result = spawnSync(tar, ['-xOf', archive, file.path], { windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
      if (result.error || result.status !== 0) throw new Error(`Cannot read pinned Rust notice: ${source.name}/${file.path}`);
      originals.push({ path: file.path, bytes: result.stdout });
    }
    rustDocuments.set(source.name + '@' + source.version, originals);
    await rm(archive, { force: true, maxRetries: 5, retryDelay: 200 });
  });
  return stageNativeNotices({ root, licenses, documents, rustDocuments });
}
async function main() {
  assertWindowsHost();
  if (process.argv.length !== 2 || !process.env.npm_execpath) throw new Error('Usage: npm run package:win:x64');
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const electronVersion = JSON.parse(await readFile(join(root, 'node_modules/electron/package.json'), 'utf8')).version;
  if (metadata.devDependencies.electron !== electronVersion) throw new Error('Installed Electron differs from its pinned version; run npm ci.');
  const installEnv = { ...process.env, ELECTRON_INSTALL_PLATFORM: 'win32', ELECTRON_INSTALL_ARCH: 'x64' };
  delete installEnv.ELECTRON_OVERRIDE_DIST_PATH;
  run(process.execPath, [join(root, 'node_modules/electron/install.js')], { env: installEnv });
  const runtimeVersion = (await readFile(join(root, 'node_modules/electron/dist/version'), 'utf8')).trim().replace(/^v/, '');
  if (runtimeVersion !== electronVersion) throw new Error('Electron Windows runtime version mismatch.');
  run(process.execPath, [process.env.npm_execpath, 'run', 'build']);
  const { output, temporary } = await createPackageWorkspace(join(root, 'artifacts/windows-preview'));
  try {
    console.log('Preparing pinned upstream original licenses (build-time network only).');
    const [tessdataLicense, tr46License] = await Promise.all([TESSDATA_LICENSE, TR46_LICENSE].map(source => fetchPinned(source)));
    const stage = join(temporary, 'app'), pdfRuntime = join(temporary, 'pdf-runtime');
    const native = join(temporary, 'native'), licenses = join(temporary, 'licenses');
    const staged = await stageWindowsApp({ root, stage, pdfRuntime, native, licenses, tessdataLicense, tr46License });
    const nativeNoticeCoverage = await prepareNativeNotices(root, licenses, temporary);
    await mkdir(join(licenses, 'electron'), { recursive: true });
    for (const name of ['LICENSE', 'LICENSES.chromium.html']) await copyFile(join(root, 'node_modules/electron/dist', name), join(licenses, 'electron', name));
    const [directory] = await packager({
      dir: stage, out: join(temporary, 'packaged'), name: 'Swallow', executableName: 'Swallow',
      platform: 'win32', arch: 'x64', electronVersion, appVersion: staged.version,
      asar: true, prune: false, extraResource: [pdfRuntime, native, licenses],
      win32metadata: { CompanyName: 'nemory', FileDescription: 'Swallow Windows Preview', ProductName: 'Swallow' },
      ...(process.env.electron_config_cache ? { download: { cacheRoot: process.env.electron_config_cache } } : {}),
    });
    if (!directory) throw new Error('Electron Packager did not produce an app.');
    verifyAppArchive(listPackage(join(directory, 'resources/app.asar')));
    const app = join(output, 'Swallow'); await rename(directory, app);
    await copyFile(join(root, 'docs/windows-preview.md'), join(app, 'README-WINDOWS.txt'));
    const commit = run('git', ['rev-parse', 'HEAD'], { capture: true });
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Cannot determine build commit.');
    const electronEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_OVERRIDE_DIST_PATH']) delete electronEnv[key];
    const versions = JSON.parse(run(join(app, 'Swallow.exe'), ['-e', 'console.log(JSON.stringify(process.versions))'], { env: electronEnv, capture: true, timeout: 30_000 }));
    if (versions.electron !== electronVersion) throw new Error('Packaged Electron runtime version mismatch.');
    const resources = [
      ...await resourceInventory(join(app, 'resources/pdf-runtime'), 'resources/pdf-runtime'),
      ...await resourceInventory(join(app, 'resources/native'), 'resources/native'),
      ...await resourceInventory(join(app, 'resources/licenses'), 'resources/licenses'),
    ];
    const info = {
      format: 1, name: 'Swallow', version: staged.version, target: 'Windows 11 x64 trial', platform: 'win32', arch: 'x64',
      commit, sourceDirty: !!run('git', ['status', '--porcelain', '--untracked-files=no'], { capture: true }),
      lockfileSha256: sha256(await readFile(join(root, 'package-lock.json'))), builtAt: new Date().toISOString(),
      build: { node: process.versions.node, os: process.env.ImageOS ?? process.platform, runnerImage: process.env.ImageVersion ?? null },
      runtime: { electron: versions.electron, node: versions.node, chrome: versions.chrome },
      signing: 'unsigned', automaticUpdates: false, windows11DeviceVerified: false,
      dependencies: staged.dependencies, pdfDependencies: staged.pdfDependencies, nativeImports: staged.nativeImports,
      nativeNoticeCoverage,
      ocrData: { languages: ['kor', 'eng'], packageVersion: '1.0.0', variant: '4.0.0_best_int', gzip: true, runtimeDownloads: false, cache: false },
      resources, verification: 'See the separate smoke result; BUILD-INFO is written before the immutable ZIP is tested.',
    };
    await writeFile(join(app, 'BUILD-INFO.json'), JSON.stringify(info, null, 2) + '\n');
    await copyFile(join(app, 'BUILD-INFO.json'), join(output, 'BUILD-INFO.json'));
    // Check the entire extracted tree, including Electron DLLs/locales, for relative path/symlink problems.
    await resourceInventory(app, 'Swallow');
    const zip = join(output, `Swallow-${staged.version}-windows-x64-trial-unsigned.zip`);
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    run(powershell, ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:SWALLOW_ZIP_INPUT, $env:SWALLOW_ZIP_OUTPUT, [IO.Compression.CompressionLevel]::Optimal, $true)"], { env: { ...process.env, SWALLOW_ZIP_INPUT: app, SWALLOW_ZIP_OUTPUT: zip } });
    const smoke = join(output, 'smoke');
    run(process.execPath, [join(root, 'scripts/test-packaged-windows.mjs'), '--zip', zip, '--fixtures', join(root, 'tests/fixtures/pdf'), '--output', smoke], { timeout: 600_000 });
    const zipName = zip.slice(output.length + 1);
    await writeFile(join(output, 'SHA256SUMS'), `${sha256(await readFile(zip))}  ${zipName}\n${sha256(await readFile(join(output, 'BUILD-INFO.json')))}  BUILD-INFO.json\n`);
    const harness = join(output, 'harness'); await mkdir(join(harness, 'fixtures'), { recursive: true });
    await copyFile(join(root, 'scripts/test-packaged-windows.mjs'), join(harness, 'test-packaged-windows.mjs'));
    await copyFile(join(root, 'scripts/test-chatgpt-ui.mjs'), join(harness, 'test-chatgpt-ui.mjs'));
    for (const name of ['diagram.pdf', 'scan.pdf', 'encrypted.pdf', 'too-many-pages.pdf']) await copyFile(join(root, 'tests/fixtures/pdf', name), join(harness, 'fixtures', name));
    const playwrightVersion = JSON.parse(await readFile(join(root, 'node_modules/playwright/package.json'), 'utf8')).version;
    if (metadata.devDependencies.playwright !== playwrightVersion) throw new Error('Playwright version differs from the pin.');
    await writeFile(join(harness, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { playwright: playwrightVersion } }, null, 2) + '\n');
    // Keep diagnostics/harness outside the delivery ZIP. CI uploads exact files only.
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `output=${output}\nzip=${zip}\nharness=${harness}\n`);
    console.log(`Windows trial ZIP: ${zip}\nSHA256: ${join(output, 'SHA256SUMS')}\nSmoke: ${join(smoke, 'result.json')}`);
  } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
