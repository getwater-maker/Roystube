"""
데이터 경로 관리 모듈
- AppData/Local에 사용자 데이터 저장
- OAuth 자격증명 암호화 저장 (하이브리드 방식)
"""

import os
import sys
import json
import base64
import hashlib
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

APP_NAME = "로이의영상찾기"


def get_data_dir():
    """
    사용자 데이터 저장 경로를 반환합니다.
    Windows: C:/Users/{사용자}/AppData/Local/로이의영상찾기
    """
    if sys.platform == 'win32':
        base = os.environ.get('LOCALAPPDATA', os.path.expanduser('~'))
        data_dir = os.path.join(base, APP_NAME)
    else:
        # macOS/Linux
        data_dir = os.path.join(os.path.expanduser('~'), f'.{APP_NAME}')

    # 폴더가 없으면 생성
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)

    return data_dir


# 각 파일 경로
DATA_DIR = get_data_dir()
TOKEN_FILE = os.path.join(DATA_DIR, 'token.json')
CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')
CACHE_DIR = os.path.join(DATA_DIR, 'cache')
EXPORT_FILE = os.path.join(DATA_DIR, 'subscriptions_export.json')
CHANNEL_FILE = os.path.join(DATA_DIR, 'selected_channel.json')

# 보안 자격증명 폴더
CREDENTIALS_DIR = os.path.join(DATA_DIR, 'credentials')
CREDENTIALS_SALT_FILE = os.path.join(DATA_DIR, '.cred_salt')


def ensure_cache_dir():
    """캐시 디렉토리가 없으면 생성합니다."""
    if not os.path.exists(CACHE_DIR):
        os.makedirs(CACHE_DIR)


def ensure_credentials_dir():
    """자격증명 디렉토리가 없으면 생성합니다."""
    if not os.path.exists(CREDENTIALS_DIR):
        os.makedirs(CREDENTIALS_DIR)


def get_data_dir_path():
    """데이터 폴더 경로를 반환합니다 (UI 표시용)."""
    return DATA_DIR


# ===== 암호화 관련 함수 =====

def _get_machine_key():
    """머신 고유 키를 생성합니다 (컴퓨터별로 다른 암호화 키)."""
    import platform
    import uuid

    # 컴퓨터 고유 정보 조합
    machine_info = f"{platform.node()}-{uuid.getnode()}-{os.environ.get('USERNAME', 'user')}"
    return hashlib.sha256(machine_info.encode()).digest()


def _get_or_create_salt():
    """암호화 솔트를 가져오거나 생성합니다."""
    if os.path.exists(CREDENTIALS_SALT_FILE):
        with open(CREDENTIALS_SALT_FILE, 'rb') as f:
            return f.read()
    else:
        salt = os.urandom(16)
        with open(CREDENTIALS_SALT_FILE, 'wb') as f:
            f.write(salt)
        # 숨김 파일로 설정 (Windows)
        if sys.platform == 'win32':
            try:
                import ctypes
                ctypes.windll.kernel32.SetFileAttributesW(CREDENTIALS_SALT_FILE, 2)  # HIDDEN
            except:
                pass
        return salt


def _derive_encryption_key():
    """머신 키와 솔트로 암호화 키를 파생합니다."""
    salt = _get_or_create_salt()
    machine_key = _get_machine_key()

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(machine_key))
    return key


def encrypt_credentials(data_dict):
    """자격증명 데이터를 암호화합니다."""
    try:
        key = _derive_encryption_key()
        fernet = Fernet(key)
        encrypted = fernet.encrypt(json.dumps(data_dict).encode())
        return encrypted
    except Exception as e:
        print(f"암호화 실패: {e}")
        return None


def decrypt_credentials(encrypted_data):
    """암호화된 자격증명 데이터를 복호화합니다."""
    try:
        key = _derive_encryption_key()
        fernet = Fernet(key)
        decrypted = fernet.decrypt(encrypted_data)
        return json.loads(decrypted.decode())
    except Exception as e:
        print(f"복호화 실패: {e}")
        return None


# ===== OAuth 파일 관리 (AppData 저장) =====

