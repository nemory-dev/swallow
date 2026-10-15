import { parseHTML } from 'linkedom';
import { MAX_SOURCE_LENGTH } from '../src/learning/document.js';

export interface ImportedDocument { title: string; source: string; sourceUrl: string; }

export function documentTitle(value: string, fallback: string): string {
  return (value.replace(/\s+/g, ' ').trim() || fallback).slice(0, 160).replace(/[\uD800-\uDBFF]$/, '');
}

export function requireDocumentSource(source: string): string {
  if (!source.trim()) throw new Error('문서 본문이 비어 있습니다. 원문을 직접 복사해 추가해 주세요.');
  if (source.length > MAX_SOURCE_LENGTH) throw new Error('문서 본문은 1,000,000자 이내로 가져올 수 있습니다. 필요한 부분을 복사해 추가해 주세요.');
  return source;
}

function fenceFor(text: string, minimum: number): string {
  const lengths = [...text.matchAll(/`+/g)].map(match => match[0].length + 1);
  return '`'.repeat(Math.max(minimum, ...lengths));
}

export function extractHtmlDocument(html: string, url: string): ImportedDocument {
  // linkedom parses a static DOM; it does not run scripts or load linked resources.
  const { document } = parseHTML(/<html[\s>]/i.test(html) ? html : `<html><body>${html}</body></html>`);
  const loginForm = document.querySelector('input[type="password"]') !== null;
  for (const element of document.querySelectorAll('script, style, noscript, template, nav, aside, footer, form, input, button, select, textarea, iframe, object, embed, svg, canvas, [hidden], [inert], [aria-hidden="true"], [role="navigation"], [role="banner"], [role="complementary"]')) element.remove();
  for (const element of document.querySelectorAll('[style]')) {
    if (/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(element.getAttribute('style') ?? '')) element.remove();
  }
  document.querySelector('body > header')?.remove();
  const candidates = [...document.querySelectorAll('main'), ...document.querySelectorAll('article'), document.body];
  const root = candidates.find(element => (element.textContent ?? '').trim().length > 0) ?? document.body;
  const codeBlocks: string[] = [];
  function codeText(node: Node): string {
    if (node.nodeType === 3) return node.textContent ?? '';
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    if (element.tagName === 'BR') return '\n';
    const text = Array.from(node.childNodes, codeText).join('');
    return ['DIV', 'P', 'LI'].includes(element.tagName) && !text.endsWith('\n') ? text + '\n' : text;
  }
  function children(node: Node): string { return Array.from(node.childNodes, render).join(''); }
  function table(element: Element): string {
    const rows = Array.from(element.querySelectorAll('tr')).map(row => Array.from(row.children).filter(cell => ['TH', 'TD'].includes(cell.tagName)).map(cell => children(cell).trim().replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|'))).filter(row => row.length > 0);
    if (!rows.length) return '';
    const columns = Math.max(...rows.map(row => row.length));
    const lines = rows.map(row => `| ${Array.from({ length: columns }, (_, index) => row[index] ?? '').join(' | ')} |`);
    lines.splice(1, 0, `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`);
    const caption = element.querySelector('caption')?.textContent?.trim();
    return `\n\n${caption ? `${caption}\n\n` : ''}${lines.join('\n')}\n\n`;
  }
  function list(element: Element): string {
    let index = Number(element.getAttribute('start')) || 1;
    const items = Array.from(element.children).filter(child => child.tagName === 'LI').map(item => {
      const marker = element.tagName === 'OL' ? `${index++}. ` : '- ';
      const text = children(item).trim().replace(/\n{3,}/g, '\n\n');
      return marker + text.split('\n').map((line, lineIndex) => lineIndex ? ' '.repeat(marker.length) + line : line).join('\n');
    });
    return `\n${items.join('\n')}\n`;
  }
  function render(node: Node): string {
    if (node.nodeType === 3) return (node.textContent ?? '').replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    const tag = element.tagName;
    if (tag === 'PRE') {
      const text = codeText(element);
      const fence = fenceFor(text, 3);
      const language = element.querySelector('code')?.getAttribute('class')?.match(/(?:^|\s)language-([\w+-]+)/)?.[1] ?? '';
      const token = `\uE000CODE${codeBlocks.length}\uE001`;
      codeBlocks.push(`${fence}${language}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}`);
      return `\n\n${token}\n\n`;
    }
    if (tag === 'TABLE') return table(element);
    if (tag === 'UL' || tag === 'OL') return list(element);
    if (tag === 'BR') return '\n';
    if (tag === 'HR') return '\n\n---\n\n';
    if (tag === 'IMG') return '';
    const text = children(node);
    if (/^H[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${text.trim()}\n\n`;
    if (tag === 'CODE') {
      const fence = fenceFor(text, 1);
      return `${fence}${/^`|`$/.test(text) ? ` ${text} ` : text}${fence}`;
    }
    if (tag === 'STRONG' || tag === 'B') return `**${text.trim()}**`;
    if (tag === 'EM' || tag === 'I') return `*${text.trim()}*`;
    if (tag === 'BLOCKQUOTE') return `\n\n${text.trim().split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
    if (['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'BODY', 'HEADER', 'DL', 'DT', 'DD', 'FIGURE', 'FIGCAPTION'].includes(tag)) return `\n\n${text.trim()}\n\n`;
    return text;
  }
  let source = render(root).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (loginForm && source.length < 60) throw new Error('로그인이 필요한 페이지는 가져올 수 없습니다. 로그인한 브라우저에서 본문을 복사해 추가해 주세요.');
  if (!source) throw new Error('읽을 수 있는 본문이 없습니다. JavaScript로 표시되거나 로그인한 페이지는 브라우저에서 본문을 복사해 추가해 주세요.');
  source = source.replace(/\uE000CODE(\d+)\uE001/g, (_match, index: string) => codeBlocks[Number(index)] ?? '');
  const title = documentTitle(document.querySelector('title')?.textContent?.trim() || root.querySelector('h1')?.textContent || '', new URL(url).hostname);
  return { title, source: requireDocumentSource(source), sourceUrl: url };
}
