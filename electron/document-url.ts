import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request as httpRequest, type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import { documentTitle, extractHtmlDocument, requireDocumentSource, type ImportedDocument } from './html-document.js';

const MAX_BYTES = 4 * 1024 * 1024;
const DEADLINE_MS = 20_000;
const MAX_REDIRECTS = 3;
const timeoutMessage = '문서 가져오기가 20초를 초과했습니다. 연결을 확인하거나 본문을 직접 복사해 추가해 주세요.';

export interface DocumentUrlDependencies {
  signal?: AbortSignal;
  lookup?: (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>;
  request?: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
}

function isPublicAddress(address: string): boolean {
  if (!isIP(address) || address.includes('%')) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.range() !== 'unicast') return false;
  return parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3);
}

function documentUrl(input: unknown): URL {
  if (typeof input !== 'string' || input.length > 4096 || /[\u0000-\u001F\u007F-\u009F]/.test(input) || !/^https?:\/\//i.test(input.trim())) throw new Error('올바른 공개 HTTP 또는 HTTPS 문서 주소를 4,096자 이내로 입력해 주세요.');
  let url: URL;
  try { url = new URL(input.trim()); }
  catch { throw new Error('문서 주소 형식이 잘못되었습니다. 전체 HTTP 또는 HTTPS 주소를 입력해 주세요.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('로그인 정보와 사용자 지정 포트가 없는 공개 HTTP 또는 HTTPS 주소만 지원합니다.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('내부망과 예약 주소는 가져올 수 없습니다. 공개 문서 주소를 사용해 주세요.');
  } else {
    if (!hostname.includes('.') || /(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|corp|test|invalid|example|onion)$/.test(hostname) || hostname.endsWith('.home.arpa')) throw new Error('로컬 호스트와 내부망 주소는 가져올 수 없습니다. 공개 문서 주소를 사용해 주세요.');
    url.hostname = hostname;
  }
  url.hash = '';
  if (url.href.length > 4096) throw new Error('문서 주소는 4,096자 이내로 입력해 주세요.');
  return url;
}

function beforeAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(timeoutMessage));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error(timeoutMessage));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function publicAddress(url: URL, dependencies: DocumentUrlDependencies, signal: AbortSignal): Promise<LookupAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) return { address: hostname, family: isIP(hostname) };
  const resolving = dependencies.lookup ? dependencies.lookup(hostname, { all: true, verbatim: true }) : dnsLookup(hostname, { all: true, verbatim: true });
  const addresses = await beforeAbort(resolving, signal);
  if (!addresses.length || addresses.some(value => !isPublicAddress(value.address) || isIP(value.address) !== value.family)) throw new Error('문서 주소에 공개 IP가 아닌 주소가 포함되어 있습니다. 공개 문서 주소를 사용해 주세요.');
  return addresses[0]!;
}

function pinnedLookup(address: LookupAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
}

function requestDocument(url: URL, address: LookupAddress, dependencies: DocumentUrlDependencies, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = dependencies.request ?? (url.protocol === 'https:' ? httpsRequest : httpRequest);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const client = request(url, {
      method: 'GET', agent: false, signal, lookup: pinnedLookup(address),
      ...(url.protocol === 'https:' ? { servername: isIP(hostname) ? '' : hostname } : {}),
      headers: { Accept: 'text/html, application/xhtml+xml, text/plain', 'Accept-Encoding': 'gzip, br, deflate', 'User-Agent': 'Swallow/0.1 (document import)' },
    }, response => {
      // Keep an error listener while a redirect or unsupported body is discarded.
      response.on('error', () => {});
      resolve(response);
    });
    client.once('error', reject);
    client.end();
  });
}

function header(response: IncomingMessage, name: string): string {
  const value = response.headers[name];
  if (Array.isArray(value)) throw new Error('문서 응답 헤더가 잘못되었습니다. 다른 공개 문서 주소를 사용해 주세요.');
  return value ?? '';
}

