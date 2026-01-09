"""
멀티 계정 관리 모듈
- 여러 YouTube 계정 토큰 저장/관리
- 계정 전환 기능
- 계정별 API 자격 증명 관리
"""

import os
import json
from data_path import DATA_DIR

# 계정 데이터 저장 경로
ACCOUNTS_FILE = os.path.join(DATA_DIR, 'accounts.json')
TOKENS_DIR = os.path.join(DATA_DIR, 'tokens')
API_CREDENTIALS_DIR = os.path.join(DATA_DIR, 'api_credentials')


def ensure_tokens_dir():
    """토큰 디렉토리가 없으면 생성합니다."""
    if not os.path.exists(TOKENS_DIR):
        os.makedirs(TOKENS_DIR)


def ensure_api_credentials_dir():
    """API 자격 증명 디렉토리가 없으면 생성합니다."""
    if not os.path.exists(API_CREDENTIALS_DIR):
        os.makedirs(API_CREDENTIALS_DIR)


def load_accounts():
    """
    저장된 계정 목록을 불러옵니다.

    Returns:
        dict: {
            'accounts': [
                {'id': str, 'name': str, 'email': str, 'thumbnail': str, 'created_at': str}
            ],
            'current_account_id': str or None
        }
    """
    if os.path.exists(ACCOUNTS_FILE):
        try:
            with open(ACCOUNTS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return {
                    'accounts': data.get('accounts', []),
                    'current_account_id': data.get('current_account_id')
                }
        except Exception as e:
            print(f"계정 목록 로드 실패: {e}")

    return {'accounts': [], 'current_account_id': None}


def save_accounts(accounts_data):
    """
    계정 목록을 저장합니다.

    Args:
        accounts_data: {'accounts': [...], 'current_account_id': str}
    """
    try:
        with open(ACCOUNTS_FILE, 'w', encoding='utf-8') as f:
            json.dump(accounts_data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"계정 목록 저장 실패: {e}")
        return False


def get_account_token_path(account_id):
    """
    계정별 토큰 파일 경로를 반환합니다.

    Args:
        account_id: 계정 ID

    Returns:
        str: 토큰 파일 경로
    """
    ensure_tokens_dir()
    return os.path.join(TOKENS_DIR, f'token_{account_id}.json')


def generate_account_id():
    """
    새 계정 ID를 생성합니다.

    Returns:
        str: 고유 계정 ID
    """
    import uuid
    return str(uuid.uuid4())[:8]


def add_account(name, email, thumbnail=''):
    """
    새 계정을 추가합니다.

    Args:
        name: 계정 이름 (채널명)
        email: 이메일 또는 채널 ID
        thumbnail: 프로필 이미지 URL

    Returns:
        dict: {'success': bool, 'account_id': str, 'error': str}
    """
    from datetime import datetime

    try:
        accounts_data = load_accounts()

        # 새 계정 ID 생성
        account_id = generate_account_id()

        # 계정 정보 추가
        new_account = {
            'id': account_id,
            'name': name,
            'email': email,
            'thumbnail': thumbnail,
            'created_at': datetime.now().isoformat()
        }

        accounts_data['accounts'].append(new_account)

        # 첫 계정이면 현재 계정으로 설정
        if len(accounts_data['accounts']) == 1:
            accounts_data['current_account_id'] = account_id

        if save_accounts(accounts_data):
            return {'success': True, 'account_id': account_id}
        else:
            return {'success': False, 'error': '계정 저장 실패'}

    except Exception as e:
        return {'success': False, 'error': str(e)}


def update_account(account_id, name=None, email=None, thumbnail=None):
    """
    계정 정보를 업데이트합니다.

    Args:
        account_id: 계정 ID
        name: 새 이름 (선택)
        email: 새 이메일 (선택)
        thumbnail: 새 썸네일 (선택)

    Returns:
        dict: {'success': bool, 'error': str}
    """
    try:
        accounts_data = load_accounts()

        for account in accounts_data['accounts']:
            if account['id'] == account_id:
                if name is not None:
                    account['name'] = name
                if email is not None:
                    account['email'] = email
                if thumbnail is not None:
                    account['thumbnail'] = thumbnail

                if save_accounts(accounts_data):
                    return {'success': True}
                else:
                    return {'success': False, 'error': '계정 저장 실패'}

        return {'success': False, 'error': '계정을 찾을 수 없습니다.'}

    except Exception as e:
        return {'success': False, 'error': str(e)}


def remove_account(account_id):
    """
    계정을 삭제합니다.

    Args:
        account_id: 삭제할 계정 ID

    Returns:
        dict: {'success': bool, 'error': str}
    """
    try:
        accounts_data = load_accounts()

        # 계정 목록에서 제거
        accounts_data['accounts'] = [
            acc for acc in accounts_data['accounts']
            if acc['id'] != account_id
        ]

        # 현재 계정이 삭제된 경우 다른 계정으로 전환
        if accounts_data['current_account_id'] == account_id:
            if accounts_data['accounts']:
                accounts_data['current_account_id'] = accounts_data['accounts'][0]['id']
            else:
                accounts_data['current_account_id'] = None

        # 토큰 파일 삭제
        token_path = get_account_token_path(account_id)
        if os.path.exists(token_path):
            os.remove(token_path)

        if save_accounts(accounts_data):
            return {'success': True}
        else:
            return {'success': False, 'error': '계정 저장 실패'}

    except Exception as e:
        return {'success': False, 'error': str(e)}


def switch_account(account_id):
    """
    현재 계정을 전환합니다.

    Args:
        account_id: 전환할 계정 ID

    Returns:
        dict: {'success': bool, 'account': dict, 'error': str}
    """
    try:
        accounts_data = load_accounts()

        # 계정 존재 여부 확인
        account = None
        for acc in accounts_data['accounts']:
            if acc['id'] == account_id:
                account = acc
                break

        if not account:
            return {'success': False, 'error': '계정을 찾을 수 없습니다.'}

        # 현재 계정 변경
        accounts_data['current_account_id'] = account_id

        if save_accounts(accounts_data):
            return {'success': True, 'account': account}
        else:
            return {'success': False, 'error': '계정 저장 실패'}

    except Exception as e:
        return {'success': False, 'error': str(e)}


def get_current_account():
    """
    현재 선택된 계정 정보를 반환합니다.

    Returns:
        dict or None: 계정 정보
    """
    accounts_data = load_accounts()
    current_id = accounts_data.get('current_account_id')

    if not current_id:
        return None

    for account in accounts_data['accounts']:
        if account['id'] == current_id:
            return account

    return None


def get_current_token_path():
    """
    현재 계정의 토큰 파일 경로를 반환합니다.

    Returns:
        str or None: 토큰 파일 경로
    """
    account = get_current_account()
    if account:
        return get_account_token_path(account['id'])
    return None


def migrate_single_token():
    """
    기존 단일 token.json을 멀티 계정 시스템으로 마이그레이션합니다.

    Returns:
        dict: {'migrated': bool, 'account_id': str}
    """
    from data_path import TOKEN_FILE

    # 기존 토큰 파일이 있고, 아직 마이그레이션되지 않은 경우
    if os.path.exists(TOKEN_FILE):
        accounts_data = load_accounts()

        # 이미 계정이 있으면 마이그레이션 안 함
        if accounts_data['accounts']:
            return {'migrated': False}

        try:
            # 새 계정 생성
            account_id = generate_account_id()

            ensure_tokens_dir()

            # 토큰 파일 이동
            new_token_path = get_account_token_path(account_id)

            with open(TOKEN_FILE, 'r') as f:
                token_data = f.read()

            with open(new_token_path, 'w') as f:
                f.write(token_data)

            # 기본 계정 정보로 추가 (나중에 업데이트됨)
            accounts_data['accounts'].append({
                'id': account_id,
                'name': '기본 계정',
                'email': '',
                'thumbnail': '',
                'created_at': ''
            })
            accounts_data['current_account_id'] = account_id

            save_accounts(accounts_data)

            # 기존 토큰 파일 삭제
            os.remove(TOKEN_FILE)

            print(f"기존 토큰을 새 계정으로 마이그레이션 완료: {account_id}")
            return {'migrated': True, 'account_id': account_id}

        except Exception as e:
            print(f"토큰 마이그레이션 실패: {e}")
            return {'migrated': False}

    return {'migrated': False}


# ===== 계정별 API 자격 증명 관리 =====

def get_account_api_credentials_path(account_id):
    """계정별 API 자격 증명 파일 경로를 반환합니다."""
    ensure_api_credentials_dir()
    return os.path.join(API_CREDENTIALS_DIR, f'api_{account_id}.json')


def save_account_api_credentials(account_id, api_key, client_id, client_secret):
    """
    계정별 API 자격 증명을 저장합니다.

    Args:
        account_id: 계정 ID
        api_key: YouTube Data API v3 키
        client_id: Google OAuth Client ID
        client_secret: Google OAuth Client Secret

    Returns:
        {'success': True} 또는 {'success': False, 'error': '...'}
    """
    try:
        data = {
            'api_key': api_key,
            'client_id': client_id,
            'client_secret': client_secret
        }

        cred_file = get_account_api_credentials_path(account_id)
        with open(cred_file, 'w', encoding='utf-8') as f:
            json.dump(data, f)

        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def load_account_api_credentials(account_id):
    """
    계정별 API 자격 증명을 로드합니다.

    Args:
        account_id: 계정 ID

    Returns:
        {'success': True, 'api_key': '...', 'client_id': '...', 'client_secret': '...'} 또는
        {'success': False, 'error': '...'}
    """
    cred_file = get_account_api_credentials_path(account_id)

    if not os.path.exists(cred_file):
        return {'success': False, 'error': '저장된 API 설정이 없습니다.'}

    try:
        with open(cred_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        return {
            'success': True,
            'api_key': data.get('api_key', ''),
            'client_id': data['client_id'],
            'client_secret': data['client_secret']
        }
    except Exception as e:
        return {'success': False, 'error': f'API 설정 로드 실패: {str(e)}'}


def has_account_api_credentials(account_id):
    """계정에 저장된 API 자격 증명이 있는지 확인합니다."""
    cred_file = get_account_api_credentials_path(account_id)
    return os.path.exists(cred_file)


def delete_account_api_credentials(account_id):
    """계정의 API 자격 증명을 삭제합니다."""
    try:
        cred_file = get_account_api_credentials_path(account_id)
        if os.path.exists(cred_file):
            os.remove(cred_file)
        return True
    except Exception:
        return False
