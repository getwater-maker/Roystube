"""
TTS API 키 관리 및 사용량 추적 시스템
- 여러 API 키 관리
- 모델별 사용량 추적
- 무료 한도 80% 도달 시 자동 키 전환
- 매월 1일 자동 리셋
"""

import os
import json
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

# 데이터 저장 경로
DATA_DIR = os.path.join(os.path.expanduser('~'), '.audiovis_tts_app_data')
TTS_KEYS_FILE = os.path.join(DATA_DIR, 'tts_api_keys.json')
TTS_USAGE_FILE = os.path.join(DATA_DIR, 'tts_usage.json')

# 디렉토리 생성
os.makedirs(DATA_DIR, exist_ok=True)

# Google Cloud TTS 무료 사용량 (월간, 문자 수)
TTS_FREE_LIMITS = {
    'standard': 4_000_000,   # Standard: 400만 자
    'wavenet': 1_000_000,    # Wavenet: 100만 자
    'neural2': 1_000_000,    # Neural2: 100만 자
    'chirp3': 1_000_000,     # Chirp3-HD: 100만 자
    'studio': 100_000,       # Studio: 10만 자 (추정)
    'polyglot': 1_000_000,   # Polyglot: 100만 자 (추정)
}

# 사용량 한도 비율 (80%)
USAGE_LIMIT_RATIO = 0.8

# 스레드 안전을 위한 락 (RLock으로 재진입 허용)
_lock = threading.RLock()


def _get_model_category(voice_name: str) -> str:
    """음성 이름에서 모델 카테고리 추출"""
    voice_lower = voice_name.lower()

    if 'chirp3' in voice_lower or 'chirp' in voice_lower:
        return 'chirp3'
    elif 'neural2' in voice_lower:
        return 'neural2'
    elif 'wavenet' in voice_lower:
        return 'wavenet'
    elif 'studio' in voice_lower:
        return 'studio'
    elif 'polyglot' in voice_lower:
        return 'polyglot'
    else:
        return 'standard'


def _load_json(filepath: str) -> dict:
    """JSON 파일 로드"""
    try:
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"[TTS Quota] JSON 로드 오류: {e}")
    return {}


def _save_json(filepath: str, data: dict) -> bool:
    """JSON 파일 저장"""
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[TTS Quota] JSON 저장 오류: {e}")
        return False


# ========== API 키 관리 ==========

def get_tts_api_keys() -> List[dict]:
    """등록된 TTS API 키 목록 반환"""
    with _lock:
        data = _load_json(TTS_KEYS_FILE)
        return data.get('keys', [])


def add_tts_api_key(api_key: str, name: str = '') -> dict:
    """새 TTS API 키 추가"""
    with _lock:
        data = _load_json(TTS_KEYS_FILE)
        keys = data.get('keys', [])

        # 중복 체크
        for key_info in keys:
            if key_info.get('key') == api_key:
                return {'success': False, 'error': '이미 등록된 API 키입니다.'}

        # 새 키 추가
        new_key = {
            'id': len(keys) + 1,
            'key': api_key,
            'name': name or f'API Key #{len(keys) + 1}',
            'registered_at': datetime.now().isoformat(),
            'active': True
        }
        keys.append(new_key)
        data['keys'] = keys

        _save_json(TTS_KEYS_FILE, data)

        # 사용량 초기화
        _init_usage_for_key(new_key['id'])

        return {'success': True, 'key_id': new_key['id']}


def remove_tts_api_key(key_id: int) -> dict:
    """TTS API 키 삭제"""
    with _lock:
        data = _load_json(TTS_KEYS_FILE)
        keys = data.get('keys', [])

        keys = [k for k in keys if k.get('id') != key_id]
        data['keys'] = keys

        _save_json(TTS_KEYS_FILE, data)

        # 사용량 데이터도 삭제
        usage_data = _load_json(TTS_USAGE_FILE)
        if str(key_id) in usage_data:
            del usage_data[str(key_id)]
            _save_json(TTS_USAGE_FILE, usage_data)

        return {'success': True}


