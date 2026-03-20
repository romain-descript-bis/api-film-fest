import { Router, Request, Response } from 'express';
import { importMedia, agentEdit, pollJob } from '../services/descript-api.js';
import fs from 'fs';
import path from 'path';

const router = Router();

// ── Prompt helpers ────────────────────────────────────────────────────────────

function buildDecadeStyle(decades: string[]): string {
  const styles: Record<string, string> = {
    '50s': 'a single 1950s radio DJ in a broadcast booth, pompadour hair, short-sleeve shirt and tie, vintage tube radio equipment, rotary dials, black-and-white era decor',
    '60s': 'a single 1960s radio DJ in a broadcast booth, mod turtleneck, reel-to-reel tape machine, psychedelic posters on the wall, vintage condenser microphone',
    '70s': 'a single 1970s radio DJ in a broadcast booth, wide lapels and sideburns, wood-panel mixing console, lava lamp on the desk, warm amber studio lighting',
    '80s': 'a single 1980s radio DJ in a broadcast booth, big hair and neon jacket, digital mixing board with blinking LED meters, cassette tapes stacked on the desk',
    '90s': 'a single 1990s radio DJ in a broadcast booth, flannel shirt, chunky headphones, CD stacks and a boxy CRT monitor, grunge posters on the wall',
    '00s': 'a single 2000s radio DJ in a broadcast booth, fitted hoodie, flat-screen monitor, early digital DJ software on screen, iPod docking station on the desk',
    '10s': 'a single 2010s radio DJ in a broadcast booth, slim-fit shirt, large touch-screen mixing interface, streaming indicators on screen, sleek modern studio design',
  };
  const found = decades.map(d => styles[d]).filter(Boolean);
  const base = found.length ? found[0] : styles['70s'];
  // For multiple decades blend the key visual elements
  if (found.length > 1) {
    const elements = found.map(s => s.split(',').slice(1).join(',').trim());
    return `${found[0].split(',')[0]}, radio station broadcast booth with mixed-era props: ${elements.join('; ')}`;
  }
  return `${base}, photorealistic, no other people in the frame`;
}

function buildDescriptPrompt(manifest: any, decades: string, decadeStyle: string): string {
  const shows: Array<{ name: string; year: number }> = manifest.shows;
  const intro: string = manifest.avatarScript.intro;
  const outro: string = manifest.avatarScript.outro;
  const projectName: string = manifest.projectName;

  const rounds = shows.map((show, i) => `
ROUND ${i + 1} — QUESTION SCENE (10 seconds):
- Black background (#0a0a0f)
- Single line of text centered both horizontally and vertically: "🎵 Which TV show is this?" — large bold white font, nothing else on screen
- Play the imported audio clip named "${show.name}"
- Smooth fade-in transition at the start

ROUND ${i + 1} — REVEAL SCENE (5 seconds, music CONTINUES from question scene):
- Display ONLY the imported image named "${show.name}_poster" — fill the entire frame, no text, no overlays, no captions whatsoever
- The "${show.name}" audio continues seamlessly from the question scene
- Crossfade transition from the question scene`).join('\n');

  return `Edit the existing composition in this project — do NOT create a new one. There is already one empty composition; populate it with the following EXACT structure. The composition should be called "${projectName}".

CRITICAL: Use ONLY the imported media assets listed below. Do NOT use any generic stock assets, placeholder images, or clip art for the show audio or show images.

Imported media available:
${shows.map(s => `- Audio: "${s.name}" (the opening theme clip)\n- Image: "${s.name}_poster" (the show poster)`).join('\n')}

═══ OPENING + INTRO SCENE (single scene) ═══
Generate an AI image of: ${decadeStyle} — use it as the full-frame background throughout.
- Fade in from black over the first 0.3s
- PHASE 1 (0s → 1.5s): "📺 TV BLIND TEST" in large bold white, centered horizontally and vertically. Fades out fully by 1.5s — must be completely gone before phase 2 begins.
- PHASE 2 (1.5s → 6.5s): "Can you guess that opening theme?" and "${decades} Edition" as two lines of medium white text, centered. Appears at exactly 1.5s, fades out by 6.5s.
- At exactly 2.5s: AI avatar (friendly, energetic host) appears overlaid on the DJ image and begins speaking this script: "${intro}"
- The avatar speech overlaps with phase 2 text — this is intentional.
- NO background boxes behind any text — text shadow only. DO NOT show phase 1 and phase 2 text simultaneously.

${rounds}

═══ OUTRO SCENE ═══
- Background: the AI-generated DJ image from the opening scene (reuse it, filling the frame, NO text overlays, NO boxes)
- AI avatar (same host as intro) overlaid on the DJ image background
- 1.5 second silent pause before the avatar starts speaking
- Avatar speaks this script: "${outro}"

═══ CLOSING SCENE (5 seconds) ═══
- Same AI-generated DJ image as the opening/intro scene (reuse it)
- Overlay text: "Thanks for playing!" in large bold white
- Fade out to black

═══ GLOBAL STYLE ═══
- Background color throughout: #0a0a0f (near black)
- Primary text color: white (#ffffff)
- Font: bold, clean, modern sans-serif
- All scene transitions: smooth crossfade (0.5s)
- Audio in each round: play continuously from the question scene through the reveal
- NEVER use any asset that was not explicitly imported — no generic images, no stock media`;
}

