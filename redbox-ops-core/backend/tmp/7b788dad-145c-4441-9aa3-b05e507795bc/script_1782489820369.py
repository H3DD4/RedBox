import requests, base64, zlib

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker2000','password':'pass2000'}, allow_redirects=False)
s.post(f'{base}/login', data={'username':'hacker2000','password':'pass2000'}, allow_redirects=False)

# Spin 10 times
for i in range(10):
    r = s.post(f'{base}/spin')
    print(f'{i}: {r.text}')

# Claim
r = s.post(f'{base}/claim')
print('Claim status:', r.status_code)
# Ensure UTF-8 encoding for output
import sys
sys.stdout.reconfigure(encoding='utf-8')
print(r.text)

# Also check /win and /prize
for p in ['/win', '/prize']:
    for m in ['GET', 'POST']:
        if m == 'GET':
            r = s.get(f'{base}{p}')
        else:
            r = s.post(f'{base}{p}')
        print(f'{m} {p}: {r.status_code}')
        if r.status_code == 200:
            print(r.text[:500])