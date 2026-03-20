// ── Cookie persistence ───────────────────────────────────────────────────────
// Stores ~2KB of compact state so a page refresh lands back where you left off.

const COOKIE_NAME = 'tvblindtest';
const COOKIE_DAYS = 7;

function saveCookie() {
  const music = {};
  state.musicState.forEach((ms, showId) => {
    const r = ms.results[ms.selected];
    if (!r) return;
    music[showId] = {
      vid: r.videoId,
      vt: r.title,
      th: r.thumbnail,
      dur: r.duration,
      ss: ms.startSeconds,
      val: ms.validated,
    };
  });

  const payload = {
    v: state.currentView,
    d: [...state.selectedDecades],
    s: state.selectedShows.map(s => ({
      id: s.id,
      n: s.name,
      p: s.posterUrl,
      y: s.firstAirDate,
    })),
    m: music,
    pu: state.projectUrl,
    dpid: state.descriptProjectId,
    dmi: state.descriptMediaImported,
    dak: state.descriptApiKey || undefined,
  };

  const encoded = encodeURIComponent(JSON.stringify(payload));
  const expires = new Date(Date.now() + COOKIE_DAYS * 864e5).toUTCString();
  document.cookie = `${COOKIE_NAME}=${encoded}; expires=${expires}; path=/; SameSite=Lax`;
}

function loadCookie() {
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function clearCookie() {
  document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
}

// ── State ───────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;

const state = {
  currentView: 'view-decades',
  selectedDecades: new Set(),
  shows: [],           // All shows from TMDB (sorted by popularity desc)
  showsPage: 1,        // How many pages of PAGE_SIZE are visible
  selectedShows: [],   // Up to 10 selected shows
  /** @type {Map<string, {results: any[], selected: number, startSeconds: number, validated: boolean}>} */
  musicState: new Map(),
  projectUrl: null,          // Descript project URL after composition completes
  descriptProjectId: null,   // Set after step 1 — allows resuming from step 2
  descriptMediaImported: false, // Set after step 2 — allows resuming from step 3
  descriptApiKey: '',        // Optional override — entered on the decades page
};

// ── View Router ─────────────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  state.currentView = id;
  saveCookie();
}

// ── View 1: Decades ──────────────────────────────────────────────────────────
document.querySelectorAll('.decade-card').forEach(card => {
  card.addEventListener('click', () => {
    const d = card.dataset.decade;
    if (state.selectedDecades.has(d)) {
      state.selectedDecades.delete(d);
      card.classList.remove('selected');
    } else {
      state.selectedDecades.add(d);
      card.classList.add('selected');
    }
    document.getElementById('btn-goto-shows').disabled = state.selectedDecades.size === 0;
    saveCookie();
  });
});

document.getElementById('descript-api-key').addEventListener('input', (e) => {
  state.descriptApiKey = e.target.value.trim();
  saveCookie();
});

document.getElementById('btn-goto-shows').addEventListener('click', () => {
  showView('view-shows');
  loadShows();
});

// ── View 2: Shows ────────────────────────────────────────────────────────────
document.getElementById('btn-back-decades').addEventListener('click', () => showView('view-decades'));

async function loadShows() {
  const grid = document.getElementById('show-grid');
  const loading = document.getElementById('shows-loading');
  grid.innerHTML = '';
  state.showsPage = 1;
  document.getElementById('shows-search').value = '';
  loading.classList.remove('hidden');

  try {
    const decades = [...state.selectedDecades].join(',');
    const res = await fetch(`/api/shows?decades=${encodeURIComponent(decades)}`);
    if (!res.ok) throw new Error(await res.text());
    // Already sorted by popularity desc from TMDB
    state.shows = await res.json();
    renderShowGrid();
  } catch (err) {
    grid.innerHTML = `<p style="color:var(--red)">Error: ${err.message}</p>`;
  } finally {
    loading.classList.add('hidden');
  }
}

function filteredShows() {
  const q = document.getElementById('shows-search')?.value.trim().toLowerCase() ?? '';
  if (!q) return state.shows;
  return state.shows.filter(s => s.name.toLowerCase().includes(q));
}

