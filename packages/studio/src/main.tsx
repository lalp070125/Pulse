import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import './theme/base.css';
import './shell/shell.css';
import './editors/editors.css';
import { PRODUCT_NAME } from '@pulso/core';
import { App } from './App';
import { useShell } from './state/store';

useShell.getState().log('info', 'Shell', `${PRODUCT_NAME} started.`);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
