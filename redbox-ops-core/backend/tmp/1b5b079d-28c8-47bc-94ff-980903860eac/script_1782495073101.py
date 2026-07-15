import base64, json
s='.eJwVzDEKg1AQRdGtvLw2FrEIBHcSgoRB50dB_4SZsRL3HlNdTnN3vssiMWmwe-1EnqG6m7Ph0zZU1RGCGMwVVvC4XyEl1dHeEN-5BtIwLDKvyElx3j4X9kffcAv1KquyY2rkny2PH10DJdo'
s = s.lstrip('.')
padded = s + '=' * (4 - len(s) % 4) if len(s) % 4 else s
decoded = base64.urlsafe_b64decode(padded)
print(decoded)