import { useEffect, useState } from 'react';
import { useDialogs } from '../state/dialogs';

/** Renders the one open dialog (text prompt, confirmation or information). */
export function Dialogs() {
  const current = useDialogs((s) => s.current);
  const close = useDialogs((s) => s.close);
  const [text, setText] = useState('');

  useEffect(() => {
    if (current?.kind === 'text') setText(current.initial);
  }, [current]);

  if (!current) return null;

  const finish = (ok: boolean) => {
    if (current.kind === 'text') current.resolve(ok ? text : null);
    else if (current.kind === 'confirm') current.resolve(ok);
    else current.resolve();
    close();
  };
  const problem = current.kind === 'text' && current.validate ? current.validate(text) : null;

  return (
    <div className="backdrop" role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-label={current.title}
        data-testid="dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') finish(false);
          if (e.key === 'Enter' && current.kind === 'text' && !problem) finish(true);
        }}
      >
        <div className="dialog-head">
          <span className="dialog-title">{current.title}</span>
        </div>
        <div className="dialog-body">
          {current.kind === 'text' ? (
            <label className="field">
              <span>{current.label}</span>
              <input
                className="input"
                autoFocus
                value={text}
                data-testid="dialog-input"
                onChange={(e) => setText(e.target.value)}
              />
              {problem && <span className="field-error">{problem}</span>}
            </label>
          ) : (
            <ul className="dialog-lines">
              {current.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="dialog-foot">
          {current.kind !== 'info' && (
            <button type="button" className="btn" onClick={() => finish(false)}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className={
              current.kind === 'confirm' && current.danger ? 'btn btn-danger' : 'btn-primary'
            }
            disabled={current.kind === 'text' && problem !== null}
            data-testid="dialog-ok"
            autoFocus={current.kind !== 'text'}
            onClick={() => finish(true)}
          >
            {current.kind === 'confirm'
              ? current.okLabel
              : current.kind === 'info'
                ? 'Close'
                : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
