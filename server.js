const express = require('express');
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const parser = new Parser({ timeout: 15000 });
const DATA_FILE = path.join(__dirname, 'data', 'board.json');
const PORT = process.env.PORT || 3000;

// ==== 管理者認証 ====
// パスワードは平文では保持しない（scryptでハッシュ化したものだけを保存）
const ADMIN_EMAIL = 'koutakojima729@gmail.com';
const ADMIN_PASSWORD_SALT = '6b3e8db8d0158f278c4932f193f48606';
const ADMIN_PASSWORD_HASH = 'dd425616ffd275da24fbd151e6cac9cc6126e6f3ca86ca52d5934c698a80518095e31c11780b005c8111d6d166a196a27046b640fbd41871f66982a7b852b610';
const ADMIN_SESSION_MS = 7 * 24 * 60 * 60 * 1000; // セッション有効期限:7日
const adminSessions = new Map(); // token -> 有効期限(ms)

function verifyAdminPassword(password) {
  const hash = crypto.scryptSync(password, ADMIN_PASSWORD_SALT, 64).toString('hex');
  // タイミング攻撃対策でtimingSafeEqualを使用
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(ADMIN_PASSWORD_HASH, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAdminRequest(req) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) return false;
  const expires = adminSessions.get(token);
  if (Date.now() > expires) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) {
    return res.status(403).json({ error: '管理者のみ実行できます' });
  }
  next();
}

// ==== 一般ユーザー認証（管理者ログインとは別） ====
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const USER_SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30日
const userSessions = new Map(); // token -> { username, expires }

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch (e) {
    return {};
  }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}
let users = loadUsers();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function currentUsername(req) {
  const token = req.headers['x-user-token'];
  if (!token || !userSessions.has(token)) return null;
  const session = userSessions.get(token);
  if (Date.now() > session.expires) {
    userSessions.delete(token);
    return null;
  }
  return session.username;
}

function requireUser(req, res, next) {
  const username = currentUsername(req);
  if (!username) return res.status(401).json({ error: 'ログインが必要です' });
  req.username = username;
  next();
}

function followedKey(boardId, threadId) {
  return `${boardId}:${threadId}`;
}
function followerCountOf(username) {
  return Object.values(users).filter(u => u.following && u.following.includes(username)).length;
}


// ==== 広告枠 ====
// 将来的に外部広告（AdSenseなど埋め込みタグ）を貼れるようにするための枠組み。
// 今は空・無効の状態で用意しておき、管理者ログイン後の「広告管理」から設定できる。
const ADS_FILE = path.join(__dirname, 'data', 'ads.json');
const AD_SLOTS = [
  { id: 'top-banner', label: 'ホーム上部バナー' },
  { id: 'sidebar', label: 'サイドバー（お知らせ横）' },
  { id: 'thread-bottom', label: 'スレッド下部' },
];

function loadAds() {
  try {
    return JSON.parse(fs.readFileSync(ADS_FILE, 'utf-8'));
  } catch (e) {
    const initial = {};
    AD_SLOTS.forEach(s => { initial[s.id] = { enabled: false, html: '' }; });
    return initial;
  }
}
function saveAds(ads) {
  fs.writeFileSync(ADS_FILE, JSON.stringify(ads, null, 2), 'utf-8');
}
let adsConfig = loadAds();
AD_SLOTS.forEach(s => { if (!adsConfig[s.id]) adsConfig[s.id] = { enabled: false, html: '' }; });
saveAds(adsConfig);

