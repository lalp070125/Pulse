import { Suspense, lazy } from 'react';
import { HandPanel } from './HandPanel';
import { useScene } from './sceneStore';
import './twin.css';

// The 3D libraries are big; they load only when the Twin tab is opened.
const Scene = lazy(() => import('./Scene'));

export function TwinView() {
  const ortho = useScene((s) => s.ortho);
  return (
    <div className="tw-view" data-testid="twin-view">
      <div className="tw-stage">
        <div className="tw-toolbar">
          <button type="button" onClick={() => useScene.getState().resetView()}>
            Reset view
          </button>
          <button
            type="button"
            aria-pressed={ortho}
            onClick={() => useScene.getState().toggleOrtho()}
          >
            Flat view
          </button>
        </div>
        <Suspense fallback={<div className="tw-loading">Loading the 3D scene…</div>}>
          <Scene />
        </Suspense>
      </div>
      <HandPanel />
    </div>
  );
}
