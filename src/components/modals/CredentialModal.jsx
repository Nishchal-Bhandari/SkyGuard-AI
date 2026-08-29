import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { tacticalAudio } from '../../utils/audio';

export const CredentialModal = ({ isOpen, onClose }) => {
  const { createStationCredential } = useAuth();
  const [stationId, setStationId] = useState('');
  const [stationName, setStationName] = useState('');
  const [region, setRegion] = useState('South India');
  const [lat, setLat] = useState('17.3850');
  const [lon, setLon] = useState('78.4867');
  const [elevation, setElevation] = useState('540');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!stationId || !stationName || !username || !password) {
      setError('Please fill in all required fields.');
      return;
    }

    const res = createStationCredential(stationId, stationName, username, password, status, {
      region,
      lat: parseFloat(lat) || 0,
      lon: parseFloat(lon) || 0,
      elevation: parseFloat(elevation) || 0
    });

    if (res.success) {
      tacticalAudio.playSuccess();
      onClose();
    } else {
      setError(res.message);
      tacticalAudio.playAlarm();
    }
  };

  return (
    <div className="cyber-modal-overlay active">
      <div className="cyber-modal" style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <div className="modal-title">
            <i className="fa-solid fa-key text-cyan"></i> PROVISION STATION CREDENTIAL & GEOGRAPHY
          </div>
          <button className="modal-close-btn" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {error && (
              <div className="auth-error-banner visible" style={{ marginBottom: '8px' }}>
                <i className="fa-solid fa-triangle-exclamation"></i>
                <span>{error}</span>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="cyber-input-group">
                <label className="cyber-input-label">STATION ID (e.g. AWS-25)</label>
                <input
                  type="text"
                  className="cyber-input"
                  placeholder="AWS-25"
                  value={stationId}
                  onChange={(e) => setStationId(e.target.value.toUpperCase())}
                  required
                />
              </div>

              <div className="cyber-input-group">
                <label className="cyber-input-label">REGION / MICROCLIMATE</label>
                <input
                  type="text"
                  className="cyber-input"
                  placeholder="e.g. Western Ghats"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="cyber-input-group" style={{ marginTop: '10px' }}>
              <label className="cyber-input-label">STATION / LOCATION NAME</label>
              <input
                type="text"
                className="cyber-input"
                placeholder="e.g. Ooty Nilgiris High Met"
                value={stationName}
                onChange={(e) => setStationName(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginTop: '10px' }}>
              <div className="cyber-input-group">
                <label className="cyber-input-label">LATITUDE (°N)</label>
                <input
                  type="number"
                  step="0.0001"
                  className="cyber-input"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  required
                />
              </div>

              <div className="cyber-input-group">
                <label className="cyber-input-label">LONGITUDE (°E)</label>
                <input
                  type="number"
                  step="0.0001"
                  className="cyber-input"
                  value={lon}
                  onChange={(e) => setLon(e.target.value)}
                  required
                />
              </div>

              <div className="cyber-input-group">
                <label className="cyber-input-label">ELEVATION (m)</label>
                <input
                  type="number"
                  step="1"
                  className="cyber-input"
                  value={elevation}
                  onChange={(e) => setElevation(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
              <div className="cyber-input-group">
                <label className="cyber-input-label">OPERATOR USERNAME</label>
                <input
                  type="text"
                  className="cyber-input"
                  placeholder="e.g. aws25_op"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>

              <div className="cyber-input-group">
                <label className="cyber-input-label">OPERATOR PASSPHRASE</label>
                <input
                  type="password"
                  className="cyber-input"
                  placeholder="Enter access passphrase"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="cyber-input-group" style={{ marginTop: '10px' }}>
              <label className="cyber-input-label">ACCOUNT STATUS</label>
              <select
                className="cyber-input"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                style={{ background: '#050811' }}
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="cyber-btn btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="cyber-btn btn-sm btn-primary">
              <i className="fa-solid fa-check"></i> Provision Access Key
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
