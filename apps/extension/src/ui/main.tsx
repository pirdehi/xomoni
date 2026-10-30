import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { recoverInterruptedJobs } from '../engine/runner';
import { App } from './App';
import { applyStoredTheme } from './theme';
import './styles.css';

applyStoredTheme();
void recoverInterruptedJobs();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