def get_oauth_json_dir():
    """
    OAuth JSON 파일이 있는 폴더 경로를 반환합니다.
    우선순위: 1) AppData/credentials  2) exe 옆 json 폴더 (레거시)
    """
    ensure_credentials_dir()
    return CREDENTIALS_DIR


def get_legacy_json_dir():
    """레거시 json 폴더 경로 (exe 옆)를 반환합니다."""
    if getattr(sys, 'frozen', False):
        exe_dir = os.path.dirname(sys.executable)
    else:
        exe_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(exe_dir, 'json')


def migrate_legacy_credentials():
    """
    레거시 json 폴더의 자격증명을 AppData로 마이그레이션합니다.
    암호화하여 저장합니다.

    Returns:
        dict: {'migrated': int, 'errors': list}
    """
    legacy_dir = get_legacy_json_dir()
    result = {'migrated': 0, 'errors': []}

    if not os.path.exists(legacy_dir):
        return result

    ensure_credentials_dir()

    for filename in os.listdir(legacy_dir):
        if filename.endswith('_OAuth.json'):
            try:
                legacy_path = os.path.join(legacy_dir, filename)

                # OAuth 파일 읽기
                with open(legacy_path, 'r', encoding='utf-8') as f:
                    oauth_data = json.load(f)

                # 암호화하여 저장
                name_part = filename.replace('_OAuth.json', '')
                encrypted_path = os.path.join(CREDENTIALS_DIR, f'{name_part}_OAuth.enc')

                if not os.path.exists(encrypted_path):
                    encrypted = encrypt_credentials(oauth_data)
                    if encrypted:
                        with open(encrypted_path, 'wb') as f:
                            f.write(encrypted)
                        result['migrated'] += 1
                        print(f"마이그레이션 완료: {filename}")

                # 토큰 파일도 마이그레이션
                token_filename = f'{name_part}_token.json'
                legacy_token_path = os.path.join(legacy_dir, token_filename)

                if os.path.exists(legacy_token_path):
                    with open(legacy_token_path, 'r', encoding='utf-8') as f:
                        token_data = json.load(f)

                    encrypted_token_path = os.path.join(CREDENTIALS_DIR, f'{name_part}_token.enc')
                    if not os.path.exists(encrypted_token_path):
                        encrypted_token = encrypt_credentials(token_data)
                        if encrypted_token:
                            with open(encrypted_token_path, 'wb') as f:
                                f.write(encrypted_token)
                            print(f"토큰 마이그레이션 완료: {token_filename}")

            except Exception as e:
                result['errors'].append(f"{filename}: {str(e)}")

    return result


def get_available_oauth_files():
    """
    사용 가능한 OAuth 계정 목록을 반환합니다.
    AppData의 암호화된 파일과 레거시 폴더 모두 확인합니다.

    Returns:
        list: [{'name': '표시 이름', 'file': '파일명', 'email': '이메일', 'hasToken': bool, 'encrypted': bool}, ...]
    """
    oauth_files = []
    seen_accounts = set()

    # 1. AppData 암호화된 파일 확인
    ensure_credentials_dir()
    if os.path.exists(CREDENTIALS_DIR):
        for filename in os.listdir(CREDENTIALS_DIR):
            if filename.endswith('_OAuth.enc'):
                name_part = filename.replace('_OAuth.enc', '')

                if name_part in seen_accounts:
                    continue
                seen_accounts.add(name_part)

                parts = name_part.split('_')
                display_name = parts[0] if parts else name_part
                email_hint = parts[1] if len(parts) >= 2 else ''

                # 토큰 파일 확인
                token_path = os.path.join(CREDENTIALS_DIR, f'{name_part}_token.enc')
                has_token = os.path.exists(token_path)

                oauth_files.append({
                    'name': display_name,
                    'file': f'{name_part}_OAuth.enc',
                    'email': email_hint,
                    'display': f"{display_name} ({email_hint})" if email_hint else display_name,
                    'hasToken': has_token,
                    'tokenFile': f'{name_part}_token.enc',
                    'encrypted': True,
                    'namePart': name_part
                })

    # 2. 레거시 json 폴더 확인 (암호화되지 않은 파일)
    legacy_dir = get_legacy_json_dir()
    if os.path.exists(legacy_dir):
        for filename in os.listdir(legacy_dir):
            if filename.endswith('_OAuth.json'):
                name_part = filename.replace('_OAuth.json', '')

                if name_part in seen_accounts:
                    continue
                seen_accounts.add(name_part)

                parts = name_part.split('_')
                display_name = parts[0] if parts else name_part
                email_hint = parts[1] if len(parts) >= 2 else ''

                token_path = os.path.join(legacy_dir, f'{name_part}_token.json')
                has_token = os.path.exists(token_path)

                oauth_files.append({
                    'name': display_name,
                    'file': filename,
                    'email': email_hint,
                    'display': f"{display_name} ({email_hint})" if email_hint else display_name,
                    'hasToken': has_token,
                    'tokenFile': f'{name_part}_token.json',
                    'encrypted': False,
                    'namePart': name_part
                })

    return oauth_files


