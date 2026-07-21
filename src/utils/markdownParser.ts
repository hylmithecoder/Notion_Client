import path from "path";
import chalk from "chalk";

export interface MarkdownFrontmatter {
  title?: string;
  status?: string;
  priority?: string;
  date?: string;
  assignee?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface ParsedMarkdown {
  frontmatter: MarkdownFrontmatter;
  blocks: Array<Record<string, unknown>>;
}

export type NotionBlock = Record<string, unknown>;
export type RichText = Record<string, unknown>;

/**
 * Parses YAML frontmatter at the start of a Markdown string
 */
export function parseFrontmatter(markdown: string): { frontmatter: MarkdownFrontmatter; body: string } {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = markdown.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: markdown };
  }

  const frontmatterStr = match[1];
  const body = markdown.slice(match[0].length);
  const frontmatter: MarkdownFrontmatter = {};

  frontmatterStr.split("\n").forEach((line) => {
    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (val.startsWith("[") && val.endsWith("]")) {
        frontmatter[key] = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
      } else {
        frontmatter[key] = val;
      }
    }
  });

  return { frontmatter, body };
}

/**
 * Helper to build a Notion rich text array from plain text
 */
export function createRichText(text: string): RichText[] {
  return parseInlineRichText(text);
}

/**
 * Parses inline Markdown formatting into Notion rich_text objects.
 * Supports: bold (** or __), italic (* or _), strikethrough (~~), inline code (`), links ([text](url))
 */
export function parseInlineRichText(text: string): RichText[] {
  const result: RichText[] = [];
  let remaining = text;

  // Match link first so it can contain formatted text inside
  const linkRegex = /\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/;

  while (remaining.length > 0) {
    const linkMatch = remaining.match(linkRegex);
    const codeIdx = remaining.indexOf("`");
    const boldIdx = remaining.search(/(\*\*|__)/);
    const italicIdx = remaining.search(/(?<![*_])(\*|_)(?![*_])/);
    const strikeIdx = remaining.indexOf("~~");

    const positions: Array<{ type: string; idx: number; match?: RegExpMatchArray }> = [];
    if (linkMatch) positions.push({ type: "link", idx: linkMatch.index ?? Infinity, match: linkMatch });
    if (codeIdx !== -1) positions.push({ type: "code", idx: codeIdx });
    if (boldIdx !== -1) positions.push({ type: "bold", idx: boldIdx });
    if (italicIdx !== -1) positions.push({ type: "italic", idx: italicIdx });
    if (strikeIdx !== -1) positions.push({ type: "strike", idx: strikeIdx });

    if (positions.length === 0) {
      if (remaining) {
        result.push({ type: "text", text: { content: remaining } });
      }
      break;
    }

    positions.sort((a, b) => a.idx - b.idx);
    const first = positions[0];

    if (first.idx > 0) {
      result.push({ type: "text", text: { content: remaining.slice(0, first.idx) } });
    }

    if (first.type === "link" && first.match) {
      const linkText = first.match[1];
      const url = first.match[2];
      result.push({
        type: "text",
        text: { content: linkText, link: { url } },
      });
      remaining = remaining.slice(first.idx + first.match[0].length);
      continue;
    }

    if (first.type === "code") {
      const end = remaining.indexOf("`", codeIdx + 1);
      if (end === -1) {
        result.push({ type: "text", text: { content: remaining.slice(codeIdx) } });
        break;
      }
      const codeContent = remaining.slice(codeIdx + 1, end);
      result.push({
        type: "text",
        text: { content: codeContent },
        annotations: { code: true },
      });
      remaining = remaining.slice(end + 1);
      continue;
    }

    if (first.type === "bold") {
      const marker = remaining.slice(boldIdx, boldIdx + 2);
      const end = remaining.indexOf(marker, boldIdx + 2);
      if (end === -1) {
        result.push({ type: "text", text: { content: remaining.slice(boldIdx) } });
        break;
      }
      const inner = remaining.slice(boldIdx + 2, end);
      const innerRich = parseInlineRichText(inner);
      for (const rt of innerRich) {
        const annotations = (rt.annotations as Record<string, boolean>) || {};
        rt.annotations = { ...annotations, bold: true };
      }
      result.push(...innerRich);
      remaining = remaining.slice(end + 2);
      continue;
    }

    if (first.type === "italic") {
      const marker = remaining.slice(italicIdx, italicIdx + 1);
      const end = remaining.indexOf(marker, italicIdx + 1);
      if (end === -1) {
        result.push({ type: "text", text: { content: remaining.slice(italicIdx) } });
        break;
      }
      const inner = remaining.slice(italicIdx + 1, end);
      const innerRich = parseInlineRichText(inner);
      for (const rt of innerRich) {
        const annotations = (rt.annotations as Record<string, boolean>) || {};
        rt.annotations = { ...annotations, italic: true };
      }
      result.push(...innerRich);
      remaining = remaining.slice(end + 1);
      continue;
    }

    if (first.type === "strike") {
      const end = remaining.indexOf("~~", strikeIdx + 2);
      if (end === -1) {
        result.push({ type: "text", text: { content: remaining.slice(strikeIdx) } });
        break;
      }
      const inner = remaining.slice(strikeIdx + 2, end);
      const innerRich = parseInlineRichText(inner);
      for (const rt of innerRich) {
        const annotations = (rt.annotations as Record<string, boolean>) || {};
        rt.annotations = { ...annotations, strikethrough: true };
      }
      result.push(...innerRich);
      remaining = remaining.slice(end + 2);
      continue;
    }

    // Fallback safety
    result.push({ type: "text", text: { content: remaining } });
    break;
  }

  return result;
}