// ==== 板（カテゴリ）定義：好きに追加/変更してOK ====
// category: 'news'=RSS自動スレ立て / 'tech'・'life'・'meta'=ユーザーがスレを立てて使う板
// rss が null の板はRSS取得を行わず、「新規スレッド作成」だけでスレが増えていく
const BOARDS = [
  // --- ニュース（RSS自動スレ立て） ---
  { id: 'general', name: '総合ニュース速報', rss: 'https://www3.nhk.or.jp/rss/news/cat0.xml', category: 'news' },
  { id: 'it', name: 'IT・ガジェット', rss: 'https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml', category: 'news' },
  { id: 'sports', name: 'スポーツ', rss: 'https://www3.nhk.or.jp/rss/news/cat7.xml', category: 'news' },
  { id: 'net', name: 'ネット・話題', rss: 'https://b.hatena.ne.jp/hotentry/it.rss', category: 'news' },
  { id: 'gadget', name: 'ガジェット速報', rss: 'https://gigazine.net/news/rss_2.0/', category: 'news' },

  // --- 技術系（一部RSS、一部ユーザースレのみ） ---
  { id: 'cpp', name: 'C++', rss: 'https://qiita.com/tags/c%2B%2B/feed.atom', category: 'tech' },
  { id: 'python', name: 'Python', rss: 'https://qiita.com/tags/python/feed.atom', category: 'tech' },
  { id: 'webdev', name: 'Web開発', rss: 'https://qiita.com/tags/web/feed.atom', category: 'tech' },
  { id: 'keyboard', name: 'キーボード・マウス沼', rss: null, category: 'tech' },
  { id: 'os', name: 'Linux・macOS・Windows', rss: null, category: 'tech' },
  { id: 'network', name: 'サーバー・ネットワーク', rss: null, category: 'tech' },
  { id: 'ai', name: 'AI・機械学習', rss: 'https://qiita.com/tags/machinelearning/feed.atom', category: 'tech' },
  { id: 'security', name: 'セキュリティ・ハッキング学習', rss: null, category: 'tech' },
  { id: 'progqa', name: 'プログラミング質問総合', rss: null, category: 'tech' },

  // --- 雑談・相談（ユーザースレのみ） ---
  { id: 'life', name: '人生・進路相談', rss: null, category: 'life' },
  { id: 'love', name: '恋愛・人間関係相談', rss: null, category: 'life' },
  { id: 'recommend', name: 'おすすめ募集・質問総合', rss: null, category: 'life' },
  { id: 'collab', name: 'コラボ・メンバー募集', rss: null, category: 'life' },
  { id: 'job', name: 'バイト・仕事相談', rss: null, category: 'life' },
  { id: 'survey', name: 'アンケート・意見募集', rss: null, category: 'life' },
  { id: 'aa', name: 'AA(アスキーアート)', rss: null, category: 'life' },

  // --- サイト運営 ---
  { id: 'bugreport', name: 'バグ報告・要望・機能提案', rss: null, category: 'meta' },
  { id: 'announce', name: 'サイトのお知らせ', rss: null, category: 'meta' },
  { id: 'contact', name: '通報・お問い合わせ', rss: null, category: 'meta' },

  // --- 学問・雑学（ユーザースレのみ） ---
  { id: 'math', name: '数学総合', rss: null, category: 'study' },
  { id: 'matholympiad', name: '数学オリンピック・難問', rss: null, category: 'study' },
  { id: 'puzzle', name: 'パズル・論理クイズ', rss: null, category: 'study' },
  { id: 'physics', name: '物理・天文学', rss: null, category: 'study' },
  { id: 'chemistry', name: '化学・生物', rss: null, category: 'study' },
  { id: 'philosophy', name: '哲学・心理学', rss: null, category: 'study' },
  { id: 'history', name: '歴史・地理', rss: null, category: 'study' },
];

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10分ごとに新着チェック
const NEW_THREAD_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6時間以内はNEW表示

// ==== データ永続化 ====
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    return { boards: {} };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function hashId(str) {
  return crypto.createHash('md5').update(str).digest('hex').slice(0, 12);
}

let db = loadData();
for (const b of BOARDS) {
  if (!db.boards[b.id]) db.boards[b.id] = { threads: {} };
}
saveData(db);

// ==== RSS取得してスレッド化（既存コメントは保持） ====
async function refreshBoard(board) {
  if (!board.rss) return; // RSSが無い板（ユーザースレのみ）はスキップ
  try {
    const feed = await parser.parseURL(board.rss);
    const boardData = db.boards[board.id];
    let newCount = 0;

    for (const item of feed.items) {
      const link = item.link || item.guid || item.title;
      const threadId = hashId(link);

      if (!boardData.threads[threadId]) {
        boardData.threads[threadId] = {
          id: threadId,
          title: (item.title || '無題').trim(),
          link: item.link || '',
          summary: (item.contentSnippet || item.content || '').trim().slice(0, 400),
          pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
          createdAt: Date.now(),
          comments: [],
          opLikes: 0,
        };
        newCount++;
      }
    }
    saveData(db);
    if (newCount > 0) {
      console.log(`[${board.id}] 新着スレ ${newCount} 件`);
    }
  } catch (err) {
    console.error(`[${board.id}] RSS取得失敗: ${err.message}`);
  }
}

async function refreshAllBoards() {
  for (const b of BOARDS) {
    await refreshBoard(b);
  }
}

