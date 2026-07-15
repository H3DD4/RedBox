import requests
r = requests.get('http://wily-courier.picoctf.net:49463/', timeout=5)
print('Status:', r.status_code)
print('Length:', len(r.content))
print('Success' in r.text or 'X marks' in r.text)