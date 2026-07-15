import requests, random, string, io, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'

s = requests.Session()
name = ''.join(random.choices(string.ascii_lowercase, k=8))
r = s.post(f'{base}/register', data={'username': name, 'password': name})
r = s.post(f'{base}/login', data={'username': name, 'password': name})

# Check what pages are available after login
r = s.get(f'{base}/')
print('Dashboard keywords:', 'flag' in r.text.lower(), 'ctf' in r.text.lower(), 'congratulations' in r.text.lower())

# Settings page might show something useful
r = s.get(f'{base}/settings')
print('Settings keywords:', 'flag' in r.text.lower(), 'ctf' in r.text.lower())

# Try profile/account pages
for p in ['/profile', '/account', '/admin', '/debug', '/secret', '/flag', '/win']:
    r = s.get(f'{base}{p}')
    print(f'{p}: status={r.status_code}, len={len(r.text)}, flag={chr(10).join([l for l in r.text.split(chr(10)) if "flag" in l.lower() or "ctf" in l.lower()])[:200] if any(x in r.text.lower() for x in ["flag","ctf"]) else "none"}')
    if r.status_code != 404:
        print(r.text[:500].encode('ascii', errors='replace').decode('ascii'))

# Try to read source via static files
r = s.get(f'{base}/static/js/script.js')
print('\nJS found:', r.status_code if r.status_code != 404 else 'no')
if r.status_code == 200:
    print(r.text[:3000])