import { execFileSync } from 'node:child_process';

// Inspect only index paths/modes. Never read blobs, credentials, or user data.
// This deliberately cannot approve publication: rights/content/history require review.
const rules = [
  ['environment-files', /(?:^|\/)\.env(?:\.[^/]*)?$/i, /(?:^|\/)\.env\.(?:example|sample|template)$/i],
  ['credentials', /(?:^|\/)(?:\.aws|\.ssh|chatgpt)(?:\/|$)|(?:^|\/)(?:credentials?|tokens?|auth)\.json$|(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$|\.(?:p12|pfx|pem|key|keystore|jks)$/i],
  ['user-data', /(?:^|\/)(?:user[-_]?data|backups)(?:\/|$)|(?:^|\/)library\.json$|\.(?:sqlite|sqlite3|db)(?:-wal|-shm)?$/i],
  ['generated-artifacts', /(?:^|\/)(?:artifacts|dist|dist-electron|node_modules|coverage)(?:\/|$)|\.(?:dmg|pkg|msix|msixbundle|appx|exe|msi)$/i]
];

function inspectIndex() {
  const git = args => execFileSync('git', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024
  });
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const records = git(['-C', root, 'ls-files', '--stage', '-z']).split('\0').filter(Boolean);
  const entries = records.map(record => {
    const match = record.match(/^(\d+) [a-f0-9]+ (\d)\t([\s\S]+)$/);
    if (!match) throw new Error('Invalid index metadata');
    return { mode: match[1], stage: match[2], path: match[3] };
  });
  const paths = [...new Set(entries.map(entry => entry.path))];
  const regularFiles = new Set(entries.filter(entry => entry.stage === '0' && ['100644', '100755'].includes(entry.mode)).map(entry => entry.path));
  const checks = [
    { id: 'root-license', status: ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE.rst'].some(name => regularFiles.has(name)) ? 'pass' : 'fail', meaning: '루트 라이선스 파일의 index 등록 여부만 확인. 내용·소유권·선택 승인은 별도.' },
    { id: 'third-party-notices', status: regularFiles.has('THIRD_PARTY_NOTICES.md') ? 'pass' : 'fail', meaning: '집계 고지 파일의 index 등록 여부만 확인. 완전성과 재배포 권리는 별도.' },
    { id: 'index-conflicts', status: entries.some(entry => entry.stage !== '0') ? 'fail' : 'pass' }
  ];
  const blocked = new Set();
  for (const [id, pattern, allowed] of rules) {
    const found = paths.filter(name => pattern.test(name) && !allowed?.test(name));
    found.forEach(name => blocked.add(name));
    checks.push({ id, status: found.length ? 'fail' : 'pass', count: found.length });
  }
  checks.push(
    { id: 'links-and-submodules', status: entries.some(entry => ['120000', '160000'].includes(entry.mode)) ? 'hold' : 'pass', meaning: '링크 목적지와 submodule 내용/권리는 별도 검토.' },
    { id: 'rights-and-donations', status: 'hold', meaning: '자체 코드 소유권·라이선스 선택·vendor/제공자 재배포/수정 권리·선택 후원 조건을 통합 정책에서 확인.' },
    { id: 'contents-history-and-final-index', status: 'hold', meaning: '내용 비밀 탐지·과거 Git 이력·파일 크기·미추적/unstaged 변경·최종 공개 대상은 검사하지 않음. 공개 전 별도 검토/재실행.' }
  );
  return {
    status: checks.some(check => check.status === 'fail') ? 'fail' : 'hold',
    scope: 'Git index paths/modes only; no file content or history inspection; no publication approval',
    trackedPathCount: paths.length,
    blockedPathCount: blocked.size,
    checks
  };
}

let report;
try {
  report = inspectIndex();
} catch {
  report = { status: 'fail', checks: [{ id: 'git-index-readable', status: 'fail', meaning: 'Git index를 안전하게 읽지 못했습니다. 저장소 안에서 Git 설치/권한을 확인하세요.' }] };
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'fail' ? 1 : 2;