function renderShowGrid() {
  const grid = document.getElementById('show-grid');
  grid.innerHTML = '';

  const filtered = filteredShows();
  const visible = filtered.slice(0, state.showsPage * PAGE_SIZE);
  const hasMore = filtered.length > visible.length;

  visible.forEach(show => {
    grid.appendChild(makeShowCard(show));
  });

  document.getElementById('btn-load-more').classList.toggle('hidden', !hasMore);
  updateShowCounter();
}

function makeShowCard(show) {
  const card = document.createElement('div');
  card.className = 'show-card';
  card.dataset.id = show.id;

  const year = show.firstAirDate ? show.firstAirDate.slice(0, 4) : '';

  card.innerHTML = show.posterUrl
    ? `<img class="show-poster" src="${show.posterUrl}" alt="${escHtml(show.name)}" loading="lazy">`
    : `<div class="show-poster-placeholder">🎬</div>`;

  card.innerHTML += `
    <div class="show-info">
      <div class="show-name" title="${escHtml(show.name)}">${escHtml(show.name)}</div>
      <div class="show-year">${year}</div>
    </div>`;

  if (state.selectedShows.find(s => s.id === show.id)) {
    card.classList.add('selected');
  }

  card.addEventListener('click', () => toggleShowSelection(show, card));
  return card;
}

document.getElementById('btn-load-more').addEventListener('click', () => {
  state.showsPage++;
  const grid = document.getElementById('show-grid');
  const filtered = filteredShows();
  const start = (state.showsPage - 1) * PAGE_SIZE;
  const end = state.showsPage * PAGE_SIZE;
  filtered.slice(start, end).forEach(show => grid.appendChild(makeShowCard(show)));
  const hasMore = filtered.length > state.showsPage * PAGE_SIZE;
  document.getElementById('btn-load-more').classList.toggle('hidden', !hasMore);
});

document.getElementById('shows-search').addEventListener('input', () => {
  state.showsPage = 1;
  renderShowGrid();
});

function toggleShowSelection(show, card) {
  const idx = state.selectedShows.findIndex(s => s.id === show.id);
  if (idx >= 0) {
    state.selectedShows.splice(idx, 1);
    card.classList.remove('selected');
  } else {
    if (state.selectedShows.length >= 10) return;
    state.selectedShows.push(show);
    card.classList.add('selected');
  }
  updateShowCounter();
  saveCookie();
}

function updateShowCounter() {
  const n = state.selectedShows.length;

  document.getElementById('selection-num').textContent = n;
  document.querySelector('.selection-label').textContent = n === 1 ? 'show selected' : 'shows selected';
  document.querySelector('.selection-max').textContent = n >= 10 ? '— max reached' : '(up to 10)';
  document.getElementById('btn-clear-shows').classList.toggle('hidden', n === 0);

  // Pills — one per selected show
  const pillContainer = document.getElementById('selection-pills');
  pillContainer.innerHTML = '';
  state.selectedShows.forEach(show => {
    const pill = document.createElement('span');
    pill.className = 'selection-pill';
    pill.innerHTML = `${escHtml(show.name)} <span class="pill-x">✕</span>`;
    pill.addEventListener('click', () => {
      const card = document.querySelector(`.show-card[data-id="${show.id}"]`);
      toggleShowSelection(show, card ?? { classList: { remove: () => {}, add: () => {} } });
    });
    pillContainer.appendChild(pill);
  });

  document.getElementById('btn-goto-music').disabled = n < 1;
}

document.getElementById('btn-clear-shows').addEventListener('click', () => {
  state.selectedShows = [];
  document.querySelectorAll('.show-card.selected').forEach(c => c.classList.remove('selected'));
  updateShowCounter();
  saveCookie();
});

document.getElementById('btn-goto-music').addEventListener('click', () => {
  showView('view-music');
  startMusicSearch();
});

// ── View 3: Music Search ─────────────────────────────────────────────────────
document.getElementById('btn-back-shows').addEventListener('click', () => showView('view-shows'));