// ==== 勢い計算：直近24時間のコメント数 / 経過時間(h) ====
function calcIkioi(thread) {
  const now = Date.now();
  const ageHours = Math.max((now - thread.createdAt) / 3600000, 0.5);
  const recentComments = thread.comments.filter(
    c => now - c.date < 24 * 3600000
  ).length;
  return Math.round((recentComments / ageHours) * 10) / 10;
}

// ==== API ====
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/boards', (req, res) => {
  res.json(BOARDS.map(b => ({ id: b.id, name: b.name, category: b.category })));
});

// ==== 管理者ログイン ====
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  if (email !== ADMIN_EMAIL || !password || !verifyAdminPassword(password)) {
    return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.set(token, Date.now() + ADMIN_SESSION_MS);
  res.json({ token });
});

app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) adminSessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  res.json({ isAdmin: isAdminRequest(req) });
});

// ==== 一般ユーザー：登録・ログイン ====
const USERNAME_RE = /^[a-zA-Z0-9_ぁ-んァ-ヶー一-龠]{2,20}$/;

app.post('/api/auth/register', (req, res) => {
  let { username, password } = req.body || {};
  username = (username || '').toString().trim();
  password = (password || '').toString();

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'ユーザー名は2〜20文字（英数字・かな・漢字・アンダースコア）で入力してください' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'パスワードは4文字以上にしてください' });
  }
  if (users[username]) {
    return res.status(409).json({ error: 'そのユーザー名は既に使われています' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  users[username] = {
    passwordSalt: salt,
    passwordHash: hashPassword(password, salt),
    createdAt: Date.now(),
    following: [],
    followedThreads: [],
  };
  saveUsers(users);

  const token = crypto.randomBytes(24).toString('hex');
  userSessions.set(token, { username, expires: Date.now() + USER_SESSION_MS });
  res.json({ token, username });
});

app.post('/api/auth/login', (req, res) => {
  let { username, password } = req.body || {};
  username = (username || '').toString().trim();
  password = (password || '').toString();

  const user = users[username];
  if (!user) return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });

  const hash = hashPassword(password, user.passwordSalt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.passwordHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  userSessions.set(token, { username, expires: Date.now() + USER_SESSION_MS });
  res.json({ token, username });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-user-token'];
  if (token) userSessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const username = currentUsername(req);
  res.json({ username: username || null });
});

// ==== フォロー機能 ====

// スレッドをフォロー／解除
app.post('/api/boards/:boardId/threads/:threadId/follow', requireUser, (req, res) => {
  const { boardId, threadId } = req.params;
  const boardData = db.boards[boardId];
  if (!boardData || !boardData.threads[threadId]) {
    return res.status(404).json({ error: 'スレが見つかりません' });
  }
  const key = followedKey(boardId, threadId);
  const user = users[req.username];
  const follow = req.body && req.body.follow !== false;
  const idx = user.followedThreads.indexOf(key);

  if (follow && idx === -1) user.followedThreads.push(key);
  if (!follow && idx !== -1) user.followedThreads.splice(idx, 1);

  saveUsers(users);
  res.json({ following: follow });
});

// 投稿者をフォロー／解除
app.post('/api/users/:username/follow', requireUser, (req, res) => {
  const target = req.params.username;
  if (!users[target]) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  if (target === req.username) return res.status(400).json({ error: '自分自身はフォローできません' });

  const me = users[req.username];
  const follow = req.body && req.body.follow !== false;
  const idx = me.following.indexOf(target);

  if (follow && idx === -1) me.following.push(target);
  if (!follow && idx !== -1) me.following.splice(idx, 1);

  saveUsers(users);
  res.json({ following: follow, followerCount: followerCountOf(target) });
});

// 特定ユーザーの公開プロフィール（フォロワー数など）
app.get('/api/users/:username', (req, res) => {
  const target = req.params.username;
  if (!users[target]) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  const viewer = currentUsername(req);
  res.json({
    username: target,
    followerCount: followerCountOf(target),
    followingCount: (users[target].following || []).length,
    isFollowedByMe: viewer ? (users[viewer].following || []).includes(target) : false,
  });
});

