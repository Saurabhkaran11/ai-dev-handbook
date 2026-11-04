import { marked, type Tokens } from 'marked';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import plaintext from 'highlight.js/lib/languages/plaintext';
export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('text', plaintext);

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escape HTML, then turn `code` spans into <code>. For short strings in data files. */
export function inline(s: string): string {
  return escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}

marked.use({
  renderer: {
    code({ text, lang }: Tokens.Code): string {
      const language = lang && hljs.getLanguage(lang) ? lang : undefined;
      const html = language ? hljs.highlight(text, { language }).value : escapeHtml(text);
      const label = language ? `<span class="code-lang">${language}</span>` : '';
      return `<div class="code">${label}<button class="copy" data-action="copy" type="button">Copy</button><pre><code class="hljs">${html}</code></pre></div>`;
    },
    heading({ tokens, depth }: Tokens.Heading): string {
      const text = this.parser.parseInline(tokens);
      const id = slugify(text.replace(/<[^>]+>/g, ''));
      return `<h${depth} id="${id}"><a class="anchor" href="#${id}" data-anchor="${id}">${text}</a></h${depth}>`;
    },
    table({ header, rows }: Tokens.Table): string {
      const th = header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join('');
      const body = rows
        .map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`)
        .join('');
      return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
    },
  },
});

/** Highlight a raw code string (used for project starters). */
export function codeBlock(code: string, lang = 'typescript'): string {
  const html = hljs.highlight(code, { language: lang }).value;
  return `<div class="code"><span class="code-lang">${lang}</span><button class="copy" data-action="copy" type="button">Copy</button><pre><code class="hljs">${html}</code></pre></div>`;
}

export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string;
}
