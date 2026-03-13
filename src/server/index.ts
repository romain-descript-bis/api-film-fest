import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import livereload from 'livereload';
import connectLivereload from 'connect-livereload';
import showsRouter from './routes/shows.js';
import musicRouter from './routes/music.js';
import composeRouter from './routes/compose.js';
import driveRouter from './routes/drive.js';
import descriptComposeRouter from './routes/descript-compose.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

// Live reload in dev (watches src/client/ for HTML/CSS/JS changes)
if (process.env.NODE_ENV !== 'production') {
  const lrServer = livereload.createServer();
  lrServer.watch(path.join(__dirname, '../../src/client'));
  app.use(connectLivereload());
}

// Skip morgan for SSE endpoints — they'd log only when the connection closes
app.use(morgan('dev', {
  skip: (req) => req.path === '/api/music/search',
}));

app.use(express.json());

// Static files from client directory
const clientDir = path.join(__dirname, '../../src/client');
app.use(express.static(clientDir));

// API routes
app.use('/api/shows', showsRouter);
app.use('/api/music', musicRouter);
app.use('/api/compose', composeRouter);
app.use('/api/drive', driveRouter);
app.use('/api/descript-compose', descriptComposeRouter);

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎬 TV Blind Test running at http://localhost:${PORT}\n`);
});
