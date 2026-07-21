export type ServerConfig = string[] | {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface NotionPageCreateOptions {
  parent: { page_id?: string; database_id?: string; workspace?: boolean };
  properties: Record<string, unknown>;
  children?: Array<Record<string, unknown>>;
  icon?: Record<string, unknown>;
  cover?: Record<string, unknown>;
}

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