function contentType(response: IncomingMessage): string {
  const type = header(response, 'content-type');
  const mime = type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime === 'application/pdf') throw new Error('PDF 링크는 아직 지원하지 않습니다. PDF에서 필요한 본문을 복사해 추가해 주세요.');
  if (!['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown', 'text/x-markdown'].includes(mime)) throw new Error('HTML, 일반 텍스트, Markdown 문서만 가져올 수 있습니다. 필요한 본문을 복사해 추가해 주세요.');
  const charset = type.match(/(?:^|;)\s*charset\s*=\s*["']?([^;\s"']+)/i)?.[1]?.toLowerCase();
  if (charset && !['utf-8', 'utf8', 'us-ascii'].includes(charset)) throw new Error('UTF-8 문서만 가져올 수 있습니다. 브라우저에서 본문을 복사해 추가해 주세요.');
  return mime;
}

function byteLimiter(): Transform {
  let bytes = 0;
  return new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > MAX_BYTES ? new Error('문서는 압축 해제 전후 각각 4MB 이내로 가져올 수 있습니다. 필요한 부분을 복사해 추가해 주세요.') : null, chunk);
  } });
}

async function readBody(response: IncomingMessage, signal: AbortSignal): Promise<string> {
  const length = header(response, 'content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new Error('문서는 4MB 이내로 가져올 수 있습니다. 필요한 부분을 복사해 추가해 주세요.');
  const encoding = header(response, 'content-encoding').trim().toLowerCase();
  const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : null;
  if (encoding && encoding !== 'identity' && !decoder) throw new Error('지원하지 않는 문서 압축 형식입니다. 브라우저에서 본문을 복사해 추가해 주세요.');
  const chunks: Buffer[] = [];
  const receiver = new Writable({ write(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback(); } });
  if (decoder) await pipeline(response, byteLimiter(), decoder, byteLimiter(), receiver, { signal });
  else await pipeline(response, byteLimiter(), receiver, { signal });
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new Error('문서의 UTF-8 문자 인코딩을 읽을 수 없습니다. 브라우저에서 본문을 복사해 추가해 주세요.'); }
}

export async function fetchDocumentUrl(input: unknown, dependencies: DocumentUrlDependencies = {}): Promise<ImportedDocument> {
  let url = documentUrl(input);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  dependencies.signal?.addEventListener('abort', cancel, { once: true });
  if (dependencies.signal?.aborted) controller.abort();
  const started = Date.now();
  const timeout = setTimeout(() => controller.abort(), DEADLINE_MS);
  let response: IncomingMessage | undefined;
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const address = await publicAddress(url, dependencies, controller.signal);
      if (controller.signal.aborted) throw new Error(timeoutMessage);
      response = await requestDocument(url, address, dependencies, controller.signal);
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = header(response, 'location');
        response.destroy();
        if (redirects === MAX_REDIRECTS) throw new Error('문서 주소 이동은 3번까지만 허용합니다. 최종 문서 주소를 직접 입력해 주세요.');
        if (!location || /[\u0000-\u001F\u007F]/.test(location)) throw new Error('문서 주소 이동 응답이 잘못되었습니다. 최종 문서 주소를 직접 입력해 주세요.');
        url = documentUrl(new URL(location, url).href);
        continue;
      }
      if (status === 401 || status === 403) throw new Error('로그인이 필요한 페이지는 가져올 수 없습니다. 로그인한 브라우저에서 본문을 복사해 추가해 주세요.');
      if (status < 200 || status >= 300) throw new Error(`문서 서버가 요청을 완료하지 못했습니다 (HTTP ${status}). 주소를 확인하거나 잠시 뒤 다시 시도해 주세요.`);
      const mime = contentType(response);
      const source = await readBody(response, controller.signal);
      if (Date.now() - started >= DEADLINE_MS) throw new Error(timeoutMessage);
      if (mime === 'text/html' || mime === 'application/xhtml+xml') return extractHtmlDocument(source, url.href);
      requireDocumentSource(source);
      const title = source.match(/^#{1,6}[ \t]+(.+)$/m)?.[1] ?? source.split('\n').find(line => line.trim()) ?? '';
      return { title: documentTitle(title, url.hostname), source, sourceUrl: url.href };
    }
    throw new Error('문서 주소 이동을 완료하지 못했습니다.');
  } catch (error) {
    if (dependencies.signal?.aborted) throw new Error('문서 가져오기를 취소했습니다.');
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    if (error instanceof Error && /[가-힣]/.test(error.message)) throw error;
    throw new Error('문서를 가져오지 못했습니다. 인터넷 연결과 공개 문서 주소를 확인한 뒤 다시 시도해 주세요.');
  } finally {
    clearTimeout(timeout);
    dependencies.signal?.removeEventListener('abort', cancel);
    response?.destroy();
  }
}
