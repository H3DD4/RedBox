import requests, sys
url = 'https://web-random-cheese.tracebash.xyz'

def test_ticket(ticket_val):
    s = requests.Session()
    s.post(f'{url}/register', data={'username':f'test{ticket_val}','password':'test'})
    s.post(f'{url}/login', data={'username':f'test{ticket_val}','password':'test'})
    r = s.post(f'{url}/spin', data={'ticket': str(ticket_val)})
    return r.json()

# Test different ticket values
for t in [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1, 99, 100]:
    try:
        result = test_ticket(t)
        sys.stdout.write(f'ticket={t}: val={result.get("val")} score={result.get("score")}\n')
    except Exception as e:
        sys.stdout.write(f'ticket={t}: ERROR - {str(e)[:50]}\n')