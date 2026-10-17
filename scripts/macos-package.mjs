import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function assertRegularPath(root, path) {
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${current}`);
  }
}

// Never copy the checkout itself: each build tree and locked runtime package is selected explicitly.
async function copyTree(source, destination, { dependencies = false } = {}) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${source}`);
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const name of await readdir(source)) {
      if (name.startsWith('.') || (dependencies && name === 'node_modules')) continue;
      await copyTree(join(source, name), join(destination, name), { dependencies });
    }
  } else if (info.isFile()) {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  } else throw new Error(`Unsupported package file: ${source}`);
}

async function compiledOutputs(root, directory) {
  await assertRegularPath(root, directory);
  const outputs = [];
  for (const name of await readdir(join(root, directory))) {
    const path = `${directory}/${name}`;
    const info = await lstat(join(root, path));
    if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
    if (info.isDirectory()) outputs.push(...await compiledOutputs(root, path));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) outputs.push(`dist-electron/${path.slice(0, -3)}.js`);
  }
  return outputs;
}

export async function stageMacApp({ root, stage, native }) {
  const helper = join(root, 'dist-electron/native/swallow-pdf');
  const helperInfo = await lstat(helper).catch(() => null);
  if (!helperInfo?.isFile() || !(helperInfo.mode & 0o111)) throw new Error('PDF helper missing or not executable. Run npm run build first.');
  await assertRegularPath(root, 'dist-electron/native/swallow-pdf');
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  if (lock.lockfileVersion !== 3 || !lock.packages) throw new Error('package-lock.json v3 required. Run npm ci.');
  const packages = Object.entries(lock.packages).filter(([path, info]) => path && !info.dev);
  for (const [path, info] of packages) {
    if (!/^(?:node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9_-][a-z0-9._-]*)(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9_-][a-z0-9._-]*)*$/.test(path) || info.link) {
      throw new Error(`Invalid production dependency path: ${path}`);
    }
    // Check each ancestor too; lstat(package.json) alone would follow a symlinked package directory.
    let ancestor = root;
    for (const part of path.split('/')) {
      ancestor = join(ancestor, part);
      const info = await lstat(ancestor).catch(() => null);
      if (!info?.isDirectory()) throw new Error(`Invalid or missing ${path}; run npm ci (no symbolic links).`);
    }
    const installed = await readFile(join(root, path, 'package.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (!installed || installed.version !== info.version) throw new Error(`Version mismatch or missing ${path}; run npm ci.`);
  }
  for (const path of ['dist/index.html', 'dist-electron/electron/main.js', 'dist-electron/electron/preload.cjs']) {
    if (!(await lstat(join(root, path)).catch(() => null))?.isFile()) throw new Error(`Missing ${path}; run npm run build.`);
  }
  await assertRegularPath(root, 'dist/index.html');
  const html = await readFile(join(root, 'dist/index.html'), 'utf8');
  const renderer = new Set(['index.html']);
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const reference = tag[0].match(/\b(?:src|href)=["']([^"']+)["']/i)?.[1];
    if (!reference) continue;
    const path = reference.replace(/^\.\//, '');
    if (!/^assets\/[a-zA-Z0-9_-]+\.(?:js|css)$/.test(path)) throw new Error(`Invalid renderer asset: ${reference}`);
    renderer.add(path);
  }
  for (const path of renderer) {
    await assertRegularPath(root, `dist/${path}`);
    await copyTree(join(root, 'dist', path), join(stage, 'dist', path));
  }
  const compiled = ['dist-electron/electron/preload.cjs'];
  for (const source of ['electron', 'src/shared', 'src/learning']) compiled.push(...await compiledOutputs(root, source));
  for (const path of [...compiled, 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    await assertRegularPath(root, path);
    await copyTree(join(root, path), join(stage, path));
  }
  for (const [path] of packages) await copyTree(join(root, path), join(stage, path), { dependencies: true });
  const { name, version, type, main, license } = metadata;
  await writeFile(join(stage, 'package.json'), JSON.stringify({ name, version, type, main, license }, null, 2) + '\n');
  await copyTree(helper, join(native, 'swallow-pdf'));
  return { version, dependencies: packages.map(([path, info]) => ({ path, version: info.version })) };
}

export function assertMacHost({ platform = process.platform, arch = process.arch, node = process.versions.node } = {}) {
  if (platform !== 'darwin') throw new Error('macOS is required to package this app.');
  if (arch !== 'arm64') throw new Error('Apple Silicon (arm64) is required to package this app.');
  if (node.split('.')[0] !== '24') throw new Error('Node 24 is required. Check node --version.');
}
