import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { CredentialModal } from '../modals/CredentialModal';
import { tacticalAudio } from '../../utils/audio';
export const StationCredentials = () => {
  const { role, stationCredentials, toggleStationStatus, resetStationPassword, isLoadingStations } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);

  const isAdmin = role === 'admin' || role === 'CENTRAL_ADMIN';

  if (!isAdmin) {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <i className="fa-solid fa-lock" style={{ fontSize: '3rem', color: 'var(--neon-crimson)', marginBottom: '16px', opacity: 0.8 }}></i>
        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1.2rem', color: 'var(--neon-crimson)', fontWeight: 800 }}>
          ACCESS DENIED — CENTRAL ADMIN PRIVILEGES REQUIRED
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '500px', margin: '12px auto 20px auto' }}>
          Station provisioning and credential management are strictly restricted to Central Admin. Station Operators cannot access fleet credential administration.
        </p>
      </div>
    );
  }

  const handleToggleStatus = async (stationId) => {
    tacticalAudio.playClick();
    await toggleStationStatus(stationId);
    tacticalAudio.playSuccess();
  };

  const handleResetPassword = async (stationId) => {
    const newPass = prompt(`Enter new secure passphrase for ${stationId} (min 6 characters):`);
    if (newPass && newPass.trim().length >= 6) {
      tacticalAudio.playClick();
      const success = await resetStationPassword(stationId, newPass.trim());
      if (success) {
        tacticalAudio.playSuccess();
        alert(`Access passphrase for ${stationId} has been securely updated and hashed in SQLite.`);
      }
    } else if (newPass) {
      alert("Password must be at least 6 characters long.");
      tacticalAudio.playAlarm();
    }
  };

  return (
    <>
      <div className="cyber-card">
        <div className="cyber-card-header">
          <div className="cyber-card-title">
            <i className="fa-solid fa-users-gear text-cyan"></i> STATION OPERATOR CREDENTIALS & ACCESS REGISTRY
          </div>
          <button className="cyber-btn btn-sm btn-primary" onClick={() => setModalOpen(true)}>
            <i className="fa-solid fa-plus"></i> Provision New Station Key
          </button>
        </div>
        <div className="cyber-card-body" style={{ padding: stationCredentials.length === 0 ? '40px 20px' : 0 }}>
          {isLoadingStations ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--neon-cyan)' }}>
              <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2rem', marginBottom: '12px' }}></i>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.9rem' }}>QUERYING SQLITE DATABASE...</div>
            </div>
          ) : stationCredentials.length === 0 ? (
            <div style={{ textAlign: 'center' }}>
              <i className="fa-solid fa-key" style={{ fontSize: '2.5rem', color: 'var(--neon-cyan)', marginBottom: '12px', opacity: 0.8 }}></i>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
                NO STATION ACCOUNTS IN SQLITE
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: '500px', margin: '8px auto 16px auto' }}>
                Zero station logins exist in the database. Click below to provision a weather station with its geographic coordinates, username, and secure password.
              </p>
              <button className="cyber-btn btn-sm btn-primary" onClick={() => setModalOpen(true)}>
                <i className="fa-solid fa-plus"></i> Provision First Station Key
              </button>
            </div>
          ) : (
            <div className="tactical-table-wrapper">
              <table className="tactical-table cred-table">
                <thead>
                  <tr>
                    <th>STATION ID</th>
                    <th>STATION NAME</th>
                    <th>REGION & COORDINATES</th>
                    <th>USERNAME</th>
                    <th>SECURITY</th>
                    <th>STATUS</th>
                    <th>LAST LOGIN</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {stationCredentials.map(s => (
                    <tr key={s.stationId}>
                      <td style={{ fontWeight: 'bold', color: 'var(--neon-cyan)', whiteSpace: 'nowrap' }}>{s.stationId}</td>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{s.stationName}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className="cyber-badge badge-offline" style={{ fontSize: '0.68rem' }}>{s.region}</span>
                        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {s.lat?.toFixed(2)}°N, {s.lon?.toFixed(2)}°E ({s.elevation || 0}m)
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}><code>{s.username}</code></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--neon-green)' }}>
                            <i className="fa-solid fa-shield-halved"></i> PBKDF2-SHA256
                          </span>
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className={`cyber-badge ${s.status === 'ACTIVE' ? 'badge-normal' : 'badge-critical'}`}>
                          {s.status}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {s.last_login ? new Date(s.last_login).toLocaleDateString([], { month: 'numeric', day: 'numeric' }) + ' ' + new Date(s.last_login).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                          <button
                            className={`cyber-btn btn-sm ${s.status === 'ACTIVE' ? 'btn-danger' : 'btn-green'}`}
                            style={{ padding: '4px 7px', fontSize: '0.7rem' }}
                            onClick={() => handleToggleStatus(s.stationId)}
                          >
                            <i className={`fa-solid fa-${s.status === 'ACTIVE' ? 'ban' : 'unlock'}`}></i>
                            {s.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            className="cyber-btn btn-sm"
                            style={{ padding: '4px 7px', fontSize: '0.7rem' }}
                            onClick={() => handleResetPassword(s.stationId)}
                            title="Reset Access Passphrase"
                          >
                            <i className="fa-solid fa-rotate-right"></i> Reset Key
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <CredentialModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
};
