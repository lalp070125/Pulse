import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { conditionSummary, type Condition } from '@pulso/core';
import { askDelete, newEntity } from '../state/entities';
import { useProject } from '../state/project';
import { ExprEditor } from './ExprEditor';
import { RolesEditor } from './RolesEditor';
import { EditorPage, IconButton, NameInput, useFocusRow } from './common';

const SEVERITIES = ['info', 'warning', 'alarm', 'critical'] as const;

function Card({ c, others }: { c: Condition; others: string[] }) {
  const project = useProject((s) => s.project)!;
  const update = useProject((s) => s.update);
  const { ref, lit } = useFocusRow(c.id);
  const [alarmOpen, setAlarmOpen] = useState(c.alarm !== undefined);
  const edit = (fn: (x: Condition) => void) =>
    update((p) => {
      const x = p.conditions.find((y) => y.id === c.id);
      if (x) fn(x);
    });
  const summary = conditionSummary(project, c.roles, c.expr);
  return (
    <section
      ref={ref}
      className={`card ${lit ? 'card-lit' : ''}`}
      data-testid={`condition-card-${c.name}`}
    >
      <header className="card-head">
        <NameInput
          value={c.name}
          taken={others}
          testId="condition-name"
          className="input card-name"
          onCommit={(name) => edit((x) => (x.name = name))}
        />
        <input
          className="input wide"
          value={c.description ?? ''}
          placeholder="what this rule means"
          onChange={(e) => edit((x) => (x.description = e.target.value || undefined))}
        />
        <IconButton title={`Delete ${c.name}`} onClick={() => void askDelete('condition', c.id)} />
      </header>

      <RolesEditor roles={c.roles} change={(fn) => edit((x) => fn(x.roles))} />

      <ExprEditor
        project={project}
        roles={c.roles}
        expr={c.expr}
        onChange={(expr) => edit((x) => (x.expr = expr))}
      />
      <div className="summary mono" data-testid="condition-summary" title="Read-only summary">
        <span className="sub-label">Summary</span>
        {summary}
      </div>

      <div className="alarm">
        <button
          type="button"
          className="collapse-head"
          aria-expanded={alarmOpen}
          data-testid="alarm-toggle"
          onClick={() => setAlarmOpen(!alarmOpen)}
        >
          {alarmOpen ? (
            <ChevronDown size={14} strokeWidth={1.5} />
          ) : (
            <ChevronRight size={14} strokeWidth={1.5} />
          )}
          Alarm {c.alarm ? `· ${c.alarm.severity}` : '· off'}
        </button>
        {alarmOpen && (
          <div className="alarm-body">
            <label className="checkline">
              <input
                type="checkbox"
                checked={c.alarm !== undefined}
                data-testid="alarm-enabled"
                onChange={(e) =>
                  edit((x) => {
                    x.alarm = e.target.checked
                      ? { group: '', severity: 'alarm', message: '' }
                      : undefined;
                  })
                }
              />
              This condition is also an alarm
            </label>
            {c.alarm && (
              <div className="sim-fields">
                <label className="sim-field">
                  <span>Group</span>
                  <input
                    className="input"
                    value={c.alarm.group}
                    data-testid="alarm-group"
                    onChange={(e) => edit((x) => x.alarm && (x.alarm.group = e.target.value))}
                  />
                </label>
                <label className="sim-field">
                  <span>Severity</span>
                  <select
                    className="input"
                    value={c.alarm.severity}
                    data-testid="alarm-severity"
                    onChange={(e) =>
                      edit(
                        (x) =>
                          x.alarm &&
                          (x.alarm.severity = e.target.value as (typeof SEVERITIES)[number]),
                      )
                    }
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {s[0]!.toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sim-field grow">
                  <span>Message</span>
                  <input
                    className="input wide"
                    value={c.alarm.message}
                    data-testid="alarm-message"
                    onChange={(e) => edit((x) => x.alarm && (x.alarm.message = e.target.value))}
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** Conditions: a card per named boolean rule, built from boxes (SPEC 5.5, 6.2). */
export function ConditionsEditor() {
  const conditions = useProject((s) => s.project?.conditions ?? []);
  return (
    <EditorPage
      testId="editor-conditions"
      title="Conditions"
      hint="Named true/false rules. A condition can also be an alarm. Roles stand for devices a machine binds later."
      newLabel="New condition"
      onNew={() => void newEntity('condition')}
    >
      {conditions.length === 0 && (
        <div className="editor-empty">No conditions yet. Use “New condition” to add one.</div>
      )}
      <div className="cards">
        {conditions.map((c) => (
          <Card
            key={c.id}
            c={c}
            others={conditions.filter((o) => o.id !== c.id).map((o) => o.name)}
          />
        ))}
      </div>
    </EditorPage>
  );
}
