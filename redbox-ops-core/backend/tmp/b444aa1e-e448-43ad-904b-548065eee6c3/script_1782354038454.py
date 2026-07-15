import socket
import time

# Check if DNS resolves
ip = socket.gethostbyname('wily-courier.picoctf.net')
print(f'DNS resolved: {ip}')

# Quick port check
s = socket.socket()
s.settimeout(5)
try:
    s.connect(('wily-courier.picoctf.net', 49463))
    print('Port 49463 OPEN')
    s.close()
except Exception as e:
    print(f'Port 49463: {e}')

# Try with alternative curl
import subprocess
result = subprocess.run(['curl', '-s', '-m', '5', 'http://wily-courier.picoctf.net:49463/'], capture_output=True, text=True, timeout=10)
print('Curl stdout:', result.stdout[:200] if result.stdout else 'EMPTY')
print('Curl stderr:', result.stderr[:200] if result.stderr else 'NONE')