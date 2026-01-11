"""
채널 컨텍스트 관리 모듈
- 계정별 선택된 채널 정보 저장/로드
- 현재 작업 중인 채널 컨텍스트 관리
"""

import os
import json
from data_path import DATA_DIR

# 채널 컨텍스트 저장 경로
CHANNEL_CONTEXT_FILE = os.path.join(DATA_DIR, 'channel_contexts.json')


def load_channel_contexts():
    """
    저장된 채널 컨텍스트를 로드합니다.

    Returns:
        dict: {
            'account_id_1': {
                'selected_channel_id': 'UC...',
                'channels': [
                    {'id': 'UC...', 'title': '채널명', 'thumbnail': '...', ...}
                ]
            },
            'account_id_2': {...}
        }
    """
    if os.path.exists(CHANNEL_CONTEXT_FILE):
        try:
            with open(CHANNEL_CONTEXT_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"채널 컨텍스트 로드 실패: {e}")

    return {}


def save_channel_contexts(contexts):
    """
    채널 컨텍스트를 저장합니다.

    Args:
        contexts: 채널 컨텍스트 dict

    Returns:
        bool: 성공 여부
    """
    try:
        with open(CHANNEL_CONTEXT_FILE, 'w', encoding='utf-8') as f:
            json.dump(contexts, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"채널 컨텍스트 저장 실패: {e}")
        return False


def get_account_channel_context(account_id):
    """
    특정 계정의 채널 컨텍스트를 가져옵니다.

    Args:
        account_id: 계정 ID

    Returns:
        dict: {
            'selected_channel_id': 'UC...' or None,
            'channels': [...]
        }
    """
    contexts = load_channel_contexts()
    return contexts.get(account_id, {
        'selected_channel_id': None,
        'channels': []
    })


def save_account_channels(account_id, channels):
    """
    계정의 채널 목록을 저장합니다.

    Args:
        account_id: 계정 ID
        channels: 채널 목록 (get_my_channels 결과)

    Returns:
        dict: {'success': bool, 'error': str}
    """
    try:
        contexts = load_channel_contexts()

        # 기존 컨텍스트가 없으면 생성
        if account_id not in contexts:
            contexts[account_id] = {
                'selected_channel_id': None,
                'channels': []
            }

        # 채널 목록 업데이트
        contexts[account_id]['channels'] = channels

        # 선택된 채널이 없고 채널이 1개 이상이면 첫 번째 채널 자동 선택
        if not contexts[account_id]['selected_channel_id'] and channels:
            contexts[account_id]['selected_channel_id'] = channels[0]['id']

        # 선택된 채널이 목록에 없으면 첫 번째 채널로 변경
        channel_ids = [ch['id'] for ch in channels]
        if contexts[account_id]['selected_channel_id'] not in channel_ids:
            if channels:
                contexts[account_id]['selected_channel_id'] = channels[0]['id']
            else:
                contexts[account_id]['selected_channel_id'] = None

        if save_channel_contexts(contexts):
            return {'success': True}
        else:
            return {'success': False, 'error': '저장 실패'}

    except Exception as e:
        return {'success': False, 'error': str(e)}


def select_channel(account_id, channel_id):
    """
    계정의 활성 채널을 선택합니다.

    Args:
        account_id: 계정 ID
        channel_id: 선택할 채널 ID

    Returns:
        dict: {'success': bool, 'channel': dict, 'error': str}
    """
    try:
        contexts = load_channel_contexts()

        if account_id not in contexts:
            return {'success': False, 'error': '계정 정보를 찾을 수 없습니다.'}

        # 채널 ID 유효성 확인
        channels = contexts[account_id].get('channels', [])
        channel = None
        for ch in channels:
            if ch['id'] == channel_id:
                channel = ch
                break

        if not channel:
            return {'success': False, 'error': '채널을 찾을 수 없습니다.'}

        # 선택된 채널 ID 업데이트
        contexts[account_id]['selected_channel_id'] = channel_id

        if save_channel_contexts(contexts):
            return {'success': True, 'channel': channel}
        else:
            return {'success': False, 'error': '저장 실패'}

    except Exception as e:
        return {'success': False, 'error': str(e)}


def get_selected_channel(account_id):
    """
    계정의 현재 선택된 채널 정보를 가져옵니다.

    Args:
        account_id: 계정 ID

    Returns:
        dict or None: 선택된 채널 정보
    """
    context = get_account_channel_context(account_id)
    selected_id = context.get('selected_channel_id')

    if not selected_id:
        return None

    channels = context.get('channels', [])
    for channel in channels:
        if channel['id'] == selected_id:
            return channel

    return None


def get_selected_channel_id(account_id):
    """
    계정의 현재 선택된 채널 ID를 가져옵니다.

    Args:
        account_id: 계정 ID

    Returns:
        str or None: 채널 ID
    """
    context = get_account_channel_context(account_id)
    return context.get('selected_channel_id')


def clear_account_channels(account_id):
    """
    계정의 채널 정보를 모두 삭제합니다.

    Args:
        account_id: 계정 ID

    Returns:
        bool: 성공 여부
    """
    try:
        contexts = load_channel_contexts()

        if account_id in contexts:
            del contexts[account_id]
            return save_channel_contexts(contexts)

        return True

    except Exception:
        return False
