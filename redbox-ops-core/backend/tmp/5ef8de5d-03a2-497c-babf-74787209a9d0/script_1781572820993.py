import requests
r = requests.post('http://saturn.picoctf.net:58885/data', data={'ID': '{{7*7}}'})
print('Status:', r.status_code)
print('Headers:', dict(r.headers))
print('Body:', repr(r.text))