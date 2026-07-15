import requests, base64, zlib, json

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker700','password':'pass700'}, allow_redirects=False)
s.post(f'{base}/login', data={'username':'hacker700','password':'pass700'}, allow_redirects=False)

# Spin 10 times
for i in range(10):
    r = s.post(f'{base}/spin')
    print(f'Spin {i}: {r.json()}')

# Check the session cookie after all spins
cookie = s.cookies.get('session')
print('\nFinal cookie:', cookie)
parts = cookie.split('.')
padded = parts[1] + '=' * (4 - len(parts[1]) % 4) if len(parts[1]) % 4 else parts[1]
decoded = base64.urlsafe_b64decode(padded)
if decoded[0] == 0x78:
    data = zlib.decompress(decoded)
    print('Session data:', data)
    print('JSON:', json.dumps(json.loads(data), indent=2))