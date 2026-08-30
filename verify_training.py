import urllib.request, json, time
from backend.app.auth.security import create_access_token

token = create_access_token({'sub': 'admin', 'role': 'admin'})

req = urllib.request.Request(
    'http://127.0.0.1:8000/api/v1/stations/AWS-01/train',
    data=b'{}',
    headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
    method='POST'
)
t0 = time.time()
with urllib.request.urlopen(req) as resp:
    res = json.loads(resp.read().decode())
    dt = time.time() - t0

print('Training complete in %.2fs' % dt)
print('  station_id    :', res['station_id'])
print('  model_id      :', res['model_id'])
print('  model_version :', res['model_version'])
print('  valid_records :', res['valid_records'])
print('  threshold     :', res['threshold'])
print('  status        :', res['status'])

card = res.get('model_card', {})
print()
print('Model Card summary:')
print('  algorithm     :', card.get('algorithm'))
ts = card.get('training_summary', {})
print('  total_raw     :', ts.get('total_raw_records'))
print('  valid_records :', ts.get('valid_records'))
print('  scrubbed      :', ts.get('scrubbed_records'))
print('  dyn_threshold :', ts.get('dynamic_threshold'))
print('  features      :', ts.get('features'))

ns = card.get('normalization_stats', {})
print()
print('Normalization stats (must have real values from 2617 rows):')
print('  t_mean=%.3f  t_std=%.3f' % (ns.get('t_mean', 0), ns.get('t_std', 0)))
print('  h_mean=%.3f  h_std=%.3f' % (ns.get('h_mean', 0), ns.get('h_std', 0)))
print('  p_mean=%.3f  p_std=%.3f' % (ns.get('p_mean', 0), ns.get('p_std', 0)))
