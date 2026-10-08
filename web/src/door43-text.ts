// Door43's health-check text as the page shows it (#124). Door43 writes an
// issue's `details` and `suggestion` in a little Markdown and a little HTML
// (E16, E60): `**bold**`, `` `code` `` (usually as `**`…`**` around the
// backticks), and a link, as `<a href="/owner/repo/…" target="_blank">…</a>`
// relative to the Door43 host. This turns that text into tokens for exactly
// that subset: bold, inline code, and links. Every other tag and character is
// text, shown as Door43 wrote it, and nothing becomes markup the browser
// parses: the page builds elements from the tokens, never HTML from a string.
// The display changes; the words, and what they say, do not (H1).

export type Door43Token =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: Door43Token[] }
  | { kind: 'code'; text: string }
  /** `href` is absolute, http(s), and resolved against the Door43 host. */
  | { kind: 'link'; href: string; children: Door43Token[] };

// A link starts at `<a …>` or `[`: anchored (sticky) so each is tried only where the scan stands.
const HTML_LINK = /<a\s([^<>]*)>([^<]*)<\/a\s*>/iy;
const HREF = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const MARKDOWN_LINK = /\[([^[\]]*)\]\(([^()\s]*)\)/y;

/**
 * The address a link in Door43's text opens, or `null` when it may not be one:
 * an absolute `http:` or `https:` URL, or a path on the Door43 host (`/owner/repo/…`)
 * resolved against `origin`. Anything else (`javascript:`, `data:`, a bare word,
 * `//elsewhere`) is `null`, and the link is shown as the text Door43 wrote.
 */
export function door43Href(href: string, origin: string | null): string | null {
  try {
    if (/^https?:\/\//i.test(href)) {
      const url = new URL(href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    }
    if (origin === null || !/^\/(?![/\\])/.test(href)) return null;
    const base = new URL(origin);
    const url = new URL(href, base.origin);
    return url.origin === base.origin ? url.href : null;
  } catch {
    return null;
  }
}

/** Door43's text as tokens, links resolved against `origin` (the Door43 host, such as `https://qa.door43.org`). */
export function door43Tokens(source: string, origin: string | null): Door43Token[] {
  return scan(source, origin, true);
}

function scan(source: string, origin: string | null, links: boolean): Door43Token[] {
  const tokens: Door43Token[] = [];
  let text = '';
  const flush = () => {
    if (text) tokens.push({ kind: 'text', text });
    text = '';
  };
  let at = 0;
  while (at < source.length) {
    const char = source[at];
    if (char === '`') {
      const end = source.indexOf('`', at + 1);
      if (end > at + 1) {
        flush();
        tokens.push({ kind: 'code', text: source.slice(at + 1, end) });
        at = end + 1;
        continue;
      }
    }
    if (char === '*' && source.startsWith('**', at)) {
      const end = closingBold(source, at + 2);
      if (end > at + 2) {
        flush();
        tokens.push({ kind: 'bold', children: scan(source.slice(at + 2, end), origin, links) });
        at = end + 2;
        continue;
      }
    }
    if (links && (char === '<' || char === '[')) {
      const link = linkAt(source, at, origin);
      if (link) {
        if (link.token) {
          flush();
          tokens.push(link.token);
        } else text += link.raw;
        at += link.raw.length;
        continue;
      }
    }
    text += char;
    at += 1;
  }
  flush();
  return tokens;
}

/** Where a bold run that opens before `from` closes: the next `**` outside a code span, or -1. */
function closingBold(source: string, from: number): number {
  let at = from;
  while (at < source.length) {
    if (source[at] === '`') {
      const end = source.indexOf('`', at + 1);
      if (end > at + 1) {
        at = end + 1;
        continue;
      }
    }
    if (source.startsWith('**', at)) return at;
    at += 1;
  }
  return -1;
}

/** A link at `at`: its token, or, when its address may not be opened, `null` with the raw text to show as written. */
function linkAt(source: string, at: number, origin: string | null): { raw: string; token: Door43Token | null } | null {
  const pattern = source[at] === '<' ? HTML_LINK : MARKDOWN_LINK;
  pattern.lastIndex = at;
  const match = pattern.exec(source);
  if (!match) return null;
  const raw = match[0];
  let label: string;
  let href: string | null;
  if (pattern === HTML_LINK) {
    const attribute = HREF.exec(match[1] ?? '');
    label = match[2] ?? '';
    href = attribute ? (attribute[1] ?? attribute[2] ?? null) : null;
  } else {
    label = match[1] ?? '';
    href = match[2] ?? null;
  }
  const resolved = href === null ? null : door43Href(href, origin);
  if (resolved === null || !label) return { raw, token: null };
  return { raw, token: { kind: 'link', href: resolved, children: scan(label, origin, false) } };
}

/** The words a reader sees, without the markup: what the tokens say is what Door43 said (H1). */
export function plainText(tokens: Door43Token[]): string {
  return tokens.map(token => (token.kind === 'text' || token.kind === 'code' ? token.text : plainText(token.children))).join('');
}
