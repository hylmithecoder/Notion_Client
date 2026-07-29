# Notion MCP Client (CLI & Library)

A lightweight, dedicated Command Line Interface (CLI) and TypeScript client for interacting directly with Notion workspaces via Model Context Protocol (MCP) servers.

## Setup

1. Configure your Notion token inside `server-config.json`:
   ```json
   {
     "command": "npx",
     "args": [
       "-y",
       "@notionhq/notion-mcp-server"
     ],
     "env": {
       "NOTION_TOKEN": "secret_your_notion_integration_token_here",
       "NOTION_API_KEY": "secret_your_notion_integration_token_here"
     }
   }
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. (Optional) Link as a global executable binary:
   ```bash
   npm link
   ```

## CLI Usage

Run `notion_mcp` directly from terminal:

```bash
# Fast, offline command reference for AI agents and humans
notion_mcp docs
notion_mcp docs --json

# Interactive REPL mode
notion_mcp

# List all available Notion MCP tools
notion_mcp tools

# Print bot & workspace information
notion_mcp self

# List workspace users
notion_mcp users

# Search workspace pages
notion_mcp search "my page"

# Call any Notion tool directly with JSON arguments
notion_mcp call API-post-search '{"query": "notes"}'

# Create a database under an accessible parent page
notion_mcp database create <parent_page_id> "Tasks"
```

Tool responses are automatically unwrapped from the MCP `content[].text`
envelope and printed as readable, indented JSON.

The `docs` command does not load configuration or connect to Notion, making it
safe and fast for an AI agent to inspect before using the binary. `help`,
`--help`, and `-h` are aliases.

## Programmatic Usage

Import `NotionMCPClient` directly in TypeScript/JavaScript projects:

```typescript
import { NotionMCPClient } from "./src/MCPClient.js";

const client = new NotionMCPClient();
await client.connectToServer({
  command: "npx",
  args: ["-y", "@notionhq/notion-mcp-server"],
  env: { NOTION_TOKEN: "ntn_..." }
});

const users = await client.getUsers();
console.log(users);

await client.cleanup();
```