def load_oauth_credentials(name_part):
    """
    OAuth 자격증명을 로드합니다 (암호화/비암호화 자동 감지).
    채널명이 변경되어도 이메일 ID로 파일을 찾습니다.

    Args:
        name_part: 계정 이름 (예: '득수_getwater' 또는 'getwater')

    Returns:
        dict: OAuth 데이터 또는 None
    """
    # 파일 확장자가 포함된 경우 제거
    if name_part.endswith('_OAuth.enc'):
        name_part = name_part.replace('_OAuth.enc', '')
    elif name_part.endswith('_OAuth.json'):
        name_part = name_part.replace('_OAuth.json', '')

    # name_part에서 이메일 ID 추출 (채널명_이메일ID 형식인 경우)
    parts = name_part.split('_')
    email_id = parts[-1] if len(parts) >= 2 else parts[0]

    # 1. 정확한 이름으로 암호화된 파일 확인
    encrypted_path = os.path.join(CREDENTIALS_DIR, f'{name_part}_OAuth.enc')
    if os.path.exists(encrypted_path):
        try:
            with open(encrypted_path, 'rb') as f:
                encrypted_data = f.read()
            return decrypt_credentials(encrypted_data)
        except Exception as e:
            print(f"암호화된 OAuth 로드 실패: {e}")

    # 2. 이메일 ID로 암호화된 파일 검색 (채널명이 변경된 경우)
    if os.path.exists(CREDENTIALS_DIR):
        for filename in os.listdir(CREDENTIALS_DIR):
            if filename.endswith('_OAuth.enc'):
                file_name_part = filename.replace('_OAuth.enc', '')
                file_parts = file_name_part.split('_')
                file_email_id = file_parts[-1] if len(file_parts) >= 2 else file_parts[0]

                if file_email_id == email_id:
                    try:
                        with open(os.path.join(CREDENTIALS_DIR, filename), 'rb') as f:
                            encrypted_data = f.read()
                        print(f"이메일 ID '{email_id}'로 파일 찾음: {filename}")
                        return decrypt_credentials(encrypted_data)
                    except Exception as e:
                        print(f"암호화된 OAuth 로드 실패: {e}")

    # 3. 정확한 이름으로 레거시 파일 확인
    legacy_path = os.path.join(get_legacy_json_dir(), f'{name_part}_OAuth.json')
    if os.path.exists(legacy_path):
        try:
            with open(legacy_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"레거시 OAuth 로드 실패: {e}")

    # 4. 이메일 ID로 레거시 파일 검색 (채널명이 변경된 경우)
    legacy_dir = get_legacy_json_dir()
    if os.path.exists(legacy_dir):
        for filename in os.listdir(legacy_dir):
            if filename.endswith('_OAuth.json'):
                file_name_part = filename.replace('_OAuth.json', '')
                file_parts = file_name_part.split('_')
                file_email_id = file_parts[-1] if len(file_parts) >= 2 else file_parts[0]

                if file_email_id == email_id:
                    try:
                        with open(os.path.join(legacy_dir, filename), 'r', encoding='utf-8') as f:
                            print(f"이메일 ID '{email_id}'로 레거시 파일 찾음: {filename}")
                            return json.load(f)
                    except Exception as e:
                        print(f"레거시 OAuth 로드 실패: {e}")

    return None


