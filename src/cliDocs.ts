export const CLI_DOCS = {
  name: "notion_mcp",
  purpose: "CLI and MCP client for reading and writing a Notion workspace.",
  response_format: "Commands print decoded, indented JSON. MCP content[].text envelopes are automatically unwrapped.",
  discovery: [
    { command: "notion_mcp docs", description: "Print this AI-oriented command reference without connecting to Notion." },
    { command: "notion_mcp docs --json", description: "Print this reference as machine-readable JSON." },
    { command: "notion_mcp tools", description: "Connect and list every MCP tool exposed by the configured server." },
  ],
  read_commands: [
    { command: "notion_mcp self", description: "Get the integration bot and workspace identity." },
    { command: "notion_mcp users", description: "List workspace users." },
    { command: "notion_mcp search [query]", description: "Search accessible Notion content by title." },
    { command: "notion_mcp pages", description: "List accessible pages with IDs and URLs." },
    { command: "notion_mcp databases", aliases: ["dbs"], description: "List accessible databases with IDs and URLs." },
    { command: "notion_mcp activity", aliases: ["recents"], description: "List recently edited accessible content." },
    { command: "notion_mcp board <database_id>", description: "Query a project database." },
  ],
  write_commands: [
    { command: "notion_mcp database create <parent_page_id> [title]", description: "Create a database with Name, Status, and Created properties." },
    { command: "notion_mcp sync <file.md|html> [parent_id]", description: "Create Notion content from a local Markdown or HTML file." },
    { command: "notion_mcp append <page_id> <file.md|html>", description: "Append a local Markdown or HTML file to an existing page." },
    { command: "notion_mcp task create <title> [status] [priority] [database_id]", description: "Create a task card." },
    { command: "notion_mcp drive-upload <file_path>", description: "Upload a local file to the configured Google Drive folder." },
  ],
  advanced: [
    {
      command: "notion_mcp call <tool_name> '<json_args>'",
      description: "Call any discovered MCP tool. Run `notion_mcp tools` first to discover exact names.",
      example: "notion_mcp call API-retrieve-a-page '{\"page_id\":\"PAGE_ID\"}'",
    },
  ],
  agent_guidance: [
    "Use pages or databases first when a required parent or database ID is unknown.",
    "Treat database create, sync, append, task create, drive-upload, and mutating call operations as writes.",
    "Pass JSON arguments as one shell-quoted object.",
    "A Notion integration can only access pages explicitly shared with it.",
    "Configuration is read from ./server-config.json, ~/.notion_mcp/server-config.json, or NOTION_TOKEN/NOTION_API_KEY.",
  ],
} as const;

export function renderCliDocs(): string {
  const sections = [
    ["DISCOVERY", CLI_DOCS.discovery],
    ["READ COMMANDS", CLI_DOCS.read_commands],
    ["WRITE COMMANDS", CLI_DOCS.write_commands],
    ["ADVANCED", CLI_DOCS.advanced],
  ] as const;

  const lines = [
    `${CLI_DOCS.name} - ${CLI_DOCS.purpose}`,
    "",
    `OUTPUT: ${CLI_DOCS.response_format}`,
  ];

  for (const [heading, commands] of sections) {
    lines.push("", heading);
    for (const item of commands) {
      const aliases = "aliases" in item ? ` (aliases: ${item.aliases.join(", ")})` : "";
      lines.push(`  ${item.command}${aliases}`, `    ${item.description}`);
      if ("example" in item) lines.push(`    Example: ${item.example}`);
    }
  }

  lines.push("", "AGENT GUIDANCE");
  CLI_DOCS.agent_guidance.forEach((item) => lines.push(`  - ${item}`));
  return lines.join("\n");
}
