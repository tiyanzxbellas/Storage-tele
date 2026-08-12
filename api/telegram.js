// Serverless function untuk Vercel / Netlify
// Membaca token & chat ID dari config.js (public/config.js)
const fs = require('fs');
const path = require('path');

function loadConfig() {
  const p = path.join(__dirname, '..', 'public', 'config.js');
  const src = fs.readFileSync(p, 'utf8');
  const m = src.match(/BOT_TOKEN\s*=\s*'([^']+)'/);
  const c = src.match(/CHAT_ID\s*=\s*'([^']+)'/);
  return {
    token: m ? m[1] : (process.env.BOT_TOKEN || ''),
    chatId: c ? c[1] : (process.env.CHAT_ID || '')
  };
}

function send(res, status, data) {
  res.status(status).json(data);
}

module.exports = async (req, res) => {
  const { token, chatId } = loadConfig();
  if (!token) return send(res, 500, { ok: false, description: 'BOT_TOKEN tidak ditemukan di config.js' });

  const body = req.body || {};
  const action = body.action;

  try {
    if (action === 'list') {
      const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=0`);
      const j = await r.json();
      return send(res, 200, j);
    }
    if (action === 'delete') {
      const fd = new FormData();
      fd.append('chat_id', body.chat_id || chatId);
      fd.append('message_id', body.message_id);
      const r = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, { method: 'POST', body: fd });
      const j = await r.json();
      return send(res, 200, j);
    }
    if (action === 'rename') {
      const fd = new FormData();
      fd.append('chat_id', body.chat_id || chatId);
      fd.append('message_id', body.message_id);
      if (body.caption !== undefined) fd.append('caption', body.caption);
      const r = await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`, { method: 'POST', body: fd });
      const j = await r.json();
      return send(res, 200, j);
    }
    if (action === 'me') {
      const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const j = await r.json();
      return send(res, 200, j);
    }
    if (action === 'chat') {
      const r = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`);
      const j = await r.json();
      return send(res, 200, j);
    }
    return send(res, 400, { ok: false, description: 'Action tidak dikenal' });
  } catch (e) {
    return send(res, 500, { ok: false, description: e.message });
  }
};
