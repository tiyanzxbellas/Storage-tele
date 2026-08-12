// ===== Shared API + helper (index-based, v5) =====
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
const INDEX_KEY = 'tg_storage_index_v5';
const OFFSET_KEY = 'tg_storage_offset_v5';
const DELETED_KEY = 'tg_storage_deleted_v5';

// ===== Index store: localStorage (semua mode) + data.json (mode server) =====
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]'); } catch (e) { return []; }
}
function saveLocal(idx) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch (e) {}
}

// ===== Offset getUpdates: mencegah Telegram mengirim ulang update lama =====
function loadOffset() {
  try { return Number(localStorage.getItem(OFFSET_KEY) || 0); } catch (e) { return 0; }
}
function saveOffset(v) {
  try { localStorage.setItem(OFFSET_KEY, String(v)); } catch (e) {}
}

// ===== Tombstone: id pesan yang sudah dihapus user, jangan pernah dimunculkan lagi =====
function loadDeleted() {
  try { return JSON.parse(localStorage.getItem(DELETED_KEY) || '[]'); } catch (e) { return []; }
}
function saveDeleted(arr) {
  try { localStorage.setItem(DELETED_KEY, JSON.stringify(arr.slice(-500))); } catch (e) {}
}
function markDeleted(msgId) {
  const d = loadDeleted();
  if (!d.includes(String(msgId))) { d.push(String(msgId)); saveDeleted(d); }
}

async function detectMode() {
  try {
    const r = await fetch('/api/index', { method: 'GET' });
    if (r.ok) return 'server';
  } catch (e) {}
  return 'static';
}