function startMusicSearch() {
  const grid = document.getElementById('music-grid');
  grid.innerHTML = '';
  state.musicState.clear();

  // Initialize music state for each show
  state.selectedShows.forEach(show => {
    state.musicState.set(String(show.id), {
      results: [],
      selected: 0,
      startSeconds: 0,
      validated: false,
    });
  });

  // Render skeleton cards
  state.selectedShows.forEach(show => renderMusicCard(show));

  // Open SSE stream
  const showsParam = state.selectedShows
    .map(s => `${encodeURIComponent(s.name)}|${s.id}`)
    .join(',');

  const es = new EventSource(`/api/music/search?shows=${encodeURIComponent(showsParam)}`);

  es.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.done) {
      es.close();
      document.getElementById('music-subtitle').textContent = 'Select a 15s section for each show, then accept.';
      return;
    }

    const ms = state.musicState.get(String(data.showId));
    if (ms) {
      ms.results = data.results || [];
      const show = state.selectedShows.find(s => String(s.id) === String(data.showId));
      if (show) updateMusicCard(show);
    }
  };

  es.onerror = () => es.close();
}

/** Restore music view from saved state without re-running the SSE search. */
function restoreMusicView() {
  const grid = document.getElementById('music-grid');
  grid.innerHTML = '';

  state.selectedShows.forEach(show => {
    renderMusicCard(show);
    const ms = state.musicState.get(String(show.id));
    if (ms && ms.results.length) {
      updateMusicCard(show);
    }
  });

  const allValidated = [...state.musicState.values()].every(ms => ms.validated);
  document.getElementById('music-subtitle').textContent = allValidated
    ? 'All tracks accepted — ready to compose!'
    : 'Select a 15s section for each show, then accept.';
  document.getElementById('btn-goto-compose').disabled = !allValidated;
}

function renderMusicCard(show) {
  const grid = document.getElementById('music-grid');
  const year = show.firstAirDate ? show.firstAirDate.slice(0, 4) : '';

  const card = document.createElement('div');
  card.className = 'music-card';
  card.id = `music-card-${show.id}`;

  card.innerHTML = `
    <div class="music-card-header">
      ${show.posterUrl
        ? `<img class="music-card-poster" src="${show.posterUrl}" alt="">`
        : `<div class="music-card-poster" style="display:flex;align-items:center;justify-content:center;background:var(--surface2);font-size:1.5rem">🎬</div>`}
      <div class="music-card-title">
        <h4>${escHtml(show.name)}</h4>
        <span>${year}</span>
      </div>
    </div>
    <div class="loading-row" id="music-loading-${show.id}">
      <div class="spinner"></div>
      <span>Searching YouTube…</span>
    </div>
    <div class="result-body hidden" id="music-result-${show.id}"></div>`;

  grid.appendChild(card);
}

