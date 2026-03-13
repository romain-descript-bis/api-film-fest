import { Router, Request, Response } from 'express';
import { searchYoutube, downloadAudio } from '../services/ytdlp.js';
import { trim } from '../services/ffmpeg.js';
import fs from 'fs';
import path from 'path';

const router = Router();

// SSE: search YouTube for each show in the list
// GET /api/music/search?shows=ShowName1|id1,ShowName2|id2,...
router.get('/search', async (req: Request, res: Response) => {
  const showsParam = req.query.shows as string;
  if (!showsParam) {
    res.status(400).json({ error: 'shows param required (name|id,name|id,...)' });
    return;
  }

  // Parse "name|id" pairs
  const shows = showsParam.split(',').map(s => {
    const [name, id] = s.split('|');
    return { name: decodeURIComponent(name), id };
  });

  console.log(`[music/search] SSE open — searching ${shows.length} shows`);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  for (const show of shows) {
    try {
      console.log(`[music/search] searching: "${show.name}"`);
      const results = await searchYoutube(`${show.name} opening theme song`, 3);
      console.log(`[music/search] "${show.name}" → ${results.length} results`);
      send({ showId: show.id, results });
    } catch (err: any) {
      console.error(`[music/search] "${show.name}" error: ${err.message}`);
      send({ showId: show.id, error: err.message, results: [] });
    }
  }

  console.log('[music/search] SSE done');
  send({ done: true });
  res.end();
});

// POST /api/music/trim
// Body: { videoId, startSeconds }
// Downloads full audio (if needed) then trims to 15s
router.post('/trim', async (req: Request, res: Response) => {
  const { videoId, startSeconds } = req.body as { videoId: string; startSeconds: number };
  if (!videoId || startSeconds === undefined) {
    res.status(400).json({ error: 'videoId and startSeconds required' });
    return;
  }

  try {
    console.log(`[music/trim] videoId=${videoId} start=${startSeconds}s`);
    const audioFile = await downloadAudio(videoId);
    const trimmedFile = await trim(audioFile, Number(startSeconds));
    console.log(`[music/trim] done → ${trimmedFile}`);
    res.json({ filePath: trimmedFile, audioFile });
  } catch (err: any) {
    console.error(`[music/trim] error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/music/preview?videoId=X&startSeconds=Y
// Streams a trimmed 15s clip
router.get('/preview', async (req: Request, res: Response) => {
  const videoId = req.query.videoId as string;
  const startSeconds = Number(req.query.startSeconds ?? 0);

  if (!videoId) {
    res.status(400).json({ error: 'videoId required' });
    return;
  }

  try {
    console.log(`[music/preview] videoId=${videoId} start=${startSeconds}s`);
    const audioFile = await downloadAudio(videoId);
    const trimmedFile = await trim(audioFile, startSeconds);

    const stat = fs.statSync(trimmedFile);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(trimmedFile).pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
