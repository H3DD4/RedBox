import requests

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker800','password':'pass800'}, allow_redirects=False)
s.post(f'{base}/login', data={'username':'hacker800','password':'pass800'}, allow_redirects=False)

# Try various endpoints
endpoints = ['/claim', '/prize', '/redeem', '/reward', '/win', '/grand_meal', '/grandmeal', '/gift', '/coupon', '/voucher', '/draw', '/lucky', '/jackpot', '/check', '/verify', '/result', '/final', '/submit', '/score', '/enter', '/play', '/bonus', '/extra', '/cheese', '/shop', '/order', '/purchase', '/buy', '/cart', '/checkout', '/payment', '/pay']
for ep in endpoints:
    for method in ['GET', 'POST']:
        try:
            if method == 'GET':
                r = s.get(f'{base}{ep}')
            else:
                r = s.post(f'{base}{ep}')
            if r.status_code not in [404, 405]:
                print(f'{method} {ep}: {r.status_code} {r.text[:200]}')
        except:
            pass