import { describe, expect, it } from 'vitest';
import { findUsages, projectFromFiles, projectToFiles } from './files';
import { ProjectBuilder, T, v } from './test/kit';

/* Project model as a folder of small files (SPEC 5.1). */

function sample() {
  const b = new ProjectBuilder();
  const start = b.global('Start', T.bool);
  const m = b.machine('M');
  const a = m.state('A');
  m.trans(a, m.state('B'), m.cond('Go', v(start)));
  return { project: b.build(), start };
}

describe('project files', () => {
  it('writes one file per entity, 2-space indented, keys in a fixed order', () => {
    const { project } = sample();
    const files = projectToFiles(project);
    const g = project.globals[0]!;
    expect(Object.keys(files).sort()).toEqual(
      [
        'project.json',
        'routing.json',
        `globals/${g.id}.json`,
        ...project.conditions.map((c) => `conditions/${c.id}.json`),
        ...project.states.map((s) => `states/${s.id}.json`),
        `machines/${project.machines[0]!.machine.id}/machine.json`,
        `machines/${project.machines[0]!.machine.id}/plan.json`,
      ].sort(),
    );
    expect(files[`globals/${g.id}.json`]).toBe(
      `{\n  "id": "${g.id}",\n  "name": "Start",\n  "type": {\n    "kind": "bool"\n  },\n  "default": false\n}\n`,
    );
  });

  it('key order does not depend on how the object was built', () => {
    const { project } = sample();
    const g = project.globals[0]!;
    const shuffled = { default: g.default, type: g.type, name: g.name, id: g.id };
    const again = projectToFiles({ ...project, globals: [shuffled] });
    expect(again[`globals/${g.id}.json`]).toBe(projectToFiles(project)[`globals/${g.id}.json`]);
  });

  it('reads back exactly what it wrote (round trip)', () => {
    const { project } = sample();
    const files = projectToFiles(project);
    const { project: back, problems } = projectFromFiles(files);
    expect(problems).toEqual([]);
    expect(projectToFiles(back!)).toEqual(files);
  });

  it('names the file and field of every problem', () => {
    const { project } = sample();
    const files = projectToFiles(project);
    const g = project.globals[0]!;
    const path = `globals/${g.id}.json`;
    files[path] = files[path]!.replace('"Start"', '"2Start"');
    const { project: back, problems } = projectFromFiles(files);
    expect(back).toBeNull();
    expect(problems[0]).toMatchObject({ where: path });
    expect(problems[0]!.message).toContain('name:');
  });

  it('refuses unknown keys instead of silently dropping them', () => {
    const { project } = sample();
    const files = projectToFiles(project);
    files['project.json'] = files['project.json']!.replace('{', '{\n  "colour": "red",');
    expect(projectFromFiles(files).problems[0]!.message).toContain('colour');
  });

  it('refuses a file whose name does not match its ID', () => {
    const { project } = sample();
    const files = projectToFiles(project);
    const g = project.globals[0]!;
    files[`globals/01AAAAAAAAAAAAAAAAAAAAAAAA.json`] = files[`globals/${g.id}.json`]!;
    const { problems } = projectFromFiles(files);
    expect(problems.map((p) => p.message).join()).toContain(
      'the file name says ID 01AAAAAAAAAAAAAAAAAAAAAAAA',
    );
  });

  it('reports broken JSON', () => {
    const { project } = sample();
    const files = projectToFiles(project);
    files['routing.json'] = '{ nope';
    expect(projectFromFiles(files).problems[0]).toMatchObject({ where: 'routing.json' });
  });
});

describe('find usages (before deleting an entity)', () => {
  it('lists every file that refers to an ID, and renaming changes no reference', () => {
    const { project, start } = sample();
    const usages = findUsages(project, start.global);
    expect(usages).toHaveLength(1);
    expect(usages[0]!.file).toMatch(/^conditions\//);
    expect(usages[0]!.path).toBe('expr.ref.global');

    project.globals[0]!.name = 'StartButton';
    expect(findUsages(project, start.global)).toEqual(usages);
  });

  it('finds nothing for an unused entity', () => {
    const { project } = sample();
    expect(findUsages(project, project.machines[0]!.machine.transitions[0]!.id)).toEqual([]);
  });
});