function updateMusicCard(show) {
  const ms = state.musicState.get(String(show.id));
  if (!ms) return;

  const loadingEl = document.getElementById(`music-loading-${show.id}`);
  const resultEl = document.getElementById(`music-result-${show.id}`);

  if (loadingEl) loadingEl.classList.add('hidden');
  if (!resultEl) return;
  resultEl.classList.remove('hidden');

  if (!ms.results.length) {
    resultEl.innerHTML = `<p style="color:var(--muted);font-size:0.85rem">No results found.</p>`;
    return;
  }

  const result = ms.results[ms.selected] || ms.results[0];

  const card = document.getElementById(`music-card-${show.id}`);
  if (card) card.classList.toggle('validated', ms.validated);

  resultEl.innerHTML = `
    <div class="result-tabs" id="tabs-${show.id}">
      ${ms.results.map((r, i) => `
        <button class="result-tab ${i === ms.selected ? 'active' : ''}" data-idx="${i}" data-showid="${show.id}">
          ${escHtml(r.title.slice(0, 40))}${r.title.length > 40 ? '…' : ''}
        </button>`).join('')}
    </div>
    <img class="yt-thumbnail" src="${result.thumbnail}" alt="" onerror="this.style.display='none'">
    <div class="section-selector" id="section-${show.id}">
      <label>
        <span>Start at: <strong id="start-label-${show.id}">${ms.startSeconds.toFixed(1)}s</strong></span>
        <span>Duration: 15s clip</span>
      </label>
      <input type="range" id="start-range-${show.id}" min="0" max="${Math.max(0, (result.duration || 180) - 15)}" value="${ms.startSeconds}" step="0.1">
    </div>
    <audio controls id="audio-${show.id}" src="/api/music/preview?videoId=${encodeURIComponent(result.videoId)}&startSeconds=${ms.startSeconds}"></audio>
    <div class="card-actions">
      <button class="btn btn-icon btn-accept ${ms.validated ? 'active' : ''}" id="btn-accept-${show.id}" data-showid="${show.id}">
        ${ms.validated ? '✓ Accepted' : '✓ Accept'}
      </button>
      <span class="status-chip ${ms.validated ? 'ok' : 'pending'}">
        ${ms.validated ? 'Ready' : 'Pending'}
      </span>
    </div>`;

  // Tab switching
  resultEl.querySelectorAll('.result-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      ms.selected = Number(btn.dataset.idx);
      ms.validated = false;
      updateMusicCard(show);
      saveCookie();
    });
  });

  // Range slider
  const range = document.getElementById(`start-range-${show.id}`);
  const label = document.getElementById(`start-label-${show.id}`);
  const audio = document.getElementById(`audio-${show.id}`);

  range.addEventListener('input', () => {
    ms.startSeconds = Number(range.value);
    label.textContent = `${ms.startSeconds.toFixed(1)}s`;
  });

  range.addEventListener('change', () => {
    const r = ms.results[ms.selected];
    if (!r) return;
    audio.src = `/api/music/preview?videoId=${encodeURIComponent(r.videoId)}&startSeconds=${ms.startSeconds}`;
    ms.validated = false;
    document.getElementById(`btn-accept-${show.id}`).classList.remove('active');
    document.getElementById(`btn-accept-${show.id}`).textContent = '✓ Accept';
    saveCookie();
  });

  // Accept button
  document.getElementById(`btn-accept-${show.id}`).addEventListener('click', () => {
    ms.validated = !ms.validated;
    updateMusicCard(show);
    updateComposeButton();
    saveCookie();
  });

  updateComposeButton();
}

function updateComposeButton() {
  const allValidated = [...state.musicState.values()].every(ms => ms.validated);
  document.getElementById('btn-goto-compose').disabled = !allValidated;
}

// ── View 4: Compose ───────────────────────────────────────────────────────────
document.getElementById('btn-goto-compose').addEventListener('click', () => {
  showView('view-compose');
  initComposeView();
});

document.getElementById('btn-restart-composition').addEventListener('click', () => {
  document.getElementById('btn-restart-composition').classList.add('hidden');
  document.getElementById('progress-list').innerHTML = '';
  initComposeView();
});

async function initComposeView() {
  const list = document.getElementById('progress-list');
  list.innerHTML = '';
  document.getElementById('btn-restart-composition').classList.add('hidden');

  // Check Drive auth status first
  const { authed } = await fetch('/api/drive/status').then(r => r.json());

  if (!authed) {
    const li = document.createElement('li');
    li.className = 'progress-item active';
    li.id = 'step-drive-auth';
    li.innerHTML = `
      <span class="step-icon">🔑</span>
      <span>Connect Google Drive to upload audio clips</span>
      <button class="btn btn-primary" id="btn-drive-auth" style="margin-left:auto;padding:0.4rem 1rem;font-size:0.85rem">
        Connect Drive
      </button>`;
    list.appendChild(li);

    document.getElementById('btn-drive-auth').addEventListener('click', () => {
      const popup = window.open('/api/drive/auth', 'driveAuth', 'width=520,height=640');

      // Guard so only the first signal (postMessage OR poll) triggers startCompose
      let triggered = false;
      const proceed = () => {
        if (triggered) return;
        triggered = true;
        clearInterval(poll);
        window.removeEventListener('message', onMsg);
        popup?.close();
        li.className = 'progress-item done';
        li.innerHTML = `<span class="step-icon">✓</span><span>Google Drive connected</span>`;
        startCompose();
      };

      const onMsg = (e) => { if (e.data?.type === 'drive-authed') proceed(); };
      window.addEventListener('message', onMsg);

      // Fallback poll in case popup was blocked or postMessage didn't fire
      const poll = setInterval(async () => {
        const { authed } = await fetch('/api/drive/status').then(r => r.json());
        if (authed) proceed();
      }, 2000);
    });
  } else {
    const li = document.createElement('li');
    li.className = 'progress-item done';
    li.innerHTML = `<span class="step-icon">✓</span><span>Google Drive connected</span>`;
    list.appendChild(li);
    startCompose();
  }
}

