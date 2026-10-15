import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { waitForDevServer } from '../scripts/dev-server.mjs';
const process = () => Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
describe('개발 서버 소유권 확인', () => {
  it('이미 실행 중인 다른 서버의 200 응답을 준비 완료로 받아들이지 않는다', async () => {
    const child = process();
    await expect(waitForDevServer(child, 'http://127.0.0.1:5173', 'our-nonce', {
      timeout: 20, fetchRequest: async () => new Response('다른 앱', { status: 200 }),
    })).rejects.toThrow('준비');
  });
  it('Vite가 종료되면 HTTP 200이어도 실패한다', async () => {
    const child = process();
    const result = waitForDevServer(child, 'http://127.0.0.1:5173', 'our-nonce', {
      fetchRequest: async () => { child.exitCode = 1; child.emit('exit', 1); return new Response('다른 앱'); },
    });
    await expect(result).rejects.toThrow('종료');
  });
  it('현재 프로세스의 nonce 응답만 허용하고 리스너를 정리한다', async () => {
    const child = process();
    await waitForDevServer(child, 'http://127.0.0.1:5173', 'our-nonce', {
      fetchRequest: async url => { expect(url).toBe('http://127.0.0.1:5173/__swallow-ready'); return new Response('swallow-ready:our-nonce'); },
    });
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
  });
  it('기존 서버가 요청 경로를 따라 응답해도 nonce를 알 수 없다', async () => {
    const child = process();
    await expect(waitForDevServer(child, 'http://127.0.0.1:5173', 'secret-child-nonce', {
      timeout: 20, fetchRequest: async url => new Response('swallow-ready:' + new URL(url).pathname.split('/').at(-1)),
    })).rejects.toThrow('준비');
  });
});
