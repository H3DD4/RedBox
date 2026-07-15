import requests, sys

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker8000','password':'pass8000'}, allow_redirects=False)
s.post(f'{base}/login', data={'username':'hacker8000','password':'pass8000'}, allow_redirects=False)

# Get home page
r = s.get(f'{base}/')
print('Status:', r.status_code)
# Print text with utf-8 handling
print(r.text.encode('utf-8', errors='replace').decode('utf-8', errors='replace')[:4000])

# Now spin 10 times and claim
for i in range(10):
    s.post(f'{base}/spin')

# Get full claim page
r = s.post(f'{base}/claim')
print('\n=== CLAIM RESPONSE ===')
print(r.text.encode('utf-8', errors='replace').decode('utf-8', errors='replace')[:4000])

# Check if there's any hint
if 'score' in r.text.lower():
    import re
    scores = re.findall(r'(\d+)', r.text)
    print('Numbers found:', scores[:20])