def load_token_credentials(name_part):
    """
    토큰 데이터를 로드합니다.
    채널명이 변경되어도 이메일 ID로 파일을 찾습니다.
    """
    # 파일 확장자가 포함된 경우 제거
    if name_part.endswith('_OAuth.enc'):
        name_part = name_part.replace('_OAuth.enc', '')
    elif name_part.endswith('_OAuth.json'):
        name_part = name_part.replace('_OAuth.json', '')
    elif name_part.endswith('_token.enc'):
        name_part = name_part.replace('_token.enc', '')
    elif name_part.endswith('_token.json'):
        name_part = name_part.replace('_token.json', '')

    # name_part에서 이메일 ID 추출
    parts = name_part.split('_')
    email_id = parts[-1] if len(parts) >= 2 else parts[0]

    # 1. 정확한 이름으로 암호화된 파일 확인
    encrypted_path = os.path.join(CREDENTIALS_DIR, f'{name_part}_token.enc')
    if os.path.exists(encrypted_path):
        try:
            with open(encrypted_path, 'rb') as f:
                encrypted_data = f.read()
            return decrypt_credentials(encrypted_data)
        except Exception as e:
            print(f"암호화된 토큰 로드 실패: {e}")

    # 2. 이메일 ID로 암호화된 파일 검색 (채널명이 변경된 경우)
    if os.path.exists(CREDENTIALS_DIR):
        for filename in os.listdir(CREDENTIALS_DIR):
            if filename.endswith('_token.enc'):
                file_name_part = filename.replace('_token.enc', '')
                file_parts = file_name_part.split('_')
                file_email_id = file_parts[-1] if len(file_parts) >= 2 else file_parts[0]

                if file_email_id == email_id:
                    try:
                        with open(os.path.join(CREDENTIALS_DIR, filename), 'rb') as f:
                            encrypted_data = f.read()
                        print(f"이메일 ID '{email_id}'로 토큰 파일 찾음: {filename}")
                        return decrypt_credentials(encrypted_data)
                    except Exception as e:
                        print(f"암호화된 토큰 로드 실패: {e}")

    # 3. 정확한 이름으로 레거시 파일 확인
    legacy_path = os.path.join(get_legacy_json_dir(), f'{name_part}_token.json')
    if os.path.exists(legacy_path):
        try:
            with open(legacy_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"레거시 토큰 로드 실패: {e}")

    # 4. 이메일 ID로 레거시 파일 검색 (채널명이 변경된 경우)
    legacy_dir = get_legacy_json_dir()
    if os.path.exists(legacy_dir):
        for filename in os.listdir(legacy_dir):
            if filename.endswith('_token.json'):
                file_name_part = filename.replace('_token.json', '')
                file_parts = file_name_part.split('_')
                file_email_id = file_parts[-1] if len(file_parts) >= 2 else file_parts[0]

                if file_email_id == email_id:
                    try:
                        with open(os.path.join(legacy_dir, filename), 'r', encoding='utf-8') as f:
                            print(f"이메일 ID '{email_id}'로 레거시 토큰 파일 찾음: {filename}")
                            return json.load(f)
                    except Exception as e:
                        print(f"레거시 토큰 로드 실패: {e}")

    return None


def save_token_credentials(name_part, token_data):
    """토큰 데이터를 암호화하여 저장합니다."""
    ensure_credentials_dir()

    try:
        # 문자열이면 JSON으로 파싱
        if isinstance(token_data, str):
            token_dict = json.loads(token_data)
        else:
            token_dict = token_data

        encrypted = encrypt_credentials(token_dict)
        if encrypted:
            encrypted_path = os.path.join(CREDENTIALS_DIR, f'{name_part}_token.enc')
            with open(encrypted_path, 'wb') as f:
                f.write(encrypted)
            return True
    except Exception as e:
        print(f"토큰 저장 실패: {e}")

    return False


def delete_token_credentials(name_part):
    """토큰을 삭제합니다."""
    # 암호화된 토큰 삭제
    encrypted_path = os.path.join(CREDENTIALS_DIR, f'{name_part}_token.enc')
    if os.path.exists(encrypted_path):
        os.remove(encrypted_path)

    # 레거시 토큰 삭제
    legacy_path = os.path.join(get_legacy_json_dir(), f'{name_part}_token.json')
    if os.path.exists(legacy_path):
        os.remove(legacy_path)


