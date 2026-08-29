/**
 * SkyGuard-AI — Open-Meteo Real-Time & Historical Weather Ingestion Service
 * 
 * Free, high-resolution global meteorological API (No API key required).
 * Documentation: https://open-meteo.com/en/docs
 */

// Curated Real-World Automatic Weather Stations across diverse Indian Microclimates
export const OPEN_METEO_PRESET_STATIONS = [
  {
    id: "AWS-07",
    name: "Hyderabad Deccan Plateau",
    region: "Deccan Semi-Arid",
    lat: 17.3850,
    lon: 78.4867,
    elevation: 542,
    username: "operator_hyd",
    status: "ACTIVE"
  },
  {
    id: "AWS-12",
    name: "Mumbai Coastal Radar",
    region: "West Coast Maritime",
    lat: 18.9220,
    lon: 72.8346,
    elevation: 14,
    username: "operator_mum",
    status: "ACTIVE"
  },
  {
    id: "AWS-19",
    name: "Cherrapunji Hill Observatory",
    region: "Meghalaya Rainforest",
    lat: 25.2702,
    lon: 91.7323,
    elevation: 1313,
    username: "operator_cherra",
    status: "ACTIVE"
  },
  {
    id: "AWS-01",
    name: "Delhi Urban Meteorological Base",
    region: "Northern Plains",
    lat: 28.6139,
    lon: 77.2090,
    elevation: 216,
    username: "operator_del",
    status: "ACTIVE"
  },
  {
    id: "AWS-04",
    name: "Bengaluru Tech Plateau",
    region: "South Mysore Plateau",
    lat: 12.9716,
    lon: 77.5946,
    elevation: 920,
    username: "operator_blr",
    status: "ACTIVE"
  },
  {
    id: "AWS-21",
    name: "Leh High-Altitude Base",
    region: "Trans-Himalayan Cold Desert",
    lat: 34.1526,
    lon: 77.5771,
    elevation: 3500,
    username: "operator_leh",
    status: "ACTIVE"
  },
  {
    id: "AWS-15",
    name: "Pune Western Ghats Inflow",
    region: "Ghats Foothills",
    lat: 18.5204,
    lon: 73.8567,
    elevation: 560,
    username: "operator_pune",
    status: "ACTIVE"
  },
  {
    id: "AWS-09",
    name: "Kolkata Delta Marine",
    region: "Sundarbans Delta",
    lat: 22.5726,
    lon: 88.3639,
    elevation: 9,
    username: "operator_kol",
    status: "ACTIVE"
  }
];

class OpenMeteoService {
  constructor() {
    this.baseUrl = "https://api.open-meteo.com/v1/forecast";
    this.lastLatencyMs = 0;
    this.lastSyncTimestamp = null;
    this.isOnline = true;
    this.activeRequests = 0;
  }

  /**
   * Health check / ping test
   */
  async ping() {
    const start = performance.now();
    try {
      const res = await fetch(`${this.baseUrl}?latitude=17.385&longitude=78.4867&current=temperature_2m`, {
        cache: 'no-store'
      });
      this.lastLatencyMs = Math.round(performance.now() - start);
      this.isOnline = res.ok;
      return { ok: res.ok, status: res.status, latencyMs: this.lastLatencyMs };
    } catch (err) {
      this.lastLatencyMs = Math.round(performance.now() - start);
      this.isOnline = false;
      return { ok: false, error: err.message, latencyMs: this.lastLatencyMs };
    }
  }

