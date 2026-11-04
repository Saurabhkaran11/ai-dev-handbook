import type { Content, Concept, Question, Project, QuestionTopic, CheatsheetTopic } from './types';
import { store, type Theme } from './store';
import { renderMarkdown, inline, escapeHtml, codeBlock, slugify } from './markdown';
import { decryptContent, WrongPasswordError } from './crypto';

// ---------- content (decrypted in memory only, never stored) ----------

let C: Content | null = null;
let unlockError = '';
let unlocking = false;

// ---------- routing ----------

interface Route {
  page: string;
  param: string;
  query: URLSearchParams;
}

function parseRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, '');
  const [pathPart = '', queryPart = ''] = hash.split('?');
  const [page = '', param = ''] = pathPart.split('/');
  return { page: page || 'home', param, query: new URLSearchParams(queryPart) };
}

function go(path: string) {
  location.hash = path;
}

// ---------- ephemeral UI state ----------

const openAnswers = new Set<string>();
let hideKnown = false;
let projectFilter: Concept | 'All' = 'All';
let resetArmed = false;

// ---------- helpers ----------

const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

function progressBar(n: number, total: number, label: string): string {
  const p = pct(n, total);
  return `<div class="progress" title="${n} of ${total}">
    <div class="progress-head"><span>${label}</span><span class="muted">${n}/${total}</span></div>
    <div class="progress-track"><div class="progress-fill" style="width:${p}%"></div></div>
  </div>`;
}

const topicTitle = (c: Content, slug: QuestionTopic) => c.questionTopics.find((t) => t.slug === slug)?.title ?? slug;

interface CheatsheetSection {
  topic: CheatsheetTopic;
  heading: string;
  id: string;
  body: string;
}

