import requests

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker500','password':'pass500'}, allow_redirects=False)
s.post(f'{base}/login', data={'username':'hacker500','password':'pass500'}, allow_redirects=False)

# First normal spin
r = s.post(f'{base}/spin')
print('Normal:', r.text)

# Try spin with val parameter
r2 = s.post(f'{base}/spin', data={'val':85})
print('With val=85:', r2.text)

# Try spin with score parameter
r3 = s.post(f'{base}/spin', data={'score':100})
print('With score=100:', r3.text)

# Try GET with params
r4 = s.get(f'{base}/spin?val=90')
print('GET with val=90:', r4.text)

# Try different content type
r5 = s.post(f'{base}/spin', json={'val':90})
print('JSON with val=90:', r5.text)