async function startCompose() {
  const list = document.getElementById('progress-list');
  // Preserve the Drive auth step that initComposeView already added, clear the rest
  const driveStep = document.getElementById('step-drive-auth');
  list.innerHTML = '';
  if (driveStep) list.appendChild(driveStep);

  const steps = [
    { id: 'prep', label: 'Preparing audio clips…' },
    ...state.selectedShows.map(s => ({ id: `clip-${s.id}`, label: `Downloading & trimming: ${s.name}` })),
    { id: 'drive', label: 'Uploading clips to Google Drive…' },
    { id: 'manifest', label: 'Writing manifest.json…' },
    { id: 'descript', label: 'Composing via Descript API…' },
  ];

  steps.forEach(step => {
    const li = document.createElement('li');
    li.className = 'progress-item';
    li.id = `step-${step.id}`;
    li.innerHTML = `<span class="step-icon">⏳</span><span>${escHtml(step.label)}</span>`;
    list.appendChild(li);
  });

  const setStep = (id, stepState) => {
    const el = document.getElementById(`step-${id}`);
    if (!el) return;
    el.className = `progress-item ${stepState}`;
    el.querySelector('.step-icon').textContent =
      stepState === 'done' ? '✓' : stepState === 'error' ? '✗' : stepState === 'active' ? '▶' : '⏳';
  };

  setStep('prep', 'active');

  // Build the compose payload
  const payload = {
    decades: [...state.selectedDecades],
    shows: state.selectedShows.map(show => {
      const ms = state.musicState.get(String(show.id));
      const result = ms?.results[ms.selected || 0];
      return {
        id: show.id,
        name: show.name,
        year: show.firstAirDate ? Number(show.firstAirDate.slice(0, 4)) : 0,
        posterUrl: show.posterUrl || '',
        youtubeVideoId: result?.videoId || '',
        youtubeTitle: result?.title || '',
        startSeconds: ms?.startSeconds || 0,
      };
    }),
  };

  setStep('prep', 'done');

  // Mark each clip step active
  state.selectedShows.forEach(s => setStep(`clip-${s.id}`, 'active'));

  try {
    const res = await fetch('/api/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    state.selectedShows.forEach(s => setStep(`clip-${s.id}`, 'done'));
    setStep('drive', 'done');
    setStep('manifest', 'done');
    setStep('descript', 'active');
    // New manifest = new Descript project needed
    state.descriptProjectId = null;
    state.descriptMediaImported = false;
    saveCookie();

    window._manifestData = data.manifest;
    window._manifestPath = data.manifestPath;

    // Kick off Descript composition
    startDescriptCompose(setStep, list);

  } catch (err) {
    setStep('manifest', 'error');
    const li = document.createElement('li');
    li.className = 'progress-item error';
    li.innerHTML = `<span class="step-icon">✗</span><span>Error: ${escHtml(err.message)}</span>`;
    list.appendChild(li);
    document.getElementById('btn-restart-composition').classList.remove('hidden');
  }
}

const DESCRIPT_STEPS = [
  { id: 'create',  label: 'Creating Descript project' },
  { id: 'import',  label: 'Importing audio & poster assets' },
  { id: 'compose', label: 'Composing blind test video with AI' },
];

function startDescriptCompose(_setStep, list) {
  list.innerHTML = '';

  // Render fixed three-step list
  for (const step of DESCRIPT_STEPS) {
    const li = document.createElement('li');
    li.className = 'progress-item';
    li.id = `step-descript-${step.id}`;
    li.innerHTML = `<span class="step-icon">⏳</span><span id="step-descript-label-${step.id}">${escHtml(step.label)}</span>`;
    list.appendChild(li);
  }

  const setStep = (id, stepState, detail) => {
    const el = document.getElementById(`step-descript-${id}`);
    if (!el) return;
    el.className = `progress-item ${stepState}`;
    el.querySelector('.step-icon').textContent =
      stepState === 'done' ? '✓' : stepState === 'error' ? '✗' : stepState === 'active' ? '▶' : '⏳';
    if (detail) {
      const labelEl = document.getElementById(`step-descript-label-${id}`);
      const base = DESCRIPT_STEPS.find(s => s.id === id)?.label ?? '';
      if (labelEl) labelEl.textContent = `${base} — ${detail}`;
    }
  };

  const setProgress = (id, text) => {
    const labelEl = document.getElementById(`step-descript-label-${id}`);
    if (labelEl) labelEl.textContent = text;
  };

  let activeStepId = null;

  fetch('/api/descript-compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: state.descriptProjectId,
      mediaImported: state.descriptMediaImported,
      apiKey: state.descriptApiKey || undefined,
    }),
  })
    .then(res => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      function pump() {
        return reader.read().then(({ done, value }) => {
          if (done) return;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let event;
            try { event = JSON.parse(line.slice(6)); } catch { continue; }
            handleDescriptEvent(event, setStep, setProgress, id => { activeStepId = id; });
          }
          return pump();
        });
      }
      return pump();
    })
    .catch(err => {
      if (activeStepId) setStep(activeStepId, 'error');
      const li = document.createElement('li');
      li.className = 'progress-item error';
      li.innerHTML = `<span class="step-icon">✗</span><span>Descript error: ${escHtml(err.message)}</span>`;
      list.appendChild(li);
      document.getElementById('btn-restart-composition').classList.remove('hidden');
    });
}

