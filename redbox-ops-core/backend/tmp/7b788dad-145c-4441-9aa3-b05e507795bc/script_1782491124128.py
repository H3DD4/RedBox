import requests, sys, re
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'

s = requests.Session()
s.post(f'{base}/register', data={'username':'hack009','password':'hack009'})
s.post(f'{base}/login', data={'username':'hack009','password':'hack009'})

# Check settings
r = s.get(f'{base}/settings')
print('=== SETTINGS ===')
print(r.text[:3000] if 'html' in r.text[:100].lower() else r.text)

# The JS reveals: spin sends POST to /spin, response has val (1-10)
# After 10 spins, if total >= 85, claim btn is enabled
# The val in JS: let val = data.val; let targetAngle = -((val - 1) * 36);
# So val 1=egg(0deg), val 2=donut(-36deg) ... val 10=cheese(-324deg)
# 
# PRNG - let me check the menu items to understand values

# Also try /spin with GET to see more info
r = s.get(f'{base}/spin')
print('\n=== SPIN GET ===')
print(r.text[:500])

# Try to check if there's an API endpoint
for path in ['/api/spin', '/api/claim', '/api/score', '/api/flags', '/api/flag',
             '/admin', '/admin/flag', '/debug', '/test', '/health', '/status',
             '/api', '/reset']:
    r = s.get(f'{base}{path}')
    if r.status_code != 404 and r.status_code != 302:
        print(f'\n=== {path} (HTTP {r.status_code}) ===')
        print(r.text[:500])