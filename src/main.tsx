import React, { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

// A crash anywhere in the app shows a way back instead of a blank page. Saved records live in localStorage and are
// untouched, so reloading loses only the round on screen.
class Crashed extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error(e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="error" role="alert">
      <p>Something went wrong. Your records are safe.</p>
      <div className="error-actions"><button className="btn primary small" onClick={() => location.reload()}>Reload ATLAS</button></div>
    </div>;
  }
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Crashed><App /></Crashed></React.StrictMode>);
