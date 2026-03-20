import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const BIN = path.join(process.cwd(), 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const DENO_BIN = path.join(process.cwd(), 'bin', process.platform === 'win32' ? 'deno.exe' : 'deno');

// Point yt-dlp at our bundled deno via explicit flag (env var no longer sufficient in newer yt-dlp)
const JS_RUNTIME_FLAG = fs.existsSync(DENO_BIN) ? [`--js-runtimes`, `deno:${DENO_BIN}`] : [];

export interface YtSearchResult {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: number; // seconds
  url: string;
}

export async function searchYoutube(query: string, maxResults = 3): Promise<YtSearchResult[]> {
  const searchUrl = `ytsearch${maxResults}:${query}`;
  const { stdout } = await execFileAsync(BIN, [
    ...JS_RUNTIME_FLAG,
    '--dump-json',
    '--no-download',
    '--flat-playlist',
    searchUrl,
  ], { maxBuffer: 10 * 1024 * 1024 });

  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        const d = JSON.parse(line);
        return {
          videoId: d.id,
          title: d.title,
          thumbnail: d.thumbnail ?? `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
          duration: d.duration ?? 0,
          url: d.url ?? `https://www.youtube.com/watch?v=${d.id}`,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as YtSearchResult[];
}

export async function downloadAudio(videoId: string): Promise<string> {
  const downloadsDir = path.join(process.cwd(), 'downloads');
  fs.mkdirSync(downloadsDir, { recursive: true });

  const outputPath = path.join(downloadsDir, `${videoId}.mp3`);

  // Already downloaded
  if (fs.existsSync(outputPath)) return outputPath;

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  await execFileAsync(BIN, [
    ...JS_RUNTIME_FLAG,
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '5',
    '-o', outputPath,
    '--no-playlist',
    url,
  ], { maxBuffer: 50 * 1024 * 1024 });

  return outputPath;
}