// マイページ：フォロー中のスレッド・ユーザー一覧
app.get('/api/me/following', requireUser, (req, res) => {
  const me = users[req.username];

  const threads = (me.followedThreads || []).map(key => {
    const [boardId, threadId] = key.split(':');
    const boardData = db.boards[boardId];
    const thread = boardData && boardData.threads[threadId];
    const boardMeta = BOARDS.find(b => b.id === boardId);
    if (!thread) return null;
    return {
      boardId,
      boardName: boardMeta ? boardMeta.name : boardId,
      threadId,
      title: thread.title,
      resCount: thread.comments.length,
    };
  }).filter(Boolean);

  const followingUsers = (me.following || []).map(username => ({
    username,
    followerCount: followerCountOf(username),
  }));

  res.json({ threads, users: followingUsers });
});

// ==== 広告枠API ====
// 公開用：有効な枠のHTMLだけを返す
app.get('/api/ads', (req, res) => {
  const publicAds = {};
  for (const slot of AD_SLOTS) {
    const conf = adsConfig[slot.id];
    if (conf && conf.enabled && conf.html) {
      publicAds[slot.id] = conf.html;
    }
  }
  res.json(publicAds);
});

// 管理用：全枠の設定（無効・空も含む）と枠一覧を返す
app.get('/api/admin/ads', requireAdmin, (req, res) => {
  res.json({ slots: AD_SLOTS, config: adsConfig });
});

// 管理用：枠の設定を更新
app.put('/api/admin/ads/:slotId', requireAdmin, (req, res) => {
  const slotId = req.params.slotId;
  if (!AD_SLOTS.find(s => s.id === slotId)) {
    return res.status(404).json({ error: '不明な広告枠です' });
  }
  const { enabled, html } = req.body || {};
  adsConfig[slotId] = {
    enabled: !!enabled,
    html: (html || '').toString().slice(0, 5000),
  };
  saveAds(adsConfig);
  res.json(adsConfig[slotId]);
});

app.get('/api/boards/:boardId/threads', (req, res) => {
  const boardData = db.boards[req.params.boardId];
  if (!boardData) return res.status(404).json({ error: '板が見つかりません' });

  const sort = req.query.sort || 'new';
  let threads = Object.values(boardData.threads).map(t => ({
    id: t.id,
    title: t.title,
    resCount: t.comments.length,
    ikioi: calcIkioi(t),
    pubDate: t.pubDate,
    createdAt: t.createdAt,
    isNew: (Date.now() - t.createdAt) < NEW_THREAD_THRESHOLD_MS,
    userCreated: !!t.userCreated,
  }));

  if (sort === 'ikioi') {
    threads.sort((a, b) => b.ikioi - a.ikioi);
  } else if (sort === 'res') {
    threads.sort((a, b) => b.resCount - a.resCount);
  } else {
    threads.sort((a, b) => b.createdAt - a.createdAt);
  }

  res.json(threads);
});

app.get('/api/boards/:boardId/threads/:threadId', (req, res) => {
  const boardId = req.params.boardId;
  const boardData = db.boards[boardId];
  if (!boardData) return res.status(404).json({ error: '板が見つかりません' });
  const thread = boardData.threads[req.params.threadId];
  if (!thread) return res.status(404).json({ error: 'スレが見つかりません' });

  const username = currentUsername(req);
  const followedByMe = username
    ? (users[username].followedThreads || []).includes(followedKey(boardId, req.params.threadId))
    : false;
  const viewerFollowing = username ? (users[username].following || []) : [];

  res.json(Object.assign({}, thread, { followedByMe, viewerUsername: username, viewerFollowing }));
});

// ユーザーによる新規スレッド作成（「サイトのお知らせ」板は管理者のみ）
app.post('/api/boards/:boardId/threads', (req, res) => {
  const boardId = req.params.boardId;
  const boardData = db.boards[boardId];
  if (!boardData) return res.status(404).json({ error: '板が見つかりません' });

  const admin = isAdminRequest(req);
  const opUsername = currentUsername(req);
  if (boardId === 'announce' && !admin) {
    return res.status(403).json({ error: 'この板には管理者のみ投稿できます' });
  }

  let { title, body } = req.body;
  title = (title || '').toString().trim().slice(0, 100);
  body = (body || '').toString().trim().slice(0, 800);

  if (!title) return res.status(400).json({ error: 'タイトルを入力してください' });

  const threadId = hashId(title + Date.now() + Math.random());
  const thread = {
    id: threadId,
    title,
    link: '',
    summary: body,
    pubDate: new Date().toISOString(),
    createdAt: Date.now(),
    comments: [],
    opLikes: 0,
    userCreated: true,
    isAdmin: admin,
    opUsername: opUsername || null,
  };
  boardData.threads[threadId] = thread;
  saveData(db);
  res.json(thread);
});

