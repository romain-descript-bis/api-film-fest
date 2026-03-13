import { Router, Request, Response } from 'express';
import { downloadAudio } from '../services/ytdlp.js';
import { trim } from '../services/ffmpeg.js';
import { isAuthenticated, uploadAllMedia } from '../services/gdrive.js';
import fs from 'fs';
import path from 'path';

const router = Router();

interface ShowSelection {
  id: number;
  name: string;
  year: number;
  posterUrl: string;
  youtubeVideoId: string;
  youtubeTitle: string;
  startSeconds: number;
}

interface ComposeRequest {
  decades: string[];
  shows: ShowSelection[];
}

const AVATAR_INTROS = [
  "Hey there, fellow TV lovers! Welcome to the ultimate opening theme blind test! I'm going to play you 15 seconds of a classic TV show opening — and your job is to guess which show it's from. Ready to test your knowledge?",
  "Welcome, TV fanatics! Get your guessing hats on — it's time for the opening theme blind test! I'll play a snippet, and you call out the show. Let's see who really knows their classics!",
  "Greetings, binge-watchers! Think you know your TV themes? Let's find out! I'll play 15 seconds of classic opening music — buzz in when you know the answer!",
];

const AVATAR_OUTROS = [
  "And that's a wrap! How did you do? Whether you aced it or got stumped, these classic themes are pure gold. Thanks for playing, and keep watching great TV!",
  "That's all the themes for today! Hope you had a blast — and maybe discovered some shows you need to add to your watch list. See you next time!",
  "Game over! I hope you impressed your friends with your TV knowledge. Don't forget — the best part of these shows is watching them. Happy streaming!",
];

const FUNNY_WORDS = [
  'GroovyBanana', 'WackyNoodle', 'ChaosPickle', 'FunkyMoose',
  'ZanyPenguin', 'CosmicTaco', 'SpookyLlama', 'NeonCactus',
  'TurboFlamingo', 'BogusNarwhal', 'RadWombat', 'MysticSloth',
  'GalacticOtter', 'SpicyBadger', 'CoolMarmot', 'SwiftYak',
  'GoldenHedgehog', 'SneakyWaffle', 'MightyPorpoise', 'CrispyDinosaur',
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildProjectName(decades: string[]): string {
  return `Blind Tests ${decades.join(' ')} ${pickRandom(FUNNY_WORDS)}`;
}

function buildAvatarScript(decades: string[]) {
  const decadeStr = decades.join(' and ');
  const intro = pickRandom(AVATAR_INTROS).replace('classic', `classic ${decadeStr}`);
  const outro = pickRandom(AVATAR_OUTROS);
  return { intro, outro };
}

// POST /api/compose
router.post('/', async (req: Request, res: Response) => {
  const body = req.body as ComposeRequest;

  if (!body.shows || !Array.isArray(body.shows) || body.shows.length === 0) {
    res.status(400).json({ error: 'shows array required' });
    return;
  }

  console.log(`[compose] starting — ${body.shows.length} shows, decades: ${body.decades.join(', ')}`);

  try {
    // Download and trim all audio clips
    const processed = await Promise.all(
      body.shows.map(async show => {
        console.log(`[compose] downloading: "${show.name}" (${show.youtubeVideoId})`);
        const audioFile = await downloadAudio(show.youtubeVideoId);
        console.log(`[compose] trimming: "${show.name}" at ${show.startSeconds}s`);
        const trimmedFile = await trim(audioFile, show.startSeconds);
        console.log(`[compose] ready: "${show.name}" → ${trimmedFile}`);
        return { ...show, audioFile, trimmedFile };
      })
    );

    const projectName = buildProjectName(body.decades);

    // Upload audio + poster images to Google Drive
    let driveMedia: Record<string, { audioUrl: string; posterUrl: string }> = {};
    if (isAuthenticated()) {
      console.log(`[compose] uploading to Google Drive — folder: "${projectName}"`);
      driveMedia = await uploadAllMedia(
        processed.map(p => ({ name: p.name, trimmedFile: p.trimmedFile, posterUrl: p.posterUrl })),
        projectName,
        (name, type, url) => console.log(`[compose] uploaded "${name}" (${type}) → ${url}`),
      );
      console.log(`[compose] Drive upload done — ${Object.keys(driveMedia).length} shows`);
    } else {
      console.log('[compose] skipping Drive upload (not authenticated)');
    }

    const manifest = {
      projectName,
      decades: body.decades,
      createdAt: new Date().toISOString(),
      shows: processed.map(p => ({
        ...p,
        driveUrl: driveMedia[p.name]?.audioUrl ?? null,
        drivePosterUrl: driveMedia[p.name]?.posterUrl ?? null,
      })),
      avatarScript: buildAvatarScript(body.decades),
    };

    const manifestPath = path.join(process.cwd(), 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`[compose] manifest written → ${manifestPath}`);

    res.json({ manifestPath, manifest, driveUploaded: Object.keys(driveMedia).length > 0 });
  } catch (err: any) {
    console.error(`[compose] error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
