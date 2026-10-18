import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSpeechHelper } from './build-speech-helper.mjs';
import { prepareWindowsPdf } from './prepare-windows-pdf.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.platform === 'win32') {
  await buildSpeechHelper({ root });
  await prepareWindowsPdf(root);
} else if (process.platform === 'darwin') {
  mkdirSync(new URL('../dist-electron/native', import.meta.url), { recursive: true });
  const result = spawnSync('/usr/bin/xcrun', ['swiftc', '-target', 'arm64-apple-macosx15.0', '-O', '-module-cache-path', '/private/tmp/swallow-swift-module-cache', 'native/pdf.swift', '-o', 'dist-electron/native/swallow-pdf'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) { console.error('PDF helper build failed. Install Xcode Command Line Tools with xcode-select --install.'); process.exit(1); }
} else {
  console.log('Native PDF/speech resources are unavailable on this platform; skipping native build.');
}
