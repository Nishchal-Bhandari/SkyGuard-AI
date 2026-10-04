"""Explains why an incident was raised and how an operator should handle it.

Everything is derived from the evidence snapshot stored with the incident, so the
same reasoning is available for new incidents and for records created before this
module existed.
"""
from typing import Any, Dict, List, Optional

PARAMETER_LABELS = {'temp': 'Temperature', 'hum': 'Humidity', 'pres': 'Pressure', 'core': 'Core sensors'}
PARAMETER_ORDER = ('temp', 'hum', 'pres')
PARAMETER_UNITS = {'temp': '°C', 'hum': '%', 'pres': ' hPa'}

ROOT_CAUSE_STEPS = {
    'SENSOR_FLATLINE': [
        'Check the sensor cable, connector and ADC channel; a frozen value usually means a lost sensor signal.',
        'Compare against a portable reference instrument at the station.',
    ],
    'THERMAL_SPIKE': [
        'Inspect the radiation shield for blockage, direct sun exposure or a nearby heat source.',
        'Check the next reading: a one-off jump that returns to normal points to transient exposure, not a failing sensor.',
    ],
    'CALIBRATION_DRIFT': [
        'Compare the sensor with a calibrated reference instrument at the station.',
        'Schedule recalibration only if the bias persists over several readings and peers do not share it.',
    ],
    'SENSOR_NOISE_DEGRADATION': [
        'Inspect the sensor element, shielding and wiring for loose contacts or electrical interference.',
        'Compare with a reference instrument; erratic readings that average out can hide a failing sensor.',
    ],
    'POWER_SAG_BROWNOUT': [
        'Check battery voltage and solar charging first; brownouts corrupt readings and can mimic a sensor fault.',
        'Judge the sensors only after power is restored.',
    ],
    'SUPER_SATURATION_VIOLATION': [
        'Inspect the humidity element for condensation or contamination and clean or replace it.',
    ],
    'MISSING_DATA': [
        'Check sensor wiring and the firmware payload; one or more required fields were not delivered.',
    ],
    'COMMUNICATION_CORRUPTION': [
        'Check the sensor bus and data link; sentinel values (-999 / 65535) mean the reading never reached the pipeline intact.',
    ],
}


def _number(value: Any) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _parameter(incident: Dict[str, Any], residuals: Optional[List[float]]) -> str:
    prefix = str(incident.get('variable') or '').replace('synthetic:', '').split(':')[0]
    if prefix in PARAMETER_LABELS:
        return prefix
    if residuals and len(residuals) == 3:
        return PARAMETER_ORDER[max(range(3), key=lambda i: abs(residuals[i]))]
    return 'core'


