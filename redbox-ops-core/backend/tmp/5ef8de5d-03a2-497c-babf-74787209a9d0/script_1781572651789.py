import requests
r = requests.get('http://saturn.picoctf.net:58885/')
print(r.text)