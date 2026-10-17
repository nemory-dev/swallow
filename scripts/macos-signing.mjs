import { spawnSync } from 'node:child_process';

// Resource integrity and Gatekeeper's developer trust policy are separate checks.
export function verifyMacBundle(app) {
  const result = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], {
    encoding: 'utf8', timeout: 30000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`앱 무결성 검사 실패. DMG를 생성하지 않습니다.\n${result.error?.message ?? result.stderr.trim()}`);
  }
}
