import { describe, expect, it } from 'vitest';
import { extractHtmlDocument } from '../electron/html-document.js';

const url = 'https://docs.example.com/guide';
function page(body: string, title = '공식 문서') { return `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`; }

describe('HTML 문서 본문 추출', () => {
  it('문서의 main article과 제목을 선택하고 주변 UI와 실행 요소를 제외한다', () => {
    const result = extractHtmlDocument(page(`<nav>메뉴와 광고</nav><main><aside>관련 링크</aside><article><h1>설치 안내</h1><p>설치를 시작하기 전에 환경을 확인합니다.</p><h2>실행하기</h2><p>명령을 실행하여 결과를 확인합니다.</p><script>window.secret = '실행 금지';</script><style>.x { color: red; }</style><form>로그인 양식</form><p hidden>비공개</p><p aria-hidden="true">숨김</p><p style="display: none">숨긴 안내</p></article></main><footer>저작권</footer>`), url);
    expect(result).toEqual({ title: '공식 문서', sourceUrl: url, source: '# 설치 안내\n\n설치를 시작하기 전에 환경을 확인합니다.\n\n## 실행하기\n\n명령을 실행하여 결과를 확인합니다.' });
  });
  it('코드 공백과 빈 줄을 보존하고 내부 백틱보다 긴 코드 펜스를 사용한다', () => {
    const code = '  const answer = 42;\n\n\n  console.log(```);\n';
    const result = extractHtmlDocument(page(`<main><h1>코드</h1><p>다음 코드를 그대로 실행합니다.</p><pre><code class="language-typescript">${code}</code></pre></main>`), url);
    expect(result.source).toContain(`\n\n\`\`\`\`typescript\n${code}\`\`\`\``);
  });
  it('목록과 표를 문단 경계가 있는 Markdown 블록으로 변환한다', () => {
    const result = extractHtmlDocument(page('<article><h2>옵션</h2><ul><li>첫 번째 항목</li><li>두 번째 항목<ul><li>하위 항목</li></ul></li></ul><table><tr><th>이름</th><th>설명</th></tr><tr><td>token</td><td>A | B</td></tr></table><p>이후 본문을 확인합니다.</p></article>'), url);
    expect(result.source).toContain('- 첫 번째 항목\n- 두 번째 항목\n  - 하위 항목');
    expect(result.source).toContain('| 이름 | 설명 |\n| --- | --- |\n| token | A \\| B |');
    expect(result.source).toContain('\n\n이후 본문');
  });
  it('비어 있는 main 대신 body 문서를 선택하고 제목이 없으면 h1을 사용한다', () => {
    const result = extractHtmlDocument(page('<main></main><div><h1>본문 문서</h1><p>main 요소 밖에 있는 문서 본문도 읽을 수 있습니다.</p></div>', ''), url);
    expect(result.title).toBe('본문 문서');
    expect(result.source).toContain('문서 본문도 읽을 수 있습니다.');
  });
  it('JavaScript 전용·빈 문서와 로그인 화면은 복구 방법을 안내한다', () => {
    expect(() => extractHtmlDocument(page('<div id="root"></div><script>renderApp()</script>'), url)).toThrow(/JavaScript.*복사/);
    expect(() => extractHtmlDocument(page('<h1>로그인</h1><form><input type="password"><button>로그인</button></form>'), url)).toThrow(/로그인.*복사/);
  });
  it('제목은 160자로 제한하고 과도한 본문은 조용히 자르지 않는다', () => {
    expect(extractHtmlDocument(page('<p>제목 길이 제한을 확인할 수 있는 본문입니다.</p>', '가'.repeat(200)), url).title).toHaveLength(160);
    expect(() => extractHtmlDocument(page(`<article><p>${'가'.repeat(1_000_001)}</p></article>`), url)).toThrow(/1,000,000/);
  });
  it('main의 제목과 여러 article을 빠짐없이 가져온다', () => {
    const result = extractHtmlDocument(page('<main><h1>기술 안내</h1><p>개요</p><article><h2>설치</h2><p>첫 단계</p></article><article><h2>사용</h2><pre><code>run()</code></pre></article></main>', ''), url);
    expect(result.title).toBe('기술 안내');
    expect(result.source).toContain('개요');
    expect(result.source).toContain('## 설치');
    expect(result.source).toContain('## 사용');
    expect(result.source).toContain('run()');
  });
  it('코드의 br과 블록으로 표현한 줄 경계를 보존한다', () => {
    const result = extractHtmlDocument(page('<main><pre><code>const x=1;<br>const y=2;</code></pre><pre><code><div>  a()</div><div>  b()</div></code></pre></main>'), url);
    expect(result.source).toContain('const x=1;\nconst y=2;');
    expect(result.source).toContain('  a()\n  b()\n');
  });
});
