import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(5)
s.connect(('wily-courier.picoctf.net', 49463))
msg = b'POST / HTTP/1.1\r\nHost: wily-courier.picoctf.net:49463\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 21\r\n\r\nname=admin&pass=test'
s.sendall(msg)
resp = s.recv(4096)
print(resp.decode())
s.close()