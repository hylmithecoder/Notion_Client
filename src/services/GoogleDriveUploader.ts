import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import { google, type drive_v3 } from "googleapis";
import type { OAuth2Client } from "googleapis-common";
import chalk from "chalk";
import open from "open";
import destroyer from "server-destroy";

const NOTION_MCP_DIR = path.join(os.homedir(), ".notion_mcp");
const CREDENTIALS_PATH = path.join(NOTION_MCP_DIR, "google-credentials.json");
const TOKEN_PATH = path.join(NOTION_MCP_DIR, "google-token.json");
const DEFAULT_FOLDER_NAME = "notion_images";
const SCOPES = ["https://www.googleapis.com/auth/drive"];

export interface GoogleDriveUploadResult {
  id: string;
  name: string;
  webViewLink: string;
  webContentLink: string;
  directImageUrl: string;
  public: boolean;
}

export interface GoogleDriveCredentials {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

export class GoogleDriveUploader {
  private auth: OAuth2Client | null = null;
  private drive: drive_v3.Drive | null = null;

  private getCredentials(): GoogleDriveCredentials | null {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8")) as GoogleDriveCredentials;
    } catch (e) {
      console.error(chalk.red("Error reading Google credentials:"), e);
      return null;
    }
  }

  private getRedirectUri(credentials: GoogleDriveCredentials): string {
    const config = credentials.installed || credentials.web;
    if (!config) {
      throw new Error("Invalid Google credentials: missing 'installed' or 'web' configuration.");
    }
    if (config.redirect_uris && config.redirect_uris.length > 0) {
      return config.redirect_uris.find((uri) => uri.startsWith("http://localhost")) || config.redirect_uris[0];
    }
    // Fallback for web client credentials that don't include redirect_uris in the file.
    return "http://localhost:8080";
  }

  private createOAuthClient(credentials: GoogleDriveCredentials): OAuth2Client {
    const redirectUri = this.getRedirectUri(credentials);
    const config = credentials.installed || credentials.web;
    return new google.auth.OAuth2(config!.client_id, config!.client_secret, redirectUri);
  }

  private loadToken(): { refresh_token?: string; access_token?: string; expiry_date?: number } | null {
    if (!fs.existsSync(TOKEN_PATH)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    } catch (e) {
      console.error(chalk.red("Error loading Google token:"), e);
      return null;
    }
  }

  private saveToken(token: { refresh_token?: string | null; access_token?: string | null; expiry_date?: number | null }): void {
    if (!fs.existsSync(NOTION_MCP_DIR)) {
      fs.mkdirSync(NOTION_MCP_DIR, { recursive: true });
    }
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
  }

  /**
   * Runs the OAuth2 flow to authorize the app with Google Drive.
   * Opens a browser and waits for the callback.
   */
  async authorize(): Promise<OAuth2Client> {
    const credentials = this.getCredentials();
    if (!credentials) {
      throw new Error(
        `Google credentials not found at ${CREDENTIALS_PATH}. Please download your OAuth2 client_secret.json from Google Cloud Console and save it there.`
      );
    }

    const oAuth2Client = this.createOAuthClient(credentials);
    const token = this.loadToken();

    if (token && token.refresh_token) {
      oAuth2Client.setCredentials(token);
      this.auth = oAuth2Client;
      this.drive = google.drive({ version: "v3", auth: oAuth2Client });
      return oAuth2Client;
    }

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
    });

    const redirectUri = this.getRedirectUri(credentials);

    console.log(chalk.cyan("Authorize this app by visiting this URL:"));
    console.log(chalk.blue(authUrl));
    await open(authUrl);

    const code = await this.listenForCallback(redirectUri);
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    this.saveToken(tokens);

    this.auth = oAuth2Client;
    this.drive = google.drive({ version: "v3", auth: oAuth2Client });

    console.log(chalk.green("Google Drive authorization successful!"));
    return oAuth2Client;
  }

  private listenForCallback(redirectUri: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(redirectUri);
      const hostname = url.hostname;
      const port = parseInt(url.port || "80", 10);

      const server = http
        .createServer(async (req, res) => {
          try {
            const qs = new URL(req.url || "/", `http://${hostname}:${port}`).searchParams;
            const code = qs.get("code");
            if (!code) {
              res.end("Authorization failed. No code provided.");
              reject(new Error("Authorization failed. No code provided."));
              return;
            }
            res.end("Authorization successful! You can close this tab.");
            resolve(code);
            server.close();
          } catch (e) {
            reject(e);
          }
        })
        .listen(port, hostname, () => {
          console.log(chalk.cyan(`Waiting for OAuth callback on http://${hostname}:${port}...`));
        });

      destroyer(server);
    });
  }

  /**
   * Ensures the Google Drive API client is authorized.
   */
  async ensureAuthorized(): Promise<drive_v3.Drive> {
    if (this.drive) {
      return this.drive;
    }
    await this.authorize();
    if (!this.drive) {
      throw new Error("Google Drive authorization failed.");
    }
    return this.drive;
  }

  /**
   * Finds or creates the notion_images folder in Google Drive.
   */
  async getOrCreateFolder(name = DEFAULT_FOLDER_NAME): Promise<string> {
    const drive = await this.ensureAuthorized();

    const res = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`,
      spaces: "drive",
      fields: "files(id, name)",
    });

    if (res.data.files && res.data.files.length > 0) {
      const folderId = res.data.files[0].id;
      if (folderId) {
        console.log(chalk.cyan(`Using existing Google Drive folder '${name}' (${folderId}).`));
        return folderId;
      }
    }

    const folderRes = await drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id, name",
    });

    const folderId = folderRes.data.id;
    if (!folderId) {
      throw new Error(`Failed to create Google Drive folder '${name}'.`);
    }
    console.log(chalk.green(`Created Google Drive folder '${name}' (${folderId}).`));
    return folderId;
  }

  /**
   * Uploads a local file to the notion_images folder and makes it publicly readable.
   */
  async uploadFile(filePath: string, folderName = DEFAULT_FOLDER_NAME): Promise<GoogleDriveUploadResult> {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const drive = await this.ensureAuthorized();
    const folderId = await this.getOrCreateFolder(folderName);
    const fileName = path.basename(absolutePath);
    const mimeType = this.getMimeType(absolutePath);

    const fileRes = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType,
        body: fs.createReadStream(absolutePath),
      },
      fields: "id, name, webViewLink, webContentLink",
    });

    const fileId = fileRes.data.id;
    if (!fileId) {
      throw new Error("Failed to upload file to Google Drive.");
    }

    // Make file publicly readable
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    console.log(chalk.green(`Uploaded '${fileName}' to Google Drive folder '${folderName}'.`));

    return {
      id: fileId,
      name: fileName,
      webViewLink: fileRes.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
      webContentLink: fileRes.data.webContentLink || `https://drive.google.com/uc?export=download&id=${fileId}`,
      directImageUrl: `https://lh3.googleusercontent.com/d/${fileId}`,
      public: true,
    };
  }

  /**
   * Uploads a local file and returns the best URL for embedding in Notion.
   */
  async uploadAndGetUrl(filePath: string, folderName = DEFAULT_FOLDER_NAME): Promise<string> {
    const result = await this.uploadFile(filePath, folderName);
    return result.directImageUrl;
  }

  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
      ".mp4": "video/mp4",
      ".mp3": "audio/mpeg",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    return map[ext] || "application/octet-stream";
  }
}
