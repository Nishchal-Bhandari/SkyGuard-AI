import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWeather } from '../../context/WeatherContext';
import { tacticalAudio } from '../../utils/audio';

export const EditStationModal = ({ isOpen, onClose, station }) => {
  const { editStationCredential } = useAuth();
  const { registerStation } = useWeather();
  const [stationName, setStationName] = useState('');
  const [region, setRegion] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [elevation, setElevation] = useState('');
  const [error, setError] = useState('');

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (station && isOpen) {
      setStationName(station.stationName || station.name || '');
      setRegion(station.region || '');
      setLat((station.lat ?? station.latitude ?? '').toString());
      setLon((station.lon ?? station.longitude ?? '').toString());
      setElevation((station.elevation ?? '').toString());
      setError('');
    }
  }, [station, isOpen]);

  if (!isOpen || !station) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stationName) {
      setError('Station name is required.');
      return;
    }

    setSubmitting(true);
    setError('');

    const targetId = station.stationId || station.id;
    const res = await editStationCredential(targetId, {
      station_name: stationName,
      region,
      latitude: parseFloat(lat) || 0,
      longitude: parseFloat(lon) || 0,
      elevation: parseFloat(elevation) || 0
    });

    setSubmitting(false);

    if (res.success) {
      registerStation({
        id: targetId,
        name: stationName,
        region,
        lat: parseFloat(lat) || 0,
        lon: parseFloat(lon) || 0,
        elevation: parseFloat(elevation) || 0
      });
      tacticalAudio.playSuccess();
      onClose();
    } else {
      setError(res.message || "Failed to edit station.");
      tacticalAudio.playAlarm();
    }
  };

  const targetId = station.stationId || station.id;

  return (
    <div className="cyber-modal-overlay active">
      <div className="cyber-modal" style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <div className="modal-title">
            <i className="fa-solid fa-pen-to-square text-cyan"></i> EDIT STATION DETAILS
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
                <label className="cyber-input-label">STATION ID</label>
                <input
                  type="text"
                  className="cyber-input"
                  value={targetId}
                  disabled
                  style={{ opacity: 0.7, cursor: 'not-allowed' }}
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
          </div>

          <div className="modal-footer">
            <button type="button" className="cyber-btn btn-sm" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="cyber-btn btn-sm btn-primary" disabled={submitting}>
              {submitting ? (
                <><i className="fa-solid fa-spinner fa-spin"></i> Saving...</>
              ) : (
                <><i className="fa-solid fa-check"></i> Save Changes</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