// SSE helper
function makeSend(res: Response) {
  return (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// POST /api/descript-compose  (SSE)
// Body (optional): { projectId?: string, mediaImported?: boolean }
router.post('/', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = makeSend(res);

  const manifestPath = path.join(process.cwd(), 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    send({ type: 'error', message: 'manifest.json not found — run compose first' });
    res.end();
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { projectId: resumeProjectId, mediaImported: resumeMediaImported, apiKey } = req.body ?? {};

  const decades = manifest.decades.join(', ');
  const decadeStyle = buildDecadeStyle(manifest.decades);
  const projectName: string = manifest.projectName;
  const prompt = buildDescriptPrompt(manifest, decades, decadeStyle);

  const addMedia: Record<string, { url: string }> = {};
  for (const show of manifest.shows) {
    if (show.driveUrl) addMedia[show.name] = { url: show.driveUrl };
    if (show.drivePosterUrl) addMedia[`${show.name}_poster`] = { url: show.drivePosterUrl };
  }
  const totalAssets = Object.keys(addMedia).length;

  try {
    let projectId: string = resumeProjectId ?? '';
    let projectUrl = '';

    // ── Step 1: Create empty project ─────────────────────────────────────────
    if (projectId) {
      send({ type: 'step_skip', id: 'create' });
      console.log(`[descript-compose] skipping project creation — resuming ${projectId}`);
    } else {
      send({ type: 'step', id: 'create', label: 'Creating Descript project…' });
      console.log(`[descript-compose] creating project "${projectName}"`);
      const r = await importMedia({ projectName, addMedia: {}, apiKey });
      projectId = r.projectId;
      projectUrl = r.projectUrl;
      await pollJob(r.jobId, label => send({ type: 'progress', label }), 3000, apiKey);
      send({ type: 'step_done', id: 'create' });
      send({ type: 'project_created', projectId, projectUrl });
      console.log(`[descript-compose] project created — ${projectId}`);
    }

    // ── Step 2: Import all media ──────────────────────────────────────────────
    if (resumeMediaImported) {
      send({ type: 'step_skip', id: 'import' });
      console.log(`[descript-compose] skipping media import — already done`);
    } else {
      send({ type: 'step', id: 'import', label: `Importing ${totalAssets} assets (audio + posters)…` });
      console.log(`[descript-compose] importing assets into ${projectId}`);
      const r = await importMedia({ projectId, addMedia, apiKey });
      projectUrl = r.projectUrl;
      const importJob = await pollJob(r.jobId, label => send({ type: 'progress', label }), 3000, apiKey);
      send({ type: 'step_done', id: 'import' });
      send({ type: 'media_imported' });
      console.log(`[descript-compose] import done`);
    }

    // ── Step 3: Compose with agent ────────────────────────────────────────────
    send({ type: 'step', id: 'compose', label: 'Composing blind test video with AI…' });
    console.log(`[descript-compose] running agent on ${projectId}`);
    const { jobId: composeJobId, projectUrl: agentUrl } = await agentEdit({ projectId, prompt, apiKey });
    projectUrl = agentUrl || projectUrl;
    const composeJob = await pollJob(composeJobId, label => send({ type: 'progress', label }), 4000, apiKey);
    send({ type: 'step_done', id: 'compose' });
    console.log(`[descript-compose] agent done — ${composeJob.result?.agent_response?.slice(0, 80)}…`);

    send({ type: 'done', projectUrl });
    console.log(`[descript-compose] complete → ${projectUrl}`);

  } catch (err: any) {
    console.error(`[descript-compose] error: ${err.message}`);
    send({ type: 'error', message: err.message });
  }

  res.end();
});

export default router;
