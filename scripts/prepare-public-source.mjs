import { lstat, readdir, readFile, mkdir, mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname, extname, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const rootFiles = ['package.json', 'package-lock.json', 'LICENSE', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'PRIVACY.md',
  'THIRD_PARTY_NOTICES.md', 'tsconfig.json', 'tsconfig.electron.json', 'vite.config.ts', 'vitest.config.ts', 'index.html', '.nvmrc', '.gitignore'];
const sourceDirectories = ['src', 'electron', 'native', 'scripts', 'tests'];
const textExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.swift', '.py', '.md']);
const pdfFixtures = new Set(['diagram.pdf', 'encrypted.pdf', 'long.pdf', 'scan.pdf', 'too-many-pages.pdf']);
const excludedSource = ['vendor/siwc', 'electron/gemini.ts', 'electron/credential-encryption.ts', 'tests/gemini.test.ts',
  'tests/gemini-service.test.ts', 'tests/credential-encryption.test.ts', 'scripts/test-gemini-ui.mjs'];
const blockedPath = /(?:^|\/)(?:\.git|\.aws|\.ssh|chatgpt|userData|user-data|backups|node_modules|dist|dist-electron|coverage)(?:\/|$)|(?:^|\/)(?:token|credentials?|auth)\.json$|\.(?:sqlite|sqlite3|db|p12|pfx|pem|key|keystore|jks)(?:-wal|-shm)?$/i;
const subscriptionPackage = name => /^@siwc\//.test(name) || ['openai', 'jose', 'proper-lockfile'].includes(name);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Inspect an explicit source allowlist. Never traverse userData, credentials or Git objects. */
export async function inspectPublicSource(root = process.cwd()) {
  root = resolve(root);
  const issues = [], files = [];
  const issue = (code, path) => issues.push({ code, path });
  async function inspect(path, required = false) {
    let info;
    try { info = await lstat(join(root, path)); }
    catch (error) { if (error.code === 'ENOENT') { if (required) issue('missing-file', path); return; } throw error; }
    if (info.isSymbolicLink()) { issue('symlink', path); return; }
    if (blockedPath.test(path)) { issue('unexpected-file', path); return; }
    if (info.isDirectory()) {
      for (const name of (await readdir(join(root, path))).sort()) await inspect(`${path}/${name}`);
      return;
    }
    const binaryFixture = path.startsWith('tests/fixtures/pdf/') && pdfFixtures.has(path.slice('tests/fixtures/pdf/'.length));
    if (!info.isFile() || (!rootFiles.includes(path) && !textExtensions.has(extname(path)) && !binaryFixture) || info.size > 4_000_000) {
      issue('unexpected-file', path); return;
    }
    const bytes = await readFile(join(root, path));
    files.push({ path, size: bytes.length, sha256: digest(bytes) });
    if (binaryFixture) {
      if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) issue('invalid-pdf-fixture', path);
      return;
    }
    const text = bytes.toString('utf8');
    if (text.includes('\0')) issue('unexpected-binary', path);
    if (/\b(?:ghp_[A-Za-z0-9]{36,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) issue('sensitive-pattern', path);
    if (/^(?:src|electron)\//.test(path)) {
      if (/['"]@siwc\/|['"](?:openai|jose|proper-lockfile)['"]/.test(text)) issue('subscription-import', path);
      if (/(?:invoke(?:<[^>]+>)?|registerHandler)\(\s*['"](?:sign-in|cancel-sign-in|disconnect|select-profile|refresh-models|open-usage|gemini:)/.test(text)) issue('subscription-ipc', path);
    }
    if (path === 'package.json' || path === 'package-lock.json') {
      let manifest;
      try { manifest = JSON.parse(text); } catch { issue('invalid-json', path); return; }
      const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies });
      if (names.some(subscriptionPackage) || manifest.workspaces?.some?.(name => name.includes('siwc'))
        || Object.keys(manifest.scripts ?? {}).some(name => ['build:vendor', 'test:vendor'].includes(name))
        || Object.entries(manifest.packages ?? {}).some(([name, record]) => name.includes('vendor/siwc') || subscriptionPackage(name.split('node_modules/').at(-1))
          || Object.keys({ ...record.dependencies, ...record.optionalDependencies }).some(subscriptionPackage))) issue('subscription-dependency', path);
    }
    if (path === 'LICENSE' && (!text.includes('MIT License') || !text.includes('Copyright (c) 2026 nemory'))) issue('license-identity', path);
  }
  for (const path of excludedSource) {
    try { await lstat(join(root, path)); issue('subscription-source', path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const path of rootFiles) await inspect(path, true);
  for (const path of sourceDirectories) await inspect(path, true);
  const published = new Set(files.map(file => file.path));
  for (const file of files.filter(file => extname(file.path) === '.md')) {
    const text = await readFile(join(root, file.path), 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      const name = relative(root, resolve(root, dirname(file.path), target.split('#')[0])).replaceAll('\\', '/');
      if (!published.has(name)) issue('unpublished-link', file.path);
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { status: issues.length ? 'blocked' : 'ready', scope: 'Working source allowlist; no Git history, user data or publication actions', issues, files };
}

/** Create a new history-free source directory; never overwrite an existing checkout. */
export async function preparePublicSource(root = process.cwd()) {
  root = resolve(root);
  const report = await inspectPublicSource(root);
  if (report.status !== 'ready') return report;
  const parent = join(root, 'artifacts', 'public-source');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'swallow-'));
  try {
    for (const file of report.files) {
      // Recheck type and bytes so concurrently edited files cannot silently enter the snapshot.
      const source = join(root, file.path);
      if (!(await lstat(source)).isFile() || digest(await readFile(source)) !== file.sha256) throw new Error('Source changed during export. Retry after edits finish.');
      const destination = join(directory, file.path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
      if (digest(await readFile(destination)) !== file.sha256) throw new Error('Source changed during export. Retry after edits finish.');
    }
    await writeFile(`${directory}.manifest.json`, JSON.stringify({ ...report, directory }, null, 2) + '\n');
    return { status: 'prepared', directory, manifest: `${directory}.manifest.json`, fileCount: report.files.length };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = process.argv.includes('--check') ? await inspectPublicSource() : await preparePublicSource();
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'blocked') process.exitCode = 1;
  } catch {
    console.error('공개 소스를 검사하거나 내보내지 못했습니다. 저장 권한과 동시 편집 여부를 확인하세요. 원본은 변경하지 않았습니다.');
    process.exitCode = 1;
  }
}
