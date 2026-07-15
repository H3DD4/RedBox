import requests

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker900','password':'pass900'}, allow_redirects=False)
s.post(f'{base}/login', data={'username':'hacker900','password':'pass900'}, allow_redirects=False)

# Check /claim
r = s.get(f'{base}/claim')
print('GET /claim:', r.status_code, r.text[:500])
print('---')
# POST /claim
r2 = s.post(f'{base}/claim')
print('POST /claim:', r2.status_code, r2.text[:500])
print('---')
# Try with parameters
r3 = s.post(f'{base}/claim', data={'score':100})
print('POST /claim with score:', r3.status_code, r3.text[:500])
# Try /win
r4 = s.get(f'{base}/win')
print('GET /win:', r4.status_code, r4.text[:500])
r5 = s.post(f'{base}/win')
print('POST /win:', r5.status_code, r5.text[:500])