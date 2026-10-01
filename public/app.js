const app = document.getElementById('app');
const boardNav = document.getElementById('boardNav');

let BOARDS = [];
let currentSort = 'new';
let currentUser = null;

async function loadCurrentUser() {
  if (!getUserToken()) {
    currentUser = null;
    return null;
  }
  try {
    currentUser = await fetchJSON('/api/auth/me');
    if (currentUser.username) {
      localStorage.setItem('username', currentUser.username);
      localStorage.setItem('accountMode', currentUser.accountMode || 'anonymous');
    }
    return currentUser;
  } catch (e) {
    localStorage.removeItem('userToken');
    localStorage.removeItem('username');
    localStorage.removeItem('accountMode');
    currentUser = null;
    return null;
  }
}

function isPublicAccount() {
  return !!(currentUser && currentUser.accountMode === 'public');
}

// ==== 背景のパララックススクロール ====
const bgLayer = document.getElementById('bgLayer');
const PARALLAX_FACTOR = 0.3;
let parallaxTicking = false;

function updateParallax() {
  parallaxTicking = false;
  if (!bgLayer) return;
  const maxOffset = window.innerHeight * 0.15;
  const offset = Math.max(-maxOffset, Math.min(maxOffset, window.scrollY * PARALLAX_FACTOR));
  bgLayer.style.transform = `translateY(${offset}px)`;
}

window.addEventListener('scroll', () => {
  if (!parallaxTicking) {
    parallaxTicking = true;
    requestAnimationFrame(updateParallax);
  }
}, { passive: true });

const MIN_LOADING_MS = 400;
function withMinDelay(promise, ms = MIN_LOADING_MS) {
  const delay = new Promise(resolve => setTimeout(resolve, ms));
  return Promise.all([promise, delay]).then(([result]) => result);
}

function getAdminToken() {
  return localStorage.getItem('adminToken');
}
function isAdminUI() {
  return !!getAdminToken();
}

function getUserToken() {
  return localStorage.getItem('userToken');
}
function getUsername() {
  return localStorage.getItem('username');
}
function isLoggedIn() {
  return !!getUserToken();
}

async function fetchJSON(url, opts = {}) {
  const adminToken = getAdminToken();
  const userToken = getUserToken();
  const headers = Object.assign(
    {},
    opts.headers,
    adminToken ? { 'X-Admin-Token': adminToken } : {},
    userToken ? { 'X-User-Token': userToken } : {}
  );
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  if (!res.ok) throw new Error((await res.json()).error || 'エラー');
  return res.json();
}

function escapeHTML(str) {
  return (str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function linkify(escapedText) {
  const pattern = /((?:&gt;){2,3}(\d+)(?:-(\d+))?)|(https?:\/\/[^\s]+)/g;
  return escapedText.replace(pattern, (match, anchorFull, from, to, url) => {
    if (anchorFull) {
      return `<a href="#" class="anchor-link" data-target="${from}">${anchorFull}</a>`;
    }
    if (url) {
      let trimmed = url;
      let trailing = '';
      const trailingChars = ['.', ',', ')', '」', '』', '、', '。', ';', ':'];
      while (trimmed.length > 0 && trailingChars.includes(trimmed[trimmed.length - 1])) {
        trailing = trimmed[trimmed.length - 1] + trailing;
        trimmed = trimmed.slice(0, -1);
      }
      return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer" class="post-url">${trimmed}</a>${trailing}`;
    }
    return match;
  });
}

let currentPostsMap = {};

function setupAnchorInteractions(container) {
  let popup = document.getElementById('anchorPopup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'anchorPopup';
    popup.className = 'anchor-popup';
    document.body.appendChild(popup);
  }

  container.addEventListener('mouseover', (e) => {
    const link = e.target.closest('.anchor-link');
    if (!link) return;
    const target = link.dataset.target;
    const post = currentPostsMap[target];
    if (!post) return;
    popup.innerHTML = `
      <div class="anchor-popup-head">${escapeHTML(post.name)} (&gt;&gt;&gt;${target})</div>
      <div class="anchor-popup-body">${linkify(escapeHTML(post.body))}</div>
    `;
    popup.style.display = 'block';
    const rect = link.getBoundingClientRect();
    popup.style.left = `${rect.left + window.scrollX}px`;
    popup.style.top = `${rect.bottom + window.scrollY + 4}px`;
  });

  container.addEventListener('mouseout', (e) => {
    if (e.target.closest('.anchor-link')) popup.style.display = 'none';
  });

  container.addEventListener('click', (e) => {
    const link = e.target.closest('.anchor-link');
    if (!link) return;
    e.preventDefault();
    const target = document.getElementById(`post-${link.dataset.target}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('post-highlight');
    setTimeout(() => target.classList.remove('post-highlight'), 1500);
  });
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function likedKey(boardId, threadId, no) {
  return `liked_${boardId}_${threadId}_${no}`;
}
function isLiked(boardId, threadId, no) {
  return localStorage.getItem(likedKey(boardId, threadId, no)) === '1';
}
function markLiked(boardId, threadId, no) {
  localStorage.setItem(likedKey(boardId, threadId, no), '1');
}
function unmarkLiked(boardId, threadId, no) {
  localStorage.removeItem(likedKey(boardId, threadId, no));
}

function moderationClass(level) {
  return { '注意': 'mod-caution', '警告': 'mod-warning', '厳重注意': 'mod-strict', 'BAN': 'mod-ban' }[level] || '';
}

function renderModerationBanner(moderation) {
  if (!moderation) return '';
  return `<div class="moderation-banner ${moderationClass(moderation.level)}">運営処分: ${moderation.level}</div>`;
}

function renderPostBody(bodyHTML, moderation, no) {
  if (moderation && moderation.level === 'BAN') {
    return `
      <div class="post-body">
        <div class="ban-hidden-notice">
          BAN処分によりこの投稿は非表示です。
          <button type="button" class="ban-reveal-btn" data-target="ban-content-${no}">表示する</button>
        </div>
        <div class="ban-hidden-content" id="ban-content-${no}" style="display:none">${bodyHTML}</div>
      </div>
    `;
  }
  return `<div class="post-body">${bodyHTML}</div>`;
}

function adminBadge(isAdminPost) {
  return isAdminPost ? `<span class="admin-badge">運営</span>` : '';
}

function renderFollowUserButton(targetUsername, viewerUsername, viewerFollowing, viewerCanFollow) {
  if (!targetUsername || !isLoggedIn() || viewerUsername === targetUsername || !viewerCanFollow) return '';
  const following = (viewerFollowing || []).includes(targetUsername);
  return `<button type="button" class="follow-user-btn ${following ? 'following' : ''}" data-username="${escapeHTML(targetUsername)}">${following ? 'フォロー中' : '+ フォロー'}</button>`;
}

function renderPostActions(boardId, threadId, no, likes, moderation) {
  const liked = isLiked(boardId, threadId, no);
  const currentLevel = moderation ? moderation.level : '';
  const moderationControl = isAdminUI() ? `
      <select class="moderate-select" data-board="${boardId}" data-thread="${threadId}" data-no="${no}">
        <option value="" ${currentLevel === '' ? 'selected' : ''}>モデレーション...</option>
        <option value="注意" ${currentLevel === '注意' ? 'selected' : ''}>注意</option>
        <option value="警告" ${currentLevel === '警告' ? 'selected' : ''}>警告</option>
        <option value="厳重注意" ${currentLevel === '厳重注意' ? 'selected' : ''}>厳重注意</option>
        <option value="BAN" ${currentLevel === 'BAN' ? 'selected' : ''}>BAN</option>
        ${currentLevel ? `<option value="__clear__">解除</option>` : ''}
      </select>
  ` : '';
  return `
    <div class="post-actions">
      <button class="reply-btn" data-no="${no}">↩ 返信</button>
      <button class="like-btn ${liked ? 'liked' : ''}" data-board="${boardId}" data-thread="${threadId}" data-no="${no}">
        <span class="like-heart">${liked ? '❤️' : '🤍'}</span> <span class="like-count">${likes}</span>
      </button>
      ${moderationControl}
    </div>
  `;
}

function toggleMiniReply(postEl, boardId, threadId) {
  const no = postEl.id.replace('post-', '');
  const existing = postEl.querySelector('.mini-reply-form');

  document.querySelectorAll('.mini-reply-form').forEach(f => f.remove());
  if (existing) return;

  const form = document.createElement('div');
  form.className = 'mini-reply-form';
  form.innerHTML = `
    <input type="text" class="mini-name" placeholder="名前（省略可）" maxlength="30">
    <textarea class="mini-text" maxlength="1000"></textarea>
    <div class="mini-actions">
      <button type="button" class="mini-submit">送信</button>
      <button type="button" class="mini-cancel">キャンセル</button>
      <span class="mini-error"></span>
    </div>
  `;
  postEl.appendChild(form);

  const textArea = form.querySelector('.mini-text');
  textArea.value = `>>>${no} `;
  textArea.focus();
  textArea.setSelectionRange(textArea.value.length, textArea.value.length);

  form.querySelector('.mini-cancel').addEventListener('click', () => form.remove());

  form.querySelector('.mini-submit').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const name = form.querySelector('.mini-name').value;
    const text = textArea.value;
    const errEl = form.querySelector('.mini-error');
    errEl.textContent = '';
    if (!text.trim()) {
      errEl.textContent = '本文を入力してください';
      return;
    }
    setButtonLoading(btn, true);
    try {
      await fetchJSON(`/api/boards/${boardId}/threads/${threadId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, text }),
      });
      renderThread(boardId, threadId);
    } catch (e) {
      errEl.textContent = e.message;
      setButtonLoading(btn, false);
    }
  });
}

