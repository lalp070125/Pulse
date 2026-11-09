import { mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ENTITY_FOLDERS,
  projectFromFiles,
  projectToFiles,
  type Problem,
  type Project,
  type ProjectFiles,
} from '@pulso/core';

/* ----------------------------------------------------------------------------
 * Project store: a project is a folder of small JSON files (SPEC 5.1).
 * Only project.json, routing.json and the entity folders are owned here;
 * other folders (tests, panels, twin, logic-blocks) are never touched.
 * -------------------------------------------------------------------------- */

async function listJson(dir: string, rel = ''): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listJson(dir, r)));
    else if (e.name.endsWith('.json')) out.push(r);
  }
  return out;
}

/** Reads every file the project model owns, as relative path → text. */
export async function readProjectFiles(dir: string): Promise<ProjectFiles> {
  const files: ProjectFiles = {};
  const top = ['project.json', 'routing.json'];
  for (const f of top) {
    try {
      files[f] = await readFile(path.join(dir, f), 'utf8');
    } catch {
      // Missing files are reported by projectFromFiles.
    }
  }
  for (const folder of ENTITY_FOLDERS) {
    for (const rel of await listJson(dir, folder)) {
      files[rel] = await readFile(path.join(dir, rel), 'utf8');
    }
  }
  return files;
}

export async function loadProject(
  dir: string,
): Promise<{ project: Project | null; problems: Problem[] }> {
  return projectFromFiles(await readProjectFiles(dir));
}

/**
 * Writes the project. Only files whose text changed are written; entity files
 * that no longer belong to the project are removed.
 */
export async function saveProject(
  dir: string,
  project: Project,
): Promise<{ written: string[]; removed: string[] }> {
  const next = projectToFiles(project);
  const current = await readProjectFiles(dir);
  const written: string[] = [];
  const removed: string[] = [];

  for (const [rel, text] of Object.entries(next)) {
    if (current[rel] === text) continue;
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text, 'utf8');
    written.push(rel);
  }
  for (const rel of Object.keys(current)) {
    if (rel in next || rel === 'project.json' || rel === 'routing.json') continue;
    await rm(path.join(dir, rel));
    removed.push(rel);
    // Remove a machine folder left empty.
    const parent = path.dirname(path.join(dir, rel));
    if (rel.startsWith('machines/')) await rmdir(parent).catch(() => undefined);
  }
  return { written: written.sort(), removed: removed.sort() };
}
