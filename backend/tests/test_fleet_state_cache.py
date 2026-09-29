import json
from contextlib import contextmanager
from unittest.mock import patch

from backend.app.services.weather_service import WeatherService


class FleetCursor:
    def __init__(self, station_ids, states):
        self.station_ids = station_ids
        self.states = states
        self.query = ''

    def execute(self, query):
        self.query = query

    def fetchall(self):
        if self.query == 'SELECT station_id FROM stations':
            return [{'station_id': station_id} for station_id in self.station_ids]
        assert 'JOIN stations st' in self.query
        return [{'assessment_data': json.dumps(state)} for state in self.states]


def test_deleted_station_is_removed_from_running_fleet_cache():
    cursor = FleetCursor([], [])

    @contextmanager
    def fake_db():
        yield type('Connection', (), {'cursor': lambda self: cursor})()

    service = WeatherService()
    old_state = {'station_id': 'AWS-01', 'status': 'NORMAL'}
    service.live_state['AWS-01'] = old_state
    service.esp32_latest['AWS-01'] = old_state
    service.esp32_history['AWS-01'] = [old_state]
    service._cached_base_readings['AWS-01'] = {'temperature_2m': 25}

    with patch('backend.app.services.weather_service.get_db', fake_db):
        assert service.get_fleet_state() == []

    assert service.live_state == {}
    assert service.esp32_latest == {}
    assert service.esp32_history == {}
    assert service._cached_base_readings == {}
