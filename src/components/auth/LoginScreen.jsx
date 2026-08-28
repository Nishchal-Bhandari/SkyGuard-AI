import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { tacticalAudio } from '../../utils/audio';

export const LoginScreen = () => {
  const { login } = useAuth();
  const [activeTab, setActiveTab] = useState('station_operator'); // 'admin' | 'station_operator'
  const [username, setUsername] = useState('aws07_op');
  const [password, setPassword] = useState('hyd@2026');
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
      setUsername('aws07_op');
      setPassword('hyd@2026');
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
          <div className="auth-title">SKYGUARD</div>
          <div className="auth-subtitle">AUTOMATED WEATHER QUALITY ASSURANCE & MET-AI TELEMETRY</div>
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
                ? "CENTRAL COMMAND & FLEET SUPERVISION ACCESS"
                : "STATION / FIELD OPERATOR TERMINAL ACCESS"}
            </span>
          </div>

          <form id="auth-login-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Username Input */}
            <div className="cyber-input-group">
              <label className="cyber-input-label" htmlFor="auth-username-input">
                <span>{activeTab === 'admin' ? 'ADMIN IDENTIFIER' : 'STATION OPERATOR USERNAME'}</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--neon-cyan)' }}>SECURE RBAC</span>
              </label>
              <div className="cyber-input-wrapper">
                <i className={`fa-solid ${activeTab === 'admin' ? 'fa-id-badge' : 'fa-user'} cyber-input-icon`}></i>
                <input
                  type="text"
                  id="auth-username-input"
                  className="cyber-input"
                  placeholder={activeTab === 'admin' ? 'admin' : 'e.g. aws07_op'}
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
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>SHA-256 VERIFIED</span>
              </label>
              <div className="cyber-input-wrapper">
                <i className="fa-solid fa-key cyber-input-icon"></i>
                <input
                  type={showPassword ? 'text' : 'password'}
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
                  id="auth-password-toggle"
                  title="Toggle Password Visibility"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
            </div>

            {/* Error Banner */}
            {errorMsg && (
              <div className="auth-error-banner visible" id="auth-error-banner">
                <i className="fa-solid fa-triangle-exclamation" style={{ marginTop: '2px' }}></i>
                <span>{errorMsg}</span>
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
                  <span>AUTHENTICATING ACCESS...</span>
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
                <>
                  <button
                    type="button"
                    className="demo-pill"
                    onClick={() => handleDemoFill('aws07_op', 'hyd@2026')}
                  >
                    📡 AWS-07 (Hyderabad)
                  </button>
                  <button
                    type="button"
                    className="demo-pill"
                    onClick={() => handleDemoFill('aws08_op', 'sec@2026')}
                  >
                    📡 AWS-08 (Secunderabad)
                  </button>
                  <button
                    type="button"
                    className="demo-pill"
                    onClick={() => handleDemoFill('aws09_op', 'cyber@2026')}
                  >
                    📡 AWS-09 (Cyberabad)
                  </button>
                  <button
                    type="button"
                    className="demo-pill"
                    onClick={() => handleDemoFill('aws12_op', 'mum@2026')}
                  >
                    📡 AWS-12 (Mumbai)
                  </button>
                  <button
                    type="button"
                    className="demo-pill"
                    onClick={() => handleDemoFill('aws19_op', 'cherra@2026')}
                  >
                    📡 AWS-19 (Cherrapunji)
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
