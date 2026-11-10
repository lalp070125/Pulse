import { Plus } from 'lucide-react';
import type { Role } from '@pulso/core';
import { newId } from '../lib/ulid';
import { askDeleteInner, freshName } from '../state/entities';
import { useProject } from '../state/project';
import { IconButton, NameInput, TypeEditor, typeOfKind } from './common';

/** The roles a template needs ("a motor", "a timer"), which each machine binds later (SPEC 5.4). */
export function RolesEditor({
  roles,
  change,
}: {
  roles: Role[];
  /** Applies a change to the template's role list. */
  change: (fn: (roles: Role[]) => void) => void;
}) {
  const equipment = useProject((s) => s.project?.equipment ?? []);
  const setRole = (id: string, next: (r: Role) => Role) =>
    change((list) => {
      const i = list.findIndex((r) => r.id === id);
      if (i >= 0) list[i] = next(list[i]!);
    });

  return (
    <div className="roles" data-testid="roles">
      <div className="roles-head">
        <span className="sub-label">Roles — what this needs, bound later by each machine</span>
        <button
          type="button"
          className="btn-small"
          data-testid="add-role"
          onClick={() =>
            change((list) =>
              list.push(
                equipment[0]
                  ? {
                      id: newId(),
                      name: freshName(
                        list.map((r) => r.name),
                        'Device',
                      ),
                      kind: 'equipment',
                      equipment: equipment[0].id,
                    }
                  : {
                      id: newId(),
                      name: freshName(
                        list.map((r) => r.name),
                        'Timer',
                      ),
                      kind: 'timer',
                    },
              ),
            )
          }
        >
          <Plus size={12} strokeWidth={1.5} /> role
        </button>
      </div>
      {roles.map((r) => (
        <div key={r.id} className="role-row" data-testid={`role-${r.name}`}>
          <NameInput
            value={r.name}
            taken={roles.filter((o) => o.id !== r.id).map((o) => o.name)}
            testId="role-name"
            onCommit={(name) => setRole(r.id, (x) => ({ ...x, name }))}
          />
          <select
            className="input"
            value={r.kind}
            data-testid="role-kind"
            onChange={(e) => {
              const kind = e.target.value as Role['kind'];
              setRole(r.id, (x) => {
                const base = { id: x.id, name: x.name };
                if (kind === 'equipment')
                  return { ...base, kind, equipment: equipment[0]?.id ?? '' };
                if (kind === 'variable') return { ...base, kind, type: typeOfKind('bool') };
                return { ...base, kind };
              });
            }}
          >
            <option value="equipment">a device</option>
            <option value="variable">a variable</option>
            <option value="timer">a timer</option>
          </select>
          {r.kind === 'equipment' && (
            <select
              className="input"
              value={r.equipment}
              data-testid="role-equipment"
              onChange={(e) => setRole(r.id, (x) => ({ ...x, equipment: e.target.value }) as Role)}
            >
              {!equipment.some((e) => e.id === r.equipment) && (
                <option value={r.equipment}>(missing type)</option>
              )}
              {equipment.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          )}
          {r.kind === 'variable' && (
            <TypeEditor
              type={r.type}
              simple
              testId="role-type"
              onChange={(type) => setRole(r.id, (x) => ({ ...x, type }) as Role)}
            />
          )}
          <IconButton
            title={`Delete role ${r.name}`}
            onClick={() =>
              void askDeleteInner(`role '${r.name}'`, r.id, () =>
                change((list) => {
                  const i = list.findIndex((x) => x.id === r.id);
                  if (i >= 0) list.splice(i, 1);
                }),
              )
            }
          />
        </div>
      ))}
    </div>
  );
}
