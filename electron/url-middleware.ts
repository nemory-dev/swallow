import type { IncomingMessage, ServerResponse } from 'node:http';
import { fetchDocumentUrl } from './document-url.js';

/** Only the loopback preview's own origin may use its anonymous public-document fetcher. */
export function documentUrlMiddleware(fetcher = fetchDocumentUrl) {
  let busy = false;
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (request.url !== '/__swallow/import-url') { next(); return; }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    const fail = (error: string, status = 400) => { if (!response.destroyed) { response.statusCode = status; response.end(JSON.stringify({ ok: false, error })); } };
    const host = request.headers.host;
    if (request.method !== 'POST' || !host || !/^127\.0\.0\.1:\d+$/.test(host) || request.headers.origin !== `http://${host}` || !request.headers['content-type']?.startsWith('application/json')) {
      fail('이 미리보기 화면에서 문서 링크를 입력해 주세요.', 403); return;
    }
    if (busy) { fail('다른 문서를 가져오는 중입니다. 잠시 기다리세요.', 429); return; }
    busy = true;
    try {
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 20_000) { fail('문서 주소가 너무 깁니다.', 413); return; }
        chunks.push(Buffer.from(chunk));
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('문서 주소 입력이 잘못되었습니다.'); }
      const url = body && typeof body === 'object' && 'url' in body ? body.url : undefined;
      const value = await fetcher(url);
      if (!response.destroyed) response.end(JSON.stringify({ ok: true, value }));
    } catch (cause) { fail(cause instanceof Error && /[가-힣]/.test(cause.message) ? cause.message : '문서를 가져오지 못했습니다. 원문을 붙여 넣어 주세요.'); }
    finally { busy = false; }
  };
}
