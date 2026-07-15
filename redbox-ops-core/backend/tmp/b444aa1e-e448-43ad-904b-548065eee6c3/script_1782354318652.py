import socket, time

# Poll server status every 5 seconds, up to 30 seconds
for i in range(6):
    s = socket.socket()
    s.settimeout(3)
    try:
        s.connect(('wily-courier.picoctf.net', 49463))
        print('Server UP!')
        s.close()
        break
    except:
        print(f'Attempt {i+1}: Server down, waiting...')
        time.sleep(5)
else:
    print('Server still unavailable')
