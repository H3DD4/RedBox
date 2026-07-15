import requests, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'

# Test what happens with edge case inputs for lucky_number
s = requests.Session()
s.post(f'{base}/register', data={'username':'edge001','password':'edge001'})
s.post(f'{base}/login', data={'username':'edge001','password':'edge001'})

# Try various edge cases
payloads = [
    '0',
    '-1',
    '9999999',
    '1.5',
    '0.0000001',
    '2147483647',  # INT_MAX
    '-2147483648', # INT_MIN
    '999',  # Normal, good baseline
    'abc',
    '',
    '__proto__',
    'constructor',
]

for p in payloads:
    r = s.post(f'{base}/update_lucky', data={'lucky_number': p})
    if r.status_code == 200:
        # Spin once and see the response
        r2 = s.post(f'{base}/spin')
        try:
            j = r2.json()
            print(f'Payload {repr(p)}: spin={j}')
        except:
            print(f'Payload {repr(p)}: HTTP {r2.status_code}, body={r2.text[:200]}')
    else:
        print(f'Payload {repr(p)}: Update returned {r.status_code}')
        if 'too long' not in r.text:
            print(f'  Body: {r.text[:200]}')