const CATEGORY_LABELS = {
  tech: '技術',
  life: '雑談・相談',
  study: '学問・雑学',
  meta: 'サイト運営',
};

const CATEGORY_NAV_KEYS = ['tech', 'life', 'study', 'meta'];

let AD_SLOTS_HTML = {};

async function loadAdSlots() {
  try {
    AD_SLOTS_HTML = await fetchJSON('/api/ads');
  } catch (e) {
    AD_SLOTS_HTML = {};
  }
}

function adSlot(slotId, extraClass = '') {
  if (!AD_SLOTS_HTML[slotId]) return '';
  return `<div class="ad-slot ${extraClass}" data-slot="${slotId}"></div>`;
}

function injectAdSlots() {
  document.querySelectorAll('.ad-slot[data-slot]:not([data-injected])').forEach(el => {
    const html = AD_SLOTS_HTML[el.dataset.slot];
    if (!html) return;
    el.dataset.injected = '1';
    const temp = document.createElement('div');
    temp.innerHTML = html;
    Array.from(temp.childNodes).forEach(node => {
      if (node.tagName === 'SCRIPT') {
        const script = document.createElement('script');
        Array.from(node.attributes).forEach(attr => script.setAttribute(attr.name, attr.value));
        script.textContent = node.textContent;
        el.appendChild(script);
      } else {
        el.appendChild(node);
      }
    });
  });
}

async function initNav() {
  BOARDS = await fetchJSON('/api/boards');
  const navLink = b => `<a href="#/board/${b.id}" data-nav="${b.id}">${escapeHTML(b.name)}${b.isRoom ? ' 🏠' : ''}</a>`;

  const newsBoards = BOARDS.filter(b => !b.category || b.category === 'news');
  let html = `
    <a href="#/" data-nav="top">🔥 全板勢いランキング</a>
    <a href="#/archive" data-nav="archive">📦 みんなのアーカイブ</a>
  ` + newsBoards.map(navLink).join('');

  if (isLoggedIn()) {
    const myRooms = BOARDS.filter(b => b.isRoom && b.isMine);
    const otherRooms = BOARDS.filter(b => b.isRoom && !b.isMine);
    if (myRooms.length > 0 || otherRooms.length > 0) {
      html += `<button type="button" class="category-toggle" data-cat="room">🏠 部屋<span class="arrow"></span></button>`;
      html += `<div class="category-panel" data-cat="room"><div class="category-panel-inner">`;
      html += myRooms.map(navLink).join('');
      html += otherRooms.map(navLink).join('');
      html += `<a href="#/rooms" data-nav="rooms" class="category-panel-link room-create-link">＋ 部屋を作る</a>`;
      html += `</div></div>`;
    } else {
      html += `<a href="#/rooms" data-nav="rooms" class="nav-room-link">🏠 部屋を作る</a>`;
    }
  }

  for (const key of CATEGORY_NAV_KEYS) {
    const label = CATEGORY_LABELS[key];
    const boards = BOARDS.filter(b => b.category === key);
    if (boards.length === 0) continue;
    html += `
      <button type="button" class="category-toggle" data-cat="${key}">${escapeHTML(label)}<span class="arrow"></span></button>
      <div class="category-panel" data-cat="${key}">
        <div class="category-panel-inner">
          ${boards.map(b => `<a href="#/board/${b.id}" data-nav="${b.id}" class="category-panel-link">${escapeHTML(b.name)}</a>`).join('')}
        </div>
      </div>
    `;
  }

  boardNav.innerHTML = html;
  setupCategoryToggles();
}

function closeAllCategoryPanels() {
  boardNav.querySelectorAll('.category-panel.open').forEach(p => p.classList.remove('open'));
  boardNav.querySelectorAll('.category-toggle.open').forEach(t => t.classList.remove('open'));
}

function setupCategoryToggles() {
  const toggles = boardNav.querySelectorAll('.category-toggle');

  toggles.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cat = btn.dataset.cat;
      const panel = boardNav.querySelector(`.category-panel[data-cat="${cat}"]`);
      const isOpen = panel.classList.contains('open');
      closeAllCategoryPanels();
      if (!isOpen) {
        panel.classList.add('open');
        btn.classList.add('open');
      }
    });
  });

  boardNav.querySelectorAll('.category-panel-link').forEach(link => {
    link.addEventListener('click', closeAllCategoryPanels);
  });

  document.addEventListener('click', closeAllCategoryPanels);
}

function highlightNav(active) {
  boardNav.querySelectorAll('a').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === active);
  });
}

const newBadgeElapsed = new Map();

function newBadgeKey(boardId, threadId) {
  return `seenNew_${boardId}_${threadId}`;
}
function isSeenNew(boardId, threadId) {
  return localStorage.getItem(newBadgeKey(boardId, threadId)) === '1';
}
function markSeenNew(boardId, threadId) {
  localStorage.setItem(newBadgeKey(boardId, threadId), '1');
}

