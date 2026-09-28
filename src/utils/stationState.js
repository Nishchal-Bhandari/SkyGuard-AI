// A registered station and a live observation are separate facts. The fleet
// endpoint may legitimately have no assessment before the first observation.
export const emptySensors = () => ({
  temperature: { value: null, unit: '°C', wmo_flag: 9 },
  humidity: { value: null, unit: '%', wmo_flag: 9 },
  pressure: { value: null, unit: 'hPa', wmo_flag: 9 },
  wind_speed: { value: null, unit: 'km/h', wmo_flag: 9 },
  rainfall: { value: null, unit: 'mm', wmo_flag: 9 }
});

export function reconcileStationRoster(previous, credentials) {
  const byId = new Map(previous.map(station => [station.id, station]));
  return credentials.map(credential => {
    const id = credential.stationId || credential.station_id;
    const prior = byId.get(id);
    const observed = Boolean(prior?.source_timestamp);
    return {
      ...(observed ? prior : {}),
      id,
      name: credential.stationName || credential.station_name || id,
      region: credential.region || 'Assigned Region',
      lat: Number(credential.lat ?? credential.latitude ?? 0),
      lon: Number(credential.lon ?? credential.longitude ?? 0),
      elevation: Number(credential.elevation ?? 0),
      status: credential.status === 'INACTIVE' ? 'INACTIVE' : observed ? prior.status : 'AWAITING_DATA',
      source_timestamp: observed ? prior.source_timestamp : null,
      last_seen: observed ? prior.last_seen : null,
      sensors: observed ? prior.sensors : emptySensors(),
      battery: observed ? prior.battery : null,
      signal: observed ? prior.signal : null
    };
  });
}

export function mergeLiveAssessments(previous, assessments) {
  if (!assessments.length) return previous;
  const byId = new Map(previous.map(station => [station.id, station]));
  for (const assessment of assessments) {
    const id = assessment.station_id || assessment.id;
    const prior = byId.get(id);
    if (prior?.source_timestamp && assessment.source_timestamp &&
        Date.parse(prior.source_timestamp) > Date.parse(assessment.source_timestamp)) continue;
    byId.set(id, {
      ...prior,
      ...assessment,
      id,
      name: assessment.station_name || assessment.name || prior?.name || id,
      lat: Number(assessment.latitude ?? assessment.lat ?? prior?.lat ?? 0),
      lon: Number(assessment.longitude ?? assessment.lon ?? prior?.lon ?? 0),
      model_status: assessment.ml_model?.model_id ? 'ACTIVE_PRODUCTION' : 'PENDING_CALIBRATION'
    });
  }
  return [...byId.values()];
}
