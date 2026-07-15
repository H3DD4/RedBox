import requests, time

session = 'eyJ1c2VybmFtZSI6ImhhY2tlcjk5In0.aj64cw.XlxKyaRYfuZEkPTci5k50VSLSW4'
base = 'https://web-random-cheese.tracebash.xyz'

# Set lucky number to 85
r = requests.post(f'{base}/update_lucky', data={'lucky_number': 85}, cookies={'session': session})
# Use fresh session
r = requests.post(f'{base}/spin', cookies={'session': session})
print('Spin after lucky=85:', r.text)

# Set to 100
r = requests.post(f'{base}/update_lucky', data={'lucky_number': 100}, cookies={'session': session})
r = requests.post(f'{base}/spin', cookies={'session': session})
print('Spin after lucky=100:', r.text)

# Set to 1
r = requests.post(f'{base}/update_lucky', data={'lucky_number': 1}, cookies={'session': session})
r = requests.post(f'{base}/spin', cookies={'session': session})
print('Spin after lucky=1:', r.text)