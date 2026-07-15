import requests

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker100','password':'pass100'}, allow_redirects=False)
s.post(f'{base}/login', data={'username':'hacker100','password':'pass100'}, allow_redirects=False)

# Spin 12 times and collect results
for i in range(12):
    r = s.post(f'{base}/spin')
    data = r.json()
    print(f'Spin {i}: {data}')
    if 'flag' in data or 'FLAG' in str(data):
        print('FLAG FOUND:', data)    
print('Final session cookie:', s.cookies.get('session'))