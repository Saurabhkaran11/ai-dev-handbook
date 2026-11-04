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
let searchFilter = 'All';
let outlineHidden = false;

// ---------- helpers ----------

const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

type IconName = 'home' | 'library' | 'practice' | 'build' | 'idea' | 'search' | 'sun' | 'moon' | 'reset' | 'lock' | 'arrow' | 'check' | 'copy' | 'collapse' | 'expand' | 'outline';

function icon(name: IconName, label?: string): string {
  const paths: Record<IconName, string> = {
    home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21v-7h6v7"/>',
    library: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    practice: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.7 2.7 0 1 1 4.5 2c-1.5 1.2-2 1.8-2 3"/><path d="M12 17h.01"/>',
    build: '<path d="m14.7 6.3 3 3"/><path d="m4.3 19.7 8.9-8.9a3 3 0 0 1 4.2 4.2l-8.9 8.9H4v-4.2Z"/><path d="m14 6 4-4 4 4-4 4"/>',
    idea: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.5 15.5C7 14.3 6 12.3 6 10a6 6 0 0 1 12 0c0 2.3-1 4.3-2.5 5.5-.9.8-1.5 1.7-1.5 2.5h-4c0-.8-.6-1.7-1.5-2.5Z"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
    collapse: '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>',
    expand: '<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>',
    outline: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  };
  return `<svg class="icon icon-${name}" viewBox="0 0 24 24" aria-hidden="${label ? 'false' : 'true'}"${label ? ` aria-label="${escapeHtml(label)}" role="img"` : ''} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

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
    ['home', 'Home', 'home'],
    ['cheatsheet', 'Cheatsheet', 'library'],
    ['interview', 'Interview Qs', 'practice'],
    ['projects', 'Mini Projects', 'build'],
    ['ideas', 'Daily-life Ideas', 'idea'],
  ] as const;
  const q = route.page === 'search' ? route.query.get('q') ?? '' : '';
  const theme = currentTheme();
  const collapsed = store.sidebarCollapsed();
  const label = (text: string) => `<span class="ghost-label">${text}</span>`;
  return `<aside class="sidebar${collapsed ? ' collapsed' : ''}">
    <a class="brand" href="#/" title="Home"><span class="brand-mark">AI</span><span><strong>Engineering Handbook</strong><small>TypeScript · AI SDK · Context</small></span></a>
    <button class="ghost sidebar-toggle" data-action="toggle-sidebar" type="button" title="${collapsed ? 'Expand sidebar  [' : 'Collapse sidebar  ['}" aria-expanded="${!collapsed}">${icon(collapsed ? 'expand' : 'collapse')}${label('Collapse')}</button>
    ${collapsed
      ? `<button class="ghost search-button" data-action="expand-search" type="button" title="Search  /">${icon('search')}</button>`
      : `<label class="search"><span class="search-icon">${icon('search')}</span><input id="search" type="search" aria-label="Search all handbook content" placeholder="Search all content…" value="${escapeHtml(q)}" autocomplete="off" /><kbd>/</kbd></label>`}
    <nav aria-label="Main navigation">${nav
      .map(([slug, text, navIcon]) => `<a class="nav-item${route.page === slug ? ' active' : ''}" href="#/${slug}" title="${text}"><span class="nav-icon">${icon(navIcon)}</span><span class="nav-label">${text}</span></a>`)
      .join('')}</nav>
    <div class="sidebar-progress">
      ${progressBar(store.knownCount(), c.questions.length, 'Questions mastered')}
      ${progressBar(store.doneCount(), c.projects.length, 'Projects done')}
    </div>
    <div class="mobile-progress"><span>${store.knownCount()}/${c.questions.length} questions</span><span>${store.doneCount()}/${c.projects.length} projects</span></div>
    <div class="sidebar-footer">
      <button class="ghost" data-action="theme" type="button" title="${theme === 'dark' ? 'Light mode' : 'Dark mode'}">${theme === 'dark' ? icon('sun') + label('Light mode') : icon('moon') + label('Dark mode')}</button>
      <button class="ghost danger" data-action="reset" type="button" title="Reset progress">${icon('reset')}${label(resetArmed ? 'Click again to confirm' : 'Reset progress')}</button>
      <button class="ghost" data-action="lock" type="button" title="Lock">${icon('lock')}${label('Lock')}</button>
    </div>
  </aside>`;
}

function homeView(c: Content): string {
  const path = c.projects.filter((p) => p.startHere);
  const nextProject = path.find((p) => !store.projectDone(p.id));
  const modules = [
    { number: '01', icon: 'library' as IconName, title: 'Look things up', detail: `${c.cheatsheet.length} reference topics`, href: '#/cheatsheet', action: 'Browse guides' },
    { number: '02', icon: 'practice' as IconName, title: 'Practice recall', detail: `${c.questions.length} interview questions`, href: '#/interview', action: 'Start practice' },
    { number: '03', icon: 'build' as IconName, title: 'Build a project', detail: `${c.projects.length} guided mini projects`, href: '#/projects', action: 'Explore projects' },
    { number: '04', icon: 'idea' as IconName, title: 'Apply the ideas', detail: `${c.ideas.length} practical use cases`, href: '#/ideas', action: 'See ideas' },
  ];
  return `<section class="hero">
      <p class="eyebrow">Your AI engineering learning space</p>
      <h1>Find the right answer. Build confidence by doing.</h1>
      <p class="lede">A structured handbook for TypeScript, AI SDKs, and context engineering. Search across every guide, question, project, and idea.</p>
      <div class="hero-actions"><a class="btn primary" href="#/cheatsheet">Start with the fundamentals</a><a class="btn" href="#/projects${nextProject ? `?focus=p-${nextProject.id}` : ''}">${nextProject ? 'Continue your project path' : 'Browse projects'}</a></div>
    </section>
    <section class="section-heading"><div><p class="eyebrow">Choose a way to learn</p><h2>Explore the handbook</h2></div><a class="text-link" href="#/search">Browse all content →</a></section>
    <section class="module-grid">${modules
      .map((m) => `<a class="module-card module-${m.number}" href="${m.href}"><span class="module-number">${m.number}</span><span class="module-icon">${icon(m.icon)}</span><h3>${m.title}</h3><p>${m.detail}</p><span class="module-link">${m.action} ${icon('arrow')}</span></a>`)
      .join('')}</section>
    <section class="section-heading roadmap-heading"><div><p class="eyebrow">A simple sequence</p><h2>Follow the learning path</h2></div><span class="muted">Learn · practice · build · apply</span></section>
    <section class="roadmap">
      <a class="roadmap-step" href="#/cheatsheet"><span class="step-marker">1</span><span><strong>Learn the foundations</strong><small>Use concise references to understand the core concepts.</small></span><span class="step-arrow">→</span></a>
      <a class="roadmap-step" href="#/interview"><span class="step-marker">2</span><span><strong>Check your understanding</strong><small>Practice questions and mark what you know or want to revisit.</small></span><span class="step-arrow">→</span></a>
      <div class="roadmap-step"><span class="step-marker">3</span><span><strong>Build something real</strong><small>${nextProject ? `Continue with #${nextProject.id}: ${escapeHtml(nextProject.title)}.` : 'You completed the suggested projects. Pick another project to keep going.'}</small></span><a class="step-arrow" aria-label="Open projects" href="#/projects${nextProject ? `?focus=p-${nextProject.id}` : ''}">→</a></div>
      <a class="roadmap-step" href="#/ideas"><span class="step-marker">4</span><span><strong>Apply it to your work</strong><small>Explore practical ideas and the projects they build on.</small></span><span class="step-arrow">→</span></a>
    </section>
    <section class="dashboard-grid">
      <div class="card progress-card"><div class="card-heading"><div><p class="eyebrow">Your progress</p><h2>Keep your momentum</h2></div><span class="progress-spark" aria-hidden="true">↗</span></div><p class="muted">Saved on this device, so you can pick up where you left off.</p>${progressBar(store.knownCount(), c.questions.length, 'Questions mastered')}${progressBar(store.doneCount(), c.projects.length, 'Projects completed')}</div>
      <div class="card quick-tips"><p class="eyebrow">Quick tips</p><h2>Find things faster</h2><ul class="how"><li>Search by concept, tool, question, or project name.</li><li>Press <kbd>/</kbd> to jump into search; press <kbd>Esc</kbd> to clear. Press <kbd>[</kbd> or the chevron to collapse the sidebar.</li><li>Use topic tabs and filters to narrow a long list.</li><li>Every cheatsheet topic opens with "Fundamentals in 3 minutes". The <a href="#/cheatsheet/remember">Remember It</a> tab has the daily loop, mnemonics, and the never-forget list.</li></ul></div>
    </section>`;
}

function cheatsheetView(c: Content, param: string): string {
  const topic = c.cheatsheet.find((t) => t.slug === param) ?? c.cheatsheet[0]!;
  const parts = topic.markdown.split(/^### /m);
  const intro = parts[0]?.trim() ?? '';
  const sections = parts.slice(1).map((part, index) => {
    const newline = part.indexOf('\n');
    const heading = (newline < 0 ? part : part.slice(0, newline)).trim();
    const body = newline < 0 ? '' : part.slice(newline + 1).trim();
    const id = slugify(heading);
    return `<details class="concept-section" ${index === 0 ? 'open' : ''}><summary id="${id}"><span class="concept-index">${String(index + 1).padStart(2, '0')}</span><span class="concept-title">${escapeHtml(heading)}</span><span class="concept-toggle" aria-hidden="true"></span></summary><div class="concept-body">${renderMarkdown(body)}</div></details>`;
  });
  const tabs = c.cheatsheet
    .map((t) => `<a class="tab${t.slug === topic.slug ? ' active' : ''}" href="#/cheatsheet/${t.slug}">${t.title}</a>`)
    .join('');
  return `<div class="page-head topic-head"><p class="eyebrow">Learning library <span aria-hidden="true">/</span> Reference</p><h1>${topic.title}</h1><p class="lede">${topic.tagline}</p></div>
    <div class="tabs" aria-label="Choose a topic">${tabs}</div>
    <div class="doc-layout${outlineHidden ? ' no-toc' : ''}">
      <article class="doc topic-doc">
        ${intro ? `<div class="topic-intro">${renderMarkdown(intro)}</div>` : ''}
        ${sections.length ? `<div class="concept-toolbar"><span>${sections.length} short sections</span><div><button class="text-button" data-action="toggle-sections" data-target="concept-list" data-open="true" type="button">Expand all</button><span aria-hidden="true">·</span><button class="text-button" data-action="toggle-sections" data-target="concept-list" data-open="false" type="button">Collapse all</button><span aria-hidden="true">·</span><button class="text-button" data-action="toggle-outline" type="button">${outlineHidden ? 'Show outline' : 'Hide outline'}</button></div></div><div class="concept-list">${sections.join('')}</div>` : renderMarkdown(topic.markdown)}
      </article>
      ${sections.length && !outlineHidden ? `<nav class="toc topic-index"><p class="toc-title">In this topic</p>${parts.slice(1).map((part) => { const newline = part.indexOf('\n'); const title = (newline < 0 ? part : part.slice(0, newline)).trim(); return `<a href="#/cheatsheet/${topic.slug}?focus=${slugify(title)}">${escapeHtml(title)}</a>`; }).join('')}</nav>` : ''}
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
    <div class="toolbar interview-toolbar">
      <div class="chips">${chips}</div>
      <div class="toolbar-actions"><button class="mini-action" data-action="toggle-answers" data-open="${list.some((q) => !openAnswers.has(q.id))}" type="button">${icon('practice')}${list.some((q) => !openAnswers.has(q.id)) ? 'Show all answers' : 'Hide all answers'}</button><label class="toggle"><input type="checkbox" data-action="hide-known" ${hideKnown ? 'checked' : ''}/> Hide mastered</label></div>
    </div>
    <p class="muted stat">${known} of ${inTopic.length} mastered</p>
    <div class="cards">${list.length === 0 ? '<p class="empty">Everything here is mastered. Nice.</p>' : list.map((q) => questionCard(c, q)).join('')}</div>`;
}

function questionCard(c: Content, q: Question): string {
  const open = openAnswers.has(q.id);
  const state = store.questionState(q.id);
  const badge = state ? `<span class="badge ${state}">${state === 'known' ? 'Known' : 'Review'}</span>` : '';
  return `<article class="card qcard${open ? ' open' : ''}${state ? ' ' + state : ''}" id="q-${q.id}">
    <div class="qcard-head"><span class="chips"><span class="chip small">${topicTitle(c, q.topic)}</span>${q.fundamental ? '<span class="chip small fund">Fundamentals</span>' : ''}</span>${badge}</div>
    <h3>${inline(q.q)}</h3>
    ${open ? `<p class="answer">${inline(q.a)}</p>` : ''}
    <div class="qcard-actions">
      <button class="btn small" data-action="toggle-answer" data-id="${q.id}" type="button">${open ? 'Hide answer' : 'Show answer'}</button>
      <button class="btn small ok${state === 'known' ? ' active' : ''}" data-action="mark" data-id="${q.id}" data-state="known" aria-pressed="${state === 'known'}" type="button">Got it</button>
      <button class="btn small warn${state === 'review' ? ' active' : ''}" data-action="mark" data-id="${q.id}" data-state="review" aria-pressed="${state === 'review'}" type="button">Review again</button>
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
    .map((x, index) => {
      const items = list.filter((p) => p.concept === x);
      const done = items.filter((p) => store.projectDone(p.id)).length;
      return `<details class="collection-section" id="concept-${slugify(x)}" ${projectFilter !== 'All' || index === 0 ? 'open' : ''}><summary class="collection-summary"><span class="concept-index">${String(index + 1).padStart(2, '0')}</span><span class="collection-name"><strong>${x}</strong><small>${done} of ${items.length} completed</small></span><span class="count-pill">${items.length}</span><span class="concept-toggle" aria-hidden="true"></span></summary><div class="collection-content"><div class="cards grid">${items.map(projectCard).join('')}</div></div></details>`;
    })
    .join('');
  return `<div class="page-head"><p class="eyebrow">Mini projects</p><h1>${c.projects.length} projects, one hour each</h1><p class="lede">Every project drills one concept and has a concrete done condition. Start with the four marked "Start here".</p></div>
    <div class="toolbar"><div class="chips">${chips}</div><div class="toolbar-actions"><span class="muted stat">${store.doneCount()} of ${c.projects.length} done</span><button class="mini-action" data-action="toggle-sections" data-target="project-groups" data-open="true" type="button">Expand groups</button><button class="mini-action" data-action="toggle-sections" data-target="project-groups" data-open="false" type="button">Collapse groups</button></div></div>
    <div class="project-groups">${grouped}</div>`;
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
    .map((cat, index) => {
      const items = c.ideas.filter((i) => i.category === cat);
      return `<details class="collection-section" id="idea-category-${slugify(cat)}" ${index === 0 ? 'open' : ''}><summary class="collection-summary"><span class="concept-index">${String(index + 1).padStart(2, '0')}</span><span class="collection-name"><strong>${escapeHtml(cat)}</strong><small>${items.length} practical ideas</small></span><span class="count-pill">${items.length}</span><span class="concept-toggle" aria-hidden="true"></span></summary><div class="collection-content"><div class="cards grid">${items
        .map(
          (i) => `<article class="card icard" id="i-${slugify(i.title)}"><h3>${escapeHtml(i.title)}</h3><p>${inline(i.detail)}</p>${
            i.uses?.length
              ? `<p class="uses">Reuses ${i.uses.map((n) => `<a href="#/projects?focus=p-${n}">#${n}</a>`).join(', ')}</p>`
              : ''
          }</article>`,
        )
        .join('')}</div></div></details>`;
    })
    .join('');
  const categoryLinks = c.ideaCategories.map((cat) => `<a class="chip" href="#/ideas?focus=idea-category-${slugify(cat)}">${escapeHtml(cat)}</a>`).join('');
  return `<div class="page-head"><p class="eyebrow">Daily-life ideas</p><h1>Put it to work in your own day</h1><p class="lede">Pick one and ship the smallest version. Each idea links to the mini projects it reuses.</p></div><div class="toolbar idea-toolbar"><div class="idea-category-nav">${categoryLinks}</div><div class="toolbar-actions"><button class="mini-action" data-action="toggle-sections" data-target="idea-groups" data-open="true" type="button">Expand groups</button><button class="mini-action" data-action="toggle-sections" data-target="idea-groups" data-open="false" type="button">Collapse groups</button></div></div><div class="idea-groups">${sections}</div>`;
}

function searchView(c: Content, q: string): string {
  const needle = q.trim().toLowerCase();
  if (!needle) return `<div class="page-head search-head"><p class="eyebrow">Handbook index</p><h1>What are you looking for?</h1><p class="lede">Search across ${c.cheatsheet.length} reference topics, ${c.questions.length} questions, ${c.projects.length} projects, and ${c.ideas.length} practical ideas.</p></div><div class="search-empty card"><span class="search-empty-icon" aria-hidden="true">⌕</span><h2>Start with a topic or question</h2><p class="muted">Try “TypeScript”, “tool calling”, “RAG”, or a project name.</p><div class="suggestions">${['TypeScript', 'AI SDK', 'RAG', 'production'].map((s) => `<button class="suggestion" data-action="search-suggestion" data-query="${s}" type="button">${s}</button>`).join('')}</div></div><div class="index-links"><a href="#/cheatsheet">Browse reference topics <span>→</span></a><a href="#/interview">Browse interview questions <span>→</span></a><a href="#/projects">Browse mini projects <span>→</span></a><a href="#/ideas">Browse practical ideas <span>→</span></a></div>`;
  const hit = (s: string) => s.toLowerCase().includes(needle);
  const secs = cheatsheetSections(c).filter((s) => hit(s.topic.title) || hit(s.topic.tagline) || hit(s.heading) || hit(s.body));
  const qs = c.questions.filter((x) => hit(x.q) || hit(x.a) || hit(topicTitle(c, x.topic)));
  const ps = c.projects.filter((p) => hit(p.title) || hit(p.build) || hit(p.doneWhen) || hit(p.concept));
  const is = c.ideas.filter((i) => hit(i.title) || hit(i.detail) || hit(i.category));
  const groups = [
    { id: 'Cheatsheet', title: 'Reference topics', items: secs.map((s) => `<a class="result" href="#/cheatsheet/${s.topic.slug}?focus=${s.id}"><span class="result-type">Guide</span><span class="result-copy"><strong>${escapeHtml(s.heading)}</strong><small>${escapeHtml(s.topic.title)} · ${escapeHtml(s.topic.tagline)}</small></span><span class="result-arrow" aria-hidden="true">→</span></a>`) },
    { id: 'Interview questions', title: 'Practice questions', items: qs.map((x) => `<a class="result" href="#/interview/${x.topic}?focus=q-${x.id}"><span class="result-type">Question</span><span class="result-copy"><strong>${inline(x.q)}</strong><small>${topicTitle(c, x.topic)}${x.fundamental ? ' · Fundamentals' : ''}</small></span><span class="result-arrow" aria-hidden="true">→</span></a>`) },
    { id: 'Projects', title: 'Mini projects', items: ps.map((p) => `<a class="result" href="#/projects?focus=p-${p.id}"><span class="result-type">Build</span><span class="result-copy"><strong>#${p.id} ${escapeHtml(p.title)}</strong><small>${p.concept} · ${inline(p.build)}</small></span><span class="result-arrow" aria-hidden="true">→</span></a>`) },
    { id: 'Ideas', title: 'Practical ideas', items: is.map((i) => `<a class="result" href="#/ideas?focus=i-${slugify(i.title)}"><span class="result-type">Idea</span><span class="result-copy"><strong>${escapeHtml(i.title)}</strong><small>${escapeHtml(i.category)} · ${inline(i.detail)}</small></span><span class="result-arrow" aria-hidden="true">→</span></a>`) },
  ];
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  const visibleGroups = groups.filter((g) => (searchFilter === 'All' || searchFilter === g.id) && g.items.length > 0);
  const filterTabs = ['All', ...groups.map((g) => g.id)].map((name) => `<button class="filter-chip${searchFilter === name ? ' active' : ''}" data-action="search-filter" data-filter="${name}" type="button">${name === 'All' ? `All <span>${total}</span>` : `${name} <span>${groups.find((g) => g.id === name)?.items.length ?? 0}</span>`}</button>`).join('');
  const group = (title: string, items: string[]) => `<section class="group search-group"><div class="search-group-head"><h2>${title}</h2><span class="count-pill">${items.length}</span></div><div class="results">${items.join('')}</div></section>`;
  return `<div class="page-head search-results-head"><p class="eyebrow">Handbook search</p><h1>${total} result${total === 1 ? '' : 's'} for <span class="query-highlight">“${escapeHtml(q)}”</span></h1><p class="lede">Search matches across guides, practice questions, projects, and ideas.</p></div>
    <div class="search-filters" aria-label="Filter search results">${filterTabs}</div>
    ${visibleGroups.map((g) => group(g.title, g.items)).join('')}
    ${total === 0 ? `<div class="empty search-no-results"><strong>No matches for “${escapeHtml(q)}”</strong><span>Try a broader term or browse the handbook sections below.</span><a class="btn" href="#/cheatsheet">Browse reference topics</a></div>` : ''}`;
}

// ---------- render ----------

const app = document.getElementById('app')!;
let toastTimer = 0;

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
  app.classList.toggle('sidebar-collapsed', store.sidebarCollapsed());
  app.innerHTML = `${sidebar(c, route)}<main class="main"><div class="content">${main}</div></main><div id="action-toast" class="action-toast" role="status" aria-live="polite"></div>`;
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
        const collapsible = el.closest('details');
        if (collapsible) collapsible.open = true;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('flash');
      }
    });
  } else {
    document.querySelector('.main')?.scrollTo(0, 0);
  }
}

