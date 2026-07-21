import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import chalk from "chalk";
import type { ServerConfig, MCPToolInfo, NotionPageCreateOptions, TaskCardInput } from "./types.d.ts";
import { NotionProjectManager } from "./services/NotionProjectManager.js";

export class NotionMCPClient {
  private mcp: Client;
  private transport: StdioClientTransport | null = null;
  private tools: MCPToolInfo[] = [];

  constructor(clientName = "notion-mcp-client") {
    this.mcp = new Client({ name: clientName, version: "1.0.0" });
  }

  async connectToServer(serverConfig: ServerConfig) {
    try {
      if (Array.isArray(serverConfig)) {
        const [scriptPath] = serverConfig;
        const isJs = scriptPath.endsWith(".js");
        const isPy = scriptPath.endsWith(".py");
        if (!isJs && !isPy) {
          throw new Error("Server script must be a .js or .py file");
        }
        const command = isPy
          ? process.platform === "win32"
            ? "python"
            : "python3"
          : process.execPath;

        this.transport = new StdioClientTransport({
          command,
          args: serverConfig,
        });
      } else {
        if (!serverConfig.command || typeof serverConfig.command !== "string") {
          throw new Error("ServerConfig command must be a non-empty string");
        }
        if (!Array.isArray(serverConfig.args)) {
          throw new Error("ServerConfig args must be an array");
        }
        if (serverConfig.args.length === 0) {
          throw new Error("ServerConfig args cannot be empty");
        }

        const envMap: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined) {
            envMap[key] = value;
          }
        }
        if (serverConfig.env) {
          Object.assign(envMap, serverConfig.env);
        }

        this.transport = new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args,
          env: envMap,
        });
      }

      await this.mcp.connect(this.transport);

      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }));

      console.log(chalk.green("Connected to Notion MCP Server successfully!"));
      console.log(chalk.cyan(`Loaded ${this.tools.length} available tools.`));
    } catch (e) {
      console.error(chalk.red("Failed to connect to MCP server:"), e);
      throw e;
    }
  }

  getTools(): MCPToolInfo[] {
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}) {
    try {
      const result = await this.mcp.callTool({
        name,
        arguments: args,
      });
      return result;
    } catch (error) {
      console.error(chalk.red(`Error calling tool '${name}':`), error);
      throw error;
    }
  }

  // --- Convenience Notion Helper Methods ---

  async getSelf() {
    return this.callTool("API-get-self", {});
  }

  async getUsers() {
    return this.callTool("API-get-users", {});
  }

  async search(query = "") {
    return this.callTool("API-post-search", { query });
  }

  async getPage(pageId: string) {
    return this.callTool("API-retrieve-a-page", { page_id: pageId });
  }

  async getPageMarkdown(pageId: string) {
    return this.callTool("API-retrieve-page-markdown", { page_id: pageId });
  }

  async updatePageMarkdown(pageId: string, markdown: string) {
    return this.callTool("API-update-page-markdown", {
      page_id: pageId,
      body: markdown,
    });
  }

  async createPage(options: NotionPageCreateOptions) {
    return this.callTool("API-post-page", options as unknown as Record<string, unknown>);
  }

  async getBlockChildren(blockId: string) {
    return this.callTool("API-get-block-children", { block_id: blockId });
  }

  async appendBlockChildren(blockId: string, children: Array<Record<string, unknown>>) {
    return this.callTool("API-patch-block-children", {
      block_id: blockId,
      children,
    });
  }

  // --- Project Board & Markdown Automation ---

  get projectManager(): NotionProjectManager {
    return new NotionProjectManager(this);
  }

  async createTaskCard(input: TaskCardInput) {
    return this.projectManager.createTaskCard(input);
  }

  async importMarkdownFile(filePath: string, parentId?: string, isDatabase = false) {
    return this.projectManager.importMarkdownFile(filePath, parentId, isDatabase);
  }

  async getProjectBoard(databaseId: string) {
    return this.projectManager.getProjectBoard(databaseId);
  }

  async listDatabases() {
    return this.projectManager.listDatabases();
  }

  async listPages() {
    return this.projectManager.listPages();
  }

  async getActivity() {
    return this.projectManager.getActivity();
  }

  // --- Interactive REPL CLI ---

  async interactiveCLI() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log(chalk.bold.yellow("\n--- Notion MCP Interactive CLI ---"));
      console.log("Commands:");
      console.log("  " + chalk.green("tools") + "            - List all available MCP tools");
      console.log("  " + chalk.green("users") + "            - List workspace users");
      console.log("  " + chalk.green("self") + "             - View bot token details");
      console.log("  " + chalk.green("search <query>") + "   - Search workspace pages");
      console.log("  " + chalk.green("call <tool> <json_args>") + " - Call any tool directly");
      console.log("  " + chalk.green("quit") + "             - Exit CLI\n");

      while (true) {
        const line = await rl.question(chalk.bold.blue("notion-mcp> "));
        const input = line.trim();
        if (!input) continue;

        if (input.toLowerCase() === "quit" || input.toLowerCase() === "exit") {
          break;
        }

        if (input.toLowerCase() === "tools") {
          console.log(chalk.bold("\nAvailable Tools:"));
          this.tools.forEach((t, idx) => {
            console.log(` ${idx + 1}. ${chalk.green(t.name)}: ${t.description || "No description"}`);
          });
          console.log();
          continue;
        }

        if (input.toLowerCase() === "users") {
          const res = await this.getUsers();
          console.log("\n" + JSON.stringify(res, null, 2) + "\n");
          continue;
        }

        if (input.toLowerCase() === "self") {
          const res = await this.getSelf();
          console.log("\n" + JSON.stringify(res, null, 2) + "\n");
          continue;
        }

        if (input.toLowerCase().startsWith("search")) {
          const query = input.slice(6).trim();
          const res = await this.search(query);
          console.log("\n" + JSON.stringify(res, null, 2) + "\n");
          continue;
        }

        if (input.toLowerCase().startsWith("call ")) {
          const parts = input.slice(5).trim().split(" ");
          const toolName = parts[0];
          const rawArgs = parts.slice(1).join(" ");
          let argsObj: Record<string, unknown> = {};
          if (rawArgs) {
            try {
              argsObj = JSON.parse(rawArgs);
            } catch (e) {
              console.log(chalk.red("Invalid JSON arguments syntax."));
              continue;
            }
          }
          const res = await this.callTool(toolName, argsObj);
          console.log("\n" + JSON.stringify(res, null, 2) + "\n");
          continue;
        }

        console.log(chalk.yellow("Unknown command. Type 'tools', 'users', 'self', 'search <q>', 'call <name> <json>', or 'quit'."));
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    if (this.transport) {
      await this.mcp.close();
    }
  }
}

// Alias export for backward compatibility
export const MCPClient = NotionMCPClient;