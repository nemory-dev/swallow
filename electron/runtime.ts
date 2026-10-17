import { resolve } from 'node:path';

export function runtimePaths(input: { packaged: boolean; resourcesPath: string; currentDirectory: string; devUrl?: string }) {
  const devUrl = input.packaged ? undefined : input.devUrl;
  if (devUrl && devUrl !== 'http://127.0.0.1:5173') throw new Error('허용하지 않는 개발 서버 주소입니다.');
  return {
    devUrl,
    homeUrl: devUrl ?? 'swallow://app/',
    pdfHelper: input.packaged ? resolve(input.resourcesPath, 'native/swallow-pdf') : resolve(input.currentDirectory, '../native/swallow-pdf'),
  };
}
