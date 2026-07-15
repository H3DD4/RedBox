import socket
s = socket.socket()
s.settimeout(10)
try:
    s.connect(('wily-courier.picoctf.net', 49463))
    print('Server UP!')
    s.close()
except Exception as e:
    print(f'Server DOWN: {e}')
