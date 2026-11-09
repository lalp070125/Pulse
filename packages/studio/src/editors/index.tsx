import type { ReactNode } from 'react';
import { GlobalsEditor } from './GlobalsEditor';

/** The editor that belongs to an open tab (ids look like `doc:lib.globals`), or null if none yet. */
export function editorForTab(tabId: string): ReactNode | null {
  switch (tabId) {
    case 'doc:lib.globals':
      return <GlobalsEditor />;
    default:
      return null;
  }
}