function trackNewBadge(boardId, threadId, badgeEl) {
  const key = `${boardId}:${threadId}`;
  if (!newBadgeElapsed.has(key)) newBadgeElapsed.set(key, 0);

  const intervalId = setInterval(() => {
    if (!document.body.contains(badgeEl)) {
      clearInterval(intervalId);
      return;
    }
    if (document.hidden) return;

    const elapsed = newBadgeElapsed.get(key) + 200;
    newBadgeElapsed.set(key, elapsed);

    if (elapsed >= 3000) {
      badgeEl.classList.add('faded');
      markSeenNew(boardId, threadId);
      clearInterval(intervalId);
    }
  }, 200);
}

function trackAllVisibleNewBadges() {
  document.querySelectorAll('.new-badge[data-board]').forEach(el => {
    trackNewBadge(el.dataset.board, el.dataset.thread, el);
  });
}

function skeletonThreadList(rows = 5, withBoardCol = false) {
  const row = () => `
    <div class="skeleton-row">
      <div class="skeleton-line" style="width:18px"></div>
      ${withBoardCol ? `<div class="skeleton-line" style="width:70px"></div>` : ''}
      <div class="skeleton-line" style="flex:1; width:${40 + Math.random() * 40}%"></div>
      <div class="skeleton-line" style="width:36px"></div>
      <div class="skeleton-line" style="width:32px"></div>
    </div>
  `;
  return `<div class="skeleton skeleton-table">${Array.from({ length: rows }).map(row).join('')}</div>`;
}

function skeletonThreadDetail() {
  return `
    <div class="skeleton-thread-header">
      <div class="skeleton-line" style="width:65%; height:18px;"></div>
      <div class="skeleton-line" style="width:35%; height:11px; margin-top:6px;"></div>
    </div>
    <div class="skeleton">
      ${Array.from({ length: 2 }).map(() => `
        <div class="skeleton-post">
          <div class="skeleton-line" style="width:90px; height:11px;"></div>
          <div class="skeleton-line" style="width:95%; margin-top:7px;"></div>
          <div class="skeleton-line" style="width:60%; margin-top:5px;"></div>
        </div>
      `).join('')}
    </div>
  `;
}

function setButtonLoading(btn, loading, loadingLabel) {
  if (loading) {
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<span class="loader loader-small"></span>${loadingLabel || '送信中...'}`;
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.originalText || btn.textContent;
  }
}

function loaderSpinner() {
  return `<div class="loader-wrap"><div class="loader"></div></div>`;
}

function renderAdminAuthArea() {
  const area = document.getElementById('adminAuthArea');
  if (!area) return;

  if (isAdminUI()) {
    area.innerHTML = `
      <span class="admin-status">運営としてログイン中</span>
      <button type="button" id="adminAdsToggle">広告管理</button>
      <button type="button" id="adminLogoutBtn">ログアウト</button>
      <div id="adminAdsPanel" class="admin-ads-panel" style="display:none"></div>
    `;
    document.getElementById('adminAdsToggle').addEventListener('click', () => {
      const panel = document.getElementById('adminAdsPanel');
      const opening = panel.style.display === 'none';
      panel.style.display = opening ? 'block' : 'none';
      if (opening) loadAdminAdsPanel();
    });
    document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
      try {
        await fetchJSON('/api/admin/logout', { method: 'POST' });
      } catch (e) { }
      localStorage.removeItem('adminToken');
      renderAdminAuthArea();
      router();
    });
  } else {
    area.innerHTML = `
      <button type="button" id="adminLoginToggle">管理者ログイン</button>
      <div id="adminLoginForm" class="admin-login-form" style="display:none">
        <input type="email" id="adminEmail" placeholder="メールアドレス">
        <input type="password" id="adminPassword" placeholder="パスワード">
        <button type="button" id="adminLoginSubmit">ログイン</button>
        <span id="adminLoginError" class="mini-error"></span>
      </div>
    `;
    document.getElementById('adminLoginToggle').addEventListener('click', () => {
      const form = document.getElementById('adminLoginForm');
      form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    });
    document.getElementById('adminLoginSubmit').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const email = document.getElementById('adminEmail').value.trim();
      const password = document.getElementById('adminPassword').value;
      const errEl = document.getElementById('adminLoginError');
      errEl.textContent = '';
      setButtonLoading(btn, true, 'ログイン中...');
      try {
        const result = await fetchJSON('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        localStorage.setItem('adminToken', result.token);
        renderAdminAuthArea();
        router();
      } catch (err) {
        errEl.textContent = err.message;
        setButtonLoading(btn, false);
      }
    });
  }
}

function renderUserAuthArea() {
  const area = document.getElementById('userAuthArea');
  if (!area) return;

  if (isLoggedIn()) {
    const label = isPublicAccount() && currentUser && currentUser.displayName
      ? escapeHTML(currentUser.displayName)
      : escapeHTML(getUsername());
    area.innerHTML = `
      <a href="#/mypage" class="user-status">${label}さん</a>
      ${isPublicAccount() ? `<a href="#/dm" class="user-dm-link">DM</a>` : ''}
      <button type="button" id="userLogoutBtn">ログアウト</button>
    `;
    document.getElementById('userLogoutBtn').addEventListener('click', async () => {
      try {
        await fetchJSON('/api/auth/logout', { method: 'POST' });
      } catch (e) { }
      localStorage.removeItem('userToken');
      localStorage.removeItem('username');
      localStorage.removeItem('accountMode');
      currentUser = null;
      renderUserAuthArea();
      await initNav();
      router();
    });
  } else {
    area.innerHTML = `<a href="#/login" class="user-login-link">ログイン</a>`;
  }
}

async function renderLoginPage() {
  if (isLoggedIn()) {
    location.hash = '#/mypage';
    return;
  }
  app.innerHTML = `
    <div class="login-page">
      <h2>ログイン / 新規登録</h2>
      <p class="login-page-note">ログインすると部屋の作成などが利用できます。公開モードではフォロー・DM・プロフィールも使えます。</p>
      <input type="text" id="userAuthName" placeholder="ユーザー名">
      <input type="password" id="userAuthPassword" placeholder="パスワード">
      <div class="account-mode-select">
        <p class="account-mode-label">アカウントモード（新規登録時）</p>
        <label class="mode-option">
          <input type="radio" name="accountMode" value="anonymous" checked>
          <span class="mode-title">匿名モード</span>
          <span class="mode-desc">名無しさん@ユーザー名で投稿。フォロー・DM・プロフィールは不可。</span>
        </label>
        <label class="mode-option">
          <input type="radio" name="accountMode" value="public">
          <span class="mode-title">公開モード</span>
          <span class="mode-desc">表示名・プロフィール・フォロー・DM・部屋作成が利用可能。</span>
        </label>
      </div>
      <div class="login-page-actions">
        <button type="button" id="userLoginSubmit">ログイン</button>
        <button type="button" id="userRegisterSubmit">新規登録</button>
      </div>
      <span id="userAuthError" class="mini-error"></span>
    </div>
  `;

  const handleAuth = async (endpoint, btn, isRegister) => {
    const username = document.getElementById('userAuthName').value.trim();
    const password = document.getElementById('userAuthPassword').value;
    const errEl = document.getElementById('userAuthError');
    errEl.textContent = '';
    setButtonLoading(btn, true, '処理中...');
    try {
      const body = { username, password };
      if (isRegister) {
        const modeEl = document.querySelector('input[name="accountMode"]:checked');
        body.accountMode = modeEl ? modeEl.value : 'anonymous';
      }
      const result = await fetchJSON(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      localStorage.setItem('userToken', result.token);
      localStorage.setItem('username', result.username);
      localStorage.setItem('accountMode', result.accountMode || 'anonymous');
      await loadCurrentUser();
      renderUserAuthArea();
      await initNav();
      location.hash = '#/mypage';
    } catch (err) {
      errEl.textContent = err.message;
      setButtonLoading(btn, false);
    }
  };

  document.getElementById('userLoginSubmit').addEventListener('click', (e) => handleAuth('/api/auth/login', e.currentTarget, false));
  document.getElementById('userRegisterSubmit').addEventListener('click', (e) => handleAuth('/api/auth/register', e.currentTarget, true));
}

async function loadAdminAdsPanel() {
  const panel = document.getElementById('adminAdsPanel');
  if (!panel) return;
  panel.innerHTML = `<div class="loader-wrap" style="padding:16px"><div class="loader loader-small"></div>読み込み中...</div>`;
  try {
    const { slots, config } = await fetchJSON('/api/admin/ads');
    panel.innerHTML = `
      <p class="admin-ads-note">外部広告（AdSenseなどの埋め込みタグ）のHTMLを貼り付けて有効化できます。空欄・無効の間は何も表示されません。</p>
      ${slots.map(s => {
        const conf = config[s.id] || { enabled: false, html: '' };
        return `
          <div class="admin-ads-slot" data-slot="${s.id}">
            <label class="admin-ads-slot-label">
              <input type="checkbox" class="ads-enabled" ${conf.enabled ? 'checked' : ''}>
              ${escapeHTML(s.label)}
            </label>
            <textarea class="ads-html" placeholder="広告コード（HTML/埋め込みタグ）を貼り付け">${escapeHTML(conf.html || '')}</textarea>
            <button type="button" class="ads-save">保存</button>
            <span class="ads-save-status"></span>
          </div>
        `;
      }).join('')}
    `;

    panel.querySelectorAll('.admin-ads-slot').forEach(slotEl => {
      slotEl.querySelector('.ads-save').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const slotId = slotEl.dataset.slot;
        const enabled = slotEl.querySelector('.ads-enabled').checked;
        const html = slotEl.querySelector('.ads-html').value;
        const statusEl = slotEl.querySelector('.ads-save-status');
        setButtonLoading(btn, true, '保存中...');
        statusEl.textContent = '';
        try {
          await fetchJSON(`/api/admin/ads/${slotId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled, html }),
          });
          await loadAdSlots();
          statusEl.textContent = '保存しました';
        } catch (err) {
          statusEl.textContent = err.message;
        } finally {
          setButtonLoading(btn, false);
        }
      });
    });
  } catch (e) {
    panel.innerHTML = `<div class="empty">読み込みに失敗しました: ${escapeHTML(e.message)}</div>`;
  }
}