/** Split each topic's markdown into h3 sections for search. */
function cheatsheetSections(c: Content): CheatsheetSection[] {
  const out: CheatsheetSection[] = [];
  for (const topic of c.cheatsheet) {
    const parts = topic.markdown.split(/^### /m);
    for (const part of parts.slice(1)) {
      const nl = part.indexOf('\n');
      const heading = part.slice(0, nl).trim();
      out.push({ topic, heading, id: slugify(heading), body: part.slice(nl + 1) });
    }
  }
  return out;
}

// ---------- views ----------

function lockView(): string {
  return `<main class="lock">
    <form class="lock-card" data-action="unlock">
      <div class="brand-mark big">AI</div>
      <h1>Engineering Handbook</h1>
      <p class="muted">This handbook is encrypted. Enter the password to open it. Nothing is stored; you will be asked again next time.</p>
      <label class="lock-field">
        <span>Password</span>
        <input id="password" type="password" autocomplete="current-password" autofocus required ${unlocking ? 'disabled' : ''} />
      </label>
      ${unlockError ? `<p class="lock-error" role="alert">${escapeHtml(unlockError)}</p>` : ''}
      <button class="btn primary" type="submit" ${unlocking ? 'disabled' : ''}>${unlocking ? 'Decrypting…' : 'Unlock'}</button>
    </form>
  </main>`;
}

function sidebar(c: Content, route: Route): string {
  const nav = [
    ['home', 'Home', '⌂'],
    ['cheatsheet', 'Cheatsheet', '▤'],
    ['interview', 'Interview Qs', '?'],
    ['projects', 'Mini Projects', '⚒'],
    ['ideas', 'Daily-life Ideas', '✦'],
  ] as const;
  const q = route.page === 'search' ? route.query.get('q') ?? '' : '';
  const theme = currentTheme();
  return `<aside class="sidebar">
    <a class="brand" href="#/"><span class="brand-mark">AI</span><span><strong>Engineering Handbook</strong><small>TypeScript · AI SDK · Context</small></span></a>
    <label class="search"><span class="search-icon">⌕</span><input id="search" type="search" placeholder="Search everything" value="${escapeHtml(q)}" autocomplete="off" /><kbd>/</kbd></label>
    <nav>${nav
      .map(([slug, label, icon]) => `<a class="nav-item${route.page === slug ? ' active' : ''}" href="#/${slug}"><span class="nav-icon">${icon}</span>${label}</a>`)
      .join('')}</nav>
    <div class="sidebar-progress">
      ${progressBar(store.knownCount(), c.questions.length, 'Questions mastered')}
      ${progressBar(store.doneCount(), c.projects.length, 'Projects done')}
    </div>
    <div class="sidebar-footer">
      <button class="ghost" data-action="theme" type="button">${theme === 'dark' ? '☀ Light mode' : '☾ Dark mode'}</button>
      <button class="ghost danger" data-action="reset" type="button">${resetArmed ? 'Click again to confirm' : 'Reset progress'}</button>
      <button class="ghost" data-action="lock" type="button">⊘ Lock</button>
    </div>
  </aside>`;
}

function homeView(c: Content): string {
  const path = c.projects.filter((p) => p.startHere);
  const tiles = [
    { n: c.cheatsheet.length, label: 'cheatsheet topics', href: '#/cheatsheet' },
    { n: c.questions.length, label: 'interview questions', href: '#/interview' },
    { n: c.projects.length, label: 'one-hour projects', href: '#/projects' },
    { n: c.ideas.length, label: 'daily-life ideas', href: '#/ideas' },
  ];
  return `<section class="hero">
      <p class="eyebrow">Learn by reference, drill, and build</p>
      <h1>TypeScript, the AI SDK, and context engineering, in one place.</h1>
      <p class="lede">A cheatsheet to look things up, interview questions to drill, ${c.projects.length} projects you can finish in an hour, and ideas to put it to work in your own day. Your progress stays in this browser.</p>
      <div class="hero-actions"><a class="btn primary" href="#/cheatsheet">Open the cheatsheet</a><a class="btn" href="#/projects">Start building</a></div>
    </section>
    <section class="tiles">${tiles
      .map((t) => `<a class="tile" href="${t.href}"><span class="tile-n">${t.n}</span><span class="tile-label">${t.label}</span></a>`)
      .join('')}</section>
    <section class="two-col">
      <div class="card">
        <h2>Suggested path</h2>
        <p class="muted">Four projects, in this order, give you a complete production-shaped loop: chat, structured extraction, retrieval, cost tracking.</p>
        <ol class="path">${path
          .map(
            (p) => `<li class="${store.projectDone(p.id) ? 'done' : ''}"><label><input type="checkbox" data-action="project" data-id="${p.id}" ${store.projectDone(p.id) ? 'checked' : ''}/><span><strong>#${p.id} ${escapeHtml(p.title)}</strong><br/><span class="muted">${inline(p.build)}</span></span></label></li>`,
          )
          .join('')}</ol>
      </div>
      <div class="card">
        <h2>How to use this</h2>
        <ul class="how">
          <li><strong>Look it up.</strong> The cheatsheet is split by topic with code you can copy. Press <kbd>/</kbd> to search everything.</li>
          <li><strong>Drill.</strong> Interview questions are flashcards. Reveal the answer, then mark it known or review.</li>
          <li><strong>Build.</strong> Each project fits in an hour and has a clear done condition. Tick them off as you go.</li>
          <li><strong>Apply.</strong> Daily-life ideas link back to the projects they reuse.</li>
        </ul>
        <h3>Progress</h3>
        ${progressBar(store.knownCount(), c.questions.length, 'Questions mastered')}
        ${progressBar(store.doneCount(), c.projects.length, 'Projects done')}
      </div>
    </section>`;
}

function cheatsheetView(c: Content, param: string): string {
  const topic = c.cheatsheet.find((t) => t.slug === param) ?? c.cheatsheet[0]!;
  const toc = [...topic.markdown.matchAll(/^### (.+)$/gm)].map((m) => m[1]!);
  const tabs = c.cheatsheet
    .map((t) => `<a class="tab${t.slug === topic.slug ? ' active' : ''}" href="#/cheatsheet/${t.slug}">${t.title}</a>`)
    .join('');
  return `<div class="page-head"><p class="eyebrow">Cheatsheet</p><h1>${topic.title}</h1><p class="lede">${topic.tagline}</p></div>
    <div class="tabs">${tabs}</div>
    <div class="doc-layout">
      <article class="doc">${renderMarkdown(topic.markdown)}</article>
      <nav class="toc"><p class="toc-title">On this page</p>${toc
        .map((h) => `<a href="#/cheatsheet/${topic.slug}?focus=${slugify(h)}">${escapeHtml(h)}</a>`)
        .join('')}</nav>
    </div>`;
}

function interviewView(c: Content, param: string): string {
  const topic = (c.questionTopics.find((t) => t.slug === param)?.slug ?? 'all') as QuestionTopic | 'all';
  const inTopic = topic === 'all' ? c.questions : c.questions.filter((q) => q.topic === topic);
  const known = inTopic.filter((q) => store.questionState(q.id) === 'known').length;
  const list = hideKnown ? inTopic.filter((q) => store.questionState(q.id) !== 'known') : inTopic;
  const chips = [{ slug: 'all', title: 'All' }, ...c.questionTopics]
    .map((t) => `<a class="chip${t.slug === topic ? ' active' : ''}" href="#/interview${t.slug === 'all' ? '' : '/' + t.slug}">${t.title}</a>`)
    .join('');
  return `<div class="page-head"><p class="eyebrow">Interview questions</p><h1>Drill until it is reflex</h1><p class="lede">Read the question, say the answer out loud, then reveal. Mark it known or keep it in review.</p></div>
    <div class="toolbar">
      <div class="chips">${chips}</div>
      <label class="toggle"><input type="checkbox" data-action="hide-known" ${hideKnown ? 'checked' : ''}/> Hide mastered</label>
    </div>
    <p class="muted stat">${known} of ${inTopic.length} mastered</p>
    <div class="cards">${list.length === 0 ? '<p class="empty">Everything here is mastered. Nice.</p>' : list.map((q) => questionCard(c, q)).join('')}</div>`;
}

function questionCard(c: Content, q: Question): string {
  const open = openAnswers.has(q.id);
  const state = store.questionState(q.id);
  const badge = state ? `<span class="badge ${state}">${state === 'known' ? 'Known' : 'Review'}</span>` : '';
  return `<article class="card qcard${open ? ' open' : ''}${state ? ' ' + state : ''}" id="q-${q.id}">
    <div class="qcard-head"><span class="chip small">${topicTitle(c, q.topic)}</span>${badge}</div>
    <h3>${inline(q.q)}</h3>
    ${open ? `<p class="answer">${inline(q.a)}</p>` : ''}
    <div class="qcard-actions">
      <button class="btn small" data-action="toggle-answer" data-id="${q.id}" type="button">${open ? 'Hide answer' : 'Show answer'}</button>
      <button class="btn small ok${state === 'known' ? ' active' : ''}" data-action="mark" data-id="${q.id}" data-state="known" type="button">Got it</button>
      <button class="btn small warn${state === 'review' ? ' active' : ''}" data-action="mark" data-id="${q.id}" data-state="review" type="button">Review again</button>
    </div>
  </article>`;
}

function projectsView(c: Content): string {
  const list = projectFilter === 'All' ? c.projects : c.projects.filter((p) => p.concept === projectFilter);
  const chips = ['All', ...c.concepts]
    .map((x) => `<button class="chip${x === projectFilter ? ' active' : ''}" data-action="project-filter" data-concept="${x}" type="button">${x}</button>`)
    .join('');
  const grouped = c.concepts
    .filter((x) => projectFilter === 'All' || x === projectFilter)
    .map((x) => {
      const items = list.filter((p) => p.concept === x);
      const done = items.filter((p) => store.projectDone(p.id)).length;
      return `<section class="group"><h2>${x} <span class="muted">${done}/${items.length}</span></h2><div class="cards grid">${items.map(projectCard).join('')}</div></section>`;
    })
    .join('');
  return `<div class="page-head"><p class="eyebrow">Mini projects</p><h1>${c.projects.length} projects, one hour each</h1><p class="lede">Every project drills one concept and has a concrete done condition. Start with the four marked "Start here".</p></div>
    <div class="toolbar"><div class="chips">${chips}</div><span class="muted stat">${store.doneCount()} of ${c.projects.length} done</span></div>
    ${grouped}`;
}

function projectCard(p: Project): string {
  const done = store.projectDone(p.id);
  return `<article class="card pcard${done ? ' done' : ''}" id="p-${p.id}">
    <div class="pcard-head"><span class="num">#${p.id}</span>${p.startHere ? '<span class="badge start">Start here</span>' : ''}<label class="check"><input type="checkbox" data-action="project" data-id="${p.id}" ${done ? 'checked' : ''}/> Done</label></div>
    <h3>${escapeHtml(p.title)}</h3>
    <p><span class="label">Build</span> ${inline(p.build)}</p>
    <p><span class="label">Done when</span> ${inline(p.doneWhen)}</p>
    <details class="starter"><summary>Starter code</summary>${codeBlock(p.starter)}</details>
  </article>`;
}

function ideasView(c: Content): string {
  const sections = c.ideaCategories
    .map((cat) => {
      const items = c.ideas.filter((i) => i.category === cat);
      return `<section class="group"><h2>${cat}</h2><div class="cards grid">${items
        .map(
          (i) => `<article class="card icard"><h3>${escapeHtml(i.title)}</h3><p>${inline(i.detail)}</p>${
            i.uses?.length
              ? `<p class="uses">Reuses ${i.uses.map((n) => `<a href="#/projects?focus=p-${n}">#${n}</a>`).join(', ')}</p>`
              : ''
          }</article>`,
        )
        .join('')}</div></section>`;
    })
    .join('');
  return `<div class="page-head"><p class="eyebrow">Daily-life ideas</p><h1>Put it to work in your own day</h1><p class="lede">Pick one and ship the smallest version. Each idea links to the mini projects it reuses.</p></div>${sections}`;
}

function searchView(c: Content, q: string): string {
  const needle = q.trim().toLowerCase();
  if (!needle) return `<div class="page-head"><h1>Search</h1><p class="lede">Type to search the cheatsheet, questions, projects, and ideas.</p></div>`;
  const hit = (s: string) => s.toLowerCase().includes(needle);
  const secs = cheatsheetSections(c).filter((s) => hit(s.heading) || hit(s.body));
  const qs = c.questions.filter((x) => hit(x.q) || hit(x.a));
  const ps = c.projects.filter((p) => hit(p.title) || hit(p.build) || hit(p.doneWhen));
  const is = c.ideas.filter((i) => hit(i.title) || hit(i.detail));
  const total = secs.length + qs.length + ps.length + is.length;
  const group = (title: string, items: string[]) =>
    items.length ? `<section class="group"><h2>${title} <span class="muted">${items.length}</span></h2><div class="results">${items.join('')}</div></section>` : '';
  return `<div class="page-head"><p class="eyebrow">Search</p><h1>${total} result${total === 1 ? '' : 's'} for "${escapeHtml(q)}"</h1></div>
    ${group('Cheatsheet', secs.map((s) => `<a class="result" href="#/cheatsheet/${s.topic.slug}?focus=${s.id}"><span class="chip small">${s.topic.title}</span><strong>${escapeHtml(s.heading)}</strong></a>`))}
    ${group('Interview questions', qs.map((x) => `<a class="result" href="#/interview/${x.topic}?focus=q-${x.id}"><span class="chip small">${topicTitle(c, x.topic)}</span><strong>${inline(x.q)}</strong></a>`))}
    ${group('Projects', ps.map((p) => `<a class="result" href="#/projects?focus=p-${p.id}"><span class="chip small">${p.concept}</span><strong>#${p.id} ${escapeHtml(p.title)}</strong></a>`))}
    ${group('Ideas', is.map((i) => `<a class="result" href="#/ideas"><span class="chip small">${i.category}</span><strong>${escapeHtml(i.title)}</strong></a>`))}
    ${total === 0 ? '<p class="empty">Nothing matched. Try a shorter word.</p>' : ''}`;
}

// ---------- render ----------

const app = document.getElementById('app')!;

export function render() {
  if (!C) {
    app.innerHTML = lockView();
    (document.getElementById('password') as HTMLInputElement | null)?.focus();
    return;
  }
  const c = C;
  const route = parseRoute();
  let main = '';
  switch (route.page) {
    case 'cheatsheet': main = cheatsheetView(c, route.param); break;
    case 'interview': main = interviewView(c, route.param); break;
    case 'projects': main = projectsView(c); break;
    case 'ideas': main = ideasView(c); break;
    case 'search': main = searchView(c, route.query.get('q') ?? ''); break;
    default: main = homeView(c);
  }
  const hadFocus = document.activeElement?.id === 'search';
  const caret = (document.getElementById('search') as HTMLInputElement | null)?.selectionStart ?? null;
  app.innerHTML = `${sidebar(c, route)}<main class="main"><div class="content">${main}</div></main>`;
  if (hadFocus) {
    const input = document.getElementById('search') as HTMLInputElement;
    input.focus();
    if (caret !== null) input.setSelectionRange(caret, caret);
  }
  const focus = route.query.get('focus');
  if (focus) {
    requestAnimationFrame(() => {
      const el = document.getElementById(focus);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('flash');
      }
    });
  } else {
    document.querySelector('.main')?.scrollTo(0, 0);
  }
}

// ---------- events ----------

function applyTheme(t: Theme | undefined) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme as Theme | undefined;
  if (set) return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

async function unlock(password: string) {
  unlocking = true;
  unlockError = '';
  render();
  try {
    C = await decryptContent(password);
    unlocking = false;
    render();
  } catch (e) {
    unlocking = false;
    unlockError = e instanceof WrongPasswordError ? 'Wrong password. Try again.' : (e as Error).message;
    render();
  }
}

export function init() {
  applyTheme(store.theme());

  app.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement;
    if (form.dataset.action !== 'unlock') return;
    e.preventDefault();
    const pw = (form.querySelector('#password') as HTMLInputElement).value;
    if (pw) void unlock(pw);
  });

  app.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target || target.tagName === 'FORM') return;
    const { action, id, state, concept } = target.dataset;
    switch (action) {
      case 'toggle-answer':
        if (openAnswers.has(id!)) openAnswers.delete(id!); else openAnswers.add(id!);
        render();
        break;
      case 'mark': {
        const next = store.questionState(id!) === state ? undefined : (state as 'known' | 'review');
        store.setQuestion(id!, next);
        render();
        break;
      }
      case 'project-filter':
        projectFilter = concept as Concept | 'All';
        render();
        break;
      case 'theme': {
        const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
        store.setTheme(next);
        applyTheme(next);
        render();
        break;
      }
      case 'reset':
        if (resetArmed) { store.reset(); resetArmed = false; }
        else { resetArmed = true; setTimeout(() => { resetArmed = false; render(); }, 3000); }
        render();
        break;
      case 'lock':
        C = null;
        openAnswers.clear();
        go('/');
        render();
        break;
      case 'copy': {
        const code = target.parentElement?.querySelector('code')?.textContent ?? '';
        navigator.clipboard?.writeText(code).then(() => {
          target.textContent = 'Copied';
          setTimeout(() => (target.textContent = 'Copy'), 1500);
        });
        break;
      }
    }
  });

  app.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.dataset.action === 'project') { store.toggleProject(Number(target.dataset.id)); render(); }
    if (target.dataset.action === 'hide-known') { hideKnown = target.checked; render(); }
  });

  app.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.id === 'search') {
      const q = target.value;
      history.replaceState(null, '', q ? `#/search?q=${encodeURIComponent(q)}` : '#/');
      render();
    }
  });

  // In-page anchor links inside rendered markdown
  app.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-anchor]');
    if (!a) return;
    e.preventDefault();
    document.getElementById(a.dataset.anchor!)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.addEventListener('keydown', (e) => {
    if (!C) return;
    const input = document.getElementById('search') as HTMLInputElement | null;
    if (e.key === '/' && document.activeElement !== input && !(e.target as HTMLElement).matches('input, textarea')) {
      e.preventDefault();
      input?.focus();
    }
    if (e.key === 'Escape' && document.activeElement === input && input) {
      input.value = '';
      input.blur();
      go('/');
    }
  });

  window.addEventListener('hashchange', render);
  render();
}
