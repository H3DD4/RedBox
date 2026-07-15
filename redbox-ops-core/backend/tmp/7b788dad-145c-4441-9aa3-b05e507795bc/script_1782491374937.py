import requests, sys, re, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'

# Wait for rate limit to reset
print('Waiting 60s for rate limit...')
time.sleep(60)

# Try seed 0 and 1000 carefully
for seed in [0, 1000]:
    s = requests.Session()
    name = f'tseed{seed}'
    s.post(f'{base}/register', data={'username': name, 'password': name})
    s.post(f'{base}/login', data={'username': name, 'password': name})
    
    r = s.post(f'{base}/update_lucky', data={'lucky_number': str(seed)})
    print(f'Seed {seed}: update status {r.status_code}')
    
    if r.status_code == 200:
        # Get home page to see if settings updated
        r = s.get(f'{base}/')
        if 'Current Lucky Number: 0' in r.text or 'Current Lucky Number: 1000' in r.text:
            print(f'Settings updated successfully!')
        
        for i in range(10):
            r = s.post(f'{base}/spin')
            print(f'  Spin {i}: status={r.status_code}, body={r.text[:200]}')
            try:
                j = r.json()
                print(f'    JSON: {j}')
            except:
                print(f'    Not JSON')
        
        # Try claim
        r = s.post(f'{base}/claim')
        print(f'Claim: status={r.status_code}, url={r.url}')
        print(f'  Body: {r.text[:500]}')
    time.sleep(2)