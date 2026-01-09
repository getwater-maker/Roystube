# YouTube API 설정
# 각 계정은 자신만의 API 자격 증명을 가집니다.
# 런타임에 현재 계정의 API가 설정됩니다.

# 앱 버전
APP_VERSION = "2.1.0"
APP_NAME = "로이의 영상찾기"

# 현재 활성화된 API 자격 증명 (런타임에 계정별로 설정됨)
_current_api_key = None
_current_client_id = None
_current_client_secret = None


def get_api_key():
    """현재 활성 API 키를 반환합니다."""
    return _current_api_key


def get_client_id():
    """현재 활성 Client ID를 반환합니다."""
    return _current_client_id


def get_client_secret():
    """현재 활성 Client Secret을 반환합니다."""
    return _current_client_secret


def set_current_credentials(api_key, client_id, client_secret):
    """현재 세션의 API 자격 증명을 설정합니다."""
    global _current_api_key, _current_client_id, _current_client_secret
    _current_api_key = api_key
    _current_client_id = client_id
    _current_client_secret = client_secret


def clear_current_credentials():
    """현재 세션의 API 자격 증명을 초기화합니다."""
    global _current_api_key, _current_client_id, _current_client_secret
    _current_api_key = None
    _current_client_id = None
    _current_client_secret = None


def is_configured():
    """API 설정이 완료되었는지 확인합니다. OAuth만 있어도 로그인 가능."""
    # OAuth (client_id, client_secret)만 있으면 로그인 가능
    # API Key는 일부 기능에만 필요하므로 필수가 아님
    return bool(_current_client_id) and bool(_current_client_secret)
