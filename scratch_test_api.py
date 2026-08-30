import urllib.request
import json
import time

url = 'http://127.0.0.1:8000/api/v1/health'
try:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as response:
        print(response.read().decode())
except Exception as e:
    print('Health Error:', e)
