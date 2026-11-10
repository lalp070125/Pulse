import type { ReactNode } from 'react';
import { ConditionsEditor } from './ConditionsEditor';
import { EquipmentEditor } from './EquipmentEditor';
import { StatesEditor } from './StatesEditor';
import { MachinesEditor } from './MachinesEditor';
import { GlobalsEditor } from './GlobalsEditor';
import { InterfacesEditor } from './InterfacesEditor';
import { PlannerEditor } from '../planner/Planner';
import { twinEditorForTab } from '../twin';
import { MonitorView } from '../monitor/Monitor';

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
    case 'doc:machines':
      return <MachinesEditor />;
    case 'twin:station':
    case 'twin:line':
      return twinEditorForTab(tabId);
    case 'doc:monitor':
      return <MonitorView />;
    case 'doc:planner':
      return <PlannerEditor />;
    default:
      return null;
  }
}
