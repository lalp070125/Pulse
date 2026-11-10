import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from '../planner/Planner';
import { useProject } from '../state/project';
import { EventLog } from './EventLog';
import { useMonitor } from './store';
import { Waveform } from './Waveform';
import './monitor.css';

/** The Monitor tab (SPEC 7): live plan and event log on top, waveform below. They move together. */
export function MonitorView() {
  const project = useProject((s) => s.project);
  const part = useMonitor((s) => s.part);
  if (!project) return <div className="editor-empty">No project is open.</div>;
  return (
    <div className="monitor" data-testid="editor-monitor">
      <PanelGroup direction="vertical" key={part}>
        <Panel defaultSize={part === 'wave' ? 35 : 60} minSize={15}>
          <PanelGroup direction="horizontal">
            <Panel defaultSize={part === 'log' ? 40 : 60} minSize={20}>
              <div className="monitor-plan">
                <ReactFlowProvider>
                  <Canvas live />
                </ReactFlowProvider>
              </div>
            </Panel>
            <PanelResizeHandle className="monitor-handle-v" />
            <Panel minSize={20}>
              <EventLog />
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="monitor-handle-h" />
        <Panel minSize={15}>
          <Waveform />
        </Panel>
      </PanelGroup>
    </div>
  );
}
