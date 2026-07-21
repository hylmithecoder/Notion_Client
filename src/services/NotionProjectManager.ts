import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import type { NotionMCPClient } from "../MCPClient.js";
import {
  parseMarkdownFile,
  parseHtmlFile,
  parseMarkdownFileAsync,
  parseHtmlFileAsync,
  splitBlocksIntoChunks,
  estimateBlockCount,
  estimateHtmlBlockCount,
  convertUnresolvedLocalImagesToWarnings,
  type NotionBlock,
} from "../utils/markdownParser.js";
import { GoogleDriveUploader } from "./GoogleDriveUploader.js";

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

const MAX_NOTION_CHILDREN = 100;

export class NotionProjectManager {
  private client: NotionMCPClient;
  private googleDriveUploader: GoogleDriveUploader | null = null;

  constructor(client: NotionMCPClient) {
    this.client = client;
  }

  get driveUploader(): GoogleDriveUploader {
    if (!this.googleDriveUploader) {
      this.googleDriveUploader = new GoogleDriveUploader();
    }
    return this.googleDriveUploader;
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
    let children: NotionBlock[] = [];
    if (input.markdownContent) {
      const parsed = parseMarkdownFile(input.markdownContent);
      children = parsed.blocks;
    }

    console.log(chalk.cyan(`Creating Task Card '${input.title}' in Notion...`));
    const result = await this.client.callTool("API-post-page", {
      parent,
      properties,
      children: children.length > 0 ? children.slice(0, MAX_NOTION_CHILDREN) : undefined,
    });

    // If there are more than 100 children, append the rest in batches
    if (children.length > MAX_NOTION_CHILDREN) {
      const pageId = this.extractPageId(result);
      if (pageId) {
        await this.appendBlocksInBatches(pageId, children.slice(MAX_NOTION_CHILDREN));
      }
    }

    return result;
  }

  /**
   * Imports a local `.md` or `.html` file and converts it into a Notion Page or Project Card.
   * Automatically splits content into batches if it exceeds 100 blocks.
   * Local images are uploaded to Google Drive when credentials are available.
   */
  async importMarkdownFile(filePath: string, parentId?: string, isDatabase = false, useGoogleDrive = true) {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === ".html" || ext === ".htm";
    const content = fs.readFileSync(absolutePath, "utf-8");
    const filename = path.basename(filePath, ext);
    const baseDir = path.dirname(absolutePath);

    const hasGoogleCredentials = this.hasGoogleDriveCredentials();
    let parsed: { frontmatter: Record<string, unknown>; blocks: NotionBlock[] };

    if (hasGoogleCredentials && useGoogleDrive) {
      try {
        parsed = isHtml
          ? await parseHtmlFileAsync(content, baseDir, (p) => this.driveUploader.uploadAndGetUrl(p))
          : await parseMarkdownFileAsync(content, baseDir, (p) => this.driveUploader.uploadAndGetUrl(p));
      } catch (e: any) {
        console.log(
          chalk.yellow(
            `⚠️  Google Drive upload failed (${e?.message || e}). Falling back to local-image placeholders.`
          )
        );
        parsed = isHtml ? parseHtmlFile(content) : parseMarkdownFile(content);
      }
    } else {
      parsed = isHtml ? parseHtmlFile(content) : parseMarkdownFile(content);
      convertUnresolvedLocalImagesToWarnings(parsed.blocks);
    }

    const blockCount = parsed.blocks.length;

    const title = (parsed.frontmatter.title as string) || filename;
    const status = (parsed.frontmatter.status as string) || "Sedang berlangsung";
    const priority = (parsed.frontmatter.priority as string) || "Tinggi";
    const date = parsed.frontmatter.date as string | undefined;

    if (blockCount > MAX_NOTION_CHILDREN) {
      console.log(
        chalk.yellow(
          `⚠️  Content has ${blockCount} blocks. Notion limits 100 children per request. It will be split into ${Math.ceil(blockCount / MAX_NOTION_CHILDREN)} batches automatically.`
        )
      );
    }

    if (isDatabase && parentId) {
      return this.createTaskCard({
        title,
        databaseId: parentId,
        status,
        priority,
        startDate: date,
        markdownContent: isHtml ? content : undefined,
      });
    }

    const parent: Record<string, unknown> = parentId
      ? { page_id: parentId }
      : { workspace: true };

    const chunks = splitBlocksIntoChunks(parsed.blocks, MAX_NOTION_CHILDREN);

    console.log(chalk.cyan(`Importing '${title}' from ${filePath} into Notion (${blockCount} blocks)...`));

    const firstChunk = chunks[0] || [];
    const result = await this.client.callTool("API-post-page", {
      parent,
      properties: {
        title: {
          title: [{ text: { content: title } }],
        },
      },
      children: firstChunk.length > 0 ? firstChunk : undefined,
    });

    if (chunks.length > 1) {
      const pageId = this.extractPageId(result);
      if (!pageId) {
        console.error(chalk.red("Could not determine created page ID for appending remaining blocks."));
        return result;
      }
      for (let i = 1; i < chunks.length; i++) {
        console.log(chalk.cyan(`  Appending batch ${i + 1}/${chunks.length} (${chunks[i].length} blocks)...`));
        await this.client.appendBlockChildren(pageId, chunks[i]);
      }
      console.log(chalk.green(`Successfully imported all ${blockCount} blocks in ${chunks.length} batches.`));
    }

    return result;
  }

