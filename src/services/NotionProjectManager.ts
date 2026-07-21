import fs from "fs";
import path from "path";
import chalk from "chalk";
import type { NotionMCPClient } from "../MCPClient.js";
import { parseMarkdownFile } from "../utils/markdownParser.js";

export interface TaskCardInput {
  title: string;
  databaseId?: string;
  pageId?: string;
  status?: "Belum dimulai" | "Sedang berlangsung" | "Selesai" | string;
  priority?: "Tinggi" | "Sedang" | "Rendah" | string;
  progress?: number;
  startDate?: string;
  endDate?: string;
  assigneeId?: string;
  markdownContent?: string;
}

export class NotionProjectManager {
  private client: NotionMCPClient;

  constructor(client: NotionMCPClient) {
    this.client = client;
  }

  /**
   * Creates a structured Task Card in a Notion Database/Project Board
   */
  async createTaskCard(input: TaskCardInput) {
    const parent: Record<string, unknown> = input.databaseId
      ? { database_id: input.databaseId }
      : input.pageId
        ? { page_id: input.pageId }
        : { workspace: true };

    const properties: Record<string, unknown> = {
      title: {
        title: [{ text: { content: input.title } }],
      },
    };

    // Add Status if provided
    if (input.status) {
      properties["Status"] = {
        status: { name: input.status },
      };
    }

    // Add Priority if provided
    if (input.priority) {
      properties["Priority"] = {
        select: { name: input.priority },
      };
    }

    // Add Progress % if provided
    if (input.progress !== undefined) {
      properties["Progress"] = {
        number: input.progress / 100,
      };
    }

    // Add Date range for Notion Calendar
    if (input.startDate) {
      properties["Date"] = {
        date: {
          start: input.startDate,
          end: input.endDate || undefined,
        },
      };
    }

    // Parse children blocks from markdown if provided
    let children: Array<Record<string, unknown>> = [];
    if (input.markdownContent) {
      const parsed = parseMarkdownFile(input.markdownContent);
      children = parsed.blocks;
    }

    console.log(chalk.cyan(`Creating Task Card '${input.title}' in Notion...`));
    const result = await this.client.callTool("API-post-page", {
      parent,
      properties,
      children: children.length > 0 ? children : undefined,
    });

    return result;
  }

  /**
   * Imports a local `.md` file and converts it into a Notion Page or Project Card
   */
  async importMarkdownFile(filePath: string, parentId?: string, isDatabase = false) {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(absolutePath, "utf-8");
    const filename = path.basename(filePath, ".md");
    const parsed = parseMarkdownFile(content);

    const title = parsed.frontmatter.title || filename;
    const status = parsed.frontmatter.status || "Sedang berlangsung";
    const priority = parsed.frontmatter.priority || "Tinggi";
    const date = parsed.frontmatter.date;

    if (isDatabase && parentId) {
      return this.createTaskCard({
        title,
        databaseId: parentId,
        status,
        priority,
        startDate: date,
        markdownContent: parsed.blocks.length > 0 ? content : undefined,
      });
    }

    const parent: Record<string, unknown> = parentId
      ? { page_id: parentId }
      : { workspace: true };

    console.log(chalk.cyan(`Importing '${title}' from ${filePath} into Notion...`));
    return this.client.callTool("API-post-page", {
      parent,
      properties: {
        title: {
          title: [{ text: { content: title } }],
        },
      },
      children: parsed.blocks,
    });
  }

  /**
   * Queries and displays Project Board cards grouped by status
   */
  async getProjectBoard(databaseId: string) {
    console.log(chalk.cyan(`Querying Notion Project Board '${databaseId}'...`));
    const result = await this.client.callTool("API-query-data-source", {
      database_id: databaseId,
    });

    return result;
  }

  /**
   * Scans workspace and lists all accessible Databases with IDs and Titles
   */
  async listDatabases() {
    console.log(chalk.cyan("Scanning workspace for Databases..."));
    const searchRes = await this.client.callTool("API-post-search", {
      filter: { value: "database", property: "object" },
    });
    const searchData = JSON.parse((searchRes.content as any)[0]?.text || "{}");
    const results = searchData.results || [];

    return results.map((item: any) => {
      let title = "Untitled Database";
      if (item.title && Array.isArray(item.title) && item.title.length > 0) {
        title = item.title.map((t: any) => t.plain_text).join("");
      }
      return {
        id: item.id,
        title,
        url: item.url,
        last_edited_time: item.last_edited_time,
      };
    });
  }

  /**
   * Scans workspace and lists all accessible Pages with IDs and Titles
   */
  async listPages() {
    console.log(chalk.cyan("Scanning workspace for Pages..."));
    const searchRes = await this.client.callTool("API-post-search", {
      filter: { value: "page", property: "object" },
    });
    const searchData = JSON.parse((searchRes.content as any)[0]?.text || "{}");
    const results = searchData.results || [];

    return results.map((item: any) => {
      let title = "Untitled Page";
      if (item.properties) {
        for (const key of Object.keys(item.properties)) {
          const prop = item.properties[key];
          if (prop.type === "title" && prop.title && prop.title.length > 0) {
            title = prop.title.map((t: any) => t.plain_text).join("");
          }
        }
      }
      return {
        id: item.id,
        title,
        parent: item.parent,
        url: item.url,
        last_edited_time: item.last_edited_time,
      };
    });
  }

  /**
   * Fetches overall workspace activity ordered by last edited time
   */
  async getActivity() {
    console.log(chalk.cyan("Fetching overall workspace activity..."));
    const searchRes = await this.client.callTool("API-post-search", {
      sort: {
        direction: "descending",
        timestamp: "last_edited_time",
      },
    });
    const searchData = JSON.parse((searchRes.content as any)[0]?.text || "{}");
    const results = searchData.results || [];

    return results.map((item: any) => {
      let title = "Untitled";
      if (item.object === "database" && item.title && Array.isArray(item.title)) {
        title = item.title.map((t: any) => t.plain_text).join("") || title;
      } else if (item.properties) {
        for (const key of Object.keys(item.properties)) {
          const prop = item.properties[key];
          if (prop.type === "title" && prop.title && prop.title.length > 0) {
            title = prop.title.map((t: any) => t.plain_text).join("");
          }
        }
      }
      return {
        type: item.object,
        id: item.id,
        title,
        url: item.url,
        last_edited_by: item.last_edited_by?.id || item.last_edited_by,
        last_edited_time: item.last_edited_time,
      };
    });
  }
}
