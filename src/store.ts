export type QuestionState = 'known' | 'review';

interface Progress {
  questions: Record<string, QuestionState>;
  projects: Record<string, boolean>;
  sidebar?: 'collapsed' | 'expanded';
}

const KEY = 'ai-dev-handbook:v1';

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Progress;
  } catch {
    /* private mode or blocked storage: fall through to defaults */
  }
  return { questions: {}, projects: {} };
}

let state = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export const store = {
  questionState(id: string): QuestionState | undefined {
    return state.questions[id];
  },
  setQuestion(id: string, s: QuestionState | undefined) {
    if (s) state.questions[id] = s;
    else delete state.questions[id];
    save();
  },
  knownCount(): number {
    return Object.values(state.questions).filter((s) => s === 'known').length;
  },
  projectDone(id: number): boolean {
    return state.projects[String(id)] === true;
  },
  toggleProject(id: number) {
    state.projects[String(id)] = !state.projects[String(id)];
    save();
  },
  doneCount(): number {
    return Object.values(state.projects).filter(Boolean).length;
  },
  sidebarCollapsed(): boolean {
    return state.sidebar === 'collapsed';
  },
  setSidebarCollapsed(collapsed: boolean) {
    state.sidebar = collapsed ? 'collapsed' : 'expanded';
    save();
  },
  reset() {
    state = { questions: {}, projects: {}, sidebar: state.sidebar };
    save();
  },
};
