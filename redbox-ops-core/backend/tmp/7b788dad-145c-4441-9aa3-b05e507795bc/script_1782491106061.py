import requests, sys, re
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'

s = requests.Session()
s.post(f'{base}/register', data={'username':'hack008','password':'hack008'})
s.post(f'{base}/login', data={'username':'hack008','password':'hack008'})

# Get the HTML to extract all JS code
r = s.get(f'{base}/')
html = r.text

# Print the full HTML to see claim endpoint and params
print('=== FULL HTML ===')
print(html)
print('=== END HTML ===')

# The claim form might include hidden fields or specific format