/**
 * Splits a table row by pipe character, respecting escaped pipes.
 */
function splitTableRow(row: string): string[] {
  const cells: string[] = [];
  let current = "";
  let i = 0;
  while (i < row.length) {
    const char = row[i];
    const next = row[i + 1];
    if (char === "\\" && next === "|") {
      current += "|";
      i += 2;
    } else if (char === "|") {
      cells.push(current);
      current = "";
      i++;
    } else {
      current += char;
      i++;
    }
  }
  cells.push(current);
  // Remove leading empty cell if row starts with |
  if (cells.length > 0 && cells[0].trim() === "") {
    cells.shift();
  }
  return cells;
}

function isTableDivider(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  const inner = trimmed.slice(1, -1);
  return inner
    .split("|")
    .every((cell) => /^\s*[-:]+\s*$/.test(cell.trim()));
}

function parseTableRows(lines: string[], startIdx: number): { rows: string[][]; endIdx: number } {
  const rows: string[][] = [];
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) break;
    if (isTableDivider(line)) {
      i++;
      continue;
    }
    rows.push(splitTableRow(line).map((c) => c.trim()));
    i++;
  }
  return { rows, endIdx: i };
}

function buildTableBlock(rows: string[][]): NotionBlock {
  const width = Math.max(...rows.map((r) => r.length));
  const normalizedRows = rows.map((r) => {
    const padded = [...r];
    while (padded.length < width) padded.push("");
    return padded;
  });

  const children = normalizedRows.map((row) => ({
    type: "table_row",
    table_row: {
      cells: row.map((cell) => parseInlineRichText(cell)),
    },
  }));

  return {
    type: "table",
    table: {
      table_width: width,
      has_column_header: true,
      has_row_header: false,
      children,
    },
  };
}

function isExternalImageUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function buildImageBlock(alt: string, url: string): NotionBlock {
  return {
    type: "image",
    image: {
      type: "external",
      external: { url },
      caption: alt ? parseInlineRichText(alt) : [],
    },
  };
}

/**
 * Converts image blocks with unresolved local URLs into paragraph warnings.
 */
export function convertUnresolvedLocalImagesToWarnings(blocks: NotionBlock[]): void {
  for (const block of blocks) {
    if (block.type === "image") {
      const image = block.image as Record<string, unknown>;
      const external = image?.external as Record<string, unknown> | undefined;
      const url = external?.url as string;
      if (url && !isExternalImageUrl(url)) {
        block.type = "paragraph";
        block.paragraph = {
          rich_text: parseInlineRichText(
            `⚠️ Local image not uploaded (Google Drive not configured): ${url}`
          ),
        };
        delete (block as Record<string, unknown>).image;
      }
    }
  }
}

/**
 * Converts a Markdown table, image, or other element line into a block if matched.
 */
function parseSpecialMarkdownLine(line: string): NotionBlock | null {
  // Image: ![alt](url) or ![alt](url "title")
  const imageMatch = line.match(/^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)$/);
  if (imageMatch) {
    return buildImageBlock(imageMatch[1], imageMatch[2]);
  }
  return null;
}

/**
 * Converts Markdown text into a Notion Block API object array
 */
