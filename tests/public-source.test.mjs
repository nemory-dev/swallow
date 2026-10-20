import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const roots = [];
afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'swallow-public-source-test-')); roots.push(root);
  for (const name of ['src', 'electron', 'native', 'scripts', 'tests/fixtures/pdf']) await mkdir(join(root, name), { recursive: true });
  const files = {
    'package.json': JSON.stringify({ name: 'swallow', private: true, scripts: { build: 'tsc' }, dependencies: { react: '19.3.0' } }),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'swallow', dependencies: { react: '19.3.0' } }, 'node_modules/react': { version: '19.3.0', license: 'MIT' } } }),
    LICENSE: 'MIT License\nCopyright (c) 2026 nemory\nPermission is hereby granted, free of charge',
    'README.md': '# Swallow\nLocal learning app',
    'SECURITY.md': 'nemory.dev@gmail.com', 'CONTRIBUTING.md': 'npm test', 'PRIVACY.md': 'Local storage',
    'THIRD_PARTY_NOTICES.md': 'React MIT', 'tsconfig.json': '{}', 'tsconfig.electron.json': '{}',
    'vite.config.ts': '', 'vitest.config.ts': '', 'index.html': '<html></html>', '.nvmrc': '24', '.gitignore': 'node_modules/', '.gitattributes': '*.pdf binary\n',
    'src/app.ts': 'export const local = true;', 'electron/main.ts': 'export const local = true;',
    'native/pdf.swift': '// fixture', 'scripts/build.mjs': '// fixture', 'tests/example.test.ts': '// fixture',
  };
  for (const [name, body] of Object.entries(files)) await writeFile(join(root, name), body);
  return root;
}
describe('구독 없는 공개 소스 검사와 내보내기', () => {
  it('Windows helper·안내·workflow만 추가 공개하고 내부 docs는 제외한다', async () => {
    const { inspectPublicSource } = await import('../scripts/prepare-public-source.mjs');
    const root = await fixture();
    for (const path of ['native/windows', 'docs/release', 'docs/superpowers', '.github/workflows']) await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, 'native/windows/speech.cs'), '// local speech helper');
    await writeFile(join(root, 'docs/windows-preview.md'), '# Windows preview');
    await writeFile(join(root, '.github/workflows/windows-preview.yml'), 'name: Windows preview');
    await writeFile(join(root, 'docs/release/internal.md'), 'PRIVATE_DATA');
    const result = await inspectPublicSource(root);
    expect(result.status).toBe('ready');
    expect(result.files.map(file => file.path)).toEqual(expect.arrayContaining(['native/windows/speech.cs', 'docs/windows-preview.md', '.github/workflows/windows-preview.yml']));
    expect(result.files.some(file => file.path.startsWith('docs/release/') || file.path.startsWith('docs/superpowers/'))).toBe(false);
  });
  it('현재 앱의 source·lock·빌드에서 구독 SDK를 실제 제외해야 한다', async () => {
    const { inspectPublicSource } = await import('../scripts/prepare-public-source.mjs');
    const result = await inspectPublicSource(process.cwd());
    expect(result.issues.filter(issue => ['subscription-dependency', 'subscription-source', 'subscription-import', 'subscription-ipc'].includes(issue.code))).toEqual([]);
  });
  it('vendor·잠긴 전이 의존성과 인증 IPC가 남으면 거절하고 내용/비밀은 출력하지 않는다', async () => {
    const { inspectPublicSource } = await import('../scripts/prepare-public-source.mjs');
    const root = await fixture();
    await mkdir(join(root, 'vendor/siwc'), { recursive: true });
    await writeFile(join(root, 'vendor/siwc/secret.txt'), 'USER_SECRET');
    await writeFile(join(root, 'electron/main.ts'), "import sdk from '@siwc/local';\nregisterHandler('sign-in', () => {});");
    const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
    lock.packages['node_modules/openai'] = { version: '7.31.0' };
    await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock));
    const result = await inspectPublicSource(root);
    expect(result.status).toBe('blocked');
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['subscription-source', 'subscription-import', 'subscription-ipc', 'subscription-dependency']));
    expect(JSON.stringify(result)).not.toContain('USER_SECRET');
  });
  it('공개 목록만 내보내고 Git·userData·인증·백업·내부 계획·설치본은 읽거나 복사하지 않는다', async () => {
    const { preparePublicSource } = await import('../scripts/prepare-public-source.mjs');
    const root = await fixture();
    for (const name of ['.git', 'chatgpt', 'userData', 'backups', 'docs/superpowers/plans', 'artifacts']) {
      await mkdir(join(root, name), { recursive: true }); await writeFile(join(root, name, 'private.txt'), 'PRIVATE_DATA');
    }
    const result = await preparePublicSource(root);
    expect(result.status).toBe('prepared');
    expect(await readFile(join(result.directory, 'src/app.ts'), 'utf8')).toContain('local');
    for (const name of ['.git', 'chatgpt', 'userData', 'backups', 'docs', 'artifacts', 'node_modules']) expect(await readdir(result.directory)).not.toContain(name);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_DATA');
  });
  it('허용 디렉터리 안의 symlink·알 수 없는 바이너리·인증 파일을 거절한다', async () => {
    const { inspectPublicSource } = await import('../scripts/prepare-public-source.mjs');
    const { symlink } = await import('node:fs/promises');
    const root = await fixture();
    await writeFile(join(root, 'electron/token.json'), '{"token":"USER_SECRET"}');
    await writeFile(join(root, 'src/unknown.bin'), 'PRIVATE_BYTES');
    // NTFS directory junctions exercise the real lstat rejection without symlink privileges.
    await symlink(join(root, process.platform === 'win32' ? 'electron' : '.gitignore'), join(root, 'src/link.ts'), process.platform === 'win32' ? 'junction' : 'file');
    const result = await inspectPublicSource(root);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['unexpected-file', 'symlink']));
    expect(result.issues).toContainEqual({ code: 'symlink', path: 'src/link.ts' });
    expect(result.files.some(file => file.path.startsWith('src/link.ts'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('USER_SECRET');
  });
});
