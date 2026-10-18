import { isAbsolute, join, resolve } from 'node:path';

export function pdfWorkerEnvironment(original: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...original };
  const externalLoaders = new Set(['node_options', 'node_path', 'electron_override_dist_path', 'electron_run_as_node']);
  for (const key of Object.keys(result)) if (externalLoaders.has(key.toLowerCase())) delete result[key];
  return { ...result, ELECTRON_RUN_AS_NODE: '1' };
}

export function desktopDataDirectory(input: { platform: string; localAppData?: string; override?: string }): string | undefined {
  if (input.override) {
    if (!isAbsolute(input.override)) throw new Error('SWALLOW_DATA_DIR은 절대 경로여야 합니다.');
    return input.override;
  }
  if (input.platform !== 'win32') return undefined;
  if (!input.localAppData || !isAbsolute(input.localAppData)) throw new Error('Windows 로컬 저장 폴더를 찾을 수 없습니다. 사용자 계정의 저장 경로를 확인하세요.');
  return join(input.localAppData, 'Swallow');
}

export function runtimePaths(input: { packaged: boolean; resourcesPath: string; currentDirectory: string; devUrl?: string }) {
  const devUrl = input.packaged ? undefined : input.devUrl;
  if (devUrl && devUrl !== 'http://127.0.0.1:5173') throw new Error('허용하지 않는 개발 서버 주소입니다.');
  return {
    devUrl,
    homeUrl: devUrl ?? 'swallow://app/',
    pdfHelper: input.packaged ? resolve(input.resourcesPath, 'native/swallow-pdf') : resolve(input.currentDirectory, '../native/swallow-pdf'),
    windowsPdfWorker: input.packaged ? resolve(input.resourcesPath, 'pdf-runtime/worker.mjs') : resolve(input.currentDirectory, '../native/pdf-runtime/worker.mjs'),
    speechHelper: input.packaged ? resolve(input.resourcesPath, 'native/swallow-speech.exe') : resolve(input.currentDirectory, '../native/swallow-speech.exe'),
  };
}