export function markdownToNotionBlocks(markdownText: string): NotionBlock[] {
  const { body } = parseFrontmatter(markdownText);
  const lines = body.split(/\r?\n/);
  const blocks: NotionBlock[] = [];

  let inCodeBlock = false;
  let codeLanguage = "plain text";
  let codeContentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block handling
    if (line.trim().startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLanguage = line.trim().slice(3).trim() || "plain text";
        codeContentLines = [];
      } else {
        inCodeBlock = false;
        blocks.push({
          type: "code",
          code: {
            rich_text: [{ type: "text", text: { content: codeContentLines.join("\n") } }],
            language: codeLanguage.toLowerCase(),
          },
        });
      }
      continue;
    }

    if (inCodeBlock) {
      codeContentLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      continue;
    }

    // Table handling
    if (trimmed.startsWith("|")) {
      const { rows, endIdx } = parseTableRows(lines, i);
      if (rows.length >= 1) {
        blocks.push(buildTableBlock(rows));
      }
      i = endIdx - 1;
      continue;
    }

    // Dividers
    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      blocks.push({ type: "divider", divider: {} });
      continue;
    }

    // Headings
    if (trimmed.startsWith("# ")) {
      blocks.push({
        type: "heading_1",
        heading_1: { rich_text: parseInlineRichText(trimmed.slice(2)) },
      });
      continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push({
        type: "heading_2",
        heading_2: { rich_text: parseInlineRichText(trimmed.slice(3)) },
      });
      continue;
    }
    if (trimmed.startsWith("### ")) {
      blocks.push({
        type: "heading_3",
        heading_3: { rich_text: parseInlineRichText(trimmed.slice(4)) },
      });
      continue;
    }

    // Callouts
    if (trimmed.startsWith("> ")) {
      blocks.push({
        type: "callout",
        callout: {
          rich_text: parseInlineRichText(trimmed.slice(2)),
          icon: { emoji: "💡" },
        },
      });
      continue;
    }

    // To-do items
    if (trimmed.startsWith("- [ ] ") || trimmed.startsWith("* [ ] ")) {
      blocks.push({
        type: "to_do",
        to_do: {
          rich_text: parseInlineRichText(trimmed.slice(6)),
          checked: false,
        },
      });
      continue;
    }
    if (trimmed.startsWith("- [x] ") || trimmed.startsWith("* [x] ")) {
      blocks.push({
        type: "to_do",
        to_do: {
          rich_text: parseInlineRichText(trimmed.slice(6)),
          checked: true,
        },
      });
      continue;
    }

    // Bulleted list items
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: parseInlineRichText(trimmed.slice(2)) },
      });
      continue;
    }

    // Numbered list items
    if (/^\d+\.\s/.test(trimmed)) {
      const content = trimmed.replace(/^\d+\.\s/, "");
      blocks.push({
        type: "numbered_list_item",
        numbered_list_item: { rich_text: parseInlineRichText(content) },
      });
      continue;
    }

    // Image on its own line
    const special = parseSpecialMarkdownLine(trimmed);
    if (special) {
      blocks.push(special);
      continue;
    }

    // Paragraph default
    blocks.push({
      type: "paragraph",
      paragraph: { rich_text: parseInlineRichText(trimmed) },
    });
  }

  return blocks;
}

// --- HTML to Notion conversion ---

interface HtmlToken {
  type: "text" | "tag" | "close";
  value: string;
  tag?: string;
  attrs?: Record<string, string>;
}

