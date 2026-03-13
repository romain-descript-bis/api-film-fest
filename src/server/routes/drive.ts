import { Router } from 'express';
import { getAuthUrl, handleCallback, isAuthenticated } from '../services/gdrive.js';

const router = Router();

const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/api/drive/callback';

router.get('/status', (_req, res) => {
  res.json({ authed: isAuthenticated() });
});

router.get('/auth', (_req, res) => {
  res.redirect(getAuthUrl(REDIRECT_URI));
});

router.get('/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send('Missing OAuth code');
    return;
  }
  try {
    await handleCallback(code, REDIRECT_URI);
    // Close the popup and notify the opener
    res.send(`<!DOCTYPE html>
<html>
<head><title>Connected!</title>
<style>
  body { font-family: system-ui; background: #0a0a0f; color: #e8e8f0;
         display: flex; align-items: center; justify-content: center;
         height: 100vh; margin: 0; flex-direction: column; gap: 1rem; }
  h2 { color: #69f0ae; }
</style>
</head>
<body>
  <h2>✓ Google Drive connected!</h2>
  <p>You can close this window.</p>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'drive-authed' }, '*');
      setTimeout(() => window.close(), 1000);
    }
  </script>
</body>
</html>`);
  } catch (err: any) {
    res.status(500).send(`OAuth error: ${err.message}`);
  }
});

export default router;
