import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import type { LookupAddress } from 'node:dns';
import { fetchDocumentUrl, type DocumentUrlDependencies } from '../electron/document-url.js';

interface ResponseFixture { status?: number; headers?: IncomingMessage['headers']; body?: string | Buffer; hang?: boolean; }
function transport(fixtures: ResponseFixture[] = [{}], addresses: LookupAddress[] = [{ address: '93.184.215.14', family: 4 }]) {
  const calls: { url: URL; options: RequestOptions; pinned: LookupAddress[]; response: IncomingMessage }[] = [];
  const lookup = vi.fn(async (_hostname: string) => addresses);
  const request: NonNullable<DocumentUrlDependencies['request']> = (url, options, callback) => {
    const fixture = fixtures[calls.length] ?? {};
    const stream = new PassThrough();
    const response = stream as unknown as IncomingMessage;
    response.statusCode = fixture.status ?? 200;
    response.headers = { 'content-type': 'text/plain; charset=utf-8', ...fixture.headers };
    const call = { url, options, pinned: [] as LookupAddress[], response };
    calls.push(call);
    const client = new Writable({ write(_chunk, _encoding, done) { done(); } }) as unknown as ClientRequest;
    client.on('finish', () => {
      options.lookup!(url.hostname, { all: true }, (_error, values) => { call.pinned = values as LookupAddress[]; });
      callback(response);
      if (!fixture.hang) stream.end(fixture.body ?? '학습 자료 본문입니다.');
    });
    options.signal?.addEventListener('abort', () => { response.destroy(new Error('aborted')); client.destroy(new Error('aborted')); }, { once: true });
    return client;
  };
  return { dependencies: { lookup, request } satisfies DocumentUrlDependencies, calls, lookup };
}
afterEach(() => vi.useRealTimers());