function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const tagRegex = /<(\/?)([a-zA-Z0-9-]+)([^>]*)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: html.slice(lastIndex, match.index) });
    }

    const isClosing = match[1] === "/";
    const tag = match[2].toLowerCase();
    const attrStr = match[3];
    const attrs: Record<string, string> = {};

    const attrRegex = /([a-zA-Z-]+)(?:=["']([^"']*)["'])?/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
      attrs[attrMatch[1].toLowerCase()] = attrMatch[2] ?? "";
    }

    tokens.push({
      type: isClosing ? "close" : "tag",
      value: match[0],
      tag,
      attrs,
    });

    lastIndex = tagRegex.lastIndex;
  }

  if (lastIndex < html.length) {
    tokens.push({ type: "text", value: html.slice(lastIndex) });
  }

  return tokens;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function htmlInlineToRichText(tokens: HtmlToken[], startIdx: number): { richText: RichText[]; endIdx: number } {
  const richText: RichText[] = [];
  let currentText = "";
  const annotations: Record<string, boolean> = {};
  let i = startIdx;

  function flush() {
    if (currentText) {
      richText.push({
        type: "text",
        text: { content: decodeHtmlEntities(currentText) },
        annotations: Object.keys(annotations).length > 0 ? { ...annotations } : undefined,
      });
      currentText = "";
    }
  }

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "text") {
      currentText += token.value;
      i++;
      continue;
    }

    if (token.type === "tag") {
      const tag = token.tag ?? "";
      if (["b", "strong"].includes(tag)) {
        flush();
        annotations.bold = true;
        const inner = htmlInlineToRichText(tokens, i + 1);
        for (const rt of inner.richText) {
          const rtAnno = (rt.annotations as Record<string, boolean>) || {};
          rt.annotations = { ...rtAnno, bold: true };
        }
        richText.push(...inner.richText);
        i = inner.endIdx + 1;
        delete annotations.bold;
        continue;
      }
      if (["i", "em"].includes(tag)) {
        flush();
        annotations.italic = true;
        const inner = htmlInlineToRichText(tokens, i + 1);
        for (const rt of inner.richText) {
          const rtAnno = (rt.annotations as Record<string, boolean>) || {};
          rt.annotations = { ...rtAnno, italic: true };
        }
        richText.push(...inner.richText);
        i = inner.endIdx + 1;
        delete annotations.italic;
        continue;
      }
      if (["s", "strike", "del"].includes(tag)) {
        flush();
        annotations.strikethrough = true;
        const inner = htmlInlineToRichText(tokens, i + 1);
        for (const rt of inner.richText) {
          const rtAnno = (rt.annotations as Record<string, boolean>) || {};
          rt.annotations = { ...rtAnno, strikethrough: true };
        }
        richText.push(...inner.richText);
        i = inner.endIdx + 1;
        delete annotations.strikethrough;
        continue;
      }
      if (tag === "code") {
        flush();
        annotations.code = true;
        const inner = htmlInlineToRichText(tokens, i + 1);
        for (const rt of inner.richText) {
          const rtAnno = (rt.annotations as Record<string, boolean>) || {};
          rt.annotations = { ...rtAnno, code: true };
        }
        richText.push(...inner.richText);
        i = inner.endIdx + 1;
        delete annotations.code;
        continue;
      }
      if (tag === "a" && token.attrs?.href) {
        flush();
        const inner = htmlInlineToRichText(tokens, i + 1);
        const url = token.attrs.href;
        for (const rt of inner.richText) {
          rt.text = { ...(rt.text as object), link: { url } };
        }
        richText.push(...inner.richText);
        i = inner.endIdx + 1;
        continue;
      }
      if (tag === "br") {
        currentText += "\n";
        i++;
        continue;
      }
      // Unknown inline tag, skip it but process contents
      const inner = htmlInlineToRichText(tokens, i + 1);
      richText.push(...inner.richText);
      i = inner.endIdx + 1;
      continue;
    }

    if (token.type === "close") {
      flush();
      return { richText, endIdx: i };
    }

    i++;
  }

  flush();
  return { richText, endIdx: i };
}

function collectTextUntil(tokens: HtmlToken[], startIdx: number, stopTag: string): { text: string; endIdx: number } {
  let text = "";
  let i = startIdx;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === "close" && token.tag === stopTag) {
      return { text: decodeHtmlEntities(text), endIdx: i };
    }
    if (token.type === "text") {
      text += token.value;
    } else if (token.type === "tag" && token.tag === "br") {
      text += "\n";
    }
    i++;
  }
  return { text: decodeHtmlEntities(text), endIdx: i };
}

/**
 * Converts simple HTML into Notion blocks.
 * Supports: h1-h3, p, div, ul/ol/li, table/tr/td/th, img, pre/code, blockquote, hr, br, basic inline formatting.
 */