def build_reasoning(incident: Dict[str, Any]) -> Dict[str, Any]:
    state = incident.get('evidence_data') if isinstance(incident.get('evidence_data'), dict) else {}
    a = state.get('final_assessment') if isinstance(state.get('final_assessment'), dict) else {}
    vector = a.get('evidence_vector') or {}
    fleet = a.get('fleet_evidence') or {}
    classification = a.get('classification') or incident.get('quality_state') or 'UNKNOWN'
    root_cause = a.get('root_cause') or 'UNKNOWN'
    residuals = a.get('residuals') if isinstance(a.get('residuals'), list) and len(a['residuals']) == 3 else None
    parameter = _parameter(incident, residuals)
    label = PARAMETER_LABELS[parameter]
    ml = state.get('ml_model') or {}
    fusion = a.get('fusion') or {}
    risk = _number(incident.get('fault_risk')) or 0.
    hard = a.get('quality_state') == 'INVALID' or bool(vector.get('z_phys'))
    peers = _number(fleet.get('eligible_peer_count'))
    peers = int(peers) if peers is not None else 0
    agreement = _number(fleet.get('agreement_index'))
    candidate = bool(a.get('regional_candidate'))
    corroborating = int(_number(fleet.get('corroborating_peers')) or 0)
    partial = not candidate and not hard and classification == 'LOCALIZED_ANOMALY_UNCONFIRMED' and peers >= 2 and (corroborating >= 2 or corroborating * 2 >= peers)
    radius = fleet.get('search_radius_km')

    factors: List[Dict[str, str]] = []

    def add(code, title, detail, effect):
        factors.append({'code': code, 'title': title, 'detail': detail, 'effect': effect})

    issues = [str(v) for v in a.get('integrity_issues') or []]
    physics = [v for v in a.get('physics_violations') or [] if isinstance(v, dict)]
    if issues:
        add('DATA_INTEGRITY_FAIL', 'Data integrity failure', 'Rejected input: ' + ', '.join(issues[:4]) + '.', 'supports')
    for violation in physics[:3]:
        add('PHYSICAL_BOUNDS_FAIL', 'Physics check failed', str(violation.get('detail') or violation.get('type')), 'supports')

    if residuals and not hard:
        value = residuals[PARAMETER_ORDER.index(parameter)] if parameter in PARAMETER_ORDER else max(residuals, key=abs)
        direction = 'above' if value > 0 else 'below'
        observed = _number((a.get('observed') or {}).get(parameter))
        expected = _number((a.get('expected') or {}).get(parameter))
        unit = PARAMETER_UNITS.get(parameter, '')
        compare = f' (observed {observed:.1f}{unit}, expected {expected:.1f}{unit})' if observed is not None and expected is not None else ''
        if abs(value) >= 3 or vector.get('z_qc'):
            add('STATISTICAL_EXCURSION', f'{label} outside its normal range',
                f'{abs(value):.1f}σ {direction} this station\'s usual value for this hour{compare}.', 'supports')
    if vector.get('z_temp'):
        add('TEMPORAL_ANOMALY', 'Abnormal change over time',
            'Spike, flatline, persistent departure or a drifting trend was detected against recent history.', 'supports')
    if vector.get('z_ml'):
        score, threshold = ml.get('anomaly_score'), ml.get('threshold')
        detail = f'Station model score {score} against threshold {threshold}.' if score is not None and threshold is not None else 'Station model flagged the observation.'
        add('ML_ANOMALY', 'Station model flags it', detail, 'supports')
    elif vector.get('z_ml') == 0.:
        add('ML_NORMAL', 'Station model sees it as normal', 'The learned model did not flag this observation.', 'against')
    elif not hard:
        add('ML_UNAVAILABLE', 'No station model score', f'Rules-only assessment (readiness {(a.get("readiness") or {}).get("tier", "UNKNOWN")}).', 'missing')
    if vector.get('z_multi'):
        add('MULTIVARIATE_PHYSICS', 'Variables are physically inconsistent', 'Temperature, humidity and pressure do not agree thermodynamically.', 'supports')

    battery = _number(state.get('battery'))
    if root_cause == 'POWER_SAG_BROWNOUT' and battery is not None:
        add('LOW_BATTERY', 'Battery sag', f'Supply at {battery:.1f} V is below the 11.2 V brownout threshold.', 'supports')

    if classification == 'REGIONAL_EVENT':
        spread = f' (agreement {agreement:.2f})' if agreement is not None else ''
        add('PEER_CONFIRMED_REGIONAL', 'Neighbours show the same change',
            f'{peers} nearby stations moved the same way on consecutive readings{spread}, so this looks like weather.', 'against')
    elif candidate:
        add('REGIONAL_CANDIDATE_PENDING', 'Neighbours may share this change',
            f'{peers} peers move the same way (agreement {agreement:.2f}). One more confirming reading within 30 minutes reclassifies it as a regional event.', 'against')
    elif partial:
        add('PEER_PARTIAL_AGREEMENT', 'Some neighbours show the same change',
            f'{corroborating} of {peers} nearby stations depart in the same direction, but not most of them. A localized weather front such as a sea breeze is possible, so a sensor fault is not confirmed.', 'against')
    elif peers >= 2 and not hard:
        spread = f' (agreement {agreement:.2f})' if agreement is not None else ''
        add('PEER_DISAGREEMENT', 'Neighbours do not share it',
            f'{peers} nearby stations within {radius} km are not showing the same departure{spread}, so weather is unlikely.', 'supports')
    elif not hard:
        add('PEERS_INSUFFICIENT', 'Not enough neighbours to compare',
            f'{peers} eligible peer(s) within {radius if radius is not None else "the configured"} km; 2 are required to rule weather in or out.', 'missing')

    caveats: List[str] = []
    if root_cause == 'CALIBRATION_DRIFT' and not vector.get('z_temp'):
        caveats.append('"Calibration drift" is the default label when no spike or flatline signature was found; drift itself was not measured. Verify before recalibrating.')
    if fusion.get('coefficient_status') == 'DEFAULT_PRIORS':
        caveats.append(f'Risk {risk:.0%} comes from default fusion weights, not field-fitted ones. Use it to rank incidents, not as a probability.')
    completeness = _number(a.get('evidence_completeness'))
    if completeness is not None and completeness < 0.67:
        caveats.append(f'Only {completeness:.0%} of the evidence channels were available for this decision.')

    reason_codes = [root_cause] if root_cause not in ('UNKNOWN', 'NOMINAL') else []
    reason_codes += [f['code'] for f in factors if f['effect'] == 'supports' or f['code'].startswith('PEER') or f['code'] == 'REGIONAL_CANDIDATE_PENDING']
    reason_codes = list(dict.fromkeys(reason_codes)) or [str(classification)]

    if classification == 'REGIONAL_EVENT':
        priority, suggested = 'P3', 'GENUINE'
        headline = f'{label} changed together with nearby stations, so this is treated as real weather rather than a sensor fault.'
        steps = ['Keep the observations; do not invalidate or recalibrate.', 'Confirm it as a genuine extreme if it matches a known weather event.']
        why = 'Peers corroborate the change on consecutive readings.'
    elif hard:
        priority, suggested = 'P1', 'REJECT'
        headline = f'{label} failed a hard data or physics check; this reading cannot be trusted regardless of weather.'
        steps = ROOT_CAUSE_STEPS.get(root_cause, ['Inspect the implicated sensor and its data path.']) + ['Invalidate the reading once the fault is confirmed; machine learning and peer comparison were skipped for it.']
        why = 'Hard-gate failures are invalid by definition.'
    elif partial:
        priority, suggested = 'P2', 'ACKNOWLEDGE'
        headline = f'{label} is unusual and {corroborating} of {peers} neighbours show the same change, so this may be a localized weather front rather than a sensor fault.'
        steps = ['Check whether the stations that agree share exposure with this one (coast, elevation, terrain) and whether the others are simply outside the front.',
                 'Acknowledge and watch the next readings; a sensor fault should not be asserted while neighbours corroborate the change.']
        why = 'Partial peer agreement means a sensor fault is unproven.'
    elif candidate:
        priority, suggested = 'P2', 'ACKNOWLEDGE'
        headline = f'{label} is unusual, but neighbouring stations are moving the same way; this may be an emerging weather event.'
        steps = ['Acknowledge and wait for the next reading (within 30 minutes).', 'If it is reclassified as a regional event, treat it as weather; if peers revert, treat it as a local fault.']
        why = 'Judging now risks a false sensor-fault verdict on real weather.'
    elif peers >= 2:
        priority = 'P1' if risk >= .7 else 'P2'
        suggested = 'REJECT'
        headline = f'{label} departs from its normal pattern while {peers} nearby stations do not, so a local sensor or station fault is likely.'
        steps = ROOT_CAUSE_STEPS.get(root_cause, ['Inspect the implicated sensor and compare with a reference instrument.'])
        steps = steps + ['If the field check confirms a defect, invalidate the reading; otherwise acknowledge and keep monitoring.']
        why = 'Peers disagree, which is the evidence needed to blame the sensor.'
    else:
        priority, suggested = 'P2', 'ACKNOWLEDGE'
        headline = f'{label} is unusual for this station, but with fewer than 2 neighbours the system cannot tell a sensor fault from local weather.'
        steps = ['Check whether nearby stations are online and reporting; widening the station peer radius may restore comparison.',
                 'Acknowledge now and re-evaluate after the next reading; avoid invalidating on this evidence alone.'] + ROOT_CAUSE_STEPS.get(root_cause, [])[:1]
        why = 'The verdict is unconfirmed, so a destructive action is premature.'

    if str(incident.get('status') or 'open') == 'open':
        steps = steps + ['The incident auto-resolves after 3 consecutive normal readings.']

    return {
        'parameter': parameter,
        'parameter_label': label,
        'headline': headline,
        'factors': factors,
        'caveats': caveats,
        'priority': priority,
        'priority_label': {'P1': 'Act now', 'P2': 'Review soon', 'P3': 'Monitor'}[priority],
        'handling_steps': steps,
        'suggested_action': suggested,
        'suggested_action_reason': why,
        'reason_codes': reason_codes,
    }
