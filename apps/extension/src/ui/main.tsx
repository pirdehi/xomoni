import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { recoverInterruptedJobs } from '../engine/runner';
import { App } from './App';
import { applyStoredTheme } from './theme';
import './styles.css';

applyStoredTheme();
void recoverInterruptedJobs();

const root = document.getElementById('root');
if (!root) throw new Error('dashboard.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
