import requests
base = 'http://wily-courier.picoctf.net:49463'

# Fresh session for each request
r0 = requests.get(base)
print('BASELINE (no x param):')
print('Length:', len(r0.content))
print(r0.text)
print('='*80)

# Now with x parameter
r = requests.get(base, params={'x': 'test'})
print('WITH x=test:')
print('Length:', len(r.content))
print(r.text)