import socket
import time

for i in range(5):
    try:
        s = socket.socket()
        s.settimeout(4)
        s.connect(('wily-courier.picoctf.net', 49463))
        s.close()
        print('SERVER IS UP!')
        break
    except:
        print(f'Attempt {i+1}/5: Connection refused')
        if i < 4:
            time.sleep(10)
else:
    print('Server still down.')
