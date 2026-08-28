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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <WeatherProvider>
        <App />
      </WeatherProvider>
    </AuthProvider>
  </React.StrictMode>
);
