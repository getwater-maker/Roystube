"""
보안 설정 관리 모듈
- Client ID/Secret 암호화 저장
- 비밀번호 기반 암호화
"""

import os
import json
import base64
import hashlib
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from data_path import DATA_DIR

SECURE_CONFIG_FILE = os.path.join(DATA_DIR, 'secure_config.dat')
SALT_FILE = os.path.join(DATA_DIR, '.salt')


def _get_or_create_salt():
    """솔트를 가져오거나 생성합니다."""
    if os.path.exists(SALT_FILE):
        with open(SALT_FILE, 'rb') as f:
            return f.read()
    else:
        salt = os.urandom(16)
        with open(SALT_FILE, 'wb') as f:
            f.write(salt)
        return salt


def _derive_key(password: str) -> bytes:
    """비밀번호에서 암호화 키를 파생합니다."""
    salt = _get_or_create_salt()
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
    return key


def _hash_password(password: str) -> str:
    """비밀번호 해시를 생성합니다 (검증용)."""
    salt = _get_or_create_salt()
    return hashlib.sha256(salt + password.encode()).hexdigest()


def save_secure_config(client_id: str, client_secret: str, password: str) -> dict:
    """
    Client ID와 Secret을 암호화하여 저장합니다.

    Args:
        client_id: Google OAuth Client ID
        client_secret: Google OAuth Client Secret
        password: 암호화에 사용할 비밀번호

    Returns:
        {'success': True} 또는 {'success': False, 'error': '...'}
    """
    try:
        key = _derive_key(password)
        fernet = Fernet(key)

        data = {
            'client_id': client_id,
            'client_secret': client_secret
        }

        encrypted = fernet.encrypt(json.dumps(data).encode())
        password_hash = _hash_password(password)

        with open(SECURE_CONFIG_FILE, 'wb') as f:
            # 비밀번호 해시(64바이트) + 암호화된 데이터
            f.write(password_hash.encode() + b'\n' + encrypted)

        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def load_secure_config(password: str) -> dict:
    """
    암호화된 설정을 복호화하여 반환합니다.

    Args:
        password: 복호화에 사용할 비밀번호

    Returns:
        {'success': True, 'client_id': '...', 'client_secret': '...'} 또는
        {'success': False, 'error': '...'}
    """
    if not os.path.exists(SECURE_CONFIG_FILE):
        return {'success': False, 'error': '저장된 설정이 없습니다.'}

    try:
        with open(SECURE_CONFIG_FILE, 'rb') as f:
            content = f.read()

        # 비밀번호 해시와 암호화 데이터 분리
        parts = content.split(b'\n', 1)
        if len(parts) != 2:
            return {'success': False, 'error': '설정 파일이 손상되었습니다.'}

        stored_hash = parts[0].decode()
        encrypted = parts[1]

        # 비밀번호 검증
        if _hash_password(password) != stored_hash:
            return {'success': False, 'error': '비밀번호가 일치하지 않습니다.'}

        # 복호화
        key = _derive_key(password)
        fernet = Fernet(key)
        decrypted = fernet.decrypt(encrypted)
        data = json.loads(decrypted.decode())

        return {
            'success': True,
            'client_id': data['client_id'],
            'client_secret': data['client_secret']
        }
    except Exception as e:
        return {'success': False, 'error': f'복호화 실패: {str(e)}'}


def has_secure_config() -> bool:
    """저장된 보안 설정이 있는지 확인합니다."""
    return os.path.exists(SECURE_CONFIG_FILE)


def delete_secure_config() -> bool:
    """저장된 보안 설정을 삭제합니다."""
    try:
        if os.path.exists(SECURE_CONFIG_FILE):
            os.remove(SECURE_CONFIG_FILE)
        return True
    except Exception:
        return False


def verify_password(password: str) -> bool:
    """비밀번호가 맞는지 확인합니다."""
    if not os.path.exists(SECURE_CONFIG_FILE):
        return False

    try:
        with open(SECURE_CONFIG_FILE, 'rb') as f:
            content = f.read()

        parts = content.split(b'\n', 1)
        if len(parts) != 2:
            return False

        stored_hash = parts[0].decode()
        return _hash_password(password) == stored_hash
    except Exception:
        return False
