import { type HealthInfo, type ServerMessage } from '@pulso/core';
import { useShell } from '../state/store';

/**
 * The one live connection to the runtime (SPEC 2: all three apps share it).
 * It reconnects on its own and reports every change to the message panel.
 */
const RETRY_MS = 2000;
let socket: WebSocket | null = null;
let retryTimer: number | undefined;
let stopped = false;
let wasConnected = false;

async function loadRuntimeInfo(): Promise<void> {
  try {
    const res = await fetch('/api/health');
    const info = (await res.json()) as HealthInfo;
    useShell.getState().setRuntimeInfo(info.address, info.project);
  } catch {
    // The socket status already tells the user the runtime is unreachable.
  }
}

function open(): void {
  const shell = useShell.getState();
  shell.setConnection('connecting');
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${scheme}://${window.location.host}/ws`);
  socket = ws;

  ws.onmessage = (event) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(event.data)) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      wasConnected = true;
      useShell.getState().setConnection('connected');
      useShell
        .getState()
        .log('info', 'Runtime', `Connected to ${msg.product} runtime ${msg.version}.`);
      void loadRuntimeInfo();
    }
  };

  ws.onclose = () => {
    if (socket !== ws || stopped) return;
    socket = null;
    useShell.getState().setConnection('disconnected');
    if (wasConnected) {
      wasConnected = false;
      useShell
        .getState()
        .log('warning', 'Runtime', 'Connection to the runtime was lost. Trying again…');
    }
    retryTimer = window.setTimeout(open, RETRY_MS);
  };
}

export function startConnection(): () => void {
  stopped = false;
  open();
  return () => {
    stopped = true;
    window.clearTimeout(retryTimer);
    socket?.close();
    socket = null;
  };
}