async function renderAnnounceBox() {
  try {
    const threads = await fetchJSON('/api/boards/announce/threads?sort=new');
    const items = threads.slice(0, 6);
    if (items.length === 0) {
      return `
        <div class="announce-box">
          <h3>📢 お知らせ</h3>
          <div class="announce-empty">まだお知らせはありません</div>
        </div>
      `;
    }
    return `
      <div class="announce-box">
        <h3>📢 お知らせ</h3>
        <ul class="announce-list">
          ${items.map(t => `
            <li>
              <a href="#/board/announce/thread/${t.id}">${escapeHTML(t.title)}</a>
              ${(t.isNew && !isSeenNew('announce', t.id)) ? `<span class="new-badge" data-board="announce" data-thread="${t.id}">NEW</span>` : ''}
            </li>
          `).join('')}
        </ul>
        <a class="announce-more" href="#/board/announce">すべて見る &raquo;</a>
      </div>
    `;
  } catch (e) {
    return `<div class="announce-box"><h3>📢 お知らせ</h3><div class="announce-empty">読み込みに失敗しました</div></div>`;
  }
}

async function renderMyPage() {
  if (!isLoggedIn()) {
    app.innerHTML = `<div class="empty">マイページを見るには<a href="#/login">ログイン</a>してください</div>`;
    return;
  }
  app.innerHTML = skeletonThreadList(4);
  try {
    await loadCurrentUser();
    const data = await withMinDelay(fetchJSON('/api/me/following'));
    const modeLabel = data.accountMode === 'public' ? '公開モード' : '匿名モード';
    const headingName = data.accountMode === 'public' && data.displayName ? data.displayName : getUsername();

    const profileSection = data.accountMode === 'public' ? `
      <section class="mypage-section">
        <h3>プロフィール設定</h3>
        <div class="profile-form">
          <label>表示名<input type="text" id="profileDisplayName" maxlength="20" value="${escapeHTML(data.displayName || getUsername())}"></label>
          <label>自己紹介<textarea id="profileBio" maxlength="200">${escapeHTML(data.bio || '')}</textarea></label>
          <button type="button" id="profileSaveBtn">プロフィールを保存</button>
          <span id="profileSaveStatus" class="mini-error"></span>
        </div>
      </section>
    ` : `
      <section class="mypage-section mypage-upgrade">
        <h3>アカウントモード</h3>
        <p>現在: <strong>${modeLabel}</strong>（フォロー・DM・プロフィールは利用できません）</p>
        <button type="button" id="upgradePublicBtn">公開モードに切り替える</button>
        <span id="upgradeStatus" class="mini-error"></span>
      </section>
    `;

    const roomsHTML = `
      <section class="mypage-section">
        <h3>自分の部屋（${data.rooms.length}/${data.roomLimit}）</h3>
        ${data.rooms.length === 0
          ? `<div class="empty">まだ部屋がありません。<a href="#/rooms">部屋を作る</a></div>`
          : `<div class="mypage-room-list">${data.rooms.map(r => `
              <div class="mypage-room-row">
                <a href="#/board/${r.id}">${escapeHTML(r.name)}</a>
                <button type="button" class="delete-room-btn" data-room="${r.id}">削除</button>
              </div>`).join('')}</div>`
        }
        ${data.rooms.length < data.roomLimit ? `<a href="#/rooms" class="room-create-btn">＋ 部屋を作る</a>` : ''}
      </section>
    `;

    const followSections = data.accountMode === 'public' ? `
      <section class="mypage-section">
        <h3>フォロー中のスレッド</h3>
        ${data.threads.length === 0 ? `<div class="empty">フォロー中のスレッドはまだありません</div>` : `
          <table class="thread-list">
            <thead><tr><th></th><th>板</th><th>スレッドタイトル</th><th>レス</th></tr></thead>
            <tbody>${data.threads.map((t, i) => `
              <tr onclick="location.hash='#/board/${t.boardId}/thread/${t.threadId}'" style="cursor:pointer">
                <td class="thread-num">${i + 1}</td>
                <td style="font-size:12px;color:#666">${escapeHTML(t.boardName)}</td>
                <td>${escapeHTML(t.title)}</td>
                <td class="thread-res">${t.resCount}</td>
              </tr>`).join('')}</tbody>
          </table>`}
      </section>
      <section class="mypage-section">
        <h3>フォロー中のユーザー</h3>
        ${data.users.length === 0 ? `<div class="empty">フォロー中のユーザーはまだいません</div>` : `
          <div class="mypage-user-list">${data.users.map(u => `
            <div class="mypage-user-row">
              <a href="#/user/${u.username}" class="mypage-username">${escapeHTML(u.displayName || u.username)}</a>
              <span class="mypage-follower-count">フォロワー ${u.followerCount}人</span>
              <button type="button" class="unfollow-user-btn" data-username="${escapeHTML(u.username)}">フォロー解除</button>
            </div>`).join('')}</div>`}
      </section>
    ` : '';

    app.innerHTML = `
      <h2 class="mypage-heading">${escapeHTML(headingName)}さんのマイページ</h2>
      <p class="mypage-mode-badge">${modeLabel}</p>
      ${profileSection}
      ${roomsHTML}
      ${followSections}
    `;

    const profileSaveBtn = document.getElementById('profileSaveBtn');
    if (profileSaveBtn) {
      profileSaveBtn.addEventListener('click', async () => {
        const statusEl = document.getElementById('profileSaveStatus');
        statusEl.textContent = '';
        try {
          await fetchJSON('/api/me/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              displayName: document.getElementById('profileDisplayName').value,
              bio: document.getElementById('profileBio').value,
            }),
          });
          await loadCurrentUser();
          renderUserAuthArea();
          statusEl.textContent = '保存しました';
          statusEl.style.color = '#2a7a2a';
        } catch (e) {
          statusEl.textContent = e.message;
        }
      });
    }

    const upgradeBtn = document.getElementById('upgradePublicBtn');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', async () => {
        const statusEl = document.getElementById('upgradeStatus');
        statusEl.textContent = '';
        try {
          await fetchJSON('/api/me/upgrade-public', { method: 'POST' });
          await loadCurrentUser();
          renderUserAuthArea();
          renderMyPage();
        } catch (e) {
          statusEl.textContent = e.message;
        }
      });
    }

    app.querySelectorAll('.unfollow-user-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await fetchJSON(`/api/users/${btn.dataset.username}/follow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ follow: false }),
          });
          renderMyPage();
        } catch (e) {
          btn.disabled = false;
        }
      });
    });

    app.querySelectorAll('.delete-room-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('この部屋を削除しますか？')) return;
        btn.disabled = true;
        try {
          await fetchJSON(`/api/rooms/${btn.dataset.room}`, { method: 'DELETE' });
          await initNav();
          renderMyPage();
        } catch (e) {
          alert(e.message);
          btn.disabled = false;
        }
      });
    });
  } catch (e) {
    app.innerHTML = `<div class="empty">読み込みに失敗しました: ${escapeHTML(e.message)}</div>`;
  }
}

