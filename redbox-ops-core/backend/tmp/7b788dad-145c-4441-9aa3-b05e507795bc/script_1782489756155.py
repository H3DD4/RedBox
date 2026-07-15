import requests, zlib, base64, json

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker1000','password':'pass1000'}, allow_redirects=False)
s.post(f'{base}/login', data={'username':'hacker1000','password':'pass1000'}, allow_redirects=False)

# Spin 10 times
for i in range(10):
    r = s.post(f'{base}/spin')
    print(f'Spin {i}: {r.text[:100]}')

# Now try /claim
r = s.post(f'{base}/claim')
print('\n/claim response:', r.status_code)
print(r.text[:2000])

# Check cookie after
cookie = s.cookies.get('session')
if cookie:
    parts = cookie.split('.')
    if len(parts) >= 2:
        padded = parts[1] + '=' * (4 - len(parts[1]) % 4) if len(parts[1]) % 4 else parts[1]
        decoded = base64.urlsafe_b64decode(padded)
        if decoded[0] == 0x78:
            data = zlib.decompress(decoded)
            print('\nFinal session:', data.decode('utf-8', errors='replace'))
