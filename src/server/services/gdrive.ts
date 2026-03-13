import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const TOKENS_PATH = path.join(process.cwd(), 'tokens.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

export function createOAuth2Client(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri ?? process.env.GOOGLE_REDIRECT_URI,
  );
}

export function getAuthUrl(redirectUri: string): string {
  const client = createOAuth2Client(redirectUri);
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function handleCallback(code: string, redirectUri: string): Promise<void> {
  const client = createOAuth2Client(redirectUri);
  const { tokens } = await client.getToken(code);
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

export function isAuthenticated(): boolean {
  if (!fs.existsSync(TOKENS_PATH)) return false;
  try {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    return !!tokens.access_token;
  } catch {
    return false;
  }
}

function getAuthenticatedClient() {
  const client = createOAuth2Client();
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
  client.setCredentials(tokens);
  // Auto-save refreshed tokens
  client.on('tokens', updated => {
    const merged = { ...tokens, ...updated };
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(merged, null, 2));
  });
  return client;
}

export async function createFolder(name: string): Promise<string> {
  const auth = getAuthenticatedClient();
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });
  return res.data.id!;
}

async function makePublic(drive: ReturnType<typeof google.drive>, fileId: string) {
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export async function uploadFile(
  filePath: string,
  folderId: string,
): Promise<{ id: string; url: string }> {
  const auth = getAuthenticatedClient();
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.create({
    requestBody: {
      name: path.basename(filePath),
      parents: [folderId],
    },
    media: {
      mimeType: 'audio/mpeg',
      body: fs.createReadStream(filePath),
    },
    fields: 'id',
  });

  const fileId = res.data.id!;
  const url = await makePublic(drive, fileId);
  return { id: fileId, url };
}

export async function uploadFromUrl(
  url: string,
  name: string,
  mimeType: string,
  folderId: string,
): Promise<{ id: string; url: string }> {
  const auth = getAuthenticatedClient();
  const drive = google.drive({ version: 'v3', auth });

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);

  const body = Readable.fromWeb(response.body as any);

  const res = await drive.files.create({
    requestBody: { name, parents: [folderId] },
    media: { mimeType, body },
    fields: 'id',
  });

  const fileId = res.data.id!;
  const driveUrl = await makePublic(drive, fileId);
  return { id: fileId, url: driveUrl };
}

export async function uploadAllMedia(
  shows: Array<{ name: string; trimmedFile: string; posterUrl: string }>,
  folderName: string,
  onProgress?: (showName: string, type: 'audio' | 'poster', url: string) => void,
): Promise<Record<string, { audioUrl: string; posterUrl: string }>> {
  const folderId = await createFolder(folderName);
  const result: Record<string, { audioUrl: string; posterUrl: string }> = {};

  for (const show of shows) {
    const { url: audioUrl } = await uploadFile(show.trimmedFile, folderId);
    onProgress?.(show.name, 'audio', audioUrl);

    let posterDriveUrl = '';
    if (show.posterUrl) {
      const { url } = await uploadFromUrl(
        show.posterUrl,
        `${show.name}_poster.jpg`,
        'image/jpeg',
        folderId,
      );
      posterDriveUrl = url;
      onProgress?.(show.name, 'poster', url);
    }

    result[show.name] = { audioUrl, posterUrl: posterDriveUrl };
  }

  return result;
}
