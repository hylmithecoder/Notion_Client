#!/usr/bin/env node

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { NotionMCPClient } from "./MCPClient.js";
import chalk from "chalk";
import type { ServerConfig } from "./types.d.ts";

dotenv.config();

function loadServerConfig(): ServerConfig {
  const configPath = path.join(process.cwd(), "server-config.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return {
        command: config.command,
        args: config.args,
        env: config.env,
      };
    } catch (e) {
      console.error(chalk.red("Error parsing server-config.json:"), e);
      process.exit(1);
    }
  }

  // Fallback to npx @notionhq/notion-mcp-server using process.env.NOTION_TOKEN or NOTION_API_KEY
  const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  if (token) {
    return {
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: {
        NOTION_TOKEN: token,
        NOTION_API_KEY: token,
      },
    };
  }

  console.log(chalk.red.bold("Configuration Error: ") + "No server-config.json found and NOTION_TOKEN is not set.");
  console.log(chalk.yellow("Please create server-config.json or set NOTION_TOKEN in your environment."));
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  const serverConfig = loadServerConfig();
  const client = new NotionMCPClient();

  try {
    await client.connectToServer(serverConfig);

    if (!command || command === "repl" || command === "interactive") {
      await client.interactiveCLI();
    } else if (command === "tools" || command === "list") {
      console.log(chalk.bold("\nAvailable Notion MCP Tools:"));
      client.getTools().forEach((t, i) => {
        console.log(` ${i + 1}. ${chalk.green(t.name)}: ${t.description || "No description"}`);
      });
    } else if (command === "users") {
      const res = await client.getUsers();
      console.log(JSON.stringify(res, null, 2));
    } else if (command === "self") {
      const res = await client.getSelf();
      console.log(JSON.stringify(res, null, 2));
    } else if (command === "search") {
      const query = args.slice(1).join(" ");
      const res = await client.search(query);
      console.log(JSON.stringify(res, null, 2));
    } else if (command === "call") {
      const toolName = args[1];
      if (!toolName) {
        console.error(chalk.red("Error: Missing tool name. Usage: notion_mcp call <tool_name> [json_args]"));
        process.exit(1);
      }
      let toolArgs: Record<string, unknown> = {};
      if (args[2]) {
        try {
          toolArgs = JSON.parse(args.slice(2).join(" "));
        } catch (e) {
          console.error(chalk.red("Error: Invalid JSON arguments object."));
          process.exit(1);
        }
      }
      const res = await client.callTool(toolName, toolArgs);
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(chalk.yellow(`Unknown subcommand '${command}'.`));
      console.log("Usage:");
      console.log("  notion_mcp                  (starts interactive CLI)");
      console.log("  notion_mcp tools            (lists all tools)");
      console.log("  notion_mcp users            (lists workspace users)");
      console.log("  notion_mcp self             (prints bot details)");
      console.log("  notion_mcp search <query>   (searches workspace)");
      console.log("  notion_mcp call <tool> <json_args> (calls a specific tool)");
    }
  } catch (error) {
    console.error(chalk.red("Client execution error:"), error);
    process.exit(1);
  } finally {
    await client.cleanup();
  }
}

main();