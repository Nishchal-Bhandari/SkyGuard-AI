import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { tacticalAudio } from '../../utils/audio';

export const LoginScreen = () => {
  const { login } = useAuth();
  const [activeTab, setActiveTab] = useState('admin'); // 'admin' | 'station_operator'
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('sentinel2026');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleTabChange = (role) => {
    setActiveTab(role);
    setErrorMsg('');
    if (role === 'admin') {
      setUsername('admin');
      setPassword('sentinel2026');
    } else {
      setUsername('');
      setPassword('');
    }
    tacticalAudio.playSwitch();
  };

  const handleDemoFill = (u, p) => {
    setUsername(u);
    setPassword(p);
    setErrorMsg('');
    tacticalAudio.playClick();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    tacticalAudio.playClick();

    const res = await login(activeTab, username, password);
    setLoading(false);

    if (res.success) {
      tacticalAudio.playSuccess();
    } else {
      tacticalAudio.playAlarm();
      setErrorMsg(res.message || "Authentication failed. Please verify credentials.");
    }
  };

  return (
    <div className="auth-wrapper" id="auth-wrapper">
      <div className={`auth-card ${activeTab === 'admin' ? 'role-admin' : 'role-station'}`}>
        {/* Card Header */}
        <div className="auth-header">
          <div className="auth-brand-icon">
            <i className="fa-solid fa-shield-halved"></i>
          </div>
          <div className="auth-title">SKYGUARD-AI</div>
          <div className="auth-subtitle">INTELLIGENT ANOMALY DETECTION FOR AUTOMATIC WEATHER STATIONS (AWS)</div>
        </div>

        {/* Role Switcher Tabs */}
        <div className="auth-role-switch">
          <button
            type="button"
            className={`role-tab-btn tab-admin ${activeTab === 'admin' ? 'active' : ''}`}
            onClick={() => handleTabChange('admin')}
          >
            <i className="fa-solid fa-user-shield"></i> CENTRAL ADMIN
          </button>
          <button
            type="button"
            className={`role-tab-btn tab-station ${activeTab === 'station_operator' ? 'active' : ''}`}
            onClick={() => handleTabChange('station_operator')}
          >
            <i className="fa-solid fa-tower-broadcast"></i> STATION OPERATOR
          </button>
        </div>

        {/* Card Body & Form */}
        <div className="auth-body">
          <div className={`auth-role-indicator ${activeTab === 'station_operator' ? 'indicator-station' : ''}`}>
            <i className={activeTab === 'admin' ? "fa-solid fa-lock" : "fa-solid fa-satellite-dish"}></i>
            <span>
              {activeTab === 'admin'
                ? "CENTRAL COMMAND & FLEET GOVERNANCE ACCESS"
                : "STATION OPERATOR COCKPIT ACCESS"}
            </span>
          </div>

          <form id="auth-login-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Username Input */}
            <div className="cyber-input-group">
              <label className="cyber-input-label" htmlFor="auth-username-input">
                <span>{activeTab === 'admin' ? 'ADMIN IDENTIFIER' : 'STATION USERNAME / STATION ID'}</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--neon-cyan)' }}>SECURE RBAC</span>
              </label>
              <div className="cyber-input-wrapper">
                <i className={`fa-solid ${activeTab === 'admin' ? 'fa-id-badge' : 'fa-user'} cyber-input-icon`}></i>
                <input
                  type="text"
                  id="auth-username-input"
                  className="cyber-input"
                  placeholder={activeTab === 'admin' ? 'admin' : 'e.g. operator_hyd or AWS-07'}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="cyber-input-group">
              <label className="cyber-input-label" htmlFor="auth-password-input">
                <span>ACCESS KEY / PASSPHRASE</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>PBKDF2-SHA256 HASHED</span>
              </label>
              <div className="cyber-input-wrapper">
                <i className="fa-solid fa-key cyber-input-icon"></i>
                <input
                  type={showPassword ? "text" : "password"}
                  id="auth-password-input"
                  className="cyber-input"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? "Hide Passphrase" : "Show Passphrase"}
                >
                  <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
            </div>

            {/* Error Banner */}
            {errorMsg && (
              <div className="auth-error-banner visible" id="auth-error-banner">
                <i className="fa-solid fa-triangle-exclamation"></i>
                <span id="auth-error-text">{errorMsg}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              className={`cyber-btn auth-submit-btn ${activeTab === 'station_operator' ? 'btn-amber' : 'btn-primary'}`}
              id="auth-submit-btn"
              disabled={loading}
            >
              {loading ? (
                <>
                  <i className="fa-solid fa-circle-notch fa-spin"></i>
                  <span>AUTHENTICATING AGAINST SQLITE...</span>
                </>
              ) : (
                <>
                  <i className="fa-solid fa-fingerprint"></i>
                  <span>AUTHENTICATE & ENTER TERMINAL</span>
                </>
              )}
            </button>
          </form>

          {/* Quick-Fill Demo Helpers */}
          <div className="demo-helper-box">
            <div className="demo-helper-title">
              <i className="fa-solid fa-bolt text-amber"></i>
              <span>QUICK-SELECT DEMO CREDENTIALS:</span>
            </div>
            <div className="demo-pills">
              {activeTab === 'admin' ? (
                <button
                  type="button"
                  className="demo-pill"
                  onClick={() => handleDemoFill('admin', 'sentinel2026')}
                >
                  👑 Admin: admin / sentinel2026
                </button>
              ) : (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0' }}>
                  No pre-configured stations. Login as <strong style={{ color: 'var(--neon-cyan)', cursor: 'pointer' }} onClick={() => handleTabChange('admin')}>Central Admin</strong> to provision stations.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
