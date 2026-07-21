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
 * Helper to build a Notion rich text array
 */
export function createRichText(text: string): Array<Record<string, unknown>> {
  return [
    {
      type: "text",
      text: { content: text },
    },
  ];
}

/**
 * Converts Markdown text into a Notion Block API object array
 */
export function markdownToNotionBlocks(markdownText: string): Array<Record<string, unknown>> {
  const { body } = parseFrontmatter(markdownText);
  const lines = body.split(/\r?\n/);
  const blocks: Array<Record<string, unknown>> = [];

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
            rich_text: createRichText(codeContentLines.join("\n")),
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

    // Dividers
    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      blocks.push({ type: "divider", divider: {} });
      continue;
    }

    // Headings
    if (trimmed.startsWith("# ")) {
      blocks.push({
        type: "heading_1",
        heading_1: { rich_text: createRichText(trimmed.slice(2)) },
      });
      continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push({
        type: "heading_2",
        heading_2: { rich_text: createRichText(trimmed.slice(3)) },
      });
      continue;
    }
    if (trimmed.startsWith("### ")) {
      blocks.push({
        type: "heading_3",
        heading_3: { rich_text: createRichText(trimmed.slice(4)) },
      });
      continue;
    }

    // Callouts
    if (trimmed.startsWith("> ")) {
      blocks.push({
        type: "callout",
        callout: {
          rich_text: createRichText(trimmed.slice(2)),
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
          rich_text: createRichText(trimmed.slice(6)),
          checked: false,
        },
      });
      continue;
    }
    if (trimmed.startsWith("- [x] ") || trimmed.startsWith("* [x] ")) {
      blocks.push({
        type: "to_do",
        to_do: {
          rich_text: createRichText(trimmed.slice(6)),
          checked: true,
        },
      });
      continue;
    }

    // Bulleted list items
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: createRichText(trimmed.slice(2)) },
      });
      continue;
    }

    // Numbered list items
    if (/^\d+\.\s/.test(trimmed)) {
      const content = trimmed.replace(/^\d+\.\s/, "");
      blocks.push({
        type: "numbered_list_item",
        numbered_list_item: { rich_text: createRichText(content) },
      });
      continue;
    }

    // Paragraph default
    blocks.push({
      type: "paragraph",
      paragraph: { rich_text: createRichText(trimmed) },
    });
  }

  return blocks;
}

/**
 * Parses full Markdown file content into Frontmatter + Notion Blocks
 */
export function parseMarkdownFile(markdownText: string): ParsedMarkdown {
  const { frontmatter } = parseFrontmatter(markdownText);
  const blocks = markdownToNotionBlocks(markdownText);
  return { frontmatter, blocks };
}