def update_tts_api_key(key_id: int, name: str = None, active: bool = None) -> dict:
    """TTS API 키 정보 업데이트"""
    with _lock:
        data = _load_json(TTS_KEYS_FILE)
        keys = data.get('keys', [])

        for key_info in keys:
            if key_info.get('id') == key_id:
                if name is not None:
                    key_info['name'] = name
                if active is not None:
                    key_info['active'] = active
                break

        data['keys'] = keys
        _save_json(TTS_KEYS_FILE, data)
        return {'success': True}


def reorder_tts_api_keys(key_ids: List[int]) -> dict:
    """TTS API 키 순서 변경"""
    with _lock:
        data = _load_json(TTS_KEYS_FILE)
        keys = data.get('keys', [])

        # ID로 키 정보 매핑
        key_map = {k['id']: k for k in keys}

        # 새 순서로 정렬
        new_keys = []
        for i, key_id in enumerate(key_ids, 1):
            if key_id in key_map:
                key_info = key_map[key_id]
                key_info['id'] = i  # 순서 번호 업데이트
                new_keys.append(key_info)

        data['keys'] = new_keys
        _save_json(TTS_KEYS_FILE, data)
        return {'success': True}


# ========== 사용량 추적 ==========

def _init_usage_for_key(key_id: int):
    """새 API 키의 사용량 초기화"""
    usage_data = _load_json(TTS_USAGE_FILE)

    now = datetime.now()
    usage_data[str(key_id)] = {
        'month': now.strftime('%Y-%m'),
        'usage': {
            'standard': 0,
            'wavenet': 0,
            'neural2': 0,
            'chirp3': 0,
            'studio': 0,
            'polyglot': 0
        },
        'last_updated': now.isoformat()
    }

    _save_json(TTS_USAGE_FILE, usage_data)


def _check_and_reset_monthly():
    """매월 1일 자동 리셋 체크"""
    usage_data = _load_json(TTS_USAGE_FILE)
    current_month = datetime.now().strftime('%Y-%m')
    reset_occurred = False

    for key_id, key_usage in usage_data.items():
        if key_usage.get('month') != current_month:
            # 새 달이므로 리셋
            key_usage['month'] = current_month
            key_usage['usage'] = {
                'standard': 0,
                'wavenet': 0,
                'neural2': 0,
                'chirp3': 0,
                'studio': 0,
                'polyglot': 0
            }
            key_usage['last_updated'] = datetime.now().isoformat()
            key_usage['last_reset'] = datetime.now().isoformat()
            reset_occurred = True

    if reset_occurred:
        _save_json(TTS_USAGE_FILE, usage_data)
        print(f"[TTS Quota] 월간 사용량 리셋 완료: {current_month}")

    return reset_occurred


def get_usage_for_key(key_id: int) -> dict:
    """특정 API 키의 사용량 조회"""
    with _lock:
        _check_and_reset_monthly()
        usage_data = _load_json(TTS_USAGE_FILE)
        return usage_data.get(str(key_id), {})


def get_all_usage() -> dict:
    """모든 API 키의 사용량 조회"""
    with _lock:
        _check_and_reset_monthly()
        return _load_json(TTS_USAGE_FILE)


def add_usage(key_id: int, voice_name: str, char_count: int) -> dict:
    """사용량 추가"""
    with _lock:
        _check_and_reset_monthly()

        usage_data = _load_json(TTS_USAGE_FILE)
        key_str = str(key_id)

        if key_str not in usage_data:
            _init_usage_for_key(key_id)
            usage_data = _load_json(TTS_USAGE_FILE)

        model = _get_model_category(voice_name)
        usage_data[key_str]['usage'][model] += char_count
        usage_data[key_str]['last_updated'] = datetime.now().isoformat()

        _save_json(TTS_USAGE_FILE, usage_data)

        return {'success': True, 'model': model, 'added': char_count}


