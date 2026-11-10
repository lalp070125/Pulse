import { defaultValue, checkValue, type Global } from '@pulso/core';
import { askDelete, newEntity } from '../state/entities';
import { useProject } from '../state/project';
import { EditorPage, IconButton, NameInput, TypeEditor, ValueEditor, useFocusRow } from './common';

function Row({ g, taken }: { g: Global; taken: string[] }) {
  const update = useProject((s) => s.update);
  const { ref, lit } = useFocusRow(g.id);
  const edit = (fn: (x: Global) => void) =>
    update((p) => {
      const x = p.globals.find((y) => y.id === g.id);
      if (x) fn(x);
    });
  const bad = checkValue(g.type, g.default, 'default');
  return (
    <tr ref={ref} className={lit ? 'row-lit' : ''} data-testid={`global-row-${g.name}`}>
      <td>
        <NameInput
          value={g.name}
          taken={taken}
          testId="global-name"
          onCommit={(name) => edit((x) => (x.name = name))}
        />
      </td>
      <td>
        <TypeEditor
          type={g.type}
          testId="global-type"
          onChange={(t) =>
            edit((x) => {
              x.type = t;
              x.default = defaultValue(t);
            })
          }
        />
      </td>
      <td title={bad ?? undefined} className={bad ? 'cell-bad' : ''}>
        <ValueEditor
          type={g.type}
          value={g.default}
          testId="global-default"
          onChange={(v) => edit((x) => (x.default = v))}
        />
      </td>
      <td>
        <input
          className="input"
          value={g.unit ?? ''}
          placeholder="unit"
          onChange={(e) => edit((x) => (x.unit = e.target.value || undefined))}
        />
      </td>
      <td>
        <input
          className="input wide"
          value={g.description ?? ''}
          placeholder="what it is for"
          data-testid="global-description"
          onChange={(e) => edit((x) => (x.description = e.target.value || undefined))}
        />
      </td>
      <td className="cell-actions">
        <IconButton title={`Delete ${g.name}`} onClick={() => void askDelete('global', g.id)} />
      </td>
    </tr>
  );
}

/** Global Variables: a table — name, type, default, unit, description (SPEC 6.2). */
export function GlobalsEditor() {
  const globals = useProject((s) => s.project?.globals ?? []);
  return (
    <EditorPage
      testId="editor-globals"
      title="Global Variables"
      hint="Project-wide values, written Global.Name. Any machine can read or write them."
      newLabel="New global"
      onNew={() => void newEntity('global')}
    >
      {globals.length === 0 ? (
        <div className="editor-empty">No global variables yet. Use “New global” to add one.</div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Default</th>
              <th>Unit</th>
              <th>Description</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {globals.map((g) => (
              <Row
                key={g.id}
                g={g}
                taken={globals.filter((o) => o.id !== g.id).map((o) => o.name)}
              />
            ))}
          </tbody>
        </table>
      )}
    </EditorPage>
  );
}
