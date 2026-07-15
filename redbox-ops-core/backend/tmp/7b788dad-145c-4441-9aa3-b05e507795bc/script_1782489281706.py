import base64, zlib, json

# The session cookie parts
cookie = 'eyJ1c2VybmFtZSI6InBsYXllcjk5OSJ9.aj6frg.YaVLEEl24fd9Fo4Pf3p1uNRxCY8'
parts = cookie.split('.')
print('Parts:', len(parts))
# Payload might be compressed or not
payload = parts[0]
# Add padding
pad = 4 - len(payload) % 4
if pad != 4:
    payload += '=' * pad
print('Payload padded:', payload)
try:
    decoded = base64.urlsafe_b64decode(payload)
    print('Decoded:', decoded)
    if decoded.startswith(b'.'):
        # compressed
        decompressed = zlib.decompress(decoded)
        print('Decompressed:', decompressed)
except Exception as e:
    print('Error:', e)