import requests

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker7000','password':'pass7000'}, allow_redirects=False)
s.post(f'{base}/login', data={'username':'hacker7000','password':'pass7000'}, allow_redirects=False)

# Get dashboard for authenticated user
r = s.get(f'{base}/')
print('Dashboard status:', r.status_code)
# Print full response
sys.stdout.reconfigure(encoding='utf-8')
print(r.text[:3000])