def get_remaining_quota(key_id: int, voice_name: str) -> Tuple[int, int, float]:
    """
    특정 API 키의 특정 모델 잔여 한도 조회

    Returns:
        (사용량, 한도, 사용비율)
    """
    with _lock:
        _check_and_reset_monthly()

        usage_data = _load_json(TTS_USAGE_FILE)
        key_str = str(key_id)

        if key_str not in usage_data:
            model = _get_model_category(voice_name)
            limit = TTS_FREE_LIMITS.get(model, 1_000_000)
            return (0, limit, 0.0)

        model = _get_model_category(voice_name)
        used = usage_data[key_str]['usage'].get(model, 0)
        limit = TTS_FREE_LIMITS.get(model, 1_000_000)
        ratio = used / limit if limit > 0 else 1.0

        return (used, limit, ratio)


def is_quota_available(key_id: int, voice_name: str, char_count: int = 0) -> bool:
    """
    해당 API 키로 지정된 모델 사용 가능 여부 확인
    (80% 한도 기준)
    """
    used, limit, ratio = get_remaining_quota(key_id, voice_name)
    threshold = limit * USAGE_LIMIT_RATIO

    # 이미 80% 초과했거나, 이번 요청으로 80% 초과하면 False
    if used >= threshold:
        return False
    if used + char_count > threshold:
        return False

    return True


# ========== 자동 키 선택 ==========

def get_available_api_key(voice_name: str, char_count: int = 0) -> Optional[dict]:
    """
    사용 가능한 API 키 자동 선택
    - 순서대로 확인하여 80% 미만인 첫 번째 키 반환
    - 모든 키가 80% 이상이면 None 반환
    """
    with _lock:
        _check_and_reset_monthly()

        keys = get_tts_api_keys()

        for key_info in keys:
            if not key_info.get('active', True):
                continue

            key_id = key_info['id']
            if is_quota_available(key_id, voice_name, char_count):
                return {
                    'key_id': key_id,
                    'api_key': key_info['key'],
                    'name': key_info['name']
                }

        # 80% 이상이지만 100% 미만인 키 찾기 (fallback)
        for key_info in keys:
            if not key_info.get('active', True):
                continue

            key_id = key_info['id']
            used, limit, ratio = get_remaining_quota(key_id, voice_name)

            if ratio < 1.0:  # 100% 미만
                return {
                    'key_id': key_id,
                    'api_key': key_info['key'],
                    'name': key_info['name'],
                    'warning': f'80% 초과 사용 중 ({ratio*100:.1f}%)'
                }

        return None


def get_usage_summary() -> List[dict]:
    """모든 API 키의 사용량 요약"""
    with _lock:
        _check_and_reset_monthly()

        keys = get_tts_api_keys()
        usage_data = _load_json(TTS_USAGE_FILE)

        summary = []
        for key_info in keys:
            key_id = str(key_info['id'])
            key_usage = usage_data.get(key_id, {}).get('usage', {})

            models_summary = []
            for model, limit in TTS_FREE_LIMITS.items():
                used = key_usage.get(model, 0)
                threshold = int(limit * USAGE_LIMIT_RATIO)
                ratio = used / limit if limit > 0 else 0

                models_summary.append({
                    'model': model,
                    'used': used,
                    'limit': limit,
                    'threshold': threshold,
                    'ratio': ratio,
                    'available': used < threshold
                })

            summary.append({
                'key_id': key_info['id'],
                'name': key_info['name'],
                'active': key_info.get('active', True),
                'registered_at': key_info.get('registered_at', ''),
                'models': models_summary,
                'month': usage_data.get(key_id, {}).get('month', ''),
                'last_updated': usage_data.get(key_id, {}).get('last_updated', '')
            })

        return summary


# ========== 포맷팅 유틸리티 ==========

def format_char_count(count: int) -> str:
    """문자 수를 읽기 쉬운 형식으로 변환"""
    if count >= 1_000_000:
        return f"{count/1_000_000:.1f}M"
    elif count >= 1_000:
        return f"{count/1_000:.1f}K"
    else:
        return str(count)


def format_usage_display(used: int, limit: int) -> str:
    """사용량 표시 문자열 생성"""
    ratio = used / limit if limit > 0 else 0
    return f"{format_char_count(used)} / {format_char_count(limit)} ({ratio*100:.1f}%)"


print("[TTS Quota Manager] 모듈 로드 완료")
