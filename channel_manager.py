"""
채널 관리 모듈
YouTube Data API를 사용하여 채널 정보를 조회하고 관리합니다.
"""

import os
import re
import json
import eel
from datetime import datetime
from googleapiclient.errors import HttpError


# 채널 데이터 저장 파일 경로
CHANNEL_DATA_FILE = os.path.join(os.path.expanduser('~'), '.royscreator', 'channels.json')


def channel_manager_init():
    """
    채널 관리자 초기화
    데이터 디렉토리 생성
    """
    # 데이터 디렉토리 생성
    data_dir = os.path.dirname(CHANNEL_DATA_FILE)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)


def extract_channel_id(url_or_handle):
    """
    YouTube 채널 URL 또는 핸들에서 채널 ID 추출

    지원 형식:
    - https://www.youtube.com/channel/UCxxxxx
    - https://www.youtube.com/c/채널명
    - https://www.youtube.com/@핸들명
    - https://youtube.com/@핸들명
    - @핸들명
    - UCxxxxx (직접 채널 ID)
    """
    url = url_or_handle.strip()

    # 이미 채널 ID 형식인 경우 (UC로 시작)
    if url.startswith('UC') and len(url) == 24:
        return url, 'channel_id'

    # @핸들 형식
    if url.startswith('@'):
        return url[1:], 'handle'

    # URL에서 채널 ID 추출
    channel_id_match = re.search(r'youtube\.com/channel/([a-zA-Z0-9_-]+)', url)
    if channel_id_match:
        return channel_id_match.group(1), 'channel_id'

    # URL에서 커스텀 URL 추출
    custom_match = re.search(r'youtube\.com/c/([a-zA-Z0-9_가-힣-]+)', url)
    if custom_match:
        return custom_match.group(1), 'custom_url'

    # URL에서 @핸들 추출
    handle_match = re.search(r'youtube\.com/@([a-zA-Z0-9_가-힣-]+)', url)
    if handle_match:
        return handle_match.group(1), 'handle'

    # 사용자명 형식 (레거시)
    user_match = re.search(r'youtube\.com/user/([a-zA-Z0-9_-]+)', url)
    if user_match:
        return user_match.group(1), 'username'

    # 매칭되지 않으면 그대로 반환 (핸들로 간주)
    return url, 'handle'


def get_channel_info_by_id(youtube, channel_id):
    """
    채널 ID로 채널 정보 조회
    """
    try:
        request = youtube.channels().list(
            part='snippet,statistics,contentDetails',
            id=channel_id
        )
        response = request.execute()

        if not response.get('items'):
            return None

        return response['items'][0]
    except HttpError as e:
        print(f"[Channel Manager] API 오류: {e}")
        return None


def get_channel_info_by_handle(youtube, handle):
    """
    핸들(@username)로 채널 정보 조회
    """
    try:
        request = youtube.channels().list(
            part='snippet,statistics,contentDetails',
            forHandle=handle
        )
        response = request.execute()

        if not response.get('items'):
            return None

        return response['items'][0]
    except HttpError as e:
        print(f"[Channel Manager] API 오류: {e}")
        return None


def get_channel_info_by_username(youtube, username):
    """
    사용자명(레거시)으로 채널 정보 조회
    """
    try:
        request = youtube.channels().list(
            part='snippet,statistics,contentDetails',
            forUsername=username
        )
        response = request.execute()

        if not response.get('items'):
            return None

        return response['items'][0]
    except HttpError as e:
        print(f"[Channel Manager] API 오류: {e}")
        return None


def get_youtube_service():
    """
    메인 앱에서 YouTube 서비스 가져오기
    """
    try:
        import main
        return main.youtube_service
    except Exception as e:
        print(f"[Channel Manager] YouTube 서비스 가져오기 실패: {e}")
        return None


