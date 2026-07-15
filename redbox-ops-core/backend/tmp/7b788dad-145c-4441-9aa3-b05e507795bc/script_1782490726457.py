import requests, base64, random, struct, time, string

base = 'https://web-random-cheese.tracebash.xyz'

# Create fresh user and get a cookie
s = requests.Session()
name = ''.join(random.choices(string.ascii_lowercase, k=8))
s.post(f'{base}/register', data={'username': name, 'password': name})
s.post(f'{base}/login', data={'username': name, 'password': name})
cookie = s.cookies.get('session')
print('Cookie:', cookie[:100])

# Parse: format is .{payload}.{timestamp}.{sig}
parts = cookie.split('.')
timestamp_b64 = parts[2]
print('Timestamp b64:', timestamp_b64)

# Decode timestamp (it's base64 encoded)
padded = timestamp_b64 + '=' * (4 - len(timestamp_b64) % 4) if len(timestamp_b64) % 4 else timestamp_b64
timestamp_bytes = base64.urlsafe_b64decode(padded)
print('Timestamp bytes:', timestamp_bytes, 'len:', len(timestamp_bytes))
print('Timestamp int:', int.from_bytes(timestamp_bytes, 'big'))

# The timestamp might be a Unix timestamp
# Get current server time
r = s.get(f'{base}/')
server_date = r.headers.get('Date')
print('Server date:', server_date)

# Try to predict: seed = server_time
import datetime
# Parse server date to timestamp
dt = datetime.datetime.strptime(server_date, '%a, %d %b %Y %H:%M:%S %Z')
server_ts = int(dt.timestamp())
print('Server timestamp:', server_ts)

# The cookie timestamp should be close to server timestamp
cookie_ts = int.from_bytes(timestamp_bytes, 'big')
print('Cookie timestamp:', cookie_ts)
print('Diff:', server_ts - cookie_ts)

# Try to simulate PRNG with this seed
def simulate_spins(seed):
    random.seed(seed)
    vals = []
    for _ in range(10):
        v = random.randint(1, 10)
        vals.append(v)
    return vals

print('\nSimulated vals with cookie_ts as seed:', simulate_spins(cookie_ts))
print('Sum:', sum(simulate_spins(cookie_ts)))

# Now actually spin and compare
s2 = requests.Session()
s2.cookies['session'] = cookie
actual_vals = []
for _ in range(10):
    r = s2.post(f'{base}/spin')
    d = r.json()
    actual_vals.append(d['val'])
print('Actual vals:', actual_vals)
print('Sum:', sum(actual_vals))