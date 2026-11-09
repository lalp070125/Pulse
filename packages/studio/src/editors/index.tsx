import type { ReactNode } from 'react';
import { ConditionsEditor } from './ConditionsEditor';
import { EquipmentEditor } from './EquipmentEditor';
import { StatesEditor } from './StatesEditor';
import { GlobalsEditor } from './GlobalsEditor';
import { InterfacesEditor } from './InterfacesEditor';

/** The editor that belongs to an open tab (ids look like `doc:lib.globals`), or null if none yet. */
export function editorForTab(tabId: string): ReactNode | null {
  switch (tabId) {
    case 'doc:lib.globals':
      return <GlobalsEditor />;
    case 'doc:lib.interfaces':
      return <InterfacesEditor />;
    case 'doc:lib.equipment':
      return <EquipmentEditor />;
    case 'doc:lib.conditions':
      return <ConditionsEditor />;
    case 'doc:lib.states':
      return <StatesEditor />;
    default:
      return null;
  }
}
