import requests
import time
for i in range(3):
    try:
        r = requests.get('http://wily-courier.picoctf.net:49463/', timeout=5)
        print(f'Attempt {i+1}: {r.status_code}, length={len(r.content)}')
        break
    except Exception as e:
        print(f'Attempt {i+1} failed: {e}')
        time.sleep(2)