function handleDescriptEvent(event, setStep, setProgress, setActive) {
  if (event.type === 'step') {
    setActive(event.id);
    setStep(event.id, 'active');

  } else if (event.type === 'step_skip') {
    setStep(event.id, 'done');

  } else if (event.type === 'project_created') {
    state.descriptProjectId = event.projectId;
    state.projectUrl = event.projectUrl;
    saveCookie();
    const link = document.getElementById('compose-done-link');
    const box = document.getElementById('compose-done-box');
    if (link && event.projectUrl) {
      link.href = event.projectUrl;
      box.classList.remove('hidden');
    }

  } else if (event.type === 'media_imported') {
    state.descriptMediaImported = true;
    saveCookie();

  } else if (event.type === 'progress') {
    const active = DESCRIPT_STEPS.find(s =>
      document.getElementById(`step-descript-${s.id}`)?.classList.contains('active'));
    if (active) setProgress(active.id, event.label);

  } else if (event.type === 'step_done') {
    setStep(event.id, 'done', event.detail);

  } else if (event.type === 'done') {
    state.projectUrl = event.projectUrl || state.projectUrl;
    saveCookie();
    const link = document.getElementById('compose-done-link');
    if (link && state.projectUrl) link.href = state.projectUrl;

  } else if (event.type === 'error') {
    const active = DESCRIPT_STEPS.find(s =>
      document.getElementById(`step-descript-${s.id}`)?.classList.contains('active'));
    if (active) setStep(active.id, 'error');
    const list = document.getElementById('progress-list');
    const li = document.createElement('li');
    li.className = 'progress-item error';
    li.innerHTML = `<span class="step-icon">✗</span><span>${escHtml(event.message)}</span>`;
    list.appendChild(li);
    updateRestartButton();
    document.getElementById('btn-restart-composition').classList.remove('hidden');
  }
}

