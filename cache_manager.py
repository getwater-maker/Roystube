"""
캐시 관리 모듈
- 구독 목록, 채널 정보 캐싱
- 캐시 만료 확인 (24시간)
- 계정별 캐시 분리
"""

import os
import json
from datetime import datetime, timedelta
from data_path import CACHE_DIR, ensure_cache_dir

CACHE_EXPIRY_HOURS = 24

# 기본 캐시 파일 경로
_BASE_SUBSCRIPTIONS_CACHE = os.path.join(CACHE_DIR, 'subscriptions.json')
_BASE_CHANNELS_CACHE = os.path.join(CACHE_DIR, 'channels.json')
_BASE_VIDEOS_CACHE = os.path.join(CACHE_DIR, 'videos.json')

# 현재 프리셋 OAuth 계정 ID (main.py에서 설정)
_current_preset_account_id = None


def set_current_preset_account(account_id):
    """프리셋 OAuth 계정 ID를 설정합니다."""
    global _current_preset_account_id
    _current_preset_account_id = account_id
    print(f"[캐시] 프리셋 계정 설정: {account_id}")


def get_current_preset_account():
    """현재 프리셋 OAuth 계정 ID를 반환합니다."""
    return _current_preset_account_id


def _get_current_account_id():
    """현재 계정 ID를 반환합니다."""
    # 1. 프리셋 OAuth 계정 ID 우선
    if _current_preset_account_id:
        return _current_preset_account_id

    # 2. 계정 매니저의 현재 계정
    try:
        import account_manager
        account = account_manager.get_current_account()
        if account:
            return account['id']
    except Exception:
        pass
    return None


def _get_account_cache_path(base_cache_file):
    """계정별 캐시 파일 경로를 반환합니다."""
    account_id = _get_current_account_id()
    if account_id:
        base, ext = os.path.splitext(base_cache_file)
        return f"{base}_{account_id}{ext}"
    return base_cache_file


def _ensure_cache_dir():
    """캐시 디렉토리가 없으면 생성합니다."""
    ensure_cache_dir()


def _is_cache_valid(cache_file):
    """캐시 파일이 유효한지 확인합니다 (24시간 이내)."""
    if not os.path.exists(cache_file):
        return False

    try:
        with open(cache_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        cached_time = datetime.fromisoformat(data.get('cached_at', '2000-01-01'))
        expiry_time = cached_time + timedelta(hours=CACHE_EXPIRY_HOURS)

        return datetime.now() < expiry_time
    except Exception:
        return False


def _save_cache(cache_file, data):
    """데이터를 캐시 파일에 저장합니다."""
    _ensure_cache_dir()

    cache_data = {
        'cached_at': datetime.now().isoformat(),
        'data': data
    }

    with open(cache_file, 'w', encoding='utf-8') as f:
        json.dump(cache_data, f, ensure_ascii=False, indent=2)


def _load_cache(cache_file):
    """캐시 파일에서 데이터를 불러옵니다."""
    if not _is_cache_valid(cache_file):
        return None

    try:
        with open(cache_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data.get('data')
    except Exception:
        return None


# 구독 목록 캐시 (계정별)
def save_subscriptions(subscriptions):
    """구독 목록을 캐시에 저장합니다."""
    cache_file = _get_account_cache_path(_BASE_SUBSCRIPTIONS_CACHE)
    _save_cache(cache_file, subscriptions)
    print(f"구독 목록 {len(subscriptions)}개 캐시 저장 완료")


def load_subscriptions():
    """캐시에서 구독 목록을 불러옵니다."""
    cache_file = _get_account_cache_path(_BASE_SUBSCRIPTIONS_CACHE)
    data = _load_cache(cache_file)
    if data:
        print(f"캐시에서 구독 목록 {len(data)}개 로드")
    return data


# 채널 정보 캐시 (계정별)
def save_channels(channels):
    """채널 정보를 캐시에 저장합니다."""
    cache_file = _get_account_cache_path(_BASE_CHANNELS_CACHE)
    _save_cache(cache_file, channels)
    print(f"채널 정보 {len(channels)}개 캐시 저장 완료")


def load_channels():
    """캐시에서 채널 정보를 불러옵니다."""
    cache_file = _get_account_cache_path(_BASE_CHANNELS_CACHE)
    data = _load_cache(cache_file)
    if data:
        print(f"캐시에서 채널 정보 {len(data)}개 로드")
    return data


# 캐시 삭제 (현재 계정)
def clear_all_cache():
    """현재 계정의 모든 캐시를 삭제합니다."""
    cache_files = [
        _get_account_cache_path(_BASE_SUBSCRIPTIONS_CACHE),
        _get_account_cache_path(_BASE_CHANNELS_CACHE),
        _get_account_cache_path(_BASE_VIDEOS_CACHE)
    ]

    for cache_file in cache_files:
        if os.path.exists(cache_file):
            os.remove(cache_file)

    # 기존 캐시 파일도 삭제 (호환성)
    for cache_file in [_BASE_SUBSCRIPTIONS_CACHE, _BASE_CHANNELS_CACHE, _BASE_VIDEOS_CACHE]:
        if os.path.exists(cache_file):
            os.remove(cache_file)

    print("모든 캐시 삭제 완료")


def clear_subscriptions_cache():
    """구독 목록 캐시만 삭제합니다."""
    cache_file = _get_account_cache_path(_BASE_SUBSCRIPTIONS_CACHE)
    if os.path.exists(cache_file):
        os.remove(cache_file)
        print("구독 목록 캐시 삭제 완료")

    # 기존 캐시 파일도 삭제 (호환성)
    if os.path.exists(_BASE_SUBSCRIPTIONS_CACHE):
        os.remove(_BASE_SUBSCRIPTIONS_CACHE)


def get_cache_info():
    """캐시 상태 정보를 반환합니다."""
    info = {}

    cache_paths = [
        ('subscriptions', _get_account_cache_path(_BASE_SUBSCRIPTIONS_CACHE)),
        ('channels', _get_account_cache_path(_BASE_CHANNELS_CACHE)),
        ('videos', _get_account_cache_path(_BASE_VIDEOS_CACHE))
    ]

    for name, path in cache_paths:
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                info[name] = {
                    'exists': True,
                    'cached_at': data.get('cached_at'),
                    'count': len(data.get('data', []))
                }
            except Exception:
                info[name] = {'exists': False}
        else:
            info[name] = {'exists': False}

    return info