export function htmlToNotionBlocks(htmlText: string): NotionBlock[] {
  const tokens = tokenizeHtml(htmlText);
  const blocks: NotionBlock[] = [];
  let i = 0;

  function parseInline(startIdx: number): RichText[] {
    const { richText, endIdx } = htmlInlineToRichText(tokens, startIdx);
    return richText;
  }

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "text") {
      const text = decodeHtmlEntities(token.value).trim();
      if (text) {
        blocks.push({ type: "paragraph", paragraph: { rich_text: parseInline(i) } });
      }
      i++;
      continue;
    }

    if (token.type !== "tag") {
      i++;
      continue;
    }

    const tag = token.tag ?? "";

    if (["h1", "h2", "h3"].includes(tag)) {
      const { text, endIdx } = collectTextUntil(tokens, i + 1, tag);
      const type = tag === "h1" ? "heading_1" : tag === "h2" ? "heading_2" : "heading_3";
      blocks.push({ type, [type]: { rich_text: parseInlineRichText(text) } });
      i = endIdx + 1;
      continue;
    }

    if (["p", "div"].includes(tag)) {
      const { text, endIdx } = collectTextUntil(tokens, i + 1, tag);
      if (text.trim()) {
        blocks.push({ type: "paragraph", paragraph: { rich_text: parseInlineRichText(text) } });
      }
      i = endIdx + 1;
      continue;
    }

    if (tag === "blockquote") {
      const { text, endIdx } = collectTextUntil(tokens, i + 1, "blockquote");
      if (text.trim()) {
        blocks.push({
          type: "callout",
          callout: { rich_text: parseInlineRichText(text), icon: { emoji: "💬" } },
        });
      }
      i = endIdx + 1;
      continue;
    }

    if (tag === "hr") {
      blocks.push({ type: "divider", divider: {} });
      i++;
      continue;
    }

    if (tag === "img") {
      const src = token.attrs?.src || "";
      const alt = token.attrs?.alt || "";
      if (src) {
        blocks.push(buildImageBlock(alt, src));
      }
      i++;
      continue;
    }

    if (tag === "pre") {
      const { text, endIdx } = collectTextUntil(tokens, i + 1, "pre");
      const codeText = text.replace(/<code[^>]*>/gi, "").replace(/<\/code>/gi, "").trim();
      blocks.push({
        type: "code",
        code: {
          rich_text: [{ type: "text", text: { content: codeText } }],
          language: "plain text",
        },
      });
      i = endIdx + 1;
      continue;
    }

    if (tag === "ul") {
      const { endIdx } = parseListItems(tokens, i + 1, "ul", "bulleted_list_item");
      i = endIdx + 1;
      continue;
    }

    if (tag === "ol") {
      const { endIdx } = parseListItems(tokens, i + 1, "ol", "numbered_list_item");
      i = endIdx + 1;
      continue;
    }

    if (tag === "table") {
      const { block, endIdx } = parseHtmlTable(tokens, i + 1);
      if (block) blocks.push(block);
      i = endIdx + 1;
      continue;
    }

    // Unknown block tag: process children inline
    i++;
  }

  return blocks;

  function parseListItems(
    toks: HtmlToken[],
    start: number,
    closeTag: string,
    itemType: string
  ): { endIdx: number } {
    let idx = start;
    while (idx < toks.length) {
      const t = toks[idx];
      if (t.type === "close" && t.tag === closeTag) {
        return { endIdx: idx };
      }
      if (t.type === "tag" && t.tag === "li") {
        const { text, endIdx } = collectTextUntil(toks, idx + 1, "li");
        blocks.push({
          type: itemType,
          [itemType]: { rich_text: parseInlineRichText(text) },
        });
        idx = endIdx + 1;
      } else {
        idx++;
      }
    }
    return { endIdx: idx };
  }

  function parseHtmlTable(toks: HtmlToken[], start: number): { block: NotionBlock | null; endIdx: number } {
    const rows: string[][] = [];
    let idx = start;
    let hasHeader = false;

    while (idx < toks.length) {
      const t = toks[idx];
      if (t.type === "close" && t.tag === "table") {
        if (rows.length === 0) return { block: null, endIdx: idx };
        const width = Math.max(...rows.map((r) => r.length));
        const normalized = rows.map((r) => {
          const padded = [...r];
          while (padded.length < width) padded.push("");
          return padded;
        });
        const children = normalized.map((row) => ({
          type: "table_row",
          table_row: { cells: row.map((cell) => parseInlineRichText(cell)) },
        }));
        return {
          block: {
            type: "table",
            table: {
              table_width: width,
              has_column_header: hasHeader,
              has_row_header: false,
              children,
            },
          },
          endIdx: idx,
        };
      }

      if (t.type === "tag" && (t.tag === "tr" || t.tag === "thead" || t.tag === "tbody")) {
        idx++;
        continue;
      }

      if (t.type === "close" && (t.tag === "tr" || t.tag === "thead" || t.tag === "tbody")) {
        idx++;
        continue;
      }

      if (t.type === "tag" && (t.tag === "td" || t.tag === "th")) {
        const isHeader = t.tag === "th";
        if (isHeader) hasHeader = true;
        const { text, endIdx } = collectTextUntil(toks, idx + 1, t.tag);
        const currentRow = rows[rows.length - 1];
        if (currentRow && currentRow.length > 0 && rows.length > 0) {
          // If we encounter a td/th after a row was closed, start new row
        }
        if (!currentRow || (toks[idx - 1]?.type === "close" && toks[idx - 1].tag === "tr")) {
          rows.push([]);
        }
        rows[rows.length - 1].push(text);
        idx = endIdx + 1;
        continue;
      }

      idx++;
    }

    return { block: null, endIdx: idx };
  }
}

