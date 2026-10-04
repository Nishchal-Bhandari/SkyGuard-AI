from backend.app.services.incident_reasoning import build_reasoning


def incident(classification, root='CALIBRATION_DRIFT', peers=0, candidate=False, vector=None, risk=.8, residuals=(0., 0., 3.6), **extra):
    assessment = {
        'classification': classification, 'root_cause': root, 'quality_state': 'SUSPECT', 'residuals': list(residuals),
        'observed': {'temp': 25., 'hum': 60., 'pres': 1030.}, 'expected': {'temp': 25., 'hum': 60., 'pres': 1013.},
        'evidence_vector': {'z_qc': 1., 'z_phys': 0., 'z_temp': 0., 'z_ml': None, 'z_multi': 0., **(vector or {})},
        'fleet_evidence': {'eligible_peer_count': peers, 'agreement_index': .2, 'search_radius_km': 60},
        'regional_candidate': candidate, 'fusion': {'coefficient_status': 'DEFAULT_PRIORS'}, 'evidence_completeness': .5,
        'integrity_issues': [], 'physics_violations': [],
        **extra,
    }
    return {'variable': 'pres:' + root, 'quality_state': classification, 'fault_risk': risk, 'status': 'open',
            'evidence_data': {'final_assessment': assessment, 'battery': 12.6}}


def codes(reasoning):
    return {f['code'] for f in reasoning['factors']}


def test_unconfirmed_incident_is_not_blamed_on_the_sensor():
    r = build_reasoning(incident('LOCALIZED_ANOMALY_UNCONFIRMED', peers=1))
    assert r['parameter'] == 'pres'
    assert r['suggested_action'] == 'ACKNOWLEDGE'
    assert 'PEERS_INSUFFICIENT' in codes(r)
    assert any('default label' in c for c in r['caveats'])
    assert r['reason_codes'][0] == 'CALIBRATION_DRIFT'


def test_peer_disagreement_supports_sensor_fault():
    r = build_reasoning(incident('LOCALIZED_ANOMALY', peers=3, vector={'z_temp': 1.}))
    assert r['suggested_action'] == 'REJECT'
    assert r['priority'] == 'P1'
    assert 'PEER_DISAGREEMENT' in codes(r)
    assert not any('default label' in c for c in r['caveats'])


def test_first_reading_of_possible_weather_is_held():
    r = build_reasoning(incident('LOCALIZED_ANOMALY', peers=3, candidate=True))
    assert r['suggested_action'] == 'ACKNOWLEDGE'
    assert 'REGIONAL_CANDIDATE_PENDING' in codes(r)


def test_regional_event_is_preserved():
    r = build_reasoning(incident('REGIONAL_EVENT', root='REGIONAL_WEATHER_FRONT', peers=3, risk=0.))
    assert (r['suggested_action'], r['priority']) == ('GENUINE', 'P3')


def test_hard_failure_is_urgent_and_skips_peers():
    r = build_reasoning(incident('LOCALIZED_ANOMALY', root='COMMUNICATION_CORRUPTION', vector={'z_phys': 1.},
                                 quality_state='INVALID', integrity_issues=['temperature:SENTINEL']))
    assert (r['suggested_action'], r['priority']) == ('REJECT', 'P1')
    assert 'DATA_INTEGRITY_FAIL' in codes(r)
    assert not codes(r) & {'PEER_DISAGREEMENT', 'PEERS_INSUFFICIENT'}


def test_legacy_incident_without_evidence_does_not_fail():
    r = build_reasoning({'variable': 'core:UNKNOWN', 'quality_state': 'NORMAL', 'status': 'open', 'evidence_data': {}})
    assert r['priority'] in {'P1', 'P2', 'P3'} and r['handling_steps']


def test_partial_peer_agreement_holds_the_incident():
    r = build_reasoning(incident('LOCALIZED_ANOMALY_UNCONFIRMED', root='REGIONAL_WEATHER_FRONT', peers=4,
                                 fleet_evidence={'eligible_peer_count': 4, 'agreement_index': .2, 'search_radius_km': 60, 'corroborating_peers': 2}))
    assert r['suggested_action'] == 'ACKNOWLEDGE'
    assert 'PEER_PARTIAL_AGREEMENT' in codes(r)
    assert 'sensor fault' in r['headline']
