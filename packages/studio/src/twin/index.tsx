import type { ReactNode } from 'react';
import { TwinView } from './TwinView';

/* ----------------------------------------------------------------------------
 * Entry point of the Twin (SPEC 10). The Twin app's two tabs come here:
 * 'twin:station' (Station Builder) and 'twin:line' (Line Builder).
 *
 * Everything for the 3D scene lives in this folder (docs/parallel-twin-plan.md).
 * Returning null keeps the tab's placeholder note.
 * -------------------------------------------------------------------------- */

export function twinEditorForTab(tabId: string): ReactNode | null {
  // The scene and hand controls open in the Station Builder tab for now.
  if (tabId === 'twin:station') return <TwinView />;
  return null;
}
