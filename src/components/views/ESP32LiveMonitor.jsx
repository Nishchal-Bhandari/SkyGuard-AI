import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../../utils/apiClient';

// ─── WMO Flag Display ─────────────────────────────────────────────────────────
const WMO_LABELS = { 0: 'WMO 0 PASS', 1: 'WMO 1 SUSPECT', 2: 'WMO 2 ERRONEOUS' };
const WMO_COLORS = { 0: 'var(--neon-green)', 1: 'var(--neon-amber)', 2: 'var(--neon-crimson)' };

const WmoFlag = ({ flag }) => (
  <span style={{
    fontFamily: 'var(--font-tactical)', fontSize: '0.65rem', fontWeight: 700,
    color: WMO_COLORS[flag] ?? 'var(--text-muted)',
    border: `1px solid ${WMO_COLORS[flag] ?? 'var(--border-subtle)'}`,
    borderRadius: '3px', padding: '1px 5px',
  }}>
    {WMO_LABELS[flag] ?? `WMO ${flag}`}
  </span>
);

// ─── Tiny label/value row ─────────────────────────────────────────────────────
const Row = ({ k, v, vColor, small }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{k}:</span>
    <span style={{
      color: vColor || 'var(--text-primary)', fontWeight: 600, textAlign: 'right',
      fontSize: small ? '0.65rem' : undefined, fontFamily: 'var(--font-mono)',
    }}>{v}</span>
  </div>
);

// ─── Sensor Row ───────────────────────────────────────────────────────────────
const SensorRow = ({ label, edgeFlag, cloudFlag, value, unit }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '110px 1fr 1fr 1fr',
    alignItems: 'center', gap: '8px',
    padding: '6px 10px', borderBottom: '1px solid rgba(0,240,255,0.07)',
  }}>
    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-tactical)' }}>{label}</div>
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'var(--neon-cyan)', fontWeight: 700 }}>
      {value != null ? `${value} ${unit}` : '—'}
    </div>
    <div><WmoFlag flag={edgeFlag} /></div>
    <div><WmoFlag flag={cloudFlag} /></div>
  </div>
);

// ─── Verification Badge ───────────────────────────────────────────────────────
const VerificationBadge = ({ verdict }) => {
  const ok = verdict === 'VERIFIED';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      background: ok ? 'rgba(0,255,102,0.08)' : 'rgba(255,58,58,0.09)',
      border: `1px solid ${ok ? 'var(--neon-green)' : 'var(--neon-crimson)'}`,
      borderRadius: '6px', padding: '8px 14px',
    }}>
      <i className={`fa-solid fa-${ok ? 'circle-check' : 'triangle-exclamation'}`}
         style={{ color: ok ? 'var(--neon-green)' : 'var(--neon-crimson)', fontSize: '1.1rem' }} />
      <div>
        <div style={{
          fontFamily: 'var(--font-tactical)', fontWeight: 800, fontSize: '0.85rem',
          color: ok ? 'var(--neon-green)' : 'var(--neon-crimson)',
        }}>
          {ok ? 'TIERS VERIFIED' : 'DISCREPANCY DETECTED'}
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>
          {ok ? 'Edge-AI & Cloud-ML WMO flags agree' : 'Edge-AI & Cloud-ML disagree on anomaly severity'}
        </div>
      </div>
    </div>
  );
};

// ─── Metric Card ──────────────────────────────────────────────────────────────
const MetricCard = ({ label, value, sub, color }) => (
  <div style={{
    background: 'rgba(10,15,29,0.85)', border: '1px solid var(--border-subtle)',
    borderRadius: '5px', padding: '10px 14px', flex: 1, minWidth: '120px',
  }}>
    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-tactical)' }}>{label}</div>
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', color: color || 'var(--neon-cyan)', fontWeight: 700, marginTop: '3px' }}>
      {value ?? '—'}
    </div>
    {sub && <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: '2px' }}>{sub}</div>}
  </div>
);