function showToast(message: string) {
  const toast = document.getElementById('action-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2200);
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
        showToast(next === 'known' ? 'Marked as known' : next === 'review' ? 'Added to review' : 'Progress cleared for this question');
        break;
      }
      case 'project-filter':
        projectFilter = concept as Concept | 'All';
        render();
        break;
      case 'search-filter':
        searchFilter = target.dataset.filter ?? 'All';
        render();
        break;
      case 'search-suggestion': {
        const input = document.getElementById('search') as HTMLInputElement | null;
        const query = target.dataset.query ?? '';
        if (input) input.value = query;
        history.replaceState(null, '', `#/search?q=${encodeURIComponent(query)}`);
        searchFilter = 'All';
        render();
        break;
      }
      case 'toggle-sections': {
        // data-target names the container (concept-list, project-groups, idea-groups).
        // Only its direct <details> children toggle, so starter-code blocks inside cards stay as they are.
        const container = target.dataset.target ?? 'concept-list';
        document.querySelectorAll<HTMLDetailsElement>(`.${container} > details`).forEach((section) => { section.open = target.dataset.open === 'true'; });
        break;
      }
      case 'toggle-sidebar':
        store.setSidebarCollapsed(!store.sidebarCollapsed());
        render();
        break;
      case 'expand-search':
        store.setSidebarCollapsed(false);
        render();
        (document.getElementById('search') as HTMLInputElement | null)?.focus();
        break;
      case 'toggle-outline':
        outlineHidden = !outlineHidden;
        render();
        break;
      case 'toggle-answers': {
        const ids = [...document.querySelectorAll<HTMLElement>('.qcard')].map((el) => el.id.replace(/^q-/, ''));
        if (target.dataset.open === 'true') ids.forEach((qid) => openAnswers.add(qid));
        else ids.forEach((qid) => openAnswers.delete(qid));
        render();
        break;
      }
      case 'theme': {
        const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
        store.setTheme(next);
        applyTheme(next);
        render();
        showToast(`${next === 'dark' ? 'Dark' : 'Light'} theme enabled`);
        break;
      }
      case 'reset': {
        const didReset = resetArmed;
        if (didReset) { store.reset(); resetArmed = false; }
        else { resetArmed = true; setTimeout(() => { resetArmed = false; render(); }, 3000); }
        render();
        showToast(didReset ? 'Learning progress reset' : 'Click Reset progress again within 3 seconds to confirm');
        break;
      }
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
          showToast('Code copied to clipboard');
        }).catch(() => showToast('Could not access the clipboard'));
        break;
      }
    }
  });

  app.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.dataset.action === 'project') { store.toggleProject(Number(target.dataset.id)); render(); showToast(target.checked ? 'Project marked complete' : 'Project moved back to in progress'); }
    if (target.dataset.action === 'hide-known') { hideKnown = target.checked; render(); }
  });

  app.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.id === 'search') {
      const q = target.value;
      searchFilter = 'All';
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
    const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea');
    if (e.key === '/' && document.activeElement !== input && !typing) {
      e.preventDefault();
      if (store.sidebarCollapsed()) { store.setSidebarCollapsed(false); render(); }
      (document.getElementById('search') as HTMLInputElement | null)?.focus();
    }
    if (e.key === '[' && !typing) {
      e.preventDefault();
      store.setSidebarCollapsed(!store.sidebarCollapsed());
      render();
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
