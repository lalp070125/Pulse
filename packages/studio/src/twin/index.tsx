import type { ReactNode } from 'react';

/* ----------------------------------------------------------------------------
 * Entry point of the Twin (SPEC 10). The Twin app's two tabs come here:
 * 'twin:station' (Station Builder) and 'twin:line' (Line Builder).
 *
 * Everything for the 3D scene lives in this folder (docs/parallel-twin-plan.md).
 * Returning null keeps the tab's placeholder note until the scene is built.
 * -------------------------------------------------------------------------- */

export function twinEditorForTab(tabId: string): ReactNode | null {
  void tabId;
  return null;
}