async function renderArchive() {
  highlightNav('archive');
  app.innerHTML = skeletonThreadList(5);
  try {
    const boards = await withMinDelay(fetchJSON('/api/boards?archived=1'));
    app.innerHTML = `
      <h2 class="archive-heading">📦 みんなのアーカイブ</h2>
      <p class="archive-note">アーカイブされた板は閲覧のみ可能です。</p>
      ${boards.length === 0 ? `<div class="empty">アーカイブされた板はまだありません</div>` : `
        <table class="thread-list">
          <thead><tr><th></th><th>板名</th><th>カテゴリ</th><th>アーカイブ日</th></tr></thead>
          <tbody>${boards.map((b, i) => `
            <tr onclick="location.hash='#/board/${b.id}'" style="cursor:pointer">
              <td class="thread-num">${i + 1}</td>
              <td>${escapeHTML(b.name)}</td>
              <td style="font-size:12px;color:#666">${escapeHTML(CATEGORY_LABELS[b.category] || b.category)}</td>
              <td style="font-size:12px;color:#666">${b.archivedAt ? formatDate(b.archivedAt) : '—'}</td>
            </tr>`).join('')}</tbody>
        </table>`}
    `;
  } catch (e) {
    app.innerHTML = `<div class="empty">読み込みに失敗しました: ${escapeHTML(e.message)}</div>`;
  }
}

async function renderRoomsPage() {
  highlightNav('rooms');
  if (!isLoggedIn()) {
    app.innerHTML = `<div class="empty">部屋を作るには<a href="#/login">ログイン</a>してください</div>`;
    return;
  }
  app.innerHTML = loaderSpinner();
  try {
    const data = await fetchJSON('/api/rooms');
    app.innerHTML = `
      <h2 class="rooms-heading">🏠 部屋を作る</h2>
      <p class="rooms-note">ログイン中のユーザーだけが入れる部屋です。同時に${data.limit}個まで。（現在: ${data.count}/${data.limit}）</p>
      ${data.count >= data.limit ? `<div class="empty">上限に達しています。不要な部屋を削除してください。</div>` : `
        <div class="room-create-form">
          <input type="text" id="roomNameInput" placeholder="部屋の名前" maxlength="30">
          <button type="button" id="roomCreateBtn">部屋を作成</button>
          <span id="roomCreateError" class="mini-error"></span>
        </div>`}
      ${data.rooms.length > 0 ? `
        <section class="mypage-section">
          <h3>作成済みの部屋</h3>
          <div class="mypage-room-list">${data.rooms.map(r => `
            <div class="mypage-room-row">
              <a href="#/board/${r.id}">${escapeHTML(r.name)}</a>
              <button type="button" class="delete-room-btn" data-room="${r.id}">削除</button>
            </div>`).join('')}</div>
        </section>` : ''}
    `;
    const createBtn = document.getElementById('roomCreateBtn');
    if (createBtn) {
      createBtn.addEventListener('click', async () => {
        const name = document.getElementById('roomNameInput').value.trim();
        const errEl = document.getElementById('roomCreateError');
        errEl.textContent = '';
        if (!name) { errEl.textContent = '部屋の名前を入力してください'; return; }
        setButtonLoading(createBtn, true, '作成中...');
        try {
          const room = await fetchJSON('/api/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          });
          await initNav();
          location.hash = `#/board/${room.id}`;
        } catch (e) {
          errEl.textContent = e.message;
          setButtonLoading(createBtn, false);
        }
      });
    }
    app.querySelectorAll('.delete-room-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('この部屋を削除しますか？')) return;
        try {
          await fetchJSON(`/api/rooms/${btn.dataset.room}`, { method: 'DELETE' });
          await initNav();
          renderRoomsPage();
        } catch (e) { alert(e.message); }
      });
    });
  } catch (e) {
    app.innerHTML = `<div class="empty">読み込みに失敗しました: ${escapeHTML(e.message)}</div>`;
  }
}

