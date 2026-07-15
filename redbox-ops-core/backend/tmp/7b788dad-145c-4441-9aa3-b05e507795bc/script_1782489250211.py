import requests

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
# Register new user
r1 = s.post(f'{base}/register', data={'username':'hacker99','password':'pass99'}, allow_redirects=False)
print('Register:', r1.status_code, r1.headers.get('Set-Cookie',''))
# Login
r2 = s.post(f'{base}/login', data={'username':'hacker99','password':'pass99'}, allow_redirects=False)
print('Login:', r2.status_code, r2.headers.get('Set-Cookie',''))
# Access home
r3 = s.get(f'{base}/', allow_redirects=False)
print('Home:', r3.status_code, r3.text[:300])
# Try spin
r4 = s.post(f'{base}/spin', allow_redirects=False)
print('Spin:', r4.status_code, r4.text[:300])