function updateRestartButton() {
  const btn = document.getElementById('btn-restart-composition');
  if (state.descriptMediaImported) {
    btn.textContent = '↺ Resume from step 3 (compose)';
  } else if (state.descriptProjectId) {
    btn.textContent = '↺ Resume from step 2 (import media)';
  } else {
    btn.textContent = '↺ Restart composition';
  }
}

function showDone(url) {
  state.projectUrl = url;
  saveCookie();
  document.getElementById('done-link').href = url;
  showView('view-done');
}

function resetApp() {
  clearCookie();
  state.currentView = 'view-decades';
  state.selectedDecades.clear();
  state.shows = [];
  state.showsPage = 1;
  state.selectedShows = [];
  state.musicState.clear();
  state.projectUrl = null;
  state.descriptProjectId = null;
  state.descriptMediaImported = false;
  document.querySelectorAll('.decade-card.selected').forEach(c => c.classList.remove('selected'));
  document.getElementById('btn-goto-shows').disabled = true;
  showView('view-decades');
}

document.getElementById('btn-restart').addEventListener('click', resetApp);
document.getElementById('btn-reset-global').addEventListener('click', () => {
  if (state.currentView === 'view-decades') return; // already at start
  if (confirm('Start over? Your current selections will be lost.')) resetApp();
});

// ── Init: restore from cookie ────────────────────────────────────────────────
(function init() {
  const saved = loadCookie();
  if (!saved) return;

  // Restore decades
  (saved.d || []).forEach(d => {
    state.selectedDecades.add(d);
    const card = document.querySelector(`.decade-card[data-decade="${d}"]`);
    if (card) card.classList.add('selected');
  });
  document.getElementById('btn-goto-shows').disabled = state.selectedDecades.size === 0;

  // Restore selected shows (from cookie cache — no TMDB re-fetch needed)
  state.selectedShows = (saved.s || []).map(s => ({
    id: s.id,
    name: s.n,
    posterUrl: s.p,
    firstAirDate: s.y,
  }));
  updateShowCounter();

  // Restore music state
  const music = saved.m || {};
  Object.entries(music).forEach(([showId, m]) => {
    state.musicState.set(showId, {
      results: [{
        videoId: m.vid,
        title: m.vt,
        thumbnail: m.th,
        duration: m.dur || 180,
        url: `https://www.youtube.com/watch?v=${m.vid}`,
      }],
      selected: 0,
      startSeconds: m.ss || 0,
      validated: m.val || false,
    });
  });

  // Restore project URL and descript progress
  state.projectUrl = saved.pu || null;
  state.descriptProjectId = saved.dpid || null;
  state.descriptMediaImported = saved.dmi || false;
  if (state.projectUrl) {
    const link = document.getElementById('compose-done-link');
    const box = document.getElementById('compose-done-box');
    if (link) { link.href = state.projectUrl; box.classList.remove('hidden'); }
  }
  state.descriptApiKey = saved.dak || '';
  if (state.descriptApiKey) {
    document.getElementById('descript-api-key').value = state.descriptApiKey;
  }

  // Navigate to the saved view
  const view = saved.v || 'view-decades';
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(view).classList.add('active');
  state.currentView = view;

  if (view === 'view-music') {
    restoreMusicView();
  } else if (view === 'view-shows') {
    loadShows();
  } else if (view === 'view-done' && state.projectUrl) {
    document.getElementById('done-link').href = state.projectUrl;
  } else if (view === 'view-compose') {
    // Render Descript steps with the progress we already made
    const list = document.getElementById('progress-list');
    for (const step of DESCRIPT_STEPS) {
      const done =
        (step.id === 'create' && state.descriptProjectId) ||
        (step.id === 'import' && state.descriptMediaImported);
      const li = document.createElement('li');
      li.className = `progress-item ${done ? 'done' : ''}`;
      li.id = `step-descript-${step.id}`;
      li.innerHTML = `<span class="step-icon">${done ? '✓' : '⏸'}</span><span id="step-descript-label-${step.id}">${escHtml(step.label)}</span>`;
      list.appendChild(li);
    }
    updateRestartButton();
    document.getElementById('btn-restart-composition').classList.remove('hidden');
  }
})();

// ── Utils ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
