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