def get_channel_info(url_or_handle):
    """
    URL 또는 핸들로 채널 정보 조회

    반환:
        dict: 채널 정보 또는 None
    """
    youtube = get_youtube_service()
    if not youtube:
        print("[Channel Manager] YouTube 서비스를 사용할 수 없습니다.")
        return None

    identifier, id_type = extract_channel_id(url_or_handle)

    if id_type == 'channel_id':
        return get_channel_info_by_id(youtube, identifier)
    elif id_type == 'handle':
        return get_channel_info_by_handle(youtube, identifier)
    elif id_type == 'username':
        return get_channel_info_by_username(youtube, identifier)
    elif id_type == 'custom_url':
        # 커스텀 URL은 검색 API로 찾아야 함
        try:
            request = youtube.search().list(
                part='snippet',
                q=identifier,
                type='channel',
                maxResults=1
            )
            response = request.execute()

            if response.get('items'):
                channel_id = response['items'][0]['snippet']['channelId']
                return get_channel_info_by_id(youtube, channel_id)
        except HttpError as e:
            print(f"[Channel Manager] API 오류: {e}")

    return None


def load_channels_data():
    """
    저장된 채널 데이터 로드
    """
    if not os.path.exists(CHANNEL_DATA_FILE):
        return []

    try:
        with open(CHANNEL_DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"[Channel Manager] 채널 데이터 로드 오류: {e}")
        return []


