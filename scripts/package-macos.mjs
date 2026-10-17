import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { packager } from '@electron/packager';
import { listPackage } from '@electron/asar';
import { assertMacHost, stageMacApp } from './macos-package.mjs';
import { verifyMacBundle } from './macos-signing.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status}).`);
}
async function main() {
  assertMacHost();
  if (process.argv.slice(2).some(arg => arg !== '--dmg')) throw new Error('Usage: npm run package:mac:arm64 or npm run make:mac:arm64');
  if (!process.env.npm_execpath) throw new Error('Run npm run package:mac:arm64 or npm run make:mac:arm64.');
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const electronVersion = JSON.parse(await readFile(join(root, 'node_modules/electron/package.json'), 'utf8')).version;
  if (metadata.devDependencies.electron !== electronVersion) throw new Error('Installed Electron differs from the pinned version. Run npm ci.');
  // Electron 44 downloads its runtime lazily; a fresh npm ci has no dist or notices yet.
  const installEnv = { ...process.env, ELECTRON_INSTALL_PLATFORM: 'darwin', ELECTRON_INSTALL_ARCH: 'arm64' };
  delete installEnv.ELECTRON_OVERRIDE_DIST_PATH;
  run(process.execPath, [join(root, 'node_modules/electron/install.js')], installEnv);
  const installedVersion = (await readFile(join(root, 'node_modules/electron/dist/version'), 'utf8')).trim().replace(/^v/, '');
  if (installedVersion !== electronVersion) throw new Error('Electron runtime version mismatch. Run npm ci and retry packaging.');
  run(process.execPath, [process.env.npm_execpath, 'run', 'build']);
  const parent = join(root, 'artifacts/macos'); await mkdir(parent, { recursive: true });
  const output = await mkdtemp(join(parent, 'unsigned-'));
  const temporary = await mkdtemp(join(tmpdir(), 'swallow-macos-stage-'));
  try {
    const stage = join(temporary, 'app'), native = join(temporary, 'native');
    const licenses = join(temporary, 'licenses'); await mkdir(licenses);
    for (const file of ['LICENSE', 'LICENSES.chromium.html']) {
      await writeFile(join(licenses, file), await readFile(join(root, 'node_modules/electron/dist', file)));
    }
    const staged = await stageMacApp({ root, stage, native });
    const [appDirectory] = await packager({
      dir: stage, out: output, name: 'Swallow', platform: 'darwin', arch: 'arm64', electronVersion,
      appBundleId: 'io.github.nemory-dev.swallow', appVersion: staged.version,
      asar: true, prune: false, extraResource: [native, licenses],
      extendInfo: { LSMinimumSystemVersion: '15.0' }, extendHelperInfo: { LSMinimumSystemVersion: '15.0' },
      asarIntegrityDigest: false,
      // Seal nested code and resources locally without certificates, profiles or Apple services.
      osxSign: {
        identity: '-', identityValidation: false, continueOnError: false,
        preAutoEntitlements: false, preEmbedProvisioningProfile: false,
        optionsForFile: () => ({ entitlements: [], hardenedRuntime: false, timestamp: 'none' }),
      },
      ...(process.env.electron_config_cache ? { download: { cacheRoot: process.env.electron_config_cache } } : {}),
    });
    if (!appDirectory) throw new Error('Electron Packager did not produce an app.');
    const app = join(appDirectory, 'Swallow.app');
    verifyMacBundle(app);
    const archive = join(app, 'Contents/Resources/app.asar');
    const files = listPackage(archive);
    for (const expected of ['/package.json', '/dist/index.html', '/dist-electron/electron/main.js', '/dist-electron/electron/preload.cjs']) {
      if (!files.includes(expected)) throw new Error(`Packaged app is missing ${expected}`);
    }
    run('/usr/bin/file', [join(app, 'Contents/MacOS/Swallow'), join(app, 'Contents/Resources/native/swallow-pdf')]);
    let dmg;
    if (process.argv.includes('--dmg')) {
      const volume = join(temporary, 'volume'); await mkdir(volume);
      run('/usr/bin/ditto', [app, join(volume, 'Swallow.app')]);
      await symlink('/Applications', join(volume, 'Applications'));
      dmg = join(output, `Swallow-${staged.version}-macOS-arm64-unsigned.dmg`);
      run('/usr/bin/hdiutil', ['create', '-volname', 'Swallow', '-srcfolder', volume, '-format', 'UDZO', dmg]);
      run('/usr/bin/hdiutil', ['verify', dmg]);
    }
    const manifest = {
      version: staged.version, platform: 'darwin', arch: 'arm64', minimumMacOS: '15.0', node: process.versions.node, electron: electronVersion,
      signing: 'Local ad-hoc resource integrity signature only; no Developer ID certificate or Apple notarization.',
      adHocSigning: true, developerIDSigning: false, appleNotarization: false, bundleIntegrity: 'verified',
      app, ...(dmg ? { dmg, dmgSha256: createHash('sha256').update(await readFile(dmg)).digest('hex') } : {}),
      archiveFiles: files.length, dependencies: staged.dependencies,
    };
    await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Unsigned app: ${app}${dmg ? `\nUnsigned DMG: ${dmg}` : ''}\nManifest: ${join(output, 'manifest.json')}`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
