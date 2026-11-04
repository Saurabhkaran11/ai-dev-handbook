/**
 * Encrypts everything under src/content/ into public/content.enc.
 *
 *   HANDBOOK_PASSWORD=... pnpm encrypt        (or put it in .env)
 *
 * The plaintext content never leaves this machine; only content.enc is committed.
 * Change the password: set a new HANDBOOK_PASSWORD, run again, commit, push.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { questionTopics, questions } from '../src/content/questions';
import { concepts, projects } from '../src/content/projects';
import { ideaCategories, ideas } from '../src/content/ideas';
import type { Content } from '../src/types';

if (existsSync('.env')) process.loadEnvFile('.env');
const password = process.env.HANDBOOK_PASSWORD;
if (!password || password.length < 8) {
  console.error('Set HANDBOOK_PASSWORD (at least 8 characters) in .env or the environment.');
  process.exit(1);
}

const topics = [
  { slug: 'typescript', title: 'TypeScript', tagline: 'The subset you use daily in AI apps', file: 'typescript.md' },
  { slug: 'ai-sdk', title: 'AI SDK', tagline: 'Text, tools, agents, streaming, UI', file: 'ai-sdk.md' },
  { slug: 'context', title: 'Context Engineering', tagline: 'What enters the window, what stays, what gets compressed', file: 'context.md' },
  { slug: 'production', title: 'Production', tagline: 'From demo to something people rely on', file: 'production.md' },
  { slug: 'tools', title: 'Required Tools', tagline: 'The stack, setup, and model guide', file: 'tools.md' },
  { slug: 'platforms', title: 'Platforms & Resources', tagline: 'OpenAI, Google, Mistral, open weights, local models, and where to learn more', file: 'platforms.md' },
  { slug: 'remember', title: 'Remember It', tagline: 'How to make all of this stick', file: 'remember.md' },
];

const content: Content = {
  cheatsheet: await Promise.all(
    topics.map(async ({ file, ...t }) => ({ ...t, markdown: await readFile(`src/content/cheatsheet/${file}`, 'utf8') })),
  ),
  questionTopics,
  questions,
  concepts,
  projects,
  ideaCategories,
  ideas,
};

const subtle = webcrypto.subtle;
const iterations = 310_000;
const salt = webcrypto.getRandomValues(new Uint8Array(16));
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(content)));

const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b).toString('base64');
await mkdir('public', { recursive: true });
await writeFile('public/content.enc', JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), iv: b64(iv), data: b64(data) }));
console.log(`Encrypted ${content.cheatsheet.length} topics, ${content.questions.length} questions, ${content.projects.length} projects, ${content.ideas.length} ideas -> public/content.enc (${(data.byteLength / 1024).toFixed(0)} KB)`);
