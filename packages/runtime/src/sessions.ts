import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  type WriteStream,
} from 'node:fs';
import path from 'node:path';
import type { LiveVar, TraceEvent, Value } from '@pulso/core';

/* ----------------------------------------------------------------------------
 * Session files (SPEC 5.11): every event of a deployed run is written to a
 * `.jsonl` file (one JSON object per line), so the last hours can be opened
 * after the fact. Files rotate at a size limit; the oldest are removed.
 *
 * Line 1 of each file is a header with the variables and their values at that
 * moment, so a file can be read on its own: values over time are the header
 * plus every SET event.
 * -------------------------------------------------------------------------- */

export interface SessionHeader {
  type: 'session';
  project: string;
  deployedAt: string;
  part: number;
  vars: LiveVar[];
  values: Record<string, Value>;
  tick: number;
  timeUs: number;
}

export interface SessionOptions {
  dir: string;
  /** Start a new part when a file grows past this many bytes. */
  maxBytes?: number;
  /** Keep at most this many files in the folder. */
  keepFiles?: number;
}

export class SessionWriter {
  private stream: WriteStream | null = null;
  private bytes = 0;
  private part = 0;
  private base = '';
  name: string | null = null;
  private readonly maxBytes: number;
  private readonly keep: number;

  constructor(private readonly opts: SessionOptions) {
    this.maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;
    this.keep = opts.keepFiles ?? 40;
  }

  /** Starts a new session (on Deploy). `header` gives the variables and their values now. */
  begin(
    project: string,
    deployedAt: string,
    header: () => Omit<SessionHeader, 'type' | 'project' | 'deployedAt' | 'part'>,
  ): void {
    this.end();
    mkdirSync(this.opts.dir, { recursive: true });
    this.base = `${project}-${deployedAt.replace(/[:.]/g, '-')}`;
    this.part = 0;
    this.headerFn = () => ({
      type: 'session' as const,
      project,
      deployedAt,
      part: this.part,
      ...header(),
    });
    this.open();
  }

  private headerFn: (() => SessionHeader) | null = null;

  private open() {
    this.part++;
    this.name = `${this.base}${this.part > 1 ? `-part${this.part}` : ''}.jsonl`;
    this.stream = createWriteStream(path.join(this.opts.dir, this.name), { flags: 'w' });
    this.bytes = 0;
    this.line(this.headerFn!());
    this.prune();
  }

  private line(obj: unknown) {
    const text = `${JSON.stringify(obj)}\n`;
    this.bytes += Buffer.byteLength(text);
    this.stream?.write(text);
  }

  write(e: TraceEvent): void {
    if (!this.stream) return;
    this.line(e);
    if (this.bytes > this.maxBytes) {
      this.stream.end();
      this.open();
    }
  }

  end(): void {
    this.stream?.end();
    this.stream = null;
  }

  /** Removes the oldest files beyond the limit. */
  private prune() {
    const files = listSessions(this.opts.dir);
    for (const f of files.slice(this.keep)) {
      try {
        unlinkSync(path.join(this.opts.dir, f.name));
      } catch {
        // already gone
      }
    }
  }
}

export interface SessionFile {
  name: string;
  bytes: number;
  modified: string;
}

/** Session files, newest first. */
export function listSessions(dir: string): SessionFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.jsonl'))
    .map((name) => {
      const st = statSync(path.join(dir, name));
      return { name, bytes: st.size, modified: st.mtime.toISOString(), t: st.mtimeMs };
    })
    .sort((a, b) => b.t - a.t || b.name.localeCompare(a.name))
    .map(({ name, bytes, modified }) => ({ name, bytes, modified }));
}

/** A safe session file name (no folders, only our own files). */
export function sessionPath(dir: string, name: string): string | null {
  if (!/^[A-Za-z0-9._-]+\.jsonl$/.test(name)) return null;
  const p = path.join(dir, name);
  return existsSync(p) ? p : null;
}
