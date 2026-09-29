from unittest.mock import patch

from backend.app.api.v1.models import get_station_active_model
from backend.app.services.training_service import training_service


def test_missing_active_artifact_is_not_reported_as_usable():
    record = {
        'model_id': 'AWS-01_IF_v1_4',
        'model_location': 'ml/models/AWS-01/AWS-01_IF_v1_4.json',
    }
    with patch('backend.app.services.training_service.get_active_model_record', return_value=record), \
         patch('backend.app.services.training_service.model_storage_service.load_artifact', return_value=None):
        score = training_service.score_observation('AWS-01', {'temp': 25, 'hum': 60, 'pres': 1013})

    assert score['status'] == 'ARTIFACT_UNAVAILABLE'
    assert score['has_model'] is False
    assert score['model_id'] == record['model_id']

    with patch('backend.app.api.v1.models.get_active_model_record', return_value=record), \
         patch('backend.app.api.v1.models.model_storage_service.load_artifact', return_value=None), \
         patch('backend.app.api.v1.models.model_storage_service.load_by_station_and_id', return_value=None):
        response = get_station_active_model('AWS-01', {'role': 'admin'})

    assert response['has_active_model'] is False
    assert response['status'] == 'ARTIFACT_UNAVAILABLE'
