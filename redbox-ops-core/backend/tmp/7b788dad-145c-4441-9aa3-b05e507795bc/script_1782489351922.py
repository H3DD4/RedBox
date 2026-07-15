import requests, base64, json, zlib

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker200','password':'pass200'}, allow_redirects=False)
r = s.post(f'{base}/login', data={'username':'hacker200','password':'pass200'}, allow_redirects=False)
print('Headers:', dict(r.headers))
print('Set-Cookie:', r.headers.get('Set-Cookie',''))
cookie = s.cookies.get('session')
print('Session cookie:', cookie)
parts = cookie.split('.')
print('Parts:', len(parts))
# Try to decode payload, might be compressed
for i, part in enumerate(parts):
    padded = part
    pad = 4 - len(padded) % 4
    if pad != 4:
        padded += '=' * pad
    try:
        decoded = base64.urlsafe_b64decode(padded)
        print(f'Part {i} raw bytes len {len(decoded)}: {decoded[:100]}')
        # Check if compressed
        if len(decoded) > 0 and decoded[0] == 0x78:
            import zlib
            decompressed = zlib.decompress(decoded)
            print(f'  Decompressed: {decompressed}')
        elif decoded.startswith(b'{') or decoded.startswith(b'['):
            print(f'  JSON: {decoded}')
    except Exception as e:
        print(f'Part {i} error: {e}')