  /**
   * Fetch current real-time telemetry for a single station coordinate
   */
  async fetchStationRealtime(lat, lon) {
    const start = performance.now();
    const url = `${this.baseUrl}?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,precipitation,weather_code,direct_normal_irradiance&wind_speed_unit=kmh`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo API returned HTTP ${response.status}`);
    }

    const data = await response.json();
    this.lastLatencyMs = Math.round(performance.now() - start);
    this.lastSyncTimestamp = new Date().toISOString();

    const current = data.current || {};
    return {
      timestamp: current.time || new Date().toISOString(),
      temperature: current.temperature_2m !== undefined ? current.temperature_2m : 25.0,
      humidity: current.relative_humidity_2m !== undefined ? current.relative_humidity_2m : 60.0,
      pressure: current.surface_pressure !== undefined ? current.surface_pressure : 1013.25,
      wind_speed: current.wind_speed_10m !== undefined ? current.wind_speed_10m : 5.0,
      wind_direction: current.wind_direction_10m !== undefined ? current.wind_direction_10m : 180,
      rainfall: current.precipitation !== undefined ? current.precipitation : 0.0,
      solar: current.direct_normal_irradiance !== undefined ? current.direct_normal_irradiance : 450.0,
      weather_code: current.weather_code || 0,
      elevation: data.elevation || 0,
      latencyMs: this.lastLatencyMs
    };
  }

  /**
   * Batch fetch real-time weather for multiple stations in parallel
   */
  async fetchBatchRealtime(stations) {
    if (!stations || stations.length === 0) return {};
    const results = {};
    const start = performance.now();

    // Parallel fetch with Promise.allSettled
    const promises = stations.map(async (st) => {
      const lat = st.lat !== undefined ? st.lat : 17.3850;
      const lon = st.lon !== undefined ? st.lon : 78.4867;
      try {
        const obs = await this.fetchStationRealtime(lat, lon);
        return { stationId: st.id, data: obs, success: true };
      } catch (err) {
        return { stationId: st.id, error: err.message, success: false };
      }
    });

    const settled = await Promise.allSettled(promises);
    this.lastLatencyMs = Math.round(performance.now() - start);
    this.lastSyncTimestamp = new Date().toISOString();

    settled.forEach(item => {
      if (item.status === 'fulfilled' && item.value.success) {
        results[item.value.stationId] = item.value.data;
      }
    });

    return results;
  }

  /**
   * Fetch 7-day to 30-day hourly historical observations from Open-Meteo for Isolation Forest training
   */
  async fetchHistoricalTrainingDataset(lat, lon, pastDays = 7) {
    const url = `${this.baseUrl}?latitude=${lat}&longitude=${lon}&past_days=${pastDays}&forecast_days=0&hourly=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,precipitation&wind_speed_unit=kmh`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch historical data: HTTP ${response.status}`);
    }

    const json = await response.json();
    const hourly = json.hourly || {};
    const times = hourly.time || [];
    const temps = hourly.temperature_2m || [];
    const hums = hourly.relative_humidity_2m || [];
    const pres = hourly.surface_pressure || [];
    const winds = hourly.wind_speed_10m || [];
    const rains = hourly.precipitation || [];

    const rows = [];
    for (let i = 0; i < times.length; i++) {
      if (temps[i] === null || temps[i] === undefined) continue;
      rows.push({
        timestamp: times[i],
        temp: temps[i],
        hum: hums[i] ?? 50,
        pres: pres[i] ?? 1013,
        wind: winds[i] ?? 5,
        rain: rains[i] ?? 0
      });
    }

    return {
      totalRows: rows.length,
      elevation: json.elevation,
      timezone: json.timezone,
      rows
    };
  }

  /**
   * Decodes WMO weather code into human readable weather condition & icon
   */
  getWeatherCodeMeta(code) {
    switch (code) {
      case 0: return { label: 'Clear Sky', icon: 'fa-sun', color: '#ffb703' };
      case 1:
      case 2:
      case 3: return { label: 'Partly Cloudy', icon: 'fa-cloud-sun', color: '#8ecae6' };
      case 45:
      case 48: return { label: 'Fog / Mist', icon: 'fa-smog', color: '#94a3b8' };
      case 51:
      case 53:
      case 55: return { label: 'Drizzle', icon: 'fa-cloud-rain', color: '#00f0ff' };
      case 61:
      case 63:
      case 65: return { label: 'Rain', icon: 'fa-cloud-showers-heavy', color: '#00f0ff' };
      case 71:
      case 73:
      case 75: return { label: 'Snowfall', icon: 'fa-snowflake', color: '#ffffff' };
      case 80:
      case 81:
      case 82: return { label: 'Rain Showers', icon: 'fa-cloud-showers-water', color: '#38bdf8' };
      case 95:
      case 96:
      case 99: return { label: 'Thunderstorm', icon: 'fa-bolt', color: '#ff0055' };
      default: return { label: 'Overcast', icon: 'fa-cloud', color: '#94a3b8' };
    }
  }
}

export const openMeteoService = new OpenMeteoService();
