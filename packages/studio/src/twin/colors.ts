/* ----------------------------------------------------------------------------
 * Colours of the 3D materials, read from the Twin tokens in tokens.css so no
 * colour is written in the scene code (CLAUDE.md, docs/parallel-twin-plan.md).
 * -------------------------------------------------------------------------- */

export const TWIN_COLOR_TOKENS = [
  'sky',
  'floor',
  'frame',
  'belt',
  'steel',
  'pusher',
  'seal-head',
  'box',
  'beam-clear',
  'beam-blocked',
  'lamp-off',
  'lamp-on',
] as const;

export type TwinColor = (typeof TWIN_COLOR_TOKENS)[number];
export type TwinColors = Record<TwinColor, string>;

/**
 * Resolves every `--twin-*` colour to an `rgb(...)` string. A probe element
 * lets the browser resolve tokens that point at other tokens (`var(--info)`).
 */
export function readTwinColors(): TwinColors {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const out = {} as TwinColors;
  for (const name of TWIN_COLOR_TOKENS) {
    probe.style.color = `var(--twin-${name})`;
    out[name] = getComputedStyle(probe).color;
  }
  probe.remove();
  return out;
}