async function renderUserProfile(username) {
  app.innerHTML = loaderSpinner();
  try {
    const profile = await fetchJSON(`/api/users/${username}`);
    if (!profile.isPublic) {
      app.innerHTML = `<div class="empty">このユーザーは匿名モードのため、プロフィールは公開されていません</div>`;
      return;
    }
    app.innerHTML = `
      <div class="user-profile">
        <h2>${escapeHTML(profile.displayName || profile.username)}</h2>
        <p class="user-profile-id">@${escapeHTML(profile.username)}</p>
        ${profile.bio ? `<p class="user-profile-bio">${escapeHTML(profile.bio)}</p>` : ''}
        <p class="user-profile-stats">フォロワー ${profile.followerCount}人 ／ フォロー ${profile.followingCount}人</p>
        <div class="user-profile-actions">
          ${isPublicAccount() && profile.username !== getUsername() ? `
            <button type="button" id="profileFollowBtn" class="follow-user-btn ${profile.isFollowedByMe ? 'following' : ''}" data-username="${escapeHTML(username)}">
              ${profile.isFollowedByMe ? 'フォロー中' : '+ フォロー'}
            </button>` : ''}
          ${profile.canDm ? `<a href="#/dm/${username}" class="dm-link-btn">DMを送る</a>` : ''}
        </div>
      </div>`;
    const followBtn = document.getElementById('profileFollowBtn');
    if (followBtn) {
      followBtn.addEventListener('click', async () => {
        const newFollowing = !followBtn.classList.contains('following');
        followBtn.disabled = true;
        try {
          await fetchJSON(`/api/users/${username}/follow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ follow: newFollowing }),
          });
          renderUserProfile(username);
        } catch (e) {
          alert(e.message);
          followBtn.disabled = false;
        }
      });
    }
  } catch (e) {
    app.innerHTML = `<div class="empty">読み込みに失敗しました: ${escapeHTML(e.message)}</div>`;
  }
}

async function renderDmList() {
  if (!isPublicAccount()) {
    app.innerHTML = `<div class="empty">DMは公開モードのアカウントのみ利用できます</div>`;
    return;
  }
  app.innerHTML = loaderSpinner();
  try {
    const convs = await fetchJSON('/api/dm/conversations');
    app.innerHTML = `
      <h2 class="dm-heading">💬 DM</h2>
      ${convs.length === 0 ? `<div class="empty">まだDMのやりとりはありません</div>` : `
        <div class="dm-conv-list">${convs.map(c => `
          <a href="#/dm/${c.with}" class="dm-conv-row">
            <span class="dm-conv-name">${escapeHTML(c.displayName || c.with)}</span>
            <span class="dm-conv-preview">${escapeHTML(c.lastMessage || '')}</span>
            ${c.unread ? `<span class="dm-unread">${c.unread}</span>` : ''}
          </a>`).join('')}</div>`}
    `;
  } catch (e) {
    app.innerHTML = `<div class="empty">読み込みに失敗しました: ${escapeHTML(e.message)}</div>`;
  }
}

async function renderDmChat(username) {
  if (!isPublicAccount()) {
    app.innerHTML = `<div class="empty">DMは公開モードのアカウントのみ利用できます</div>`;
    return;
  }
  app.innerHTML = loaderSpinner();
  try {
    const chat = await fetchJSON(`/api/dm/${username}`);
    app.innerHTML = `
      <a class="back-link" href="#/dm">&laquo; DM一覧に戻る</a>
      <h2 class="dm-heading">💬 ${escapeHTML(chat.displayName || username)}</h2>
      <div class="dm-messages" id="dmMessages">
        ${chat.messages.length === 0 ? `<div class="empty">まだメッセージはありません</div>` : chat.messages.map(m => `
          <div class="dm-msg ${m.from === getUsername() ? 'dm-msg-mine' : 'dm-msg-other'}">
            <span class="dm-msg-from">${escapeHTML(m.from === getUsername() ? '自分' : (chat.displayName || m.from))}</span>
            <span class="dm-msg-text">${escapeHTML(m.text)}</span>
            <span class="dm-msg-date">${formatDate(m.at)}</span>
          </div>`).join('')}
      </div>
      <div class="dm-compose">
        <textarea id="dmTextInput" placeholder="メッセージを入力..." maxlength="500"></textarea>
        <button type="button" id="dmSendBtn">送信</button>
        <span id="dmSendError" class="mini-error"></span>
      </div>`;
    const msgsEl = document.getElementById('dmMessages');
    if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
    document.getElementById('dmSendBtn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const text = document.getElementById('dmTextInput').value;
      const errEl = document.getElementById('dmSendError');
      errEl.textContent = '';
      if (!text.trim()) { errEl.textContent = 'メッセージを入力してください'; return; }
      setButtonLoading(btn, true);
      try {
        await fetchJSON(`/api/dm/${username}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        renderDmChat(username);
      } catch (err) {
        errEl.textContent = err.message;
        setButtonLoading(btn, false);
      }
    });
  } catch (e) {
    app.innerHTML = `<div class="empty">読み込みに失敗しました: ${escapeHTML(e.message)}</div>`;
  }
}

async function renderTop() {
  highlightNav('top');
  app.innerHTML = skeletonThreadList(5, true);
  try {
    const [items, announceHTML] = await withMinDelay(
      Promise.all([fetchJSON('/api/ikioi'), renderAnnounceBox()])
    );

    const mainHTML = items.length === 0
      ? `<div class="empty">まだ勢いのあるスレはありません。板を見てレスしてみよう！</div>`
      : `
        <table class="thread-list">
          <thead><tr><th></th><th>板</th><th>スレッドタイトル</th><th>レス</th><th>勢い</th></tr></thead>
          <tbody>
            ${items.map((t, i) => `
              <tr onclick="location.hash='#/board/${t.boardId}/thread/${t.id}'" style="cursor:pointer">
                <td class="thread-num">${i + 1}</td>
                <td style="font-size:12px;color:#666">${escapeHTML(t.boardName)}</td>
                <td>${escapeHTML(t.title)}${(t.isNew && !isSeenNew(t.boardId, t.id)) ? `<span class="new-badge" data-board="${t.boardId}" data-thread="${t.id}">NEW</span>` : ''}</td>
                <td class="thread-res">${t.resCount}</td>
                <td class="thread-ikioi">${t.ikioi}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

    app.innerHTML = `
      ${adSlot('top-banner', 'ad-top-banner')}
      <div class="top-layout">
        <div class="top-main">${mainHTML}</div>
        <div class="top-side">
          ${announceHTML}
          ${adSlot('sidebar', 'ad-sidebar')}
        </div>
      </div>
    `;
    trackAllVisibleNewBadges();
    injectAdSlots();
  } catch (e) {
    app.innerHTML = `<div class="empty">読み込みに失敗しました: ${escapeHTML(e.message)}</div>`;
  }
}

async function renderBoard(boardId, sort) {
  currentSort = sort || 'new';
  highlightNav(boardId);
  app.innerHTML = skeletonThreadList(5);
  const board = BOARDS.find(b => b.id === boardId);
  try {
    const threads = await withMinDelay(fetchJSON(`/api/boards/${boardId}/threads?sort=${currentSort}`));
    const sortLinks = [
      ['new', '新着順'],
      ['res', 'レス数順'],
      ['ikioi', '勢い順'],
    ].map(([key, label]) =>
      `<a href="#/board/${boardId}?sort=${key}" class="${key === currentSort ? 'active' : ''}">${label}</a>`
    ).join('');

    const isArchived = board && board.archived;
    const isRoom = board && board.isRoom;
    const canCreateThread = !isArchived && (boardId !== 'announce' || isAdminUI());
    const boardHeader = `
      <div class="board-header">
        <h2>${board ? escapeHTML(board.name) : boardId}${isRoom ? ' 🏠' : ''}${isArchived ? ' <span class="archived-badge">アーカイブ</span>' : ''}</h2>
        ${isRoom && board.owner ? `<p class="board-room-owner">オーナー: <a href="#/user/${board.owner}">${escapeHTML(board.owner)}</a></p>` : ''}
        ${isAdminUI() && board && !isRoom ? `
          <button type="button" id="adminArchiveBtn" class="admin-archive-btn" data-board="${boardId}" data-archived="${isArchived ? '1' : '0'}">
            ${isArchived ? 'アーカイブ解除' : '板をアーカイブ'}
          </button>` : ''}
      </div>`;
    const newThreadBar = canCreateThread ? `
      <div class="new-thread-bar">
        <button id="newThreadToggle" type="button">＋ 新規スレッド作成</button>
      </div>
      <div id="newThreadForm" class="new-thread-form" style="display:none">
        <input type="text" id="newThreadTitle" placeholder="スレッドタイトル" maxlength="100">
        <textarea id="newThreadBody" placeholder="本文（省略可）" maxlength="800"></textarea>
        <div class="mini-actions">
          <button type="button" id="newThreadSubmit">スレ立てる</button>
          <button type="button" id="newThreadCancel">キャンセル</button>
          <span id="newThreadError" class="mini-error"></span>
        </div>
      </div>
    ` : isArchived
      ? `<div class="announce-restricted">この板はアーカイブされています（閲覧のみ）</div>`
      : (boardId === 'announce' ? `<div class="announce-restricted">この板には管理者のみ投稿できます</div>` : '');

    if (threads.length === 0) {
      app.innerHTML = `
        ${adSlot('top-banner', 'ad-top-banner')}
        ${boardHeader}
        <div class="sort-bar"><span>並び替え:</span>${sortLinks}</div>
        ${newThreadBar}
        <div class="empty">この板にはまだスレがありません。${canCreateThread ? '最初のスレを立ててみましょう！' : ''}</div>
      `;
      setupNewThreadForm(boardId);
      setupAdminArchiveBtn();
      injectAdSlots();
      return;
    }

    app.innerHTML = `
      ${adSlot('top-banner', 'ad-top-banner')}
      ${boardHeader}
      <div class="sort-bar"><span>並び替え:</span>${sortLinks}</div>
      ${newThreadBar}
      <table class="thread-list">
        <thead><tr><th></th><th>スレッドタイトル</th><th>レス</th><th>勢い</th></tr></thead>
        <tbody>
          ${threads.map((t, i) => `
            <tr onclick="location.hash='#/board/${boardId}/thread/${t.id}'" style="cursor:pointer">
              <td class="thread-num">${i + 1}</td>
              <td>${escapeHTML(t.title)}${(t.isNew && !isSeenNew(boardId, t.id)) ? `<span class="new-badge" data-board="${boardId}" data-thread="${t.id}">NEW</span>` : ''}</td>
              <td class="thread-res">${t.resCount}</td>
              <td class="thread-ikioi">${t.ikioi > 0 ? t.ikioi : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    setupNewThreadForm(boardId);
    setupAdminArchiveBtn();
    trackAllVisibleNewBadges();
    injectAdSlots();
  } catch (e) {
    if (e.message && e.message.includes('ログイン')) {
      app.innerHTML = `<div class="empty">この部屋に入るには<a href="#/login">ログイン</a>が必要です</div>`;
    } else {
      app.innerHTML = `<div class="empty">読み込みに失敗しました: ${escapeHTML(e.message)}</div>`;
    }
  }
}

function setupAdminArchiveBtn() {
  const btn = document.getElementById('adminArchiveBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const boardId = btn.dataset.board;
    const isArchived = btn.dataset.archived === '1';
    if (!confirm(isArchived ? 'アーカイブを解除しますか？' : 'この板をアーカイブしますか？')) return;
    btn.disabled = true;
    try {
      await fetchJSON(`/api/admin/boards/${boardId}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archive: !isArchived }),
      });
      await initNav();
      location.hash = isArchived ? `#/board/${boardId}` : '#/archive';
    } catch (e) {
      alert(e.message);
      btn.disabled = false;
    }
  });
}

function setupNewThreadForm(boardId) {
  const toggleBtn = document.getElementById('newThreadToggle');
  const formEl = document.getElementById('newThreadForm');
  if (!toggleBtn || !formEl) return;

  toggleBtn.addEventListener('click', () => {
    const opening = formEl.style.display === 'none';
    formEl.style.display = opening ? 'block' : 'none';
    if (opening) document.getElementById('newThreadTitle').focus();
  });

  document.getElementById('newThreadCancel').addEventListener('click', () => {
    formEl.style.display = 'none';
  });

  document.getElementById('newThreadSubmit').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const title = document.getElementById('newThreadTitle').value;
    const body = document.getElementById('newThreadBody').value;
    const errEl = document.getElementById('newThreadError');
    errEl.textContent = '';
    if (!title.trim()) {
      errEl.textContent = 'タイトルを入力してください';
      return;
    }
    setButtonLoading(btn, true, 'スレ立て中...');
    try {
      const thread = await fetchJSON(`/api/boards/${boardId}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      location.hash = `#/board/${boardId}/thread/${thread.id}`;
    } catch (e) {
      errEl.textContent = e.message;
      setButtonLoading(btn, false);
    }
  });
}

async function renderThread(boardId, threadId) {
  highlightNav(boardId);
  app.innerHTML = skeletonThreadDetail();
  try {
    const t = await withMinDelay(fetchJSON(`/api/boards/${boardId}/threads/${threadId}`));

    currentPostsMap = {
      1: { name: '記事', body: t.summary || '(本文なし)' },
    };
    t.comments.forEach(c => {
      currentPostsMap[c.no] = { name: c.name, body: c.text };
    });

    const posts = [
      `<div class="post op ${t.moderation ? moderationClass(t.moderation.level) : ''}" id="post-1">
        <div class="post-head">
          <span class="post-no">&gt;&gt;&gt;1</span>
          <span class="post-name">記事${t.opUsername ? ` <a href="#/user/${escapeHTML(t.opUsername)}" class="op-username">by ${escapeHTML(t.opUsername)}</a>` : ''}${adminBadge(t.isAdmin)}</span>
          ${renderFollowUserButton(t.opUsername, t.viewerUsername, t.viewerFollowing, t.viewerCanFollow)}
          <span class="post-date">${formatDate(t.createdAt)}</span>
        </div>
        ${renderModerationBanner(t.moderation)}
        ${renderPostBody(linkify(escapeHTML(t.summary || '(本文なし)')), t.moderation, 1)}
        ${renderPostActions(boardId, threadId, 1, t.opLikes || 0, t.moderation)}
      </div>`,
      ...t.comments.map(c => `
        <div class="post ${c.moderation ? moderationClass(c.moderation.level) : ''}" id="post-${c.no}">
          <div class="post-head">
            <span class="post-no">&gt;&gt;&gt;${c.no}</span>
            <span class="post-name">${c.username ? `<a href="#/user/${escapeHTML(c.username)}">${escapeHTML(c.name)}</a>` : escapeHTML(c.name)}${adminBadge(c.isAdmin)}</span>
            ${renderFollowUserButton(c.username, t.viewerUsername, t.viewerFollowing, t.viewerCanFollow)}
            <span class="post-date">${formatDate(c.date)}</span>
          </div>
          ${renderModerationBanner(c.moderation)}
          ${renderPostBody(linkify(escapeHTML(c.text)), c.moderation, c.no)}
          ${renderPostActions(boardId, threadId, c.no, c.likes || 0, c.moderation)}
        </div>
      `)
    ].join('');

    app.innerHTML = `
      <a class="back-link" href="#/board/${boardId}">&laquo; 板に戻る</a>
      <div class="thread-detail-header">
        <h2>${escapeHTML(t.title)}</h2>
        <div class="meta">レス数: ${t.comments.length} ／ 元記事公開: ${formatDate(new Date(t.pubDate).getTime())}</div>
        ${t.link ? `<div class="src-link">🔗 <a href="${escapeHTML(t.link)}" target="_blank" rel="noopener">元記事を読む</a></div>` : ''}
        ${isLoggedIn() ? `<button type="button" id="threadFollowBtn" class="thread-follow-btn ${t.followedByMe ? 'following' : ''}">${t.followedByMe ? '★ フォロー中' : '☆ このスレをフォロー'}</button>` : ''}
      </div>
      <div id="posts">${posts}</div>
      ${adSlot('thread-bottom', 'ad-thread-bottom')}
      <div class="post-form">
        <input id="nameInput" type="text" placeholder="名前（省略可・デフォルト: 名無しさん）" maxlength="30">
        <textarea id="textInput" placeholder="レスを書き込む...（例: &gt;&gt;&gt;1 それな／URLも自動でリンクになります）" maxlength="1000"></textarea>
        <button id="submitBtn">書き込む</button>
        <span id="formError" style="color:#c33;font-size:12px;margin-left:8px"></span>
      </div>
    `;

    const postsContainer = document.getElementById('posts');
    setupAnchorInteractions(postsContainer);

    const threadFollowBtn = document.getElementById('threadFollowBtn');
    if (threadFollowBtn) {
      threadFollowBtn.addEventListener('click', async () => {
        const newFollowing = !threadFollowBtn.classList.contains('following');
        threadFollowBtn.disabled = true;
        try {
          await fetchJSON(`/api/boards/${boardId}/threads/${threadId}/follow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ follow: newFollowing }),
          });
          threadFollowBtn.classList.toggle('following', newFollowing);
          threadFollowBtn.textContent = newFollowing ? '★ フォロー中' : '☆ このスレをフォロー';
        } finally {
          threadFollowBtn.disabled = false;
        }
      });
    }

    app.querySelectorAll('.follow-user-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newFollowing = !btn.classList.contains('following');
        btn.disabled = true;
        try {
          await fetchJSON(`/api/users/${btn.dataset.username}/follow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ follow: newFollowing }),
          });
          btn.classList.toggle('following', newFollowing);
          btn.textContent = newFollowing ? 'フォロー中' : '+ フォロー';
        } finally {
          btn.disabled = false;
        }
      });
    });

    postsContainer.addEventListener('click', (e) => {
      const replyTrigger = e.target.closest('.post-no, .reply-btn');
      if (replyTrigger) {
        const postEl = e.target.closest('.post');
        toggleMiniReply(postEl, boardId, threadId);
        return;
      }

      const likeBtn = e.target.closest('.like-btn');
      if (likeBtn) {
        const { board, thread, no } = likeBtn.dataset;
        const newLiked = !likeBtn.classList.contains('liked');
        likeBtn.disabled = true;
        fetchJSON(`/api/boards/${board}/threads/${thread}/posts/${no}/like`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ liked: newLiked }),
        })
          .then(result => {
            if (newLiked) markLiked(board, thread, no); else unmarkLiked(board, thread, no);
            likeBtn.classList.toggle('liked', newLiked);
            likeBtn.querySelector('.like-heart').textContent = newLiked ? '❤️' : '🤍';
            likeBtn.querySelector('.like-count').textContent = result.likes;
          })
          .finally(() => {
            likeBtn.disabled = false;
          });
        return;
      }

      const revealBtn = e.target.closest('.ban-reveal-btn');
      if (revealBtn) {
        const content = document.getElementById(revealBtn.dataset.target);
        if (content) content.style.display = 'block';
        revealBtn.closest('.ban-hidden-notice').style.display = 'none';
      }
    });

    postsContainer.addEventListener('change', (e) => {
      const select = e.target.closest('.moderate-select');
      if (!select) return;
      const { board, thread, no } = select.dataset;
      let level = select.value;
      if (level === '__clear__') level = null;
      select.disabled = true;
      fetchJSON(`/api/boards/${board}/threads/${thread}/posts/${no}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level }),
      })
        .then(() => renderThread(boardId, threadId))
        .catch(err => {
          alert(err.message);
          select.disabled = false;
        });
    });

    document.getElementById('submitBtn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const name = document.getElementById('nameInput').value;
      const text = document.getElementById('textInput').value;
      const errEl = document.getElementById('formError');
      errEl.textContent = '';
      if (!text.trim()) {
        errEl.textContent = '本文を入力してください';
        return;
      }
      setButtonLoading(btn, true);
      try {
        await fetchJSON(`/api/boards/${boardId}/threads/${threadId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, text }),
        });
        renderThread(boardId, threadId);
      } catch (e) {
        errEl.textContent = e.message;
        setButtonLoading(btn, false);
      }
    });
  } catch (e) {
    app.innerHTML = `<div class="empty">読み込みに失敗しました: ${escapeHTML(e.message)}</div>`;
    return;
  }
  injectAdSlots();
}

