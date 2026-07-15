import requests, zlib, base64, json

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker300','password':'pass300'}, allow_redirects=False)
s.post(f'{base}/login', data={'username':'hacker300','password':'pass300'}, allow_redirects=False)

# Spin a few times
for _ in range(5):
    s.post(f'{base}/spin')

# Get the cookie
cookie = s.cookies.get('session')
print('Cookie:', cookie)
parts = cookie.split('.')
print('Parts:', len(parts))
# Payload is second part (index 1) for Flask compressed
padded = parts[1]
pad = 4 - len(padded) % 4
if pad != 4:
    padded += '=' * pad
decoded = base64.urlsafe_b64decode(padded)
try:
    if decoded[0] == 0x78:
        data = zlib.decompress(decoded)
        print('Session data:', data)
        print('Session JSON:', json.loads(data))
except Exception as e:
    print('Error:', e)
    print('Raw:', decoded)