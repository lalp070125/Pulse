import { useEffect } from 'react';
import { PRODUCT_NAME } from '@pulso/core';
import logoUrl from '../assets/logo.svg';
import { useShell } from '../state/store';

/** Help → About. Always shows the safety statement (SPEC 13). */
export function AboutDialog() {
  const open = useShell((s) => s.aboutOpen);
  const close = () => useShell.getState().setAboutOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="backdrop" onPointerDown={close}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`About ${PRODUCT_NAME}`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <img src={logoUrl} alt="" />
          <div>
            <div className="dialog-title">{PRODUCT_NAME} — Machine Control Studio</div>
            <div className="dialog-sub">Version 0.0.1 · simulation-first build</div>
          </div>
        </div>
        <div className="dialog-safety">
          <strong>Safety statement</strong>
          <p>
            {PRODUCT_NAME} is <strong>not</strong> a safety system and must never be the only thing
            preventing harm. Emergency stops, guard interlocks and any function protecting people
            must be implemented with hardwired, certified safety components, independent of this
            software.
          </p>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn-primary" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
