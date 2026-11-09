import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Project } from '@pulso/core';
import { loadProject, saveProject } from './store';
import { newId } from './ulid';

function smallProject(): Project {
  const gid = newId();
  return {
    info: { formatVersion: 1, id: newId(), name: 'demo', defaultCycleMs: 10 },
    globals: [{ id: gid, name: 'Start', type: { kind: 'bool' }, default: false }],
    interfaces: [],
    equipment: [],
    conditions: [],
    states: [],
    machines: [],
    routing: { routes: [] },
  };
}

describe('ULID', () => {
  it('is 26 Crockford characters, unique, and sorts by creation time', () => {
    const a = newId(1_700_000_000_000);
    const b = newId(1_700_000_000_001);
    expect(a).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(a < b).toBe(true);
    expect(new Set(Array.from({ length: 1000 }, () => newId())).size).toBe(1000);
  });
});

describe('project store (folder of files)', () => {
  it('saves and loads a project unchanged', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pulso-'));
    const p = smallProject();
    const first = await saveProject(dir, p);
    expect(first.written).toEqual([
      'globals/' + p.globals[0]!.id + '.json',
      'project.json',
      'routing.json',
    ]);
    const { project, problems } = await loadProject(dir);
    expect(problems).toEqual([]);
    expect(project).toEqual(p);
  });

  it('writes only changed files and removes deleted entities, leaving other folders alone', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pulso-'));
    const p = smallProject();
    await saveProject(dir, p);
    await mkdir(path.join(dir, 'tests/cases'), { recursive: true });
    await writeFile(path.join(dir, 'tests/cases/keep.json'), '{}');

    const again = await saveProject(dir, p);
    expect(again).toEqual({ written: [], removed: [] });

    const gone = p.globals[0]!.id;
    const third = await saveProject(dir, { ...p, globals: [] });
    expect(third.removed).toEqual([`globals/${gone}.json`]);
    expect(await readdir(path.join(dir, 'globals'))).toEqual([]);
    expect(await readFile(path.join(dir, 'tests/cases/keep.json'), 'utf8')).toBe('{}');
  });

  it('reports a broken file instead of loading a half project', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pulso-'));
    const p = smallProject();
    await saveProject(dir, p);
    await writeFile(path.join(dir, `globals/${p.globals[0]!.id}.json`), '{"id": 1}');
    const { project, problems } = await loadProject(dir);
    expect(project).toBeNull();
    expect(problems[0]!.where).toBe(`globals/${p.globals[0]!.id}.json`);
  });
});
