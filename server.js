// Server mandiri untuk VPS / Termux / Pterodactyl / Railway / Render
// Baca token & chat ID dari public/config.js, index tersimpan di data.json
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data.json');

function loadConfig() {
  const p = path.join(PUBLIC, 'config.js');
  const src = fs.readFileSync(p, 'utf8');
  const m = src.match(/BOT_TOKEN\s*=\s*'([^']+)'/);
  const c = src.match(/CHAT_ID\s*=\s*'([^']+)'/);
  return {
    token: m ? m[1] : (process.env.BOT_TOKEN || ''),
    chatId: c ? c[1] : (process.env.CHAT_ID || '')
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

    // API index (persisten di data.json)
    if (urlPath === '/api/index') {
      if (req.method === 'POST') {
        let arr = [];
        try { arr = JSON.parse(await readBody(req)); } catch (e) { arr = []; }
        fs.writeFileSync(DATA_FILE, JSON.stringify(arr));
        return json(res, 200, { ok: true });
      }
      let arr = [];
      try { arr = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { arr = []; }
      return json(res, 200, arr);
    }

    const filePath = path.join(PUBLIC, urlPath);
    if (!filePath.startsWith(PUBLIC)) {
      res.writeHead(403); return res.end('Forbidden');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      return res.end(fs.readFileSync(filePath));
    }

    if (urlPath.startsWith('/api/telegram')) {
      const { token, chatId } = loadConfig();
      if (!token) return json(res, 500, { ok: false, description: 'BOT_TOKEN tidak ditemukan di config.js' });

      const raw = await readBody(req);
      let body = {};
      if (raw) {
        const ct = req.headers['content-type'] || '';
        if (ct.includes('application/json')) body = JSON.parse(raw);
        else {
          const params = new URLSearchParams(raw);
          for (const [k, v] of params) body[k] = v;
        }
      }
      const action = body.action;

      if (action === 'list') {
        const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=0`);
        return json(res, 200, await r.json());
      }
      if (action === 'delete') {
        const fd = new FormData();
        fd.append('chat_id', body.chat_id || chatId);
        fd.append('message_id', body.message_id);
        const r = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, { method: 'POST', body: fd });
        return json(res, 200, await r.json());
      }
      if (action === 'rename') {
        const fd = new FormData();
        fd.append('chat_id', body.chat_id || chatId);
        fd.append('message_id', body.message_id);
        if (body.caption !== undefined) fd.append('caption', body.caption);
        const r = await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`, { method: 'POST', body: fd });
        return json(res, 200, await r.json());
      }
      if (action === 'me') {
        const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        return json(res, 200, await r.json());
      }
      if (action === 'chat') {
        const r = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`);
        return json(res, 200, await r.json());
      }
      return json(res, 400, { ok: false, description: 'Action tidak dikenal' });
    }

    res.writeHead(404);
    res.end('Not Found');
  } catch (e) {
    res.writeHead(500);
    res.end(String(e.message || 'Error'));
  }
});

server.listen(PORT, () => {
  console.log(`✅ Telegram Storage jalan di http://localhost:${PORT}`);
});