function router() {
  closeAllCategoryPanels();
  const hash = location.hash.slice(1) || '/';
  const [pathPart, queryPart] = hash.split('?');
  const params = new URLSearchParams(queryPart || '');
  const parts = pathPart.split('/').filter(Boolean);

  if (parts.length === 0) {
    renderTop();
  } else if (parts[0] === 'login') {
    renderLoginPage();
  } else if (parts[0] === 'mypage') {
    renderMyPage();
  } else if (parts[0] === 'archive') {
    renderArchive();
  } else if (parts[0] === 'rooms') {
    renderRoomsPage();
  } else if (parts[0] === 'user' && parts.length === 2) {
    renderUserProfile(parts[1]);
  } else if (parts[0] === 'dm' && parts.length === 1) {
    renderDmList();
  } else if (parts[0] === 'dm' && parts.length === 2) {
    renderDmChat(parts[1]);
  } else if (parts[0] === 'board' && parts.length === 2) {
    renderBoard(parts[1], params.get('sort'));
  } else if (parts[0] === 'board' && parts.length === 4 && parts[2] === 'thread') {
    renderThread(parts[1], parts[3]);
  } else {
    renderTop();
  }
}

window.addEventListener('hashchange', router);
app.innerHTML = loaderSpinner();
renderAdminAuthArea();
renderUserAuthArea();
Promise.all([loadAdSlots(), initNav()]).then(router);