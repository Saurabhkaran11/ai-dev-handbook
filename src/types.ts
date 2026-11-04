export interface CheatsheetTopic {
  slug: string;
  title: string;
  tagline: string;
  markdown: string;
}

export type QuestionTopic = 'typescript' | 'ai-sdk' | 'context' | 'production';

export interface Question {
  id: string;
  topic: QuestionTopic;
  q: string;
  a: string;
}

export type Concept = 'TypeScript' | 'AI SDK' | 'Context Engineering' | 'Production' | 'Tooling';

export interface Project {
  id: number;
  concept: Concept;
  title: string;
  build: string;
  doneWhen: string;
  starter: string;
  startHere?: boolean;
}

export interface Idea {
  category: string;
  title: string;
  detail: string;
  uses?: number[];
}

/** Everything the site shows. Encrypted at build time, decrypted in the browser. */
export interface Content {
  cheatsheet: CheatsheetTopic[];
  questionTopics: { slug: QuestionTopic; title: string }[];
  questions: Question[];
  concepts: Concept[];
  projects: Project[];
  ideaCategories: string[];
  ideas: Idea[];
}
