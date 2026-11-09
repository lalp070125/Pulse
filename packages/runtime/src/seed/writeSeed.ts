import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProject } from '@pulso/core';
import { saveProject } from '../store';
import { buildBoxSealer } from './boxSealer';

/* Regenerates /projects/box-sealer-demo from the builder. */
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../../../../projects/box-sealer-demo');
const project = buildBoxSealer();
const problems = compileProject(project).problems;
if (problems.length) {
  console.error(problems);
  process.exit(1);
}
const result = await saveProject(dir, project);
console.log(`Wrote ${result.written.length} file(s), removed ${result.removed.length}, in ${dir}`);
