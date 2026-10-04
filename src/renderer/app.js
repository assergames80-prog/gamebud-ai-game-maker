'use strict';

(function () {
  const api = window.gamebud;

  // ---------------------------------------------------------------- helpers
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16v4M17 18h4"/>',
    play: '<path d="M7 4.5l13 7.5-13 7.5z"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 9"/>',
    game: '<rect x="2.5" y="7" width="19" height="11" rx="4"/><path d="M7 10.5v4M5 12.5h4M16 11.5h.01M18 13.5h.01"/>',
    bolt: '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
  };

  function icon(name, size) {
    const el = document.createElement('span');
    el.className = 'ico';
    if (size) el.style.fontSize = size + 'px';
    el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
    return el;
  }

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    const add = (kid) => {
      if (kid == null || kid === false) return;
      if (Array.isArray(kid)) return kid.forEach(add);
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    };
    kids.forEach(add);
    return el;
  }

  const $ = (id) => document.getElementById(id);
  const clear = (el) => el.replaceChildren();

  function relTime(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const shortDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  // Tiny, safe formatter for assistant replies: paragraphs, bullets, **bold**, `code`.
  function rich(text) {
    const frag = document.createDocumentFragment();
    const inline = (str) =>
      str.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) return h('strong', null, part.slice(2, -2));
        if (/^`[^`]+`$/.test(part)) return h('code', null, part.slice(1, -1));
        return part;
      });
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.split('\n').filter((l) => l.trim());
      if (!lines.length) continue;
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
        frag.append(h('ul', null, lines.map((l) => h('li', null, inline(l.replace(/^\s*[-*•]\s+/, ''))))));
      } else {
        const p = h('p');
        lines.forEach((l, i) => {
          if (i) p.append(h('br'));
          p.append(...[].concat(inline(l)).map((n) => (n instanceof Node ? n : document.createTextNode(n))));
        });
        frag.append(p);
      }
    }
    return frag;
  }

  function toast(text, ms = 2600) {
    for (const old of $('toasts').children) old.remove();
    const t = h('div', { class: 'toast' }, text);
    $('toasts').append(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 300);
    }, ms);
  }

  // ------------------------------------------------------------------ state
  const SUGGESTIONS = [
    'A neon space shooter with waves of enemies and a score',
    'A cozy platformer where a fox collects stars across floating islands',
    'A snake game with a twist: the walls slowly close in',
    'A one-button endless runner with a pixel-art city skyline',
  ];
  const TEX_STYLES = [
    { id: 'tile', label: 'Seamless tile' },
    { id: 'pixel', label: 'Pixel art' },
    { id: 'sprite', label: 'Sprite' },
    { id: 'background', label: 'Background' },
  ];
  const THINK_STEPS = ['Thinking it through…', 'Designing your game…', 'Writing the code…', 'Polishing the details…', 'Almost there…'];

  const S = {
    account: null,
    projects: [],
    project: null,
    tab: 'game',
    busy: null, // { kind: 'chat' | 'texture', projectId, text }
    notice: null, // { projectId, scope: 'chat' | 'texture', code }
    texStyle: 'tile',
    texPrompt: '',
    restart: 0,
    step: 0,
  };
  let stepTimer = null;

  const NOTICES = {
    DEMAND: { icon: 'clock', title: 'Demand is high.', sub: 'Please try again in a little while. No credits were used.' },
    BLOCKED: { icon: 'lock', title: "I can't build that one.", sub: 'Try describing it a different way. No credits were used.' },
    TRUNCATED: { icon: 'clock', title: 'That one was too big to finish.', sub: 'Try a smaller version, or build it in steps. No credits were used.' },
    BUSY: { icon: 'clock', title: 'Still working on your last request.', sub: 'Hang tight, it will be ready in a moment.' },
    LIMIT: { icon: 'image', title: 'Your texture library is full.', sub: 'Delete a few textures to make room for new ones.' },
    INVALID: { icon: 'lock', title: "That didn't look right.", sub: 'Check what you typed and try again. No credits were used.' },
  };
  const noticeFor = (code) => NOTICES[code] || NOTICES.DEMAND;

  // ------------------------------------------------------------ data layer
  async function refreshProjects() {
    S.projects = await api.projects.list();
    renderSidebar();
  }

  async function refreshAccount() {
    try {
      S.account = await api.account();
      renderAccount();
      renderComposerState();
    } catch {}
  }

  const isEmpty = (p) => p && !p.messages.length && !p.textures.length && !p.game;

  async function openProject(id) {
    if (S.project && S.project.id === id) return;
    const prev = S.project;
    const next = await api.projects.get(id);
    if (!next) return refreshProjects();
    S.project = next;
    S.notice = null;
    S.tab = 'game';
    S.texPrompt = '';
    // An untouched "Untitled game" is just clutter once you move on.
    if (prev && isEmpty(prev) && !(S.busy && S.busy.projectId === prev.id)) await api.projects.remove(prev.id);
    await refreshProjects();
    renderAll();
    $('input').focus();
  }

  async function newGame() {
    if (S.project && isEmpty(S.project)) {
      $('input').focus();
      return;
    }
    const prev = S.project;
    const p = await api.projects.create();
    S.project = p;
    S.notice = null;
    S.tab = 'game';
    if (prev && isEmpty(prev) && !(S.busy && S.busy.projectId === prev.id)) await api.projects.remove(prev.id);
    await refreshProjects();
    renderAll();
    $('input').focus();
  }

  async function deleteProject(id) {
    await api.projects.remove(id);
    await refreshProjects();
    if (S.project && S.project.id === id) {
      S.project = null;
      if (S.projects.length) {
        S.project = await api.projects.get(S.projects[0].id);
      } else {
        S.project = await api.projects.create();
        await refreshProjects();
      }
      S.notice = null;
      S.tab = 'game';
      renderAll();
    }
  }

  // ------------------------------------------------------------- rendering
  function renderAll() {
    renderSidebar();
    renderAccount();
    renderHeader();
    renderChat();
    renderStage();
    renderComposerState();
  }

  let confirmDelete = null;
  function renderSidebar() {
    const list = $('projectList');
    clear(list);
    if (!S.projects.length) list.append(h('div', { class: 'project-empty' }, 'Your games will show up here.'));
    for (const p of S.projects) {
      const active = S.project && S.project.id === p.id;
      const del = h('button', {
        class: 'project-del' + (confirmDelete === p.id ? ' confirm' : ''),
        type: 'button',
        'aria-label': `Delete ${p.title}`,
        onclick: async (e) => {
          e.stopPropagation();
          if (confirmDelete === p.id) {
            confirmDelete = null;
            await deleteProject(p.id);
          } else {
            confirmDelete = p.id;
            renderSidebar();
            setTimeout(() => {
              if (confirmDelete === p.id) {
                confirmDelete = null;
                renderSidebar();
              }
            }, 3000);
          }
        },
      });
      if (confirmDelete === p.id) del.append('Delete?');
      else del.append(icon('trash', 15));
      list.append(
        h(
          'div',
          { class: 'project' + (active ? ' active' : '') },
          h(
            'button',
            { class: 'project-open', type: 'button', onclick: () => openProject(p.id), 'aria-current': active ? 'true' : null },
            h('span', { class: 'project-name' }, p.title),
            h('span', { class: 'project-meta' }, relTime(p.updatedAt)),
          ),
          del,
        ),
      );
    }
  }

  function renderAccount() {
    const a = S.account;
    const box = $('account');
    clear(box);
    if (!a) return;
    const plus = a.plan === 'plus';
    const low = a.credits < a.cost;
    const meter = h('div', { class: 'meter' + (low ? ' low' : '') }, h('i'));
    meter.firstChild.style.width = `${Math.max(0, Math.min(100, (a.credits / a.allowance) * 100))}%`;
    box.append(
      h(
        'div',
        { class: 'account-top' },
        h('span', { class: 'badge' + (plus ? ' plus' : '') }, a.planName),
        h('button', { class: 'btn btn-sm' + (plus ? '' : ' btn-primary'), type: 'button', onclick: () => (plus ? showManage() : showPlans()) }, plus ? 'Manage' : 'Upgrade'),
      ),
      h('div', { class: 'credits-line' }, h('span', { class: 'credits-num' }, String(a.credits)), h('span', { class: 'credits-of' }, `of ${a.allowance} credits`)),
      meter,
      h('div', { class: 'account-note' }, `${a.cost} credits per message · resets ${shortDate(a.resetsAt)}`),
    );
  }

  function renderHeader() {
    const p = S.project;
    const title = $('title');
    if (p && document.activeElement !== title) title.value = p.title;
    title.disabled = !p;

    const tabs = $('tabs');
    clear(tabs);
    for (const [id, label] of [['game', 'Game'], ['code', 'Code'], ['textures', 'Textures']]) {
      tabs.append(
        h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(S.tab === id), onclick: () => setTab(id) }, label),
      );
    }

    const actions = $('actions');
    clear(actions);
    const hasGame = !!(p && p.game);
    const canUndo = !!(p && p.versions.length) && !S.busy;
    const btn = (ic, label, fn, disabled) =>
      h('button', { class: 'btn icon-btn', type: 'button', title: label, 'aria-label': label, disabled, onclick: fn }, icon(ic, 17));
    actions.append(
      btn('undo', 'Previous version', undoGame, !canUndo),
      btn('refresh', 'Restart game', () => { S.restart++; renderStage(); }, !hasGame),
      btn('download', 'Export as HTML', exportGame, !hasGame),
    );
  }

  function setTab(tab) {
    S.tab = tab;
    renderHeader();
    renderStage();
  }

  function scrollDown(force) {
    const m = $('messages');
    m.style.scrollBehavior = 'auto';
    m.scrollTop = m.scrollHeight;
    m.style.scrollBehavior = '';
    void force;
  }

  // Only items that are new since the last render get the entrance animation.
  let seen = { project: null, ids: new Set(), pending: false, notice: false };

  function renderChat() {
    const p = S.project;
    const box = $('messages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    clear(box);
    if (!p) return;
    const busyHere = S.busy && S.busy.projectId === p.id;
    const pendingChat = busyHere && S.busy.kind === 'chat';

    if (!p.messages.length && !pendingChat) {
      box.append(
        h(
          'div',
          { class: 'welcome' },
          h('h2', null, 'What do you want to build?'),
          h('p', null, 'Describe a game in plain words. Gamebud builds it and you can play it right here.'),
          h(
            'div',
            { class: 'suggestions' },
            SUGGESTIONS.map((s) =>
              h('button', { class: 'suggestion', type: 'button', onclick: () => { setInput(s); $('input').focus(); } }, icon('spark'), s),
            ),
          ),
        ),
      );
    }

    const sameProject = seen.project === p.id;
    const enter = (isNew) => (sameProject && isNew ? ' enter' : '');
    for (const m of p.messages) {
      const fresh = !seen.ids.has(m.id);
      if (m.role === 'user') {
        box.append(h('div', { class: 'msg user' + enter(fresh) }, h('div', { class: 'bubble' }, m.text)));
      } else {
        box.append(
          h(
            'div',
            { class: 'msg' + enter(fresh) },
            h('img', { class: 'avatar', src: 'assets/logo.svg', alt: '' }),
            h(
              'div',
              { class: 'reply' },
              h('div', null, rich(m.text)),
              m.built
                ? h('button', { class: 'built-chip', type: 'button', onclick: () => setTab('game') }, icon('check', 13), 'Game updated')
                : null,
            ),
          ),
        );
      }
    }

    if (pendingChat) {
      box.append(h('div', { class: 'msg user' + enter(!seen.pending) }, h('div', { class: 'bubble' }, S.busy.text)));
      box.append(
        h(
          'div',
          { class: 'msg' + enter(!seen.pending) },
          h('img', { class: 'avatar', src: 'assets/logo.svg', alt: '' }),
          h('div', { class: 'thinking' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), h('span', null, THINK_STEPS[Math.min(S.step, THINK_STEPS.length - 1)])),
        ),
      );
    }

    if (S.notice && S.notice.scope === 'chat' && S.notice.projectId === p.id) {
      const n = noticeFor(S.notice.code);
      box.append(h('div', { class: 'notice' + enter(!seen.notice), role: 'status' }, icon(n.icon), h('div', null, h('b', null, n.title), h('span', null, n.sub))));
    }
    seen = {
      project: p.id,
      ids: new Set(p.messages.map((m) => m.id)),
      pending: !!pendingChat,
      notice: !!(S.notice && S.notice.scope === 'chat' && S.notice.projectId === p.id),
    };

    if (nearBottom || pendingChat || S.notice) scrollDown();
  }

  function renderComposerState() {
    const a = S.account;
    const out = a && a.credits < a.cost;
    const busy = !!S.busy;
    $('composer').hidden = !!out;
    $('costHint').textContent = a ? `${a.cost} credits per message` : '';
    $('send').disabled = busy || !$('input').value.trim();
    $('input').disabled = false;

    const box = $('outOfCredits');
    box.hidden = !out;
    clear(box);
    if (out) {
      const plus = a.plan === 'plus';
      box.append(
        h('b', null, "You're out of credits"),
        h('span', null, plus ? `Your credits refill on ${shortDate(a.resetsAt)}.` : 'Upgrade to Plus for 150 credits a month, or wait for your credits to refill on ' + shortDate(a.resetsAt) + '.'),
        plus ? null : h('button', { class: 'btn btn-primary', type: 'button', onclick: showPlans }, 'See Plus'),
      );
    }
    renderTextureControls();
  }

  // ---- stage
  function renderStage() {
    const p = S.project;
    const busyChat = S.busy && S.busy.kind === 'chat' && p && S.busy.projectId === p.id;
    $('stageBar').hidden = !busyChat;
    $('panelGame').hidden = S.tab !== 'game';
    $('panelCode').hidden = S.tab !== 'code';
    $('panelTextures').hidden = S.tab !== 'textures';
    renderGamePanel();
    renderCodePanel();
    renderTexturePanel();
  }

  let frameEl = null;
  let frameSrc = '';
  function renderGamePanel() {
    const p = S.project;
    const panel = $('panelGame');
    if (!p || !p.game) {
      frameEl = null;
      frameSrc = '';
      if (!panel.querySelector('.placeholder')) {
        clear(panel);
        panel.append(
          h(
            'div',
            { class: 'placeholder' },
            h('div', { class: 'halo' }, icon('game', 30)),
            h('h3', null, 'Your game will appear here'),
            h('p', null, 'Tell Gamebud what to build on the left and you can play it as soon as it is ready.'),
          ),
        );
      }
      return;
    }
    const src = `gamebud://play/${p.id}?v=${p.game.updatedAt}&r=${S.restart}`;
    if (!frameEl || !panel.contains(frameEl)) {
      clear(panel);
      frameEl = h('iframe', { title: 'Game preview', sandbox: 'allow-scripts allow-pointer-lock', allow: 'fullscreen' });
      panel.append(frameEl);
      frameSrc = '';
    }
    if (frameSrc !== src) {
      frameSrc = src;
      frameEl.src = src;
    }
  }

  let codeFor = '';
  function renderCodePanel() {
    const p = S.project;
    const panel = $('panelCode');
    const key = p && p.game ? `${p.id}:${p.game.updatedAt}` : p ? `${p.id}:none` : '';
    if (key === codeFor && panel.firstChild) return;
    codeFor = key;
    clear(panel);
    if (!p || !p.game) {
      panel.append(
        h('div', { class: 'placeholder' }, h('div', { class: 'halo' }, icon('spark', 28)), h('h3', null, 'No code yet'), h('p', null, 'The code for your game will show up here once it is built.')),
      );
      return;
    }
    const lines = p.game.html.split('\n').length;
    panel.append(
      h(
        'div',
        { class: 'code-bar' },
        h('span', null, `${lines.toLocaleString()} lines · single HTML file`),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(p.game.html); toast('Code copied'); } catch { toast("Couldn't copy"); } } }, icon('copy', 14), 'Copy'),
      ),
      h('pre', { class: 'code-view' }, p.game.html),
    );
  }

  // ---- textures
  let texEls = null;
  function renderTexturePanel() {
    const p = S.project;
    const panel = $('panelTextures');
    if (!texEls) {
      const prompt = h('input', {
        class: 'field',
        type: 'text',
        maxlength: '300',
        placeholder: 'Describe a texture, like “mossy stone bricks”',
        'aria-label': 'Texture description',
        oninput: (e) => { S.texPrompt = e.target.value; renderTextureControls(); },
        onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); generateTexture(); } },
      });
      const gen = h('button', { class: 'btn btn-primary', type: 'button', onclick: generateTexture });
      const chips = h('div', { class: 'seg', role: 'group', 'aria-label': 'Texture style' });
      const banner = h('div');
      const grid = h('div', { class: 'tex-grid' });
      panel.append(
        h('div', { class: 'tex-top' }, h('div', null, h('h3', null, 'Textures'), h('p', null, 'Generate art for your game. Mention a texture by name in chat and Gamebud will use it.')), h('div', { class: 'tex-row' }, prompt, gen), chips),
        banner,
        grid,
      );
      texEls = { prompt, gen, chips, banner, grid };
    }
    const { prompt, chips, banner, grid } = texEls;
    if (document.activeElement !== prompt) prompt.value = S.texPrompt;
    clear(chips);
    for (const st of TEX_STYLES) {
      chips.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.texStyle === st.id), onclick: () => { S.texStyle = st.id; renderTexturePanel(); } }, st.label));
    }

    clear(banner);
    if (S.notice && S.notice.scope === 'texture' && p && S.notice.projectId === p.id) {
      const n = noticeFor(S.notice.code);
      banner.append(h('div', { class: 'tex-banner', role: 'status' }, h('b', null, n.title), ' ', n.sub));
    }

    clear(grid);
    if (!p) return;
    const loading = S.busy && S.busy.kind === 'texture' && S.busy.projectId === p.id;
    if (loading) {
      grid.append(
        h(
          'div',
          { class: 'tex-card loading' + (S.busy.style === 'background' ? ' wide' : '') },
          h('div', { class: 'tex-img skeleton' }),
          h('div', { class: 'tex-body' }, h('div', { class: 'skeleton line' }), h('div', { class: 'skeleton line' }), h('div', { class: 'tex-prompt' }, 'Painting your texture…')),
        ),
      );
    }
    if (!p.textures.length && !loading) {
      grid.append(h('div', { class: 'placeholder' }, h('div', { class: 'halo' }, icon('image', 28)), h('h3', null, 'No textures yet'), h('p', null, 'Describe one above and it will appear here.')));
    }
    for (const t of p.textures) grid.append(textureCard(p, t));
    renderTextureControls();
  }

  let confirmTex = null;
  function textureCard(p, t) {
    const del = h('button', {
      class: 'btn btn-sm icon-only' + (confirmTex === t.id ? ' btn-danger' : ''),
      type: 'button',
      title: 'Delete texture',
      'aria-label': `Delete ${t.name}`,
      onclick: async () => {
        if (confirmTex !== t.id) {
          confirmTex = t.id;
          renderTexturePanel();
          setTimeout(() => { if (confirmTex === t.id) { confirmTex = null; renderTexturePanel(); } }, 3000);
          return;
        }
        confirmTex = null;
        const updated = await api.textures.remove(p.id, t.id);
        if (updated && S.project && S.project.id === p.id) S.project = updated;
        renderTexturePanel();
      },
    });
    if (confirmTex === t.id) del.append(icon('check', 14));
    else del.append(icon('trash', 14));
    return h(
      'div',
      { class: 'tex-card' + (t.style === 'background' ? ' wide' : '') },
      h('img', { class: 'tex-img', src: `gamebud://tex/${p.id}/${t.id}`, alt: t.prompt, draggable: 'false' }),
      h(
        'div',
        { class: 'tex-body' },
        h('div', { class: 'tex-name selectable', title: `texture://${t.name}` }, t.name),
        h('div', { class: 'tex-prompt', title: t.prompt }, t.prompt),
        h(
          'div',
          { class: 'tex-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { setInput(`Use the "${t.name}" texture for `); $('input').focus(); } }, 'Use in game'),
          del,
        ),
      ),
    );
  }

  function renderTextureControls() {
    if (!texEls) return;
    const a = S.account;
    const out = a && a.credits < a.cost;
    const busy = !!S.busy;
    const can = S.texPrompt.trim().length > 0;
    const gen = texEls.gen;
    clear(gen);
    if (busy && S.busy.kind === 'texture') gen.append(h('span', { class: 'spinner' }), 'Generating');
    else if (out) gen.append(icon('lock', 15), 'Out of credits');
    else gen.append(icon('spark', 15), `Generate · ${a ? a.cost : 5} credits`);
    gen.disabled = busy || (!out && !can);
  }

  // ----------------------------------------------------------- actions
  function setInput(text) {
    const el = $('input');
    el.value = text;
    autoGrow();
    renderComposerState();
  }

  function autoGrow() {
    const el = $('input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  function startBusy(busy) {
    S.busy = busy;
    S.step = 0;
    S.notice = null;
    clearInterval(stepTimer);
    stepTimer = setInterval(() => {
      if (!S.busy) return;
      S.step++;
      if (S.step < THINK_STEPS.length) renderChat();
    }, 5000);
    renderHeader();
    renderChat();
    renderStage();
    renderComposerState();
  }

  function endBusy() {
    S.busy = null;
    clearInterval(stepTimer);
  }

  async function send() {
    const el = $('input');
    const text = el.value.trim();
    if (!text || !S.project) return;
    if (S.busy) return toast('Still working on your last request');
    if (S.account && S.account.credits < S.account.cost) return showPlans();
    const projectId = S.project.id;
    el.value = '';
    autoGrow();
    startBusy({ kind: 'chat', projectId, text });

    let res;
    try {
      res = await api.chat.send(projectId, text);
    } catch {
      res = { ok: false, code: 'DEMAND' };
    }
    endBusy();
    await finishOp(res, projectId, 'chat', () => {
      if (!$('input').value) setInput(text);
    });
  }

  async function generateTexture() {
    const prompt = S.texPrompt.trim();
    if (S.busy) return;
    if (S.account && S.account.credits < S.account.cost) return showPlans();
    if (!prompt || !S.project) return;
    const projectId = S.project.id;
    startBusy({ kind: 'texture', projectId, text: prompt, style: S.texStyle });
    let res;
    try {
      res = await api.textures.generate(projectId, prompt, S.texStyle);
    } catch {
      res = { ok: false, code: 'DEMAND' };
    }
    endBusy();
    await finishOp(res, projectId, 'texture', () => {});
    if (res.ok && S.project && S.project.id === projectId) {
      S.texPrompt = '';
      renderTexturePanel();
    }
  }

  async function finishOp(res, projectId, scope, restore) {
    if (res.account) S.account = res.account;
    const here = S.project && S.project.id === projectId;
    if (res.ok) {
      if (here) {
        const hadGame = S.project.game && S.project.game.updatedAt;
        S.project = res.project;
        S.notice = null;
        if (scope === 'chat' && res.project.game && res.project.game.updatedAt !== hadGame) {
          S.tab = 'game';
          toast('Game updated · click it to play');
        }
      }
    } else if (res.code !== 'GONE' && res.code !== 'NO_CREDITS') {
      restore();
      if (here) S.notice = { projectId, scope, code: res.code };
    } else if (res.code === 'NO_CREDITS') {
      restore();
    }
    await refreshProjects();
    if (res.code === 'GONE' && here) {
      // The game was deleted while we were waiting.
      S.project = null;
      if (S.projects.length) S.project = await api.projects.get(S.projects[0].id);
      else S.project = await api.projects.create();
      await refreshProjects();
    }
    renderAll();
    if (res.code === 'NO_CREDITS') showPlans();
  }

  async function undoGame() {
    if (!S.project || S.busy) return;
    const p = await api.game.undo(S.project.id);
    if (p) {
      S.project = p;
      renderAll();
      toast('Restored the previous version');
    }
  }

  async function exportGame() {
    if (!S.project) return;
    const res = await api.game.export(S.project.id);
    if (res && res.ok) toast('Saved to ' + res.path.split(/[\\/]/).pop());
  }

  // ------------------------------------------------------------ modals
  let modal = null;
  function openModal(content, { dismissable = true, onClose } = {}) {
    closeModal();
    const overlay = h('div', { class: 'overlay' });
    overlay.append(content);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay && modal && modal.dismissable) closeModal();
    });
    $('modalRoot').append(overlay);
    modal = { overlay, dismissable, onClose, returnFocus: document.activeElement };
    const first = content.querySelector('[data-autofocus]') || content.querySelector('input, button:not([disabled])');
    if (first) first.focus();
  }

  function closeModal() {
    if (!modal) return;
    const m = modal;
    modal = null;
    m.overlay.remove();
    if (m.onClose) m.onClose();
    if (m.returnFocus && document.contains(m.returnFocus)) m.returnFocus.focus();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.dismissable) {
      e.preventDefault();
      closeModal();
    }
    if (e.key === 'Tab' && modal) {
      const f = [...modal.overlay.querySelectorAll('button:not([disabled]), input:not([disabled])')];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!modal.overlay.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  });

  const closeBtn = () => h('button', { class: 'btn btn-ghost icon-btn', type: 'button', 'aria-label': 'Close', onclick: closeModal }, icon('x', 18));
  const feature = (text) => h('li', null, icon('check'), text);

  function showPlans() {
    const a = S.account;
    const plus = a && a.plan === 'plus';
    const hobbyCard = h(
      'div',
      { class: 'plan' },
      h('h3', null, 'Hobby', !plus ? h('span', { class: 'badge' }, 'Current plan') : null),
      h('div', { class: 'price' }, '$0', h('small', null, ' / month')),
      h('ul', null, feature('50 credits every month'), feature('About 10 messages'), feature('Game builder & textures'), feature('Export to HTML')),
      h('button', { class: 'btn', type: 'button', disabled: true }, plus ? 'Included' : 'Your current plan'),
    );
    const plusCard = h(
      'div',
      { class: 'plan featured' },
      h('h3', null, 'Plus', plus ? h('span', { class: 'badge plus' }, 'Current plan') : null),
      h('div', { class: 'price' }, '$10', h('small', null, ' / month')),
      h('ul', null, feature('150 credits every month'), feature('About 30 messages'), feature('Game builder & textures'), feature('Export to HTML'), feature('Cancel anytime')),
      plus
        ? h('button', { class: 'btn', type: 'button', onclick: showManage }, 'Manage plan')
        : h('button', { class: 'btn btn-primary', type: 'button', 'data-autofocus': '1', onclick: showCheckout }, 'Get Plus'),
    );
    openModal(
      h(
        'div',
        { class: 'modal wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose your plan' },
        h('div', { class: 'modal-head' }, h('div', null, h('h2', null, 'Choose your plan'), h('p', null, 'Build more games with more credits. Every message is 5 credits.')), closeBtn()),
        h('div', { class: 'plans' }, hobbyCard, plusCard),
      ),
    );
  }

  // The checkout is a demo: it accepts any card and nothing is stored or sent
  // anywhere. Card fields never leave this function.
  function showCheckout() {
    let working = false;
    const num = h('input', { class: 'field', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '1234 1234 1234 1234', maxlength: '23', 'aria-label': 'Card number', 'data-autofocus': '1' });
    const brand = h('span', { class: 'card-brand' });
    const name = h('input', { class: 'field', type: 'text', autocomplete: 'off', placeholder: 'Full name on card', 'aria-label': 'Name on card' });
    const exp = h('input', { class: 'field', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'MM / YY', maxlength: '7', 'aria-label': 'Expiry date' });
    const cvc = h('input', { class: 'field', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'CVC', maxlength: '4', 'aria-label': 'Security code' });
    const zip = h('input', { class: 'field', type: 'text', autocomplete: 'off', placeholder: 'ZIP', maxlength: '10', 'aria-label': 'Postal code' });
    const pay = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'Subscribe · $10.00');
    const back = h('button', { class: 'btn', type: 'button', onclick: showPlans }, 'Back');

    num.addEventListener('input', () => {
      const d = num.value.replace(/\D/g, '').slice(0, 19);
      const amex = /^3[47]/.test(d);
      num.value = (amex ? d.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' ')) : d.replace(/(\d{4})(?=\d)/g, '$1 '));
      brand.textContent = /^4/.test(d) ? 'VISA' : /^(5[1-5]|2[2-7])/.test(d) ? 'MASTERCARD' : amex ? 'AMEX' : /^6/.test(d) ? 'DISCOVER' : '';
      update();
    });
    exp.addEventListener('input', (e) => {
      let d = exp.value.replace(/\D/g, '').slice(0, 4);
      if (d.length >= 2 && e.inputType !== 'deleteContentBackward') d = d.slice(0, 2) + ' / ' + d.slice(2);
      else if (d.length > 2) d = d.slice(0, 2) + ' / ' + d.slice(2);
      exp.value = d;
      update();
    });
    cvc.addEventListener('input', () => { cvc.value = cvc.value.replace(/\D/g, '').slice(0, 4); update(); });
    for (const el of [name, zip]) el.addEventListener('input', update);

    function update() {
      pay.disabled = working || ![num, name, exp, cvc, zip].every((el) => el.value.trim());
    }
    update();

    const wipe = () => { for (const el of [num, name, exp, cvc, zip]) el.value = ''; };
    const form = h(
      'form',
      { class: 'form', novalidate: true },
      h('label', { class: 'label' }, 'Card number', h('div', { class: 'card-wrap' }, num, brand)),
      h('label', { class: 'label' }, 'Name on card', name),
      h('div', { class: 'row2' }, h('label', { class: 'label' }, 'Expiry', exp), h('label', { class: 'label' }, 'CVC', cvc), h('label', { class: 'label' }, 'ZIP', zip)),
      pay,
      h('div', { class: 'secure' }, icon('lock', 13), 'Payments are encrypted and secure'),
    );

    const card = h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Subscribe to Plus' },
      h('div', { class: 'modal-head' }, h('div', null, h('h2', null, 'Subscribe to Plus'), h('p', null, 'Cancel anytime from your account.')), closeBtn()),
      h('div', { class: 'summary' }, h('div', null, h('b', null, 'Gamebud Plus'), h('span', null, '150 credits every month')), h('div', { class: 'amount' }, '$10.00', h('span', null, 'per month'))),
      form,
      h('div', { class: 'modal-foot' }, back),
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (pay.disabled) return;
      working = true;
      for (const el of [num, name, exp, cvc, zip]) el.disabled = true;
      back.disabled = true;
      clear(pay);
      pay.append(h('span', { class: 'spinner' }), 'Processing…');
      pay.disabled = true;
      await new Promise((r) => setTimeout(r, 1600));
      wipe();
      let res;
      try { res = await api.billing.upgrade(); } catch { res = null; }
      if (res && res.ok) S.account = res.account;
      renderAccount();
      renderComposerState();
      clear(card);
      card.append(
        h('div', { class: 'success' }, h('div', { class: 'tick' }, icon('check', 30)), h('h2', null, 'Welcome to Plus'), h('p', null, 'Your 150 credits are ready. Go build something great.')),
        h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', 'data-autofocus': '1', onclick: closeModal }, 'Start building'),
      );
      card.querySelector('[data-autofocus]').focus();
    });

    openModal(card, { onClose: wipe });
  }

  function showManage() {
    const a = S.account;
    let confirming = false;
    const cancelBtn = h('button', { class: 'btn', type: 'button' }, 'Cancel plan');
    cancelBtn.addEventListener('click', async () => {
      if (!confirming) {
        confirming = true;
        cancelBtn.className = 'btn btn-danger';
        cancelBtn.textContent = 'Yes, cancel Plus';
        return;
      }
      const res = await api.billing.cancel();
      if (res && res.ok) S.account = res.account;
      renderAccount();
      renderComposerState();
      closeModal();
      toast('Your plan was changed to Hobby');
    });
    openModal(
      h(
        'div',
        { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Manage plan' },
        h('div', { class: 'modal-head' }, h('div', null, h('h2', null, 'Your plan'), h('p', null, 'You are on Gamebud Plus. Thanks for supporting us.')), closeBtn()),
        h('dl', { class: 'kv' }, h('dt', null, 'Plan'), h('dd', null, 'Plus · $10 / month'), h('dt', null, 'Credits left'), h('dd', null, `${a.credits} of ${a.allowance}`), h('dt', null, 'Renews'), h('dd', null, shortDate(a.resetsAt))),
        h('div', { class: 'modal-foot' }, cancelBtn, h('button', { class: 'btn btn-primary', type: 'button', 'data-autofocus': '1', onclick: closeModal }, 'Done')),
      ),
    );
  }

  // Hidden developer panel (Ctrl/Cmd+Shift+K). No visible entry point on purpose.
  async function showDev() {
    let status;
    try { status = await api.dev.status(); } catch { return; }
    if (!status || status.ok === false) return;

    const dot = h('span', { class: 'dot' });
    const stText = h('span');
    const key = h('input', { class: 'field', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'Paste Gemini API key (AQ… or AIza…)', 'aria-label': 'Gemini API key', 'data-autofocus': '1' });
    const result = h('div', { class: 'result', hidden: true });
    const errBox = h('div', { class: 'mono-box' });
    const show = (ok, msg) => { result.hidden = false; result.className = 'result ' + (ok ? 'ok' : 'bad'); result.textContent = msg; };

    function paint(s) {
      dot.className = 'dot ' + (s.hasKey ? 'ok' : 'bad');
      stText.textContent = s.hasKey
        ? `Key active (…${s.last4}) · ${s.source === 'env' ? 'from GEMINI_API_KEY' : s.encrypted ? 'stored encrypted' : 'stored locally'}`
        : 'No API key set';
    }
    function paintErr(e) {
      errBox.textContent = e ? `${new Date(e.at).toLocaleTimeString()} · ${e.code}\n${e.message}` : 'None since launch.';
    }
    paint(status);
    paintErr(status.lastError);

    const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      const v = key.value.trim();
      if (!v) return show(false, 'Paste a key first.');
      const res = await api.dev.setKey(v);
      if (!res || !res.ok) return show(false, 'That does not look like a Gemini API key. New keys start with AQ. and old ones with AIza.');
      key.value = '';
      paint(res.status);
      show(true, 'Key saved.');
    } }, 'Save key');
    const removeBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      const res = await api.dev.clearKey();
      if (res && res.status) paint(res.status);
      show(true, 'Saved key removed.');
    } }, 'Remove');
    const testBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing…';
      const res = await api.dev.test();
      testBtn.disabled = false;
      testBtn.textContent = 'Test connection';
      show(!!(res && res.ok), res && res.message ? res.message : 'Test failed.');
      const s = await api.dev.status();
      if (s && s.ok !== false) paintErr(s.lastError);
    } }, 'Test connection');

    key.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });

    openModal(
      h(
        'div',
        { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Developer settings' },
        h('div', { class: 'modal-head' }, h('div', null, h('h2', null, 'Developer settings'), h('p', null, 'You found the hidden panel. Users never see this.')), closeBtn()),
        h('div', { class: 'dev-section' }, h('h4', null, 'Gemini API'), h('div', { class: 'dev-status' }, dot, stText), key, h('div', { class: 'dev-buttons' }, saveBtn, testBtn, removeBtn), result),
        h('div', { class: 'dev-section' }, h('h4', null, 'Models'), h('p', { class: 'hint selectable' }, `Chat: ${status.chatModel} (thinking: high)`), h('p', { class: 'hint selectable' }, `Textures: ${status.imageModel}`)),
        h('div', { class: 'dev-section' }, h('h4', null, 'Last upstream error'), errBox, h('p', { class: 'hint' }, 'Users only ever see “Demand is high.” for these.')),
        h('div', { class: 'dev-section' }, h('h4', null, 'Account'), h('div', { class: 'dev-buttons' },
          h('button', { class: 'btn', type: 'button', onclick: async () => { const r = await api.dev.refill(); if (r && r.ok) { S.account = r.account; renderAccount(); renderComposerState(); show(true, 'Credits refilled.'); } } }, 'Refill credits'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { const r = await api.dev.reset(); if (r && r.ok) { S.account = r.account; renderAccount(); renderComposerState(); show(true, 'Account reset to Hobby.'); } } }, 'Reset to Hobby'),
        )),
      ),
    );
  }

  // -------------------------------------------------------------- wiring
  function wire() {
    $('newGame').append(icon('plus', 16), 'New game');
    $('newGame').addEventListener('click', newGame);
    $('send').append(icon('send', 17));

    const input = $('input');
    input.addEventListener('input', () => { autoGrow(); renderComposerState(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    $('composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });

    const title = $('title');
    let before = '';
    title.addEventListener('focus', () => { before = title.value; title.select(); });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') title.blur();
      if (e.key === 'Escape') { title.value = before; title.blur(); }
    });
    title.addEventListener('blur', async () => {
      const v = title.value.trim();
      if (!S.project) return;
      if (!v || v === S.project.title) { title.value = S.project.title; return; }
      const p = await api.projects.rename(S.project.id, v);
      if (p && S.project && S.project.id === p.id) S.project = p;
      await refreshProjects();
      renderHeader();
    });

    window.addEventListener('focus', refreshAccount);
    api.dev.onOpen(showDev);
    setInterval(renderSidebar, 60000);
  }

  async function init() {
    wire();
    try {
      S.account = await api.account();
      S.projects = await api.projects.list();
      // Tidy up untouched empty games from earlier sessions, keeping one.
      const empties = [];
      for (const meta of S.projects) {
        const p = await api.projects.get(meta.id);
        if (isEmpty(p)) empties.push(p);
      }
      for (const p of empties.slice(S.projects.length === empties.length ? 1 : 0)) await api.projects.remove(p.id);
      S.projects = await api.projects.list();
      S.project = S.projects.length ? await api.projects.get(S.projects[0].id) : await api.projects.create();
      S.projects = await api.projects.list();
    } catch (err) {
      console.error(err);
    }
    renderAll();
    $('input').focus();
  }

  init();
})();