def get_token_path_for_oauth(oauth_filename):
    """
    OAuth 파일명에 대응하는 토큰 파일 경로를 반환합니다.
    (레거시 호환용 - 새 시스템에서는 save_token_credentials 사용)
    """
    # .enc 파일인 경우
    if oauth_filename.endswith('.enc'):
        name_part = oauth_filename.replace('_OAuth.enc', '')
        return os.path.join(CREDENTIALS_DIR, f'{name_part}_token.enc')

    # 레거시 .json 파일인 경우
    json_dir = get_legacy_json_dir()
    name_part = oauth_filename.replace('_OAuth.json', '')
    token_filename = name_part + '_token.json'
    return os.path.join(json_dir, token_filename)


# ===== 자격증명 내보내기/가져오기 =====

def export_credentials_to_file(export_path, password):
    """
    모든 자격증명을 암호화하여 파일로 내보냅니다.

    Args:
        export_path: 내보낼 파일 경로
        password: 암호화 비밀번호

    Returns:
        dict: {'success': bool, 'count': int, 'error': str}
    """
    try:
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

        all_credentials = []

        # 모든 OAuth 파일 수집
        oauth_files = get_available_oauth_files()

        for oauth_file in oauth_files:
            name_part = oauth_file['namePart']

            # OAuth 데이터 로드
            oauth_data = load_oauth_credentials(name_part)
            if oauth_data:
                entry = {
                    'name_part': name_part,
                    'oauth': oauth_data,
                    'token': None
                }

                # 토큰 데이터 로드
                if oauth_file['hasToken']:
                    token_data = load_token_credentials(name_part)
                    if token_data:
                        entry['token'] = token_data

                all_credentials.append(entry)

        if not all_credentials:
            return {'success': False, 'error': '내보낼 자격증명이 없습니다.'}

        # 비밀번호로 암호화
        salt = os.urandom(16)
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
        fernet = Fernet(key)

        encrypted = fernet.encrypt(json.dumps(all_credentials).encode())

        # 파일 저장 (솔트 + 암호화 데이터)
        with open(export_path, 'wb') as f:
            f.write(salt + b'\n' + encrypted)

        return {'success': True, 'count': len(all_credentials)}

    except Exception as e:
        return {'success': False, 'error': str(e)}


def import_credentials_from_file(import_path, password):
    """
    파일에서 자격증명을 가져옵니다.

    Args:
        import_path: 가져올 파일 경로
        password: 복호화 비밀번호

    Returns:
        dict: {'success': bool, 'count': int, 'error': str}
    """
    try:
        with open(import_path, 'rb') as f:
            content = f.read()

        # 솔트와 데이터 분리
        parts = content.split(b'\n', 1)
        if len(parts) != 2:
            return {'success': False, 'error': '파일 형식이 올바르지 않습니다.'}

        salt = parts[0]
        encrypted = parts[1]

        # 복호화
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
        fernet = Fernet(key)

        try:
            decrypted = fernet.decrypt(encrypted)
            all_credentials = json.loads(decrypted.decode())
        except:
            return {'success': False, 'error': '비밀번호가 일치하지 않습니다.'}

        # 자격증명 저장
        ensure_credentials_dir()
        imported_count = 0

        for entry in all_credentials:
            name_part = entry['name_part']

            # OAuth 저장
            if entry.get('oauth'):
                encrypted_oauth = encrypt_credentials(entry['oauth'])
                if encrypted_oauth:
                    oauth_path = os.path.join(CREDENTIALS_DIR, f'{name_part}_OAuth.enc')
                    with open(oauth_path, 'wb') as f:
                        f.write(encrypted_oauth)

            # 토큰 저장
            if entry.get('token'):
                encrypted_token = encrypt_credentials(entry['token'])
                if encrypted_token:
                    token_path = os.path.join(CREDENTIALS_DIR, f'{name_part}_token.enc')
                    with open(token_path, 'wb') as f:
                        f.write(encrypted_token)

            imported_count += 1

        return {'success': True, 'count': imported_count}

    except Exception as e:
        return {'success': False, 'error': str(e)}
