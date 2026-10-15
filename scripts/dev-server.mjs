import { setTimeout as delay } from 'node:timers/promises';

export async function waitForDevServer(child, origin, nonce, { timeout = 10_000, fetchRequest = fetch } = {}) {
  const controller = new AbortController();
  let onError;
  let onExit;
  const failure = new Promise((_, reject) => {
    onError = () => reject(new Error('개발 서버를 실행하지 못했습니다.'));
    onExit = () => reject(new Error('개발 서버가 종료되었습니다. 5173 포트를 사용하는 다른 서버를 확인해 주세요.'));
    child.once('error', onError);
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode) onExit();
  });
  const timer = setTimeout(() => controller.abort(), timeout);
  const readiness = (async () => {
    while (!controller.signal.aborted) {
      try {
        const response = await fetchRequest(`${origin}/__swallow-ready`, { signal: controller.signal });
        if (response.ok && await response.text() === `swallow-ready:${nonce}`) {
          if (child.exitCode !== null || child.signalCode) throw new Error('개발 서버가 종료되었습니다.');
          return;
        }
      } catch (error) {
        if (controller.signal.aborted) break;
        if (child.exitCode !== null || child.signalCode) throw error;
      }
      await delay(100, undefined, { signal: controller.signal }).catch(() => {});
    }
    throw new Error('개발 서버의 준비 상태를 확인하지 못했습니다.');
  })();
  try { await Promise.race([readiness, failure]); }
  finally {
    controller.abort(); clearTimeout(timer);
    child.removeListener('error', onError); child.removeListener('exit', onExit);
  }
}