  private hasGoogleDriveCredentials(): boolean {
    const credentialsPath = path.join(os.homedir(), ".notion_mcp", "google-credentials.json");
    return fs.existsSync(credentialsPath);
  }

  /**
   * Appends blocks from a Markdown or HTML file to an existing Notion page.
   */
  async appendBlocksToPage(pageId: string, filePath: string, useGoogleDrive = true) {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === ".html" || ext === ".htm";
    const content = fs.readFileSync(absolutePath, "utf-8");
    const baseDir = path.dirname(absolutePath);

    const hasGoogleCredentials = this.hasGoogleDriveCredentials();
    let parsed: { frontmatter: Record<string, unknown>; blocks: NotionBlock[] };

    if (hasGoogleCredentials && useGoogleDrive) {
      try {
        parsed = isHtml
          ? await parseHtmlFileAsync(content, baseDir, (p) => this.driveUploader.uploadAndGetUrl(p))
          : await parseMarkdownFileAsync(content, baseDir, (p) => this.driveUploader.uploadAndGetUrl(p));
      } catch (e: any) {
        console.log(
          chalk.yellow(
            `⚠️  Google Drive upload failed (${e?.message || e}). Falling back to local-image placeholders.`
          )
        );
        parsed = isHtml ? parseHtmlFile(content) : parseMarkdownFile(content);
      }
    } else {
      parsed = isHtml ? parseHtmlFile(content) : parseMarkdownFile(content);
      convertUnresolvedLocalImagesToWarnings(parsed.blocks);
    }

    const blockCount = parsed.blocks.length;

    if (blockCount === 0) {
      console.log(chalk.yellow("No blocks found to append."));
      return { success: true, appended: 0 };
    }

    if (blockCount > MAX_NOTION_CHILDREN) {
      console.log(
        chalk.yellow(
          `⚠️  Content has ${blockCount} blocks. Will be split into ${Math.ceil(blockCount / MAX_NOTION_CHILDREN)} batches.`
        )
      );
    }

    await this.appendBlocksInBatches(pageId, parsed.blocks);
    return { success: true, appended: blockCount };
  }

  /**
   * Appends blocks to a page in batches of MAX_NOTION_CHILDREN.
   */
  async appendBlocksInBatches(pageId: string, blocks: NotionBlock[]) {
    const chunks = splitBlocksIntoChunks(blocks, MAX_NOTION_CHILDREN);
    for (let i = 0; i < chunks.length; i++) {
      console.log(chalk.cyan(`  Appending batch ${i + 1}/${chunks.length} (${chunks[i].length} blocks)...`));
      await this.client.appendBlockChildren(pageId, chunks[i]);
    }
    return { success: true, total: blocks.length, batches: chunks.length };
  }

  /**
   * Extracts the page ID from an API response.
   */
  private extractPageId(result: any): string | null {
    try {
      if (result?.content && Array.isArray(result.content)) {
        const text = result.content[0]?.text;
        if (text) {
          const parsed = JSON.parse(text);
          return parsed.id || null;
        }
      }
      if (result?.id) return result.id;
      return null;
    } catch {
      return null;
    }
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