def save_channels_data(channels):
    """
    채널 데이터 저장
    """
    try:
        with open(CHANNEL_DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(channels, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[Channel Manager] 채널 데이터 저장 오류: {e}")
        return False


@eel.expose
def channel_manager_add_channel(url, owner):
    """
    채널 추가

    Args:
        url (str): 채널 URL 또는 핸들
        owner (str): 소유자 이름 (별칭)

    Returns:
        dict: {'success': bool, 'error': str, 'channel': dict}
    """
    try:
        # 채널 정보 조회
        channel_info = get_channel_info(url)

        if not channel_info:
            return {
                'success': False,
                'error': '채널을 찾을 수 없습니다. URL을 확인해주세요.'
            }

        channel_id = channel_info['id']
        snippet = channel_info['snippet']
        statistics = channel_info['statistics']

        # 기존 채널 목록 로드
        channels = load_channels_data()

        # 이미 등록된 채널인지 확인
        for ch in channels:
            if ch['channel_id'] == channel_id:
                return {
                    'success': False,
                    'error': '이미 등록된 채널입니다.'
                }

        # 새 채널 데이터 생성
        new_channel = {
            'channel_id': channel_id,
            'owner': owner,
            'url': url,
            'channel_title': snippet.get('title', ''),
            'thumbnail': snippet.get('thumbnails', {}).get('default', {}).get('url', ''),
            'subscriber_count': int(statistics.get('subscriberCount', 0)),
            'video_count': int(statistics.get('videoCount', 0)),
            'view_count': int(statistics.get('viewCount', 0)),
            'subscriber_change': 0,
            'video_change': 0,
            'view_change': 0,
            'last_updated': datetime.now().isoformat(),
            'history': [{
                'date': datetime.now().isoformat(),
                'subscriber_count': int(statistics.get('subscriberCount', 0)),
                'video_count': int(statistics.get('videoCount', 0)),
                'view_count': int(statistics.get('viewCount', 0))
            }]
        }

        # 채널 추가
        channels.append(new_channel)

        # 저장
        if not save_channels_data(channels):
            return {
                'success': False,
                'error': '채널 데이터 저장에 실패했습니다.'
            }

        return {
            'success': True,
            'channel': new_channel
        }

    except Exception as e:
        print(f"[Channel Manager] 채널 추가 오류: {e}")
        return {
            'success': False,
            'error': str(e)
        }


@eel.expose
def channel_manager_get_channels():
    """
    등록된 채널 목록 조회

    Returns:
        dict: {'success': bool, 'channels': list}
    """
    try:
        channels = load_channels_data()
        return {
            'success': True,
            'channels': channels
        }
    except Exception as e:
        print(f"[Channel Manager] 채널 목록 조회 오류: {e}")
        return {
            'success': False,
            'error': str(e),
            'channels': []
        }


@eel.expose
def channel_manager_refresh_channel(channel_id):
    """
    특정 채널 정보 새로고침

    Args:
        channel_id (str): 채널 ID

    Returns:
        dict: {'success': bool, 'error': str}
    """
    try:
        channels = load_channels_data()

        # 채널 찾기
        target_channel = None
        for ch in channels:
            if ch['channel_id'] == channel_id:
                target_channel = ch
                break

        if not target_channel:
            return {
                'success': False,
                'error': '채널을 찾을 수 없습니다.'
            }

        # 최신 정보 조회
        channel_info = get_channel_info(channel_id)

        if not channel_info:
            return {
                'success': False,
                'error': '채널 정보를 가져올 수 없습니다.'
            }

        statistics = channel_info['statistics']
        new_subscriber_count = int(statistics.get('subscriberCount', 0))
        new_video_count = int(statistics.get('videoCount', 0))
        new_view_count = int(statistics.get('viewCount', 0))

        # 변화량 계산
        subscriber_change = new_subscriber_count - target_channel['subscriber_count']
        video_change = new_video_count - target_channel['video_count']
        view_change = new_view_count - target_channel['view_count']

        # 업데이트
        target_channel['subscriber_count'] = new_subscriber_count
        target_channel['video_count'] = new_video_count
        target_channel['view_count'] = new_view_count
        target_channel['subscriber_change'] = subscriber_change
        target_channel['video_change'] = video_change
        target_channel['view_change'] = view_change
        target_channel['last_updated'] = datetime.now().isoformat()

        # 히스토리 추가
        if 'history' not in target_channel:
            target_channel['history'] = []

        target_channel['history'].append({
            'date': datetime.now().isoformat(),
            'subscriber_count': new_subscriber_count,
            'video_count': new_video_count,
            'view_count': new_view_count
        })

        # 히스토리는 최대 100개까지만 유지
        if len(target_channel['history']) > 100:
            target_channel['history'] = target_channel['history'][-100:]

        # 저장
        save_channels_data(channels)

        return {
            'success': True
        }

    except Exception as e:
        print(f"[Channel Manager] 채널 새로고침 오류: {e}")
        return {
            'success': False,
            'error': str(e)
        }


@eel.expose
def channel_manager_refresh_all():
    """
    모든 채널 정보 새로고침

    Returns:
        dict: {'success': bool, 'error': str}
    """
    try:
        channels = load_channels_data()

        for channel in channels:
            channel_id = channel['channel_id']

            # 최신 정보 조회
            channel_info = get_channel_info(channel_id)

            if not channel_info:
                print(f"[Channel Manager] 채널 {channel_id} 정보 조회 실패")
                continue

            statistics = channel_info['statistics']
            new_subscriber_count = int(statistics.get('subscriberCount', 0))
            new_video_count = int(statistics.get('videoCount', 0))
            new_view_count = int(statistics.get('viewCount', 0))

            # 변화량 계산
            subscriber_change = new_subscriber_count - channel['subscriber_count']
            video_change = new_video_count - channel['video_count']
            view_change = new_view_count - channel['view_count']

            # 업데이트
            channel['subscriber_count'] = new_subscriber_count
            channel['video_count'] = new_video_count
            channel['view_count'] = new_view_count
            channel['subscriber_change'] = subscriber_change
            channel['video_change'] = video_change
            channel['view_change'] = view_change
            channel['last_updated'] = datetime.now().isoformat()

            # 히스토리 추가
            if 'history' not in channel:
                channel['history'] = []

            channel['history'].append({
                'date': datetime.now().isoformat(),
                'subscriber_count': new_subscriber_count,
                'video_count': new_video_count,
                'view_count': new_view_count
            })

            # 히스토리는 최대 100개까지만 유지
            if len(channel['history']) > 100:
                channel['history'] = channel['history'][-100:]

        # 저장
        save_channels_data(channels)

        return {
            'success': True
        }

    except Exception as e:
        print(f"[Channel Manager] 전체 새로고침 오류: {e}")
        return {
            'success': False,
            'error': str(e)
        }


@eel.expose
def channel_manager_delete_channel(channel_id):
    """
    채널 삭제

    Args:
        channel_id (str): 채널 ID

    Returns:
        dict: {'success': bool, 'error': str}
    """
    try:
        channels = load_channels_data()

        # 채널 찾아서 제거
        channels = [ch for ch in channels if ch['channel_id'] != channel_id]

        # 저장
        save_channels_data(channels)

        return {
            'success': True
        }

    except Exception as e:
        print(f"[Channel Manager] 채널 삭제 오류: {e}")
        return {
            'success': False,
            'error': str(e)
        }


# 초기화
channel_manager_init()
