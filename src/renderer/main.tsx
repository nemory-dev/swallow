import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { createBrowserPreview } from './browser-preview.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('앱을 표시할 공간을 찾을 수 없습니다.');
const bridge = window.swallow ?? createBrowserPreview();
createRoot(root).render(<StrictMode><App bridge={bridge} /></StrictMode>);
