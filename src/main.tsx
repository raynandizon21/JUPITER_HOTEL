import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ui';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary full>
    <App />
  </ErrorBoundary>
);
