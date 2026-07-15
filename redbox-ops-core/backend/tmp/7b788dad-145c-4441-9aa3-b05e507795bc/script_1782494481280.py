import requests
url = 'https://web-random-cheese.tracebash.xyz'
session = requests.Session()
session.post(f'{url}/register', data={'username':'hack33','password':'hack33'})
login = session.post(f'{url}/login', data={'username':'hack33','password':'hack33'})
for i in range(1,11):
    r = session.post(f'{url}/spin', data={'ticket': str(i)})
    print(f'Spin {i}: {r.text}')
# Try claim with various params
r = session.post(f'{url}/claim', data={'score': 100})
print('Claim 1:', r.text[:500])
r = session.post(f'{url}/claim', data={'ticket': 'ALL'})
print('Claim 2:', r.text[:500])