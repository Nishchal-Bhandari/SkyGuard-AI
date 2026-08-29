import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from './context/AuthContext';
import { WeatherProvider } from './context/WeatherContext';
import { App } from './App';

// Import exact stylesheets (100% Zero Visual Redesign)
import './styles/cyberpunk-theme.css';
import './styles/dashboard.css';
import './styles/components.css';
import './styles/login.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[SkyGuard-AI Exception Caught]:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-primary, #050811)',
          color: '#fff',
          fontFamily: 'sans-serif',
          padding: '20px'
        }}>
          <div style={{
            maxWidth: '600px',
            background: 'rgba(255, 0, 85, 0.1)',
            border: '1px solid #ff0055',
            borderRadius: '8px',
            padding: '24px',
            boxShadow: '0 0 30px rgba(255, 0, 85, 0.2)'
          }}>
            <h2 style={{ color: '#ff0055', margin: '0 0 12px 0' }}>
              <i className="fa-solid fa-triangle-exclamation"></i> TACTICAL UI RUNTIME EXCEPTION
            </h2>
            <p style={{ color: '#ccc', fontSize: '0.9rem' }}>
              {this.state.error?.message || "An unexpected error occurred in the tactical interface."}
            </p>
            <pre style={{
              background: 'rgba(0,0,0,0.5)',
              padding: '10px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              color: '#ff7799',
              overflowX: 'auto'
            }}>
              {this.state.error?.stack || ""}
            </pre>
            <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
              <button
                style={{
                  background: '#00f0ff',
                  color: '#000',
                  fontWeight: 'bold',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  localStorage.removeItem("skyguard_auth_v2");
                  localStorage.removeItem("skyguard_stations_cache_v3");
                  window.location.reload();
                }}
              >
                Clear Cache & Reload
              </button>
              <button
                style={{
                  background: 'transparent',
                  color: '#fff',
                  border: '1px solid #fff',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
                onClick={() => window.location.reload()}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <WeatherProvider>
          <App />
        </WeatherProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
