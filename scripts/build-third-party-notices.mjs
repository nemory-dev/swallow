import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const lockBytes = await readFile(join(root, 'package-lock.json'));
const lock = JSON.parse(lockBytes);
const packages = [];
for (const [path, record] of Object.entries(lock.packages ?? {})) {
  if (!path.startsWith('node_modules/') || record.dev || record.link) continue;
  const directory = join(root, path);
  const installed = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (installed.version !== record.version) throw new Error('Installed dependency differs from package-lock.json: ' + path);
  const filenames = (await readdir(directory)).filter(name => /^(?:licen[cs]e|copying|notice)(?:\.[a-z]+)?$/i.test(name)).sort();
  if (!filenames.length) throw new Error('Dependency license text missing: ' + path);
  const texts = [];
  for (const filename of filenames) {
    const text = await readFile(join(directory, filename), 'utf8');
    if (text.includes('\0') || text.length > 1_000_000) throw new Error('Invalid dependency notice text: ' + path);
    texts.push({ filename, text });
  }
  packages.push({ name: installed.name ?? basename(path), version: record.version, license: installed.license ?? record.license ?? 'SEE ORIGINAL NOTICE', path, texts });
}
packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const lines = ['# Third Party Notices', '', 'Swallow 자체 작성 코드와 문서는 MIT 라이선스를 따릅니다. 아래 외부 구성요소의 원문 라이선스와 고지는 각 구성요소에 적용되며 앱 라이선스로 변경되지 않습니다.', '',
  '범위: 현재 package-lock.json의 설치된 npm runtime 의존성. 구독 SDK·브랜드·모델 가중치는 포함하지 않습니다. 향후 설치본 배포 시 정확한 Electron/Chromium 배포물의 LICENSE와 LICENSES.chromium.html 및 추가 파일의 고지를 별도로 포함해야 합니다.', '',
  '| Package | Version | Declared license |', '| --- | --- | --- |', ...packages.map(p => `| ${p.name} | ${p.version} | ${p.license} |`), '', '## Original license texts', ''];
for (const p of packages) {
  lines.push(`## ${p.name} ${p.version}`, '', `Source: ${p.path}`, '');
  for (const t of p.texts) lines.push(`### ${t.filename}`, '', t.text.trimEnd(), '');
}
await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
await mkdir(join(root, 'docs/release'), { recursive: true });
await writeFile(join(root, 'docs/release/dependency-license-inventory.json'), JSON.stringify({ scope: 'Installed npm runtime packages; source-only publication; not full binary distribution', lockfileSha256: createHash('sha256').update(lockBytes).digest('hex'), packages: packages.map(({ texts, ...p }) => ({ ...p, files: texts.map(t => t.filename) })) }, null, 2) + '\n');
console.log(`Preserved license/notice text for ${packages.length} installed runtime package versions.`);
