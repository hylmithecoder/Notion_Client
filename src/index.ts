#!/usr/bin/env node

import fs from "fs";
import path from "path";
import os from "os";
import dotenv from "dotenv";
import { NotionMCPClient } from "./MCPClient.js";
import chalk from "chalk";
import type { ServerConfig } from "./types.d.ts";

dotenv.config();

function loadServerConfig(): ServerConfig {
  const cwdConfigPath = path.join(process.cwd(), "server-config.json");
  const homeConfigPath = path.join(os.homedir(), ".notion_mcp", "server-config.json");

  for (const configPath of [cwdConfigPath, homeConfigPath]) {
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
  }

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
  console.log(chalk.yellow("Please create server-config.json in the current directory or at ~/.notion_mcp/server-config.json,"));
  console.log(chalk.yellow("or set NOTION_TOKEN in your environment."));
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
    } else if (command === "sync") {
      const filePath = args[1];
      const parentId = args[2];
      if (!filePath) {
        console.error(chalk.red("Error: Missing file path. Usage: notion_mcp sync <file.md|html> [parentId]"));
        process.exit(1);
      }
      const res = await client.importMarkdownFile(filePath, parentId);
      console.log(chalk.green("\nSync complete! Response:\n"), JSON.stringify(res, null, 2));
    } else if (command === "append") {
      const pageId = args[1];
      const filePath = args[2];
      if (!pageId || !filePath) {
        console.error(chalk.red("Error: Missing arguments. Usage: notion_mcp append <page_id> <file.md|html>"));
        process.exit(1);
      }
      const res = await client.appendToPage(pageId, filePath);
      console.log(chalk.green("\nAppend complete! Response:\n"), JSON.stringify(res, null, 2));
    } else if (command === "task") {
      const subCmd = args[1]?.toLowerCase();
      if (subCmd === "create") {
        const title = args[2] || "New Task Card";
        const status = args[3] || "Sedang berlangsung";
        const priority = args[4] || "Tinggi";
        const databaseId = args[5];

        const res = await client.createTaskCard({
          title,
          status,
          priority,
          databaseId,
        });
        console.log(chalk.green("\nTask Card created! Response:\n"), JSON.stringify(res, null, 2));
      } else {
        console.log("Usage: notion_mcp task create <title> [status] [priority] [databaseId]");
      }
    } else if (command === "board") {
      const databaseId = args[1];
      if (!databaseId) {
        console.error(chalk.red("Error: Missing database ID. Usage: notion_mcp board <databaseId>"));
        process.exit(1);
      }
      const res = await client.getProjectBoard(databaseId);
      console.log(JSON.stringify(res, null, 2));
    } else if (command === "databases" || command === "dbs") {
      const dbs = await client.listDatabases();
      console.log(chalk.bold("\nAccessible Databases:"));
      console.log(JSON.stringify(dbs, null, 2));
    } else if (command === "pages") {
      const pages = await client.listPages();
      console.log(chalk.bold("\nAccessible Pages:"));
      console.log(JSON.stringify(pages, null, 2));
    } else if (command === "activity" || command === "recents") {
      const activity = await client.getActivity();
      console.log(chalk.bold("\nRecent Workspace Activity:"));
      console.log(JSON.stringify(activity, null, 2));
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
    } else if (command === "drive-auth") {
      const res = await client.authorizeGoogleDrive();
      console.log(chalk.green("Google Drive authorized successfully."));
      console.log(JSON.stringify({ email: res.credentials.access_token ? "authorized" : "unknown" }, null, 2));
    } else if (command === "drive-upload") {
      const filePath = args[1];
      if (!filePath) {
        console.error(chalk.red("Error: Missing file path. Usage: notion_mcp drive-upload <file_path>"));
        process.exit(1);
      }
      const res = await client.uploadToGoogleDrive(filePath);
      console.log(chalk.green("\nUpload complete!"));
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(chalk.yellow(`Unknown subcommand '${command}'.`));
      console.log("Usage:");
      console.log("  notion_mcp                                   (starts interactive CLI)");
      console.log("  notion_mcp tools                             (lists all tools)");
      console.log("  notion_mcp users                             (lists workspace users)");
      console.log("  notion_mcp self                              (prints bot details)");
      console.log("  notion_mcp search <query>                    (searches workspace)");
      console.log("  notion_mcp sync <file.md|html> [parent_id]   (uploads & auto-splits if >100 blocks)");
      console.log("  notion_mcp append <page_id> <file.md|html>   (appends blocks to existing page)");
      console.log("  notion_mcp drive-auth                        (authorize Google Drive)");
      console.log("  notion_mcp drive-upload <file_path>          (upload a file to Google Drive notion_images folder)");
      console.log("  notion_mcp task create <title> [status] [priority]");
      console.log("  notion_mcp board <database_id>");
      console.log("  notion_mcp call <tool> <json_args>");
    }
  } catch (error) {
    console.error(chalk.red("Client execution error:"), error);
    process.exit(1);
  } finally {
    await client.cleanup();
  }
}

main();