describe('공개 URL 문서 가져오기', () => {
  it('외부 취소는 DNS 대기와 본문 다운로드를 즉시 중단한다', async () => {
    const dns = transport();
    dns.lookup.mockImplementation(() => new Promise(() => {}));
    const dnsController = new AbortController();
    const waiting = expect(fetchDocumentUrl('https://docs.example.com', { ...dns.dependencies, signal: dnsController.signal })).rejects.toThrow('취소');
    dnsController.abort(); await waiting;
    expect(dns.calls).toHaveLength(0);
    const body = transport([{ hang: true }]);
    const bodyController = new AbortController();
    const downloading = expect(fetchDocumentUrl('https://docs.example.com', { ...body.dependencies, signal: bodyController.signal })).rejects.toThrow('취소');
    await vi.waitFor(() => expect(body.calls).toHaveLength(1));
    bodyController.abort(); await downloading;
    expect(body.calls[0]?.response.destroyed).toBe(true);
  });
  it.each([null, {}, '', 'file:///etc/passwd', 'ftp://example.com/doc', 'https://user:password@example.com', 'https://example.com:8443/a', 'http://example.com:443/a', 'https://example.com/\nsecret', 'https://localhost/a', 'https://localHost./a', 'https://printer/a', 'https://host.local/a', 'https://host.internal/a', 'http://127.0.0.1', 'http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://10.0.0.1', 'http://169.254.169.254', 'http://192.168.0.1', 'http://100.64.0.1', 'http://203.0.113.1', 'http://224.0.0.1', 'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://[::ffff:8.8.8.8]', 'http://[fc00::1]', 'http://[2001:db8::1]', 'http://[2002:0808:0808::1]', 'http://[4000::1]'])('잘못된·내부·예약 주소를 요청 전에 거부한다: %s', async input => {
    const fake = transport();
    await expect(fetchDocumentUrl(input, fake.dependencies)).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });
  it('정규화한 공개 URL을 가져오고 검증한 IP로 연결을 고정한다', async () => {
    const fake = transport([{ body: '# 자료 제목\n\n원문을 그대로 보존합니다.\n' }]);
    const result = await fetchDocumentUrl(' https://docs.example.com/start#section ', fake.dependencies);
    expect(result).toEqual({ title: '자료 제목', source: '# 자료 제목\n\n원문을 그대로 보존합니다.\n', sourceUrl: 'https://docs.example.com/start' });
    expect(fake.lookup).toHaveBeenCalledTimes(1);
    expect(fake.calls[0]?.pinned).toEqual([{ address: '93.184.215.14', family: 4 }]);
    expect(fake.calls[0]?.url.hostname).toBe('docs.example.com');
    expect(fake.calls[0]?.options).toMatchObject({ agent: false, method: 'GET', servername: 'docs.example.com' });
    expect(fake.calls[0]?.options.headers).not.toHaveProperty('Cookie');
    expect(fake.calls[0]?.options.headers).not.toHaveProperty('Authorization');
  });
  it('하나라도 내부 IP인 DNS 결과와 빈 DNS 결과를 거부한다', async () => {
    for (const addresses of [[{ address: '93.184.215.14', family: 4 }, { address: '10.1.2.3', family: 4 }], []]) {
      const fake = transport([], addresses);
      await expect(fetchDocumentUrl('https://docs.example.com', fake.dependencies)).rejects.toThrow(/공개|주소/);
      expect(fake.calls).toHaveLength(0);
    }
  });
  it('4096자를 넘는 주소와 C1 제어 문자를 요청 전에 거부한다', async () => {
    const fake = transport();
    await expect(fetchDocumentUrl(`https://docs.example.com/${'a'.repeat(4096)}`, fake.dependencies)).rejects.toThrow();
    await expect(fetchDocumentUrl('https://docs.example.com/\u0085secret', fake.dependencies)).rejects.toThrow();
    await expect(fetchDocumentUrl(`https://docs.example.com/${'한'.repeat(1000)}`, fake.dependencies)).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });
  it('공개 IPv6 주소도 확인한 IP 하나에 고정한다', async () => {
    const fake = transport([{}], [{ address: '2606:4700:4700::1111', family: 6 }]);
    await fetchDocumentUrl('https://docs.example.com', fake.dependencies);
    expect(fake.calls[0]?.pinned).toEqual([{ address: '2606:4700:4700::1111', family: 6 }]);
  });
  it('리다이렉트마다 DNS를 재검사하고 최종 URL을 보존한다', async () => {
    const fake = transport([{ status: 302, headers: { location: '/final' } }, { body: '최종 문서' }]);
    expect((await fetchDocumentUrl('https://docs.example.com/start', fake.dependencies)).sourceUrl).toBe('https://docs.example.com/final');
    expect(fake.lookup).toHaveBeenCalledTimes(2);
    expect(fake.calls[0]?.response.destroyed).toBe(true);
  });
  it('내부 주소·혼합 DNS·자격 증명으로 이동하는 리다이렉트를 차단한다', async () => {
    for (const location of ['http://127.0.0.1/admin', 'https://user:secret@docs.example.com/private', 'https://private.example.com']) {
      const fake = transport([{ status: 302, headers: { location } }]);
      fake.lookup.mockImplementation(async host => host === 'private.example.com' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '93.184.215.14', family: 4 }]);
      await expect(fetchDocumentUrl('https://docs.example.com', fake.dependencies)).rejects.toThrow();
      expect(fake.calls).toHaveLength(1);
    }
  });
  it('리다이렉트는 세 번까지만 허용한다', async () => {
    const fake = transport(Array.from({ length: 4 }, () => ({ status: 302, headers: { location: '/next' } })));
    await expect(fetchDocumentUrl('https://docs.example.com', fake.dependencies)).rejects.toThrow(/이동.*3/);
    expect(fake.calls).toHaveLength(4);
  });
  it.each([['application/pdf', /PDF/], ['image/png', /HTML.*텍스트/], ['text/plain; charset=iso-8859-1', /UTF-8/]])('지원하지 않는 문서 형식을 안내한다: %s', async (mime, message) => {
    const fake = transport([{ headers: { 'content-type': mime }, body: 'body' }]);
    await expect(fetchDocumentUrl('https://docs.example.com', fake.dependencies)).rejects.toThrow(message);
    expect(fake.calls[0]?.response.destroyed).toBe(true);
  });
  it('HTML은 본문 추출기로 처리하고 Markdown은 원문을 보존한다', async () => {
    const html = transport([{ headers: { 'content-type': 'text/html' }, body: '<html><head><title>문서</title></head><body><main><h1>사용법</h1><p>학습할 수 있는 본문을 제공합니다.</p></main></body></html>' }]);
    expect((await fetchDocumentUrl('https://docs.example.com', html.dependencies)).source).toBe('# 사용법\n\n학습할 수 있는 본문을 제공합니다.');
    const markdown = transport([{ headers: { 'content-type': 'text/markdown' }, body: '# 문서\n\n  들여쓰기\n' }]);
    expect((await fetchDocumentUrl('https://docs.example.com', markdown.dependencies)).source).toBe('# 문서\n\n  들여쓰기\n');
  });
  it('기술 문서 서버의 원시 MDX 변환 대신 읽기용 HTML을 요청한다', async () => {
    const fixture: ResponseFixture = {};
    const fake = transport([fixture]);
    const request = fake.dependencies.request;
    fake.dependencies.request = (url, options, callback) => {
      const acceptsMarkdown = (options.headers as Record<string, string>).Accept?.includes('text/markdown');
      fixture.headers = { 'content-type': acceptsMarkdown ? 'text/markdown' : 'text/html' };
      fixture.body = acceptsMarkdown ? '---\ntitle: Quick Start\n---\n<Intro>본문</Intro>\n## 첫 개념 {/*concept*/}' : '<html><head><title>Quick Start</title></head><body><main><h1>Quick Start</h1><p>본문</p></main></body></html>';
      return request(url, options, callback);
    };
    const result = await fetchDocumentUrl('https://docs.example.com/learn', fake.dependencies);
    expect(result.title).toBe('Quick Start');
    expect(result.source).toBe('# Quick Start\n\n본문');
  });
  it.each([['gzip', gzipSync], ['br', brotliCompressSync], ['deflate', deflateSync]] as const)('압축을 풀되 압축 해제 뒤에도 4MB 제한을 적용한다: %s', async (encoding, compress) => {
    const normal = transport([{ headers: { 'content-encoding': encoding }, body: compress(Buffer.from('압축된 학습 본문입니다.')) }]);
    expect((await fetchDocumentUrl('https://docs.example.com', normal.dependencies)).source).toBe('압축된 학습 본문입니다.');
    const huge = transport([{ headers: { 'content-encoding': encoding }, body: compress(Buffer.alloc(4 * 1024 * 1024 + 1, 65)) }]);
    await expect(fetchDocumentUrl('https://docs.example.com', huge.dependencies)).rejects.toThrow(/4MB/);
  });
  it('전송 크기·원문 길이·빈 본문·손상된 UTF-8·미지원 압축을 거부한다', async () => {
    const fixtures: [ResponseFixture, RegExp][] = [
      [{ body: Buffer.alloc(4 * 1024 * 1024 + 1, 65) }, /4MB/],
      [{ headers: { 'content-length': String(4 * 1024 * 1024 + 1) } }, /4MB/],
      [{ body: 'a'.repeat(1_000_001) }, /1,000,000/],
      [{ body: ' \n' }, /본문.*비어/],
      [{ body: Buffer.from([0xc3, 0x28]) }, /UTF-8/],
      [{ headers: { 'content-encoding': 'compress' }, body: 'body' }, /압축/],
    ];
    for (const [fixture, message] of fixtures) await expect(fetchDocumentUrl('https://docs.example.com', transport([fixture]).dependencies)).rejects.toThrow(message);
  });
  it.each([401, 403])('인증이 필요한 응답은 수동 복사 방법을 안내한다: %s', async status => {
    await expect(fetchDocumentUrl('https://docs.example.com', transport([{ status }]).dependencies)).rejects.toThrow(/로그인.*복사/);
  });
  it('응답과 DNS 대기 시간을 포함해 총 20초 뒤 취소한다', async () => {
    vi.useFakeTimers();
    const hangingResponse = transport([{ hang: true }]);
    const responsePromise = expect(fetchDocumentUrl('https://docs.example.com', hangingResponse.dependencies)).rejects.toThrow(/20초/);
    await vi.advanceTimersByTimeAsync(20_000);
    await responsePromise;
    expect(hangingResponse.calls[0]?.response.destroyed).toBe(true);
    const hangingDns = transport();
    hangingDns.lookup.mockImplementation(() => new Promise(() => {}));
    const dnsPromise = expect(fetchDocumentUrl('https://docs.example.com', hangingDns.dependencies)).rejects.toThrow(/20초/);
    await vi.advanceTimersByTimeAsync(20_000);
    await dnsPromise;
    expect(hangingDns.calls).toHaveLength(0);
  });
});
