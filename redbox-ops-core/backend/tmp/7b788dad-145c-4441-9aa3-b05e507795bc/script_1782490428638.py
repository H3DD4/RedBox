import requests, base64, zlib, json

base = 'https://web-random-cheese.tracebash.xyz'

s = requests.Session()
s.post(f'{base}/register', data={'username': 'testcheck', 'password': 'testcheck'}, allow_redirects=False)
s.post(f'{base}/login', data={'username': 'testcheck', 'password': 'testcheck'}, allow_redirects=False)

# Check cookie after login
cookie1 = s.cookies.get('session')
print('After login:', cookie1[:80])

# Decode it
parts = cookie1.split('.')
payload_data = parts[1] + '=' * (4 - len(parts[1]) % 4) if len(parts[1]) % 4 else parts[1]
session_json = zlib.decompress(base64.urlsafe_b64decode(payload_data))
print('Session data:', session_json)

# Do a spin
s.post(f'{base}/spin')
cookie2 = s.cookies.get('session')
print('\nAfter spin:', cookie2[:80])

if cookie1 == cookie2:
    print('Cookie UNCHANGED after spin - score stored server-side!')
else:
    parts2 = cookie2.split('.')
    payload_data2 = parts2[1] + '=' * (4 - len(parts2[1]) % 4) if len(parts2[1]) % 4 else parts2[1]
    session_json2 = zlib.decompress(base64.urlsafe_b64decode(payload_data2))
    print('New session data:', session_json2)