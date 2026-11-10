import { useEffect, useRef, useState } from 'react';
import { APPS, PRODUCT_NAME, appTitle } from '@pulso/core';
import { navigateToApp, useShell } from '../state/store';
import { useProject } from '../state/project';
import { askText } from '../state/dialogs';

interface MenuItem {
  label: string;
  shortcut?: string;
  /** Missing action = not available yet; `soon` says when it arrives. */
  action?: () => void;
  soon?: string;
  checked?: boolean;
}
type MenuEntry = MenuItem | 'separator';
interface Menu {
  label: string;
  items: MenuEntry[];
}

function useMenus(): Menu[] {
  const s = useShell();
  const later = (label: string, shortcut: string | undefined, soon: string): MenuItem => ({
    label,
    shortcut,
    soon,
  });
  return [
    {
      label: 'File',
      items: [
        {
          label: 'New Project…',
          action: () =>
            void askText('New project', 'Project folder name', '', (t) =>
              /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(t)
                ? null
                : 'Use letters, digits, - and _ only',
            ).then((name) => (name ? useProject.getState().newProject(name) : undefined)),
        },
        {
          label: 'Open Project…',
          action: () =>
            void fetch('/api/projects')
              .then((r) => r.json() as Promise<{ projects: string[] }>)
              .then(({ projects }) =>
                askText('Open project', `Folder name (${projects.join(', ')})`, projects[0] ?? ''),
              )
              .then((name) => (name ? useProject.getState().openProject(name) : undefined)),
        },
        {
          label: 'Save',
          shortcut: 'Ctrl+S',
          action: () => void useProject.getState().save(),
        },
        'separator',
        later('Import Project (zip)…', undefined, 'Phase 10'),
        later('Export Project (zip)…', undefined, 'Phase 10'),
      ],
    },
    {
      label: 'Edit',
      items: [
        later('Undo', 'Ctrl+Z', 'Phase 3'),
        later('Redo', 'Ctrl+Y', 'Phase 3'),
        'separator',
        later('Cut', 'Ctrl+X', 'Phase 3'),
        later('Copy', 'Ctrl+C', 'Phase 3'),
        later('Paste', 'Ctrl+V', 'Phase 3'),
        later('Delete', 'Del', 'Phase 3'),
      ],
    },
    {
      label: 'View',
      items: [
        {
          label: 'Sidebar',
          shortcut: 'Ctrl+B',
          checked: s.sidebarOpen,
          action: () => s.toggle('sidebarOpen'),
        },
        {
          label: 'Inspector',
          shortcut: 'Ctrl+Alt+B',
          checked: s.inspectorOpen,
          action: () => s.toggle('inspectorOpen'),
        },
        {
          label: 'Bottom Panel',
          shortcut: 'Ctrl+J',
          checked: s.bottomOpen,
          action: () => s.toggle('bottomOpen'),
        },
        'separator',
        ...APPS.map((a, i): MenuItem => ({
          label: appTitle(a.id),
          shortcut: `Alt+${i + 1}`,
          checked: s.app === a.id,
          action: () => navigateToApp(a.id),
        })),
      ],
    },
    {
      label: 'Runtime',
      items: [
        later('Deploy', 'Ctrl+D', 'Phase 4'),
        later('Start', 'F5', 'Phase 4'),
        later('Stop', 'Shift+F5', 'Phase 4'),
        later('Step One Tick', 'F10', 'Phase 4'),
      ],
    },
    { label: 'Settings', items: [later('Preferences…', 'Ctrl+,', 'a later phase')] },
    {
      label: 'Help',
      items: [
        later('Help Pages', 'F1', 'Phase 10'),
        'separator',
        { label: `About ${PRODUCT_NAME}`, action: () => s.setAboutOpen(true) },
      ],
    },
  ];
}

/** 26 px menu bar: plain text menus with their keyboard shortcuts shown. */
export function MenuBar() {
  const menus = useMenus();
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menubar" role="menubar" ref={ref} data-testid="menubar">
      {menus.map((menu, i) => (
        <div key={menu.label} className="menu">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={open === i}
            className={`menu-title ${open === i ? 'open' : ''}`}
            onClick={() => setOpen(open === i ? null : i)}
            onPointerEnter={() => open !== null && setOpen(i)}
          >
            {menu.label}
          </button>
          {open === i && (
            <div className="menu-list" role="menu">
              {menu.items.map((item, j) =>
                item === 'separator' ? (
                  <div key={j} className="menu-sep" role="separator" />
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={!item.action}
                    title={item.action ? undefined : `Arrives in ${item.soon ?? 'a later phase'}`}
                    onClick={() => {
                      setOpen(null);
                      item.action?.();
                    }}
                  >
                    <span className="menu-check">{item.checked ? '✓' : ''}</span>
                    <span className="menu-label">{item.label}</span>
                    <span className="menu-shortcut">{item.shortcut ?? ''}</span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
