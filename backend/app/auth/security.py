import hashlib
import hmac
import os
import json
import base64
import time
from typing import Optional, Dict, Any
from backend.app.config import SECRET_KEY, ACCESS_TOKEN_EXPIRE_MINUTES

# ---------------------------------------------------------------------------
# Cryptographic Password Hashing (PBKDF2-HMAC-SHA256)
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    """
    Hashes a plaintext password using PBKDF2-HMAC-SHA256 with a secure 16-byte salt
    and 100,000 iterations. Format: pbkdf2:sha256:100000$<salt_hex>$<hash_hex>
    """
    if not password:
        raise ValueError("Password cannot be empty")
    salt = os.urandom(16)
    iterations = 100000
    derived = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    return f"pbkdf2:sha256:{iterations}${salt.hex()}${derived.hex()}"

def verify_password(password: str, password_hash: str) -> bool:
    """
    Verifies a plaintext password against a stored PBKDF2 hash using constant-time comparison.
    """
    if not password or not password_hash:
        return False
    try:
        if not password_hash.startswith("pbkdf2:sha256:"):
            # Safe fallback for legacy or direct sha256 hashes if any
            return False
        parts = password_hash.split("$")
        if len(parts) != 3:
            return False
        prefix, salt_hex, hash_hex = parts
        iterations = int(prefix.split(":")[2])
        salt = bytes.fromhex(salt_hex)
        expected_hash = bytes.fromhex(hash_hex)
        actual_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
        return hmac.compare_digest(actual_hash, expected_hash)
    except Exception:
        return False

# ---------------------------------------------------------------------------
# Stateless HMAC-Signed Authentication Token Engine
# ---------------------------------------------------------------------------

def _b64_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode('utf-8').rstrip('=')

def _b64_decode(data: str) -> bytes:
    padding = '=' * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)

def create_access_token(payload: Dict[str, Any], expires_delta_minutes: Optional[int] = None) -> str:
    """
    Creates a secure, tamper-proof HMAC-SHA256 signed access token.
    """
    expire_minutes = expires_delta_minutes if expires_delta_minutes is not None else ACCESS_TOKEN_EXPIRE_MINUTES
    now = int(time.time())
    exp = now + (expire_minutes * 60)
    
    token_payload = {
        **payload,
        "iat": now,
        "exp": exp
    }
    
    header = {"alg": "HS256", "typ": "JWT"}
    encoded_header = _b64_encode(json.dumps(header).encode('utf-8'))
    encoded_payload = _b64_encode(json.dumps(token_payload).encode('utf-8'))
    
    signature_input = f"{encoded_header}.{encoded_payload}".encode('utf-8')
    signature = hmac.new(SECRET_KEY.encode('utf-8'), signature_input, hashlib.sha256).digest()
    encoded_signature = _b64_encode(signature)
    
    return f"{encoded_header}.{encoded_payload}.{encoded_signature}"

def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Decodes and verifies an access token. Returns payload if valid and unexpired; None otherwise.
    """
    if not token or token.count('.') != 2:
        return None
    try:
        encoded_header, encoded_payload, encoded_signature = token.split('.')
        signature_input = f"{encoded_header}.{encoded_payload}".encode('utf-8')
        expected_signature = hmac.new(SECRET_KEY.encode('utf-8'), signature_input, hashlib.sha256).digest()
        actual_signature = _b64_decode(encoded_signature)
        
        if not hmac.compare_digest(actual_signature, expected_signature):
            return None
        
        payload = json.loads(_b64_decode(encoded_payload).decode('utf-8'))
        now = int(time.time())
        if payload.get("exp", 0) < now:
            return None
        return payload
    except Exception:
        return None
