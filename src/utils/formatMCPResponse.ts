type MCPContent = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

type MCPResponse = {
  content?: MCPContent[];
  [key: string]: unknown;
};

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return "";

  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

/**
 * Removes the MCP transport envelope from a tool result.
 *
 * Notion's MCP server commonly returns API JSON as a string inside
 * `content[0].text`. A single text item is unwrapped directly; multiple content
 * items are retained as an array so no response data is lost.
 */
export function formatMCPResponse(response: unknown): unknown {
  if (!response || typeof response !== "object") return response;

  const result = response as MCPResponse;
  if (!Array.isArray(result.content)) return response;

  const formattedContent = result.content.map((item) => {
    if (item?.type === "text" && typeof item.text === "string") {
      return parseJsonText(item.text);
    }
    return item;
  });

  if (formattedContent.length === 1) {
    return formattedContent[0];
  }

  return formattedContent;
}

export function stringifyMCPResponse(response: unknown): string {
  const formatted = formatMCPResponse(response);
  return typeof formatted === "string" ? formatted : JSON.stringify(formatted, null, 2);
}