function isLocalPath(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return false;
  return true;
}

function getAbsolutePath(url: string, baseDir: string): string {
  if (path.isAbsolute(url)) return url;
  return path.join(baseDir, url);
}

/**
 * Resolves local image URLs in blocks by calling the provided async resolver.
 * Resolver receives the absolute file path and should return a public URL.
 */
export async function resolveLocalImagesAsync(
  blocks: NotionBlock[],
  baseDir: string,
  resolveUrl: (absolutePath: string) => Promise<string>
): Promise<void> {
  for (const block of blocks) {
    if (block.type === "image") {
      const image = block.image as Record<string, unknown>;
      const external = image?.external as Record<string, unknown> | undefined;
      const url = external?.url as string;
      if (url && isLocalPath(url)) {
        const absolutePath = getAbsolutePath(url, baseDir);
        try {
          const publicUrl = await resolveUrl(absolutePath);
          image.external = { url: publicUrl };
        } catch (e) {
          console.error(chalk.red(`Failed to resolve local image ${url}:`), e);
          block.type = "paragraph";
          block.paragraph = {
            rich_text: parseInlineRichText(`⚠️ Failed to upload image: ${url}`),
          };
          delete (block as Record<string, unknown>).image;
        }
      }
    }
  }
}

/**
 * Parses full Markdown file content into Frontmatter + Notion Blocks
 */
export function parseMarkdownFile(markdownText: string): ParsedMarkdown {
  const { frontmatter } = parseFrontmatter(markdownText);
  const blocks = markdownToNotionBlocks(markdownText);
  return { frontmatter, blocks };
}

/**
 * Async version of parseMarkdownFile that resolves local images using the provided resolver.
 */
export async function parseMarkdownFileAsync(
  markdownText: string,
  baseDir: string,
  resolveUrl: (absolutePath: string) => Promise<string>
): Promise<ParsedMarkdown> {
  const parsed = parseMarkdownFile(markdownText);
  await resolveLocalImagesAsync(parsed.blocks, baseDir, resolveUrl);
  return parsed;
}

/**
 * Parses full HTML file content into Notion Blocks.
 * Frontmatter is not supported for HTML.
 */
export function parseHtmlFile(htmlText: string): { frontmatter: MarkdownFrontmatter; blocks: NotionBlock[] } {
  const blocks = htmlToNotionBlocks(htmlText);
  // Try to extract title from <h1> or <title>
  const titleMatch = htmlText.match(/<title>([^<]*)<\/title>/i) || htmlText.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  const frontmatter: MarkdownFrontmatter = {};
  if (titleMatch) {
    frontmatter.title = decodeHtmlEntities(titleMatch[1]).trim();
  }
  return { frontmatter, blocks };
}

/**
 * Async version of parseHtmlFile that resolves local images using the provided resolver.
 */
export async function parseHtmlFileAsync(
  htmlText: string,
  baseDir: string,
  resolveUrl: (absolutePath: string) => Promise<string>
): Promise<{ frontmatter: MarkdownFrontmatter; blocks: NotionBlock[] }> {
  const parsed = parseHtmlFile(htmlText);
  await resolveLocalImagesAsync(parsed.blocks, baseDir, resolveUrl);
  return parsed;
}

/**
 * Splits blocks into chunks respecting Notion's 100 children per request limit.
 */
export function splitBlocksIntoChunks(blocks: NotionBlock[], maxChunkSize = 100): NotionBlock[][] {
  const chunks: NotionBlock[][] = [];
  for (let i = 0; i < blocks.length; i += maxChunkSize) {
    chunks.push(blocks.slice(i, i + maxChunkSize));
  }
  return chunks;
}

/**
 * Estimates the number of blocks a markdown file will produce.
 */
export function estimateBlockCount(markdownText: string): number {
  return markdownToNotionBlocks(markdownText).length;
}

/**
 * Estimates the number of blocks an HTML file will produce.
 */
export function estimateHtmlBlockCount(htmlText: string): number {
  return htmlToNotionBlocks(htmlText).length;
}
