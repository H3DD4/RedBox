import requests, sys

base = 'https://web-random-cheese.tracebash.xyz'

# Create two different accounts and check spin sequences
for prefix in ['AAA', 'BBB']:
    s = requests.Session()
    s.post(f'{base}/register', data={'username': prefix, 'password': 'pass'}, allow_redirects=False)
    s.post(f'{base}/login', data={'username': prefix, 'password': 'pass'}, allow_redirects=False)
    vals = []
    for i in range(5):
        r = s.post(f'{base}/spin')
        vals.append(r.json()['val'])
    print(f'{prefix}: {vals}')

# Now check if time-based seeding - create accounts at different times
import time
for i in range(3):
    s = requests.Session()
    username = f'SEQ{i}_{time.time_ns()}'[:25]
    s.post(f'{base}/register', data={'username': username, 'password': 'pass'}, allow_redirects=False)
    s.post(f'{base}/login', data={'username': username, 'password': 'pass'}, allow_redirects=False)
    vals = []
    for j in range(5):
        r = s.post(f'{base}/spin')
        vals.append(r.json()['val'])
    print(f'{username[-10:]}: {vals}')
    time.sleep(0.5)