const statusColor = (s) => {
  if (!s) return 'var(--text-muted)';
  if (s === 'NORMAL' || s === 'NOMINAL') return 'var(--neon-green)';
  if (s === 'CRITICAL') return 'var(--neon-crimson)';
  return 'var(--neon-amber)';
};

// ─── Main Component ───────────────────────────────────────────────────────────
export const ESP32LiveMonitor = ({ stationId = 'AWS-01' }) => {
  const [liveData, setLiveData] = useState(null);
  const [history, setHistory] = useState([]);
  const [backendUrl, setBackendUrl] = useState('http://127.0.0.1:8000');
  const [pingStatus, setPingStatus] = useState(null);
  const [pinging, setPinging] = useState(false);
  const [streamActive, setStreamActive] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [packetCount, setPacketCount] = useState(0);
  const pollRef = useRef(null);

  const fetchLive = useCallback(async () => {
    try {
      // 1. Try dedicated ESP32 real-time endpoint first
      let station = null;
      try {
        const espRes = await apiClient.getEsp32Latest(stationId);
        if (espRes && espRes.has_data && espRes.station) {
          station = espRes.station;
        }
      } catch (err) {
        console.debug('[ESP32LiveMonitor] getEsp32Latest fallback:', err.message);
      }

      // 2. Fallback to fleet live state
      if (!station) {
        const resp = await apiClient.getFleetLiveState();
        const stations = resp?.data?.stations ?? resp?.stations ?? [];
        station = stations.find(s =>
          String(s.station_id || '').trim().toUpperCase() === stationId.trim().toUpperCase()
        );
      }

      if (!station) return;
      setLiveData(station);
      setLastUpdated(new Date());
      setHistory(prev => {
        const seq = station?.esp32_seq ?? station?.edge_ai?.seq;
        if (seq == null || seq === prev[0]?.seq) return prev;
        setPacketCount(c => c + 1);
        const entry = {
          seq,
          ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          temp: station?.sensors?.temperature?.value,
          hum: station?.sensors?.humidity?.value,
          pres: station?.sensors?.pressure?.value,
          batt: station?.sensors?.battery_v?.value,
          edgeClass: station?.edge_ai?.classification ?? '—',
          cloudStatus: station?.status ?? '—',
          verdict: station?.cross_tier_verification?.verdict ?? '—',
        };
        return [entry, ...prev].slice(0, 10);
      });
    } catch (err) {
      console.warn('[ESP32LiveMonitor] fetchLive error:', err.message);
    }
  }, [stationId]);

  useEffect(() => {
    if (streamActive) {
      fetchLive();
      pollRef.current = setInterval(fetchLive, 2000);
    }
    return () => clearInterval(pollRef.current);
  }, [streamActive, fetchLive]);

  const handlePing = async () => {
    setPinging(true);
    setPingStatus(null);
    try {
      const resp = await fetch(`${backendUrl}/api/v1/telemetry/esp32/health`);
      setPingStatus(resp.ok ? 'ok' : 'error');
    } catch {
      setPingStatus('error');
    } finally {
      setPinging(false);
    }
  };

  const sensors   = liveData?.sensors ?? {};
  const edgeAi    = liveData?.edge_ai ?? {};
  const ctv       = liveData?.cross_tier_verification ?? {};
  const derived   = liveData?.derived_thermodynamics ?? {};
  const rootCause = liveData?.root_cause_diagnosis ?? {};
  const fa        = liveData?.final_assessment ?? {};
  const isEsp32   = liveData?.esp32_live === true;

  return (
    <div className="cyber-card" style={{ marginBottom: '20px' }}>
      {/* ── Header ── */}
      <div className="cyber-card-header">
        <div className="cyber-card-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <i className="fa-solid fa-microchip text-cyan" />
          ESP32 EDGE MONITOR — {stationId}
          {isEsp32 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              background: 'rgba(0,255,102,0.1)', border: '1px solid var(--neon-green)',
              borderRadius: '20px', padding: '2px 9px', fontSize: '0.65rem',
              color: 'var(--neon-green)', fontFamily: 'var(--font-tactical)',
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--neon-green)' }} />
              LIVE STREAM
            </span>
          )}
        </div>
        <button
          id="esp32-stream-toggle"
          className={`cyber-btn btn-sm ${streamActive ? 'btn-primary' : ''}`}
          onClick={() => setStreamActive(v => !v)}
          style={{ fontSize: '0.72rem' }}
        >
          <i className={`fa-solid fa-${streamActive ? 'pause' : 'play'}`} />
          {streamActive ? ' Streaming' : ' Paused'}
        </button>
      </div>

      <div className="cyber-card-body">
        {/* ── Backend Health Panel ── */}
        <div style={{
          background: 'rgba(5,8,17,0.9)', border: '1px solid var(--border-subtle)',
          borderRadius: '6px', padding: '12px 16px', marginBottom: '16px',
        }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-tactical)', marginBottom: '8px' }}>
            BACKEND HEALTH CHECK
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              id="esp32-backend-url"
              value={backendUrl}
              onChange={e => setBackendUrl(e.target.value)}
              style={{
                flex: 1, minWidth: '240px', background: 'rgba(0,240,255,0.04)',
                border: '1px solid var(--border-subtle)', borderRadius: '4px',
                color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
                fontSize: '0.78rem', padding: '5px 10px', outline: 'none',
              }}
              placeholder="http://127.0.0.1:8000"
            />
            <button
              id="esp32-ping-btn"
              className="cyber-btn btn-sm"
              onClick={handlePing}
              disabled={pinging}
              style={{ fontSize: '0.72rem' }}
            >
              <i className="fa-solid fa-satellite-dish" />
              {pinging ? ' Checking…' : ' PING BACKEND'}
            </button>
            {pingStatus === 'ok' && (
              <span style={{ color: 'var(--neon-green)', fontSize: '0.72rem', fontFamily: 'var(--font-tactical)' }}>
                ONLINE
              </span>
            )}
            {pingStatus === 'error' && (
              <span style={{ color: 'var(--neon-crimson)', fontSize: '0.72rem', fontFamily: 'var(--font-tactical)' }}>
                UNREACHABLE — Is the backend running?
              </span>
            )}
          </div>
          <div style={{ marginTop: '8px', fontSize: '0.66rem', color: 'var(--text-muted)' }}>
            ESP32 ingest endpoint:&nbsp;
            <code style={{ color: 'var(--neon-cyan)' }}>{backendUrl}/api/v1/telemetry/esp32/ingest</code>
          </div>
        </div>

        {/* ── Stats Strip ── */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <MetricCard label="STREAM STATUS"
            value={isEsp32 ? 'LIVE' : 'STANDBY'}
            sub={isEsp32 ? `Seq #${liveData?.esp32_seq ?? '—'}` : 'Waiting for ESP32 frame'}
            color={isEsp32 ? 'var(--neon-green)' : 'var(--text-muted)'} />
          <MetricCard label="PACKETS" value={packetCount} sub="Frames received" />
          <MetricCard label="LAST UPDATE"
            value={lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
            sub="2 s poll interval" />
          <MetricCard label="CLOUD STATUS"
            value={liveData?.status ?? '—'}
            sub={fa?.root_cause ?? '—'}
            color={statusColor(liveData?.status)} />
        </div>

        {/* ── Cross-Tier Verification Banner ── */}
        {isEsp32 && ctv.verdict && (
          <div style={{ marginBottom: '16px' }}>
            <VerificationBadge verdict={ctv.verdict} />
            {ctv.discrepancy_reason && (
              <div style={{
                marginTop: '6px', fontSize: '0.7rem', color: 'var(--neon-amber)',
                fontFamily: 'var(--font-tactical)', padding: '6px 10px',
                background: 'rgba(255,170,0,0.06)', borderRadius: '4px',
                border: '1px solid rgba(255,170,0,0.25)',
              }}>
                {ctv.discrepancy_reason}
              </div>
            )}
          </div>
        )}

        {/* ── Sensor Table ── */}
        <div style={{
          background: 'rgba(5,8,17,0.9)', border: '1px solid var(--border-subtle)',
          borderRadius: '6px', marginBottom: '16px', overflow: 'hidden',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '110px 1fr 1fr 1fr', gap: '8px',
            padding: '6px 10px', background: 'rgba(0,240,255,0.04)',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            {['SENSOR', 'VALUE', 'EDGE-AI WMO', 'CLOUD-ML WMO'].map(h => (
              <div key={h} style={{ fontSize: '0.65rem', color: 'var(--neon-cyan)', fontFamily: 'var(--font-tactical)', fontWeight: 700 }}>{h}</div>
            ))}
          </div>
          <SensorRow label="TEMPERATURE"
            value={sensors?.temperature?.value} unit="°C"
            edgeFlag={edgeAi?.wmo_t_flag ?? 0} cloudFlag={sensors?.temperature?.wmo_flag ?? 0} />
          <SensorRow label="HUMIDITY"
            value={sensors?.humidity?.value} unit="%"
            edgeFlag={edgeAi?.wmo_h_flag ?? 0} cloudFlag={sensors?.humidity?.wmo_flag ?? 0} />
          <SensorRow label="PRESSURE"
            value={sensors?.pressure?.value} unit="hPa"
            edgeFlag={edgeAi?.wmo_p_flag ?? 0} cloudFlag={sensors?.pressure?.wmo_flag ?? 0} />
          <SensorRow label="BATTERY"
            value={sensors?.battery_v?.value ?? liveData?.battery} unit="V"
            edgeFlag={(sensors?.battery_v?.value ?? liveData?.battery ?? 12.6) < 10.5 ? 1 : 0}
            cloudFlag={(liveData?.battery ?? 12.6) < 11.0 ? 1 : 0} />
        </div>

        {/* ── Two-column: Edge AI | Cloud ML ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div style={{ background: 'rgba(5,8,17,0.9)', border: '1px solid rgba(0,240,255,0.25)', borderRadius: '6px', padding: '12px' }}>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.72rem', color: 'var(--neon-cyan)', fontWeight: 700, marginBottom: '10px' }}>
              TIER 1 — ESP32 EDGE AI
            </div>
            <div style={{ fontSize: '0.72rem', lineHeight: '2.2', color: 'var(--text-secondary)' }}>
              <Row k="Classification" v={edgeAi?.classification ?? '—'} vColor={statusColor(edgeAi?.classification)} />
              <Row k="Anomaly Score" v={edgeAi?.anomaly_score != null ? Number(edgeAi.anomaly_score).toFixed(2) : '—'} />
              <Row k="Dew Point" v={edgeAi?.dew_point != null ? `${Number(edgeAi.dew_point).toFixed(2)} °C` : '—'} />
              <Row k="VPD" v={edgeAi?.vapor_pressure_deficit != null ? `${Number(edgeAi.vapor_pressure_deficit).toFixed(2)} hPa` : '—'} />
              <Row k="Clausius-Clapeyron"
                v={edgeAi?.clausius_clapeyron_pass != null ? (edgeAi.clausius_clapeyron_pass ? 'PASS' : 'VIOLATION') : '—'}
                vColor={edgeAi?.clausius_clapeyron_pass === false ? 'var(--neon-crimson)' : 'var(--neon-green)'} />
              <Row k="Reason" v={edgeAi?.reason || '—'} small />
            </div>
          </div>

          <div style={{ background: 'rgba(5,8,17,0.9)', border: '1px solid rgba(0,255,102,0.25)', borderRadius: '6px', padding: '12px' }}>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.72rem', color: 'var(--neon-green)', fontWeight: 700, marginBottom: '10px' }}>
              TIER 2 — CLOUD ML ENGINE
            </div>
            <div style={{ fontSize: '0.72rem', lineHeight: '2.2', color: 'var(--text-secondary)' }}>
              <Row k="Status" v={liveData?.status ?? '—'} vColor={statusColor(liveData?.status)} />
              <Row k="Root Cause" v={rootCause?.root_cause ?? fa?.root_cause ?? '—'} />
              <Row k="ML Score" v={fa?.anomaly_score != null ? Number(fa.anomaly_score).toFixed(3) : 'No model'} />
              <Row k="Fusion Score" v={fa?.fusion?.score != null ? Number(fa.fusion.score).toFixed(3) : '—'} />
              <Row k="Confidence" v={fa?.confidence ?? '—'} />
              <Row k="Diagnosis" v={rootCause?.specific_reason ?? fa?.interpretation ?? '—'} small />
            </div>
          </div>
        </div>

        {/* ── Thermodynamic Derived Values ── */}
        {derived && Object.keys(derived).length > 0 && (
          <div style={{
            background: 'rgba(5,8,17,0.9)', border: '1px solid var(--border-subtle)',
            borderRadius: '6px', padding: '12px', marginBottom: '16px',
          }}>
            <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.7rem', color: 'var(--neon-cyan)', fontWeight: 700, marginBottom: '8px' }}>
              THERMODYNAMIC DERIVED (CLOUD TIER)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {Object.entries(derived).slice(0, 8).map(([k, v]) => (
                <div key={k} style={{
                  background: 'rgba(0,240,255,0.04)', border: '1px solid var(--border-subtle)',
                  borderRadius: '4px', padding: '4px 10px',
                }}>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'var(--font-tactical)' }}>
                    {k.replace(/_/g, ' ').toUpperCase()}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--neon-cyan)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    {typeof v === 'number' ? v.toFixed(2) : String(v)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Rolling Frame History ── */}
        <div style={{ fontFamily: 'var(--font-tactical)', fontSize: '0.72rem', color: 'var(--neon-cyan)', fontWeight: 700, marginBottom: '8px' }}>
          FRAME HISTORY (last 10 packets)
        </div>
        <div className="tactical-table-wrapper" style={{ maxHeight: '220px' }}>
          <table className="tactical-table">
            <thead>
              <tr>
                <th>SEQ</th><th>TIME</th><th>T °C</th><th>RH %</th>
                <th>P hPa</th><th>BATT V</th><th>EDGE AI</th><th>CLOUD ML</th><th>VERDICT</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    <div style={{ fontFamily: 'var(--font-tactical)', color: 'var(--neon-amber)', marginBottom: '4px' }}>
                      Waiting for ESP32 telemetry…
                    </div>
                    <div style={{ fontSize: '0.7rem' }}>
                      Ensure ESP32 is sending to{' '}
                      <code style={{ color: 'var(--neon-cyan)' }}>/api/v1/telemetry/esp32/ingest</code>
                    </div>
                  </td>
                </tr>
              ) : history.map((h, i) => {
                const ok = h.verdict === 'VERIFIED';
                return (
                  <tr key={i}>
                    <td style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>#{h.seq}</td>
                    <td>{h.ts}</td>
                    <td>{h.temp ?? '—'}</td>
                    <td>{h.hum ?? '—'}</td>
                    <td>{h.pres ?? '—'}</td>
                    <td>{h.batt ?? '—'}</td>
                    <td style={{ color: statusColor(h.edgeClass), fontWeight: 600 }}>{h.edgeClass}</td>
                    <td style={{ color: statusColor(h.cloudStatus), fontWeight: 600 }}>{h.cloudStatus}</td>
                    <td>
                      <span className={`cyber-badge ${ok ? 'badge-normal' : 'badge-critical'}`} style={{ fontSize: '0.6rem' }}>
                        {ok ? 'VERIFIED' : 'DISCREPANCY'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
