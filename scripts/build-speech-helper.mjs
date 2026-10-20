import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function buildSpeechHelper({ platform = process.platform, arch = process.arch, root = fileURLToPath(new URL('..', import.meta.url)), windowsDirectory = process.env.SystemRoot ?? process.env.WINDIR, run = spawnSync } = {}) {
  if (platform !== 'win32' || arch !== 'x64') throw new Error('Speech helper compilation requires Windows x64.');
  if (!windowsDirectory) throw new Error('Windows system directory is unavailable.');
  const source = join(root, 'native', 'windows', 'speech.cs');
  try { await access(source); } catch { throw new Error('Windows speech helper source is missing.'); }
  const framework = join(windowsDirectory, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const speechGac = join(windowsDirectory, 'Microsoft.NET', 'assembly', 'GAC_MSIL', 'System.Speech', 'v4.0_4.0.0.0__31bf3856ad364e35', 'System.Speech.dll');
  const speech = existsSync(speechGac) ? speechGac : join(framework, 'System.Speech.dll');
  const output = join(root, 'dist-electron', 'native', 'swallow-speech.exe');
  await mkdir(join(root, 'dist-electron', 'native'), { recursive: true });
  await rm(output, { force: true });
  const result = run(join(framework, 'csc.exe'), [
    '/nologo', '/target:exe', '/platform:x64', '/optimize+', '/utf8output',
    '/r:' + speech, '/r:' + join(framework, 'System.Web.Extensions.dll'),
    '/out:' + output, source,
  ], { shell: false, windowsHide: true, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('Failed to compile the Windows speech helper.');
  let bytes;
  try { bytes = await readFile(output); } catch { throw new Error('Speech compiler did not produce an output executable.'); }
  if (bytes.length < 2 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new Error('Speech compiler output is not a Windows executable.');
  return output;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  buildSpeechHelper().then(output => { console.log(`Windows speech helper: ${output}`); }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