app.post('/api/boards/:boardId/threads/:threadId/comments', (req, res) => {
  const boardData = db.boards[req.params.boardId];
  if (!boardData) return res.status(404).json({ error: '板が見つかりません' });
  const thread = boardData.threads[req.params.threadId];
  if (!thread) return res.status(404).json({ error: 'スレが見つかりません' });

  const admin = isAdminRequest(req);
  const username = currentUsername(req);
  let { name, text } = req.body;
  text = (text || '').toString().trim().slice(0, 1000);
  name = (name || '').toString().trim().slice(0, 30);
  if (admin) {
    name = name || '運営';
  } else if (username) {
    name = `名無しさん@${username}`; // ログイン中は「名無しさん@ユーザー名」形式で固定（フォロー機能のため実体はusernameで管理）
  } else {
    name = name || '名無しさん';
  }

  if (!text) return res.status(400).json({ error: '本文が空です' });

  const comment = {
    no: thread.comments.length + 2, // レス1は記事本文なので+2
    name,
    text,
    date: Date.now(),
    likes: 0,
    isAdmin: admin,
    username: username || null,
  };
  thread.comments.push(comment);
  saveData(db);
  res.json(comment);
});

// いいね／いいね解除（レス番号1は記事本文＝OP扱い）
app.post('/api/boards/:boardId/threads/:threadId/posts/:no/like', (req, res) => {
  const boardData = db.boards[req.params.boardId];
  if (!boardData) return res.status(404).json({ error: '板が見つかりません' });
  const thread = boardData.threads[req.params.threadId];
  if (!thread) return res.status(404).json({ error: 'スレが見つかりません' });

  const no = parseInt(req.params.no, 10);
  const liked = req.body && req.body.liked !== false; // 省略時は「いいねする」扱い
  const delta = liked ? 1 : -1;

  if (no === 1) {
    thread.opLikes = Math.max(0, (thread.opLikes || 0) + delta);
    saveData(db);
    return res.json({ no: 1, likes: thread.opLikes });
  }
  const comment = thread.comments.find(c => c.no === no);
  if (!comment) return res.status(404).json({ error: 'レスが見つかりません' });
  comment.likes = Math.max(0, (comment.likes || 0) + delta);
  saveData(db);
  res.json({ no, likes: comment.likes });
});

// 管理者によるモデレーション（注意・警告・厳重注意・BAN）
const MODERATION_LEVELS = ['注意', '警告', '厳重注意', 'BAN'];
app.post('/api/boards/:boardId/threads/:threadId/posts/:no/moderate', requireAdmin, (req, res) => {
  const boardData = db.boards[req.params.boardId];
  if (!boardData) return res.status(404).json({ error: '板が見つかりません' });
  const thread = boardData.threads[req.params.threadId];
  if (!thread) return res.status(404).json({ error: 'スレが見つかりません' });

  const no = parseInt(req.params.no, 10);
  const { level } = req.body || {};
  if (level !== null && !MODERATION_LEVELS.includes(level)) {
    return res.status(400).json({ error: '不正なレベルです' });
  }

  const moderation = level ? { level, at: Date.now() } : null;

  if (no === 1) {
    thread.moderation = moderation;
    saveData(db);
    return res.json({ no: 1, moderation });
  }
  const comment = thread.comments.find(c => c.no === no);
  if (!comment) return res.status(404).json({ error: 'レスが見つかりません' });
  comment.moderation = moderation;
  saveData(db);
  res.json({ no, moderation });
});

// 全板横断の勢いランキング
app.get('/api/ikioi', (req, res) => {
  const all = [];
  for (const b of BOARDS) {
    const boardData = db.boards[b.id];
    if (!boardData) continue;
    for (const t of Object.values(boardData.threads)) {
      const ikioi = calcIkioi(t);
      if (ikioi > 0) {
        all.push({
          boardId: b.id,
          boardName: b.name,
          id: t.id,
          title: t.title,
          resCount: t.comments.length,
          ikioi,
          isNew: (Date.now() - t.createdAt) < NEW_THREAD_THRESHOLD_MS,
        });
      }
    }
  }
  all.sort((a, b) => b.ikioi - a.ikioi);
  res.json(all.slice(0, 30));
});

app.listen(PORT, () => {
  console.log(`こっちゃんねる サーバー起動: http://localhost:${PORT}`);
  refreshAllBoards();
  setInterval(refreshAllBoards, REFRESH_INTERVAL_MS);
});
