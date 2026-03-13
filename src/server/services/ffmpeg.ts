import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const BIN = path.join(process.cwd(), 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

export async function trim(inputPath: string, startSeconds: number, durationSeconds = 15): Promise<string> {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(dir, `${base}_trim_${startSeconds}.mp3`);

  if (fs.existsSync(outputPath)) return outputPath;

  const fadeOut = durationSeconds - 3;
  await execFileAsync(BIN, [
    '-y',
    '-ss', String(startSeconds),
    '-t', String(durationSeconds),
    '-i', inputPath,
    '-af', `afade=t=in:st=0:d=3,afade=t=out:st=${fadeOut}:d=3`,
    '-acodec', 'libmp3lame',
    '-q:a', '5',
    outputPath,
  ]);

  return outputPath;
}
