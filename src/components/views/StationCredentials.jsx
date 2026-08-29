import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { CredentialModal } from '../modals/CredentialModal';
import { tacticalAudio } from '../../utils/audio';

export const StationCredentials = () => {
  const { stationCredentials, toggleStationStatus, resetStationPassword } = useAuth();
  const [revealedPasswords, setRevealedPasswords] = useState({});
  const [modalOpen, setModalOpen] = useState(false);

  const toggleReveal = (stationId) => {
    setRevealedPasswords(prev => ({
      ...prev,
      [stationId]: !prev[stationId]
    }));
    tacticalAudio.playClick();
  };

  const copyPassword = (password) => {
    navigator.clipboard.writeText(password);
    tacticalAudio.playSuccess();
    alert("Passphrase copied to clipboard.");
  };

  const handleToggleStatus = (stationId) => {
    toggleStationStatus(stationId);
    tacticalAudio.playClick();
  };

  const handleResetPassword = (stationId) => {
    const newPass = prompt(`Enter new secure passphrase for ${stationId}:`);
    if (newPass && newPass.trim().length >= 6) {
      resetStationPassword(stationId, newPass.trim());
      tacticalAudio.playSuccess();
      alert(`Password for ${stationId} updated successfully.`);
    } else if (newPass) {
      alert("Password must be at least 6 characters long.");
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
          {stationCredentials.length === 0 ? (
            <div style={{ textAlign: 'center' }}>
              <i className="fa-solid fa-key" style={{ fontSize: '2.5rem', color: 'var(--neon-cyan)', marginBottom: '12px', opacity: 0.8 }}></i>
              <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '1rem', color: 'var(--neon-cyan)', fontWeight: 800 }}>
                NO STATION CREDENTIALS PROVISIONED (CLEAN SLATE)
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: '500px', margin: '8px auto 16px auto' }}>
                Zero station logins exist. Click below to provision a weather station with its geographic coordinates, username, and password.
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
                    <th>REGION</th>
                    <th>USERNAME</th>
                  <th>ACCESS KEY</th>
                  <th>STATUS</th>
                  <th>LAST LOGIN</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {stationCredentials.map(s => {
                  const isRevealed = !!revealedPasswords[s.stationId];
                  return (
                    <tr key={s.stationId}>
                      <td style={{ fontWeight: 'bold', color: 'var(--neon-cyan)', whiteSpace: 'nowrap' }}>{s.stationId}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{s.stationName}</td>
                      <td style={{ whiteSpace: 'nowrap' }}><span className="cyber-badge badge-offline" style={{ fontSize: '0.68rem' }}>{s.region}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}><code>{s.username}</code></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: isRevealed ? 'var(--neon-green)' : 'var(--text-muted)' }}>
                            {isRevealed ? s.password : '••••••••••••'}
                          </span>
                          <button
                            className="cyber-btn btn-sm"
                            style={{ padding: '2px 5px', fontSize: '0.62rem' }}
                            title="Reveal Passphrase"
                            onClick={() => toggleReveal(s.stationId)}
                          >
                            <i className={`fa-solid ${isRevealed ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                          </button>
                          <button
                            className="cyber-btn btn-sm"
                            style={{ padding: '2px 5px', fontSize: '0.62rem' }}
                            title="Copy Passphrase"
                            onClick={() => copyPassword(s.password)}
                          >
                            <i className="fa-solid fa-copy"></i>
                          </button>
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
                            <i className="fa-solid fa-rotate-right"></i> Reset
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