const store = {
  async load() {
    if (API.mode === 'server') {
      try {
        const r = await fetch('/api/index');
        const j = await r.json();
        if (Array.isArray(j)) return j;
      } catch (e) {}
    }
    return loadLocal();
  },
  async save(idx) {
    saveLocal(idx);
    if (API.mode === 'server') {
      try {
        await fetch('/api/index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(idx) });
      } catch (e) {}
    }
  }
};

// ===== Telegram helper =====
async function getFilePath(fileId) {
  try {
    const r = await fetch(`${API_BASE}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const j = await r.json();
    return j.ok ? j.result.file_path : null;
  } catch (e) { return null; }
}

async function normalizeMessage(m) {
  const isPhoto = !!m.photo;
  const doc = m.document || m.video || m.animation || m.audio || m.voice;
  const fid = isPhoto ? m.photo[m.photo.length - 1].file_id : (doc ? doc.file_id : null);
  const type = isPhoto ? 'photo' : m.video ? 'video' : m.animation ? 'animation' : m.audio ? 'audio' : m.voice ? 'voice' : 'document';
  let name, size;
  if (m.document) { name = m.document.file_name || 'file'; size = m.document.file_size; }
  else if (m.video) { name = m.video.file_name || 'video.mp4'; size = m.video.file_size; }
  else if (m.animation) { name = m.animation.file_name || 'gif'; size = m.animation.file_size; }
  else if (m.audio) { name = m.audio.file_name || (m.audio.title || 'audio') + '.mp3'; size = m.audio.file_size; }
  else if (m.voice) { name = 'voice.ogg'; size = m.voice.file_size; }
  else if (m.photo) { name = 'photo.jpg'; size = m.photo[0].file_size * m.photo.length; }
  else { name = 'file'; size = 0; }
  const th = (m.photo && m.photo[0]) || (m.video && m.video.thumb) || (m.animation && m.animation.thumb) || (m.document && m.document.thumb) || (m.audio && m.audio.thumb);
  const file_path = fid ? await getFilePath(fid) : null;
  const thumb_path = (th && th.file_id) ? await getFilePath(th.file_id) : null;
  return { message_id: m.message_id, date: m.date, caption: m.caption || '', type, name, size, file_id: fid, file_path, thumb_path };
}

const API = (() => {
  const tg = API_BASE;
  return {
    mode: 'static',
    _ready: false,
    async init() {
      if (this._ready) return;
      this.mode = await detectMode();
      this._ready = true;
    },
    async list() {
      await this.init();
      let idx = await store.load();
      // Tangkap file yang dikirim ke bot via Telegram (getUpdates)
      // PENTING: pakai offset supaya Telegram tidak mengirim ulang update yang
      // sudah pernah diproses -- tanpa ini, file yang baru dihapus akan
      // "hidup lagi" karena update lamanya masih dikirim ulang terus-menerus.
      try {
        const offset = loadOffset();
        const r = await fetch(`${tg}/getUpdates?timeout=0${offset ? `&offset=${offset}` : ''}`);
        const j = await r.json();
        if (j.ok && Array.isArray(j.result)) {
          const deleted = new Set(loadDeleted());
          const map = new Map(idx.map(e => [String(e.message_id), e]));
          let maxUpdateId = offset - 1;
          for (const u of j.result) {
            if (u.update_id >= maxUpdateId) maxUpdateId = u.update_id;
            const m = u.message;
            if (!m || !(m.photo || m.video || m.animation || m.audio || m.voice || m.document)) continue;
            const key = String(m.message_id);
            if (deleted.has(key)) continue; // jangan hidupkan lagi file yang sudah dihapus
            if (map.has(key)) {
              if (m.caption !== undefined) map.get(key).caption = m.caption;
              continue;
            }
            map.set(key, await normalizeMessage(m));
          }
          if (maxUpdateId >= offset) saveOffset(maxUpdateId + 1);
          idx = [...map.values()];
          await store.save(idx);
        }
      } catch (e) { /* getUpdates opsional */ }
      return idx.sort((a, b) => (b.date || 0) - (a.date || 0) || b.message_id - a.message_id);
    },
    async upload(file, progressCb) {
      await this.init();
      const fd = new FormData();
      fd.append('chat_id', CHAT_ID);
      const isPhoto = file.type.startsWith('image/');
      fd.append(isPhoto ? 'photo' : 'document', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${tg}/${isPhoto ? 'sendPhoto' : 'sendDocument'}`);
      xhr.upload.onprogress = e => progressCb && progressCb(e.lengthComputable ? e.loaded / e.total * 100 : 0);
      await new Promise((res, rej) => { xhr.onload = () => res(xhr); xhr.onerror = rej; xhr.send(fd); });
      const j = JSON.parse(xhr.responseText);
      if (!j.ok) throw new Error(j.description || 'Not Found');
      const entry = await normalizeMessage(j.result);
      const idx = await store.load();
      const map = new Map(idx.map(e => [String(e.message_id), e]));
      map.set(String(entry.message_id), entry);
      await store.save([...map.values()]);
      return j.result;
    },
    async delete(msgId) {
      await this.init();
      const fd = new FormData();
      fd.append('chat_id', CHAT_ID);
      fd.append('message_id', msgId);
      const r = await fetch(`${tg}/deleteMessage`, { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.description || 'Not Found');
      markDeleted(msgId);
      const idx = (await store.load()).filter(e => String(e.message_id) !== String(msgId));
      await store.save(idx);
    },
    async rename(msgId, caption) {
      await this.init();
      const fd = new FormData();
      fd.append('chat_id', CHAT_ID);
      fd.append('message_id', msgId);
      if (caption !== undefined) fd.append('caption', caption);
      const r = await fetch(`${tg}/editMessageCaption`, { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.description || 'Not Found');
      const idx = await store.load();
      const e = idx.find(x => String(x.message_id) === String(msgId));
      if (e) { e.caption = caption || ''; await store.save(idx); }
    },
    async restore(msgId) {
      await this.init();
      const idx = await store.load();
      const e = idx.find(x => String(x.message_id) === String(msgId));
      if (!e || !e.backup_msg_id) throw new Error('Tidak ada salinan backup untuk file ini');
      const fd = new FormData();
      fd.append('chat_id', CHAT_ID);
      fd.append('from_chat_id', BACKUP_CHAT_ID);
      fd.append('message_id', e.backup_msg_id);
      const r = await fetch(`${tg}/copyMessage`, { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.description || 'Not Found');
      const entry = await normalizeMessage(j.result);
      const map = new Map(idx.map(x => [String(x.message_id), x]));
      map.set(String(entry.message_id), entry);
      await store.save([...map.values()]);
      return entry;
    },
    async getChat() {
      const r = await fetch(`${tg}/getChat?chat_id=${CHAT_ID}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.description || 'Not Found');
      return j.result;
    },
    async me() {
      const r = await fetch(`${tg}/getMe`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.description || 'Not Found');
      return j.result;
    }
  };
})();

// ===== Helper =====
function showToast(msg, ms = 3000) {
  const t = document.getElementById('toast');
  if (!t) return alert(msg);
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(window._tt);
  window._tt = setTimeout(() => t.style.display = 'none', ms);
}

function fileIcon(f) {
  const t = f.type;
  if (t === 'photo') return '🖼';
  if (t === 'video') return '🎬';
  if (t === 'animation') return '🎞';
  if (t === 'audio' || t === 'voice') return '🎵';
  if (t === 'document') return '📄';
  return '📦';
}

function getFileUrl(f) {
  if (f.file_path) return `https://api.telegram.org/file/bot${BOT_TOKEN}/${f.file_path}`;
  return '#';
}

function getThumbUrl(f) {
  if (f.thumb_path) return `https://api.telegram.org/file/bot${BOT_TOKEN}/${f.thumb_path}`;
  return null;
}

function getName(f) { return f.name || 'file'; }
function getSize(f) { return f.size || 0; }
function fmtSize(b) { if (!b) return ''; if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB'; return Math.round(b / 1024) + ' KB'; }
function getCaption(f) { return f.caption || ''; }

function setActive(page) {
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
}
