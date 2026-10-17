import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.platform !== 'darwin') {
  console.log('PDF helper requires macOS; desktop PDF import is unavailable on this platform.');
} else {
  mkdirSync(new URL('../dist-electron/native', import.meta.url), { recursive: true });
  const result = spawnSync('/usr/bin/xcrun', ['swiftc', '-target', 'arm64-apple-macosx15.0', '-O', '-module-cache-path', '/private/tmp/swallow-swift-module-cache', 'native/pdf.swift', '-o', 'dist-electron/native/swallow-pdf'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) { console.error('PDF helper build failed. Install Xcode Command Line Tools with xcode-select --install.'); process.exit(1); }
}
