// Git Tracker — a private, local-only app that shows which of your GitHub
// repositories are shared with other people and which are not.
//
// It listens on 127.0.0.1 only, so it can't be reached from other computers.
// No dependencies: needs Node.js 18+ (uses built-in fetch).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4517;
const API = 'https://api.github.com';
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

// ---------- local storage ----------

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function removeFile(file) {
  try { fs.unlinkSync(file); } catch {}
}
function getToken() {
  return process.env.GITHUB_TOKEN || readJson(CONFIG_FILE, {}).token || null;
}

// ---------- GitHub API ----------

async function ghFetch(url, token) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'git-tracker-local',
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try { message = (await res.json()).message || message; } catch {}
    const err = new Error(`GitHub ${res.status}: ${message}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

function nextLink(header) {
  if (!header) return null;
  const part = header.split(',').find((p) => p.includes('rel="next"'));
  const m = part && part.match(/<([^>]+)>/);
  return m ? m[1] : null;
}

async function ghAll(url, token) {
  const out = [];
  let next = url;
  while (next) {
    const res = await ghFetch(next, token);
    out.push(...(await res.json()));
    next = nextLink(res.headers.get('link'));
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function scan(token) {
  const me = await (await ghFetch('/user', token)).json();
  const repos = await ghAll('/user/repos?affiliation=owner&per_page=100&sort=full_name', token);

  const results = await mapLimit(repos, 8, async (r) => {
    const base = `/repos/${r.full_name}`;
    const owner = r.owner.login.toLowerCase();
    let collaborators = [];
    let invites = [];
    let error = null;

    try {
      const list = await ghAll(`${base}/collaborators?affiliation=direct&per_page=100`, token);
      collaborators = list
        .filter((c) => c.login.toLowerCase() !== owner)
        .map((c) => ({ login: c.login, avatar: c.avatar_url, url: c.html_url, role: c.role_name || '' }));
    } catch (e) {
      error = e.message;
    }
    try {
      const list = await ghAll(`${base}/invitations?per_page=100`, token);
      invites = list.map((i) => ({
        login: i.invitee ? i.invitee.login : i.email || 'unknown',
        avatar: i.invitee ? i.invitee.avatar_url : '',
        url: i.invitee ? i.invitee.html_url : '',
        role: i.permissions || '',
        createdAt: i.created_at,
      }));
    } catch (e) {
      if (!error) error = e.message;
    }

    const status = collaborators.length ? 'shared' : invites.length ? 'pending' : 'none';
    return {
      name: r.name,
      fullName: r.full_name,
      url: r.html_url,
      accessUrl: `${r.html_url}/settings/access`,
      description: r.description || '',
      private: r.private,
      fork: r.fork,
      archived: r.archived,
      pushedAt: r.pushed_at,
      status,
      collaborators,
      invites,
      error,
    };
  });

  return {
    scannedAt: new Date().toISOString(),
    user: { login: me.login, name: me.name || '', avatar: me.avatar_url, url: me.html_url },
    repos: results,
  };
}

// Compare two scans and describe what changed in plain words.
function diffScans(prev, next) {
  if (!prev || !prev.repos || prev.user?.login !== next.user.login) return [];
  const when = next.scannedAt;
  const events = [];
  const before = new Map(prev.repos.map((r) => [r.fullName, r]));
  const after = new Map(next.repos.map((r) => [r.fullName, r]));
  const people = (r) => new Set(r.collaborators.map((c) => c.login));
  const pending = (r) => new Set(r.invites.map((c) => c.login));

  for (const [name, r] of after) {
    const old = before.get(name);
    if (!old) { events.push({ when, repo: name, text: 'New repository' }); continue; }
    const [pa, pb] = [people(old), people(r)];
    for (const p of pb) if (!pa.has(p)) events.push({ when, repo: name, text: `Now shared with ${p}` });
    for (const p of pa) if (!pb.has(p)) events.push({ when, repo: name, text: `No longer shared with ${p}` });
    const [ia, ib] = [pending(old), pending(r)];
    for (const p of ib) if (!ia.has(p) && !pb.has(p)) events.push({ when, repo: name, text: `Invite sent to ${p}` });
    if (old.private !== r.private) events.push({ when, repo: name, text: r.private ? 'Made private' : 'Made public' });
  }
  for (const name of before.keys()) {
    if (!after.has(name)) events.push({ when, repo: name, text: 'Repository removed or transferred' });
  }
  return events;
}

let refreshing = null;
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const token = getToken();
    if (!token) throw Object.assign(new Error('No GitHub token saved yet.'), { status: 401 });
    const prev = readJson(CACHE_FILE, null);
    const data = await scan(token);
    const events = diffScans(prev, data);
    if (events.length) {
      const history = readJson(HISTORY_FILE, []);
      writeJson(HISTORY_FILE, [...events, ...history].slice(0, 300));
    }
    writeJson(CACHE_FILE, data);
    return data;
  })();
  try { return await refreshing; } finally { refreshing = null; }
}

// ---------- HTTP server ----------

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10_000) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Only answer requests addressed to this machine (blocks DNS-rebinding tricks).
  if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, { error: 'Forbidden' });

  // Changes must come from this app's own page, as JSON (blocks other websites).
  if (req.method !== 'GET') {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, { error: 'Forbidden' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      return send(res, 415, { error: 'Expected JSON' });
    }
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, fs.readFileSync(INDEX_HTML), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/data') {
      return send(res, 200, {
        hasToken: Boolean(getToken()),
        tokenFromEnv: Boolean(process.env.GITHUB_TOKEN),
        data: readJson(CACHE_FILE, null),
        history: readJson(HISTORY_FILE, []),
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/refresh') {
      const data = await refresh();
      return send(res, 200, { data, history: readJson(HISTORY_FILE, []) });
    }
    if (req.method === 'POST' && url.pathname === '/api/token') {
      const { token } = await readBody(req);
      const clean = String(token || '').trim();
      if (!clean) return send(res, 400, { error: 'Paste a token first.' });
      const check = await ghFetch('/user', clean); // throws if the token is bad
      const user = await check.json();
      const scopes = check.headers.get('x-oauth-scopes');
      if (scopes !== null && !scopes.split(',').map((s) => s.trim()).includes('repo')) {
        return send(res, 400, {
          error: 'That token works, but it is missing the "repo" permission, so private repositories and their collaborators can\'t be read. Make a new token with "repo" ticked.',
        });
      }
      const cached = readJson(CACHE_FILE, null);
      if (cached && cached.user?.login !== user.login) { removeFile(CACHE_FILE); removeFile(HISTORY_FILE); }
      writeJson(CONFIG_FILE, { token: clean });
      return send(res, 200, { ok: true, login: user.login });
    }
    if (req.method === 'POST' && url.pathname === '/api/disconnect') {
      removeFile(CONFIG_FILE);
      removeFile(CACHE_FILE);
      removeFile(HISTORY_FILE);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    const status = e.status === 401 ? 401 : e.status === 403 ? 403 : 500;
    const error = e.status === 401 && e.message.startsWith('GitHub')
      ? 'GitHub rejected the token. It may be wrong, expired, or revoked.'
      : e.message;
    return send(res, status, { error });
  }
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}

module.exports = { scan, diffScans };
if (require.main !== module) return;

const appUrl = `http://${HOST}:${PORT}`;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Git Tracker is already running. Opening ${appUrl}`);
    openBrowser(appUrl);
    setTimeout(() => process.exit(0), 500);
  } else {
    throw e;
  }
});
server.listen(PORT, HOST, () => {
  console.log(`Git Tracker is running at ${appUrl}`);
  console.log('Only this computer can open it. Close this window to stop it.');
  if (process.argv.includes('--open')) openBrowser(appUrl);
});
