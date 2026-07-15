import requests, hashlib, itertools, string

base = 'https://web-random-cheese.tracebash.xyz'

# Create fresh user
s = requests.Session()
s.post(f'{base}/register', data={'username': 'crackme', 'password': 'crackme'}, allow_redirects=False)
s.post(f'{base}/login', data={'username': 'crackme', 'password': 'crackme'}, allow_redirects=False)
cookie = s.cookies.get('session')
print('Cookie:', cookie)

# Extract the payload (middle part)
parts = cookie.split('.')
print('Parts:', len(parts))
print('Header (pad):', parts[0] + '=' * (4 - len(parts[0]) % 4) if len(parts[0]) % 4 else parts[0])
print('Payload (pad):', parts[1] + '=' * (4 - len(parts[1]) % 4) if len(parts[1]) % 4 else parts[1])
print('Sig:', parts[2] if len(parts) > 2 else 'none')

# Check if there's a /api endpoint or similar
for ep in ['/api', '/api/v1', '/api/user', '/api/score', '/api/spin', '/api/claim', '/admin', '/dashboard']:
    r = requests.get(f'{base}{ep}')
    if r.status_code != 404:
        print(f'Found: {ep} -> {r.status_code}')
        if r.text and '<' not in r.text[:10]:
            print(r.text[:300])

# Check source via .git
r = requests.get(f'{base}/.git/config')
print('\n.git/config:', r.status_code)

# Try /admin with various paths
r = requests.get(f'{base}/admin', headers={'X-Forwarded-For': '127.0.0.1'})
print('/admin (XFF):', r.status_code)