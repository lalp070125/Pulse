import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Copy, Filter, Pause, Play, Trash2 } from 'lucide-react';
import { useShell, type Message, type MessageLevel } from '../state/store';

const LEVELS: { id: MessageLevel; label: string; plural: string }[] = [
  { id: 'error', label: 'Error', plural: 'Errors' },
  { id: 'warning', label: 'Warning', plural: 'Warnings' },
  { id: 'info', label: 'Info', plural: 'Info' },
];
const LEVEL_LABEL: Record<MessageLevel, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};
const ICON = { size: 14, strokeWidth: 1.5 } as const;

function clock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function asText(messages: Message[]): string {
  return messages
    .map((m) => `${clock(m.time)}\t${LEVEL_LABEL[m.level]}\t${m.source}\t${m.text}`)
    .join('\n');
}

/** Bottom panel (SPEC 6.4): filter, live count pills, Pause / Clear / Copy, message table. */
export function MessagesPanel() {
  const app = useShell((s) => s.app);
  const messages = useShell((s) => s.messages);
  const held = useShell((s) => s.heldMessages.length);
  const paused = useShell((s) => s.messagesPaused);
  const [shown, setShown] = useState<Record<MessageLevel, boolean>>({
    error: true,
    warning: true,
    info: true,
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const body = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const c: Record<MessageLevel, number> = { error: 0, warning: 0, info: 0 };
    for (const m of messages) c[m.level]++;
    return c;
  }, [messages]);

  const visible = useMemo(() => {
    const needle = filterOpen ? filter.trim().toLowerCase() : '';
    return messages.filter(
      (m) => shown[m.level] && (!needle || `${m.source} ${m.text}`.toLowerCase().includes(needle)),
    );
  }, [messages, shown, filter, filterOpen]);

  // Auto-scroll to the newest row unless paused.
  useEffect(() => {
    if (!paused && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [visible, paused]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText(visible));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      useShell
        .getState()
        .log('warning', 'Shell', 'The browser did not allow copying to the clipboard.');
    }
  };

  const sourceHead = app === 'panel' ? 'Category' : 'Source';
  return (
    <section className="messages" data-testid="messages">
      <div className="messages-head">
        <span className="panel-title">{app === 'panel' ? 'OUTPUT' : 'MESSAGES'}</span>
        <button
          type="button"
          className={`tool ${filterOpen ? 'on' : ''}`}
          aria-pressed={filterOpen}
          onClick={() => setFilterOpen(!filterOpen)}
        >
          <Filter {...ICON} /> Filter
        </button>
        {filterOpen && (
          <input
            className="input mono"
            placeholder="Text to find…"
            value={filter}
            autoFocus
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`pill level-${l.id} ${shown[l.id] ? 'on' : ''}`}
            aria-pressed={shown[l.id]}
            title={`${shown[l.id] ? 'Hide' : 'Show'} ${l.plural.toLowerCase()}`}
            onClick={() => setShown({ ...shown, [l.id]: !shown[l.id] })}
          >
            {l.plural}: {counts[l.id]}
          </button>
        ))}
        <span className="spacer" />
        <button
          type="button"
          className={`tool ${paused ? 'on' : ''}`}
          aria-pressed={paused}
          onClick={() => useShell.getState().setMessagesPaused(!paused)}
        >
          {paused ? <Play {...ICON} /> : <Pause {...ICON} />}
          {paused ? `Resume${held ? ` (${held} new)` : ''}` : 'Pause'}
        </button>
        <button type="button" className="tool" onClick={() => useShell.getState().clearMessages()}>
          <Trash2 {...ICON} /> Clear
        </button>
        <button type="button" className="tool" onClick={() => void copy()}>
          <Copy {...ICON} /> {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className="tool"
          title="Hide the bottom panel (Ctrl+J)"
          aria-label="Hide the bottom panel"
          onClick={() => useShell.getState().setBottomOpen(false)}
        >
          <ChevronDown {...ICON} />
        </button>
      </div>
      <div className="messages-cols mono">
        <span>Time</span>
        <span>Level</span>
        <span>{sourceHead}</span>
        <span>Message</span>
      </div>
      <div className="messages-body mono" ref={body}>
        {visible.map((m) => (
          <div key={m.id} className={`msg-row level-${m.level}`}>
            <span>{clock(m.time)}</span>
            <span className="msg-level">{LEVEL_LABEL[m.level]}</span>
            <span>{m.source}</span>
            <span className="msg-text">{m.text}</span>
          </div>
        ))}
        {visible.length === 0 && <div className="panel-empty">No messages</div>}
      </div>
    </section>
  );
}
