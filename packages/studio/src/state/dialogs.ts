import { create } from 'zustand';

/* Small promise-based dialogs: ask for a text, or ask for a yes/no with a list of details. */

export type DialogRequest =
  | {
      kind: 'text';
      title: string;
      label: string;
      initial: string;
      /** Returns a plain-language problem, or null when the text is fine. */
      validate?: (text: string) => string | null;
      resolve: (value: string | null) => void;
    }
  | {
      kind: 'confirm';
      title: string;
      lines: string[];
      okLabel: string;
      danger?: boolean;
      resolve: (value: boolean) => void;
    }
  | { kind: 'info'; title: string; lines: string[]; resolve: () => void };

interface DialogState {
  current: DialogRequest | null;
  /** Counts dialogs opened, so each one starts fresh (its text field begins with its own initial text). */
  seq: number;
  show(request: DialogRequest): void;
  close(): void;
}

export const useDialogs = create<DialogState>((set) => ({
  current: null,
  seq: 0,
  show: (current) => set((s) => ({ current, seq: s.seq + 1 })),
  close: () => set({ current: null }),
}));

export function askText(
  title: string,
  label: string,
  initial = '',
  validate?: (text: string) => string | null,
): Promise<string | null> {
  return new Promise((resolve) =>
    useDialogs.getState().show({ kind: 'text', title, label, initial, validate, resolve }),
  );
}

export function askConfirm(
  title: string,
  lines: string[],
  okLabel = 'OK',
  danger = false,
): Promise<boolean> {
  return new Promise((resolve) =>
    useDialogs.getState().show({ kind: 'confirm', title, lines, okLabel, danger, resolve }),
  );
}

export function showInfo(title: string, lines: string[]): Promise<void> {
  return new Promise((resolve) =>
    useDialogs.getState().show({ kind: 'info', title, lines, resolve }),
  );
}
