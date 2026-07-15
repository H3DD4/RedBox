import urllib.request, urllib.parse, http.cookiejar
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
# Login first
login_data = urllib.parse.urlencode({'username': 'testuser123', 'password': 'testpass123'}).encode()
req1 = urllib.request.Request('https://web-random-cheese.tracebash.xyz/login', data=login_data, method='POST')
resp1 = opener.open(req1)
print('Login response:', resp1.status, resp1.reason)
print('Cookies:', list(cj))
# Try spin
req2 = urllib.request.Request('https://web-random-cheese.tracebash.xyz/spin', data=b'ticket=1', method='POST')
resp2 = opener.open(req2)
print('Spin response:', resp2.status)
print('Body:', resp2.read().decode()[:500])
