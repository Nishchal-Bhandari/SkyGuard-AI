import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileStationRoster, mergeLiveAssessments } from './stationState.js';

const roster = [
  { stationId: 'AWS-01', stationName: 'North', region: 'North', lat: 28.6, lon: 77.2, status: 'ACTIVE' },
  { stationId: 'AWS-02', stationName: 'South', region: 'South', lat: 12.9, lon: 77.6, status: 'ACTIVE' }
];

test('initial empty credentials and empty fleet result never erase cached stations', () => {
  const cached = [{ id: 'AWS-01', source_timestamp: '2026-09-28T08:00:00Z', status: 'NORMAL' }];
  assert.equal(mergeLiveAssessments(cached, []), cached);
  assert.deepEqual(reconcileStationRoster(cached, roster).map(station => station.id), ['AWS-01', 'AWS-02']);
});

test('registered stations without observations remain visible with missing data', () => {
  const stations = reconcileStationRoster([], roster);
  assert.equal(stations[0].status, 'AWAITING_DATA');
  assert.equal(stations[0].source_timestamp, null);
  assert.equal(stations[0].sensors.temperature.value, null);
  assert.equal(stations[1].sensors.temperature.wmo_flag, 9);
  assert.deepEqual(mergeLiveAssessments(stations, []), stations);
});

test('legacy cached placeholder readings are discarded when roster arrives', () => {
  const cached = [{
    id: 'AWS-01', status: 'NORMAL',
    sensors: { temperature: { value: 25, unit: '°C' } }
  }];
  const [station] = reconcileStationRoster(cached, [roster[0]]);
  assert.equal(station.status, 'AWAITING_DATA');
  assert.equal(station.sensors.temperature.value, null);
});

test('assessment updates only its station and older polls cannot roll it back', () => {
  const initial = reconcileStationRoster([], roster);
  const current = mergeLiveAssessments(initial, [{
    station_id: 'AWS-01', station_name: 'North',
    source_timestamp: '2026-09-28T09:00:00Z', status: 'NORMAL',
    sensors: { temperature: { value: 27, unit: '°C', wmo_flag: 0 } }
  }]);
  assert.equal(current.length, 2);
  assert.equal(current[0].sensors.temperature.value, 27);
  assert.equal(current[1].status, 'AWAITING_DATA');
  const stale = mergeLiveAssessments(current, [{
    station_id: 'AWS-01', source_timestamp: '2026-09-28T08:00:00Z',
    sensors: { temperature: { value: 22 } }
  }]);
  assert.equal(stale[0].sensors.temperature.value, 27);
});

test('authoritative empty roster removes stations only after loading', () => {
  assert.deepEqual(reconcileStationRoster([{ id: 'AWS-01' }], []), []);
});
