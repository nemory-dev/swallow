import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.platform !== 'darwin') {
  console.log('PDF helper requires macOS; desktop PDF import is unavailable on this platform.');
} else {
  mkdirSync('dist-electron/native', { recursive: true });
  const result = spawnSync('/usr/bin/xcrun', ['swiftc', '-O', '-module-cache-path', '/private/tmp/swallow-swift-module-cache', 'native/pdf.swift', '-o', 'dist-electron/native/swallow-pdf'], { stdio: 'inherit' });
  if (result.status !== 0) { console.error('PDF helper build failed. Install Xcode Command Line Tools with xcode-select --install.'); process.exit(1); }
}
