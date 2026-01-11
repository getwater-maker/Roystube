"""
YouTube API 호출 모듈
- 구독 채널 목록 조회
- 채널 정보 배치 조회
- 영상 정보 배치 조회
- 채널 업로드 영상 조회 (playlistItems API)
- 국가별 인기 동영상 조회
- 채널 구독 추가/삭제
- URL/핸들에서 채널 ID 추출
"""

import re
from datetime import datetime, timedelta
from urllib.parse import urlparse, unquote


def extract_channel_identifier(url_or_handle):
    """
    URL 또는 핸들에서 채널 식별자를 추출합니다.

    Args:
        url_or_handle: YouTube 채널 URL 또는 핸들

    Returns:
        dict: {'type': 'channel_id'|'handle'|'custom'|'user', 'value': str} 또는 None
    """
    if not url_or_handle or not isinstance(url_or_handle, str):
        return None

    url_or_handle = url_or_handle.strip()

    # URL 디코딩 (한글 등 인코딩된 문자 처리)
    url_or_handle = unquote(url_or_handle)

    # 이미 채널 ID인 경우 (UC로 시작하는 24자)
    if re.match(r'^UC[\w-]{22}$', url_or_handle):
        return {'type': 'channel_id', 'value': url_or_handle}

    # @핸들만 있는 경우
    if url_or_handle.startswith('@'):
        return {'type': 'handle', 'value': url_or_handle}

    # URL 파싱
    try:
        # http/https가 없으면 추가
        if not url_or_handle.startswith(('http://', 'https://')):
            if 'youtube.com' in url_or_handle or 'youtu.be' in url_or_handle:
                url_or_handle = 'https://' + url_or_handle
            else:
                return None

        parsed = urlparse(url_or_handle)
        path = parsed.path

        # /channel/UC... 형식
        match = re.match(r'^/channel/(UC[\w-]{22})', path)
        if match:
            return {'type': 'channel_id', 'value': match.group(1)}

        # /@handle 형식
        match = re.match(r'^/@([\w.-]+)', path)
        if match:
            return {'type': 'handle', 'value': '@' + match.group(1)}

        # /c/CustomName 형식
        match = re.match(r'^/c/([\w.-]+)', path)
        if match:
            return {'type': 'custom', 'value': match.group(1)}

        # /user/Username 형식
        match = re.match(r'^/user/([\w.-]+)', path)
        if match:
            return {'type': 'user', 'value': match.group(1)}

        # /CustomName 형식 (videos, shorts 등 제외)
        match = re.match(r'^/([\w.-]+)(?:/.*)?$', path)
        if match:
            name = match.group(1)
            # 예약된 경로 제외
            reserved = ['watch', 'playlist', 'feed', 'gaming', 'music', 'premium',
                       'results', 'shorts', 'live', 'hashtag', 'trending']
            if name.lower() not in reserved:
                return {'type': 'custom', 'value': name}

    except Exception:
        pass

    return None


def resolve_channel_id(youtube, url_or_handle):
    """
    URL 또는 핸들에서 채널 ID를 조회합니다.

    Args:
        youtube: YouTube API 서비스
        url_or_handle: YouTube 채널 URL 또는 핸들

    Returns:
        dict: {'success': bool, 'channel_id': str, 'title': str, 'thumbnail': str} 또는 에러
    """
    identifier = extract_channel_identifier(url_or_handle)

    if not identifier:
        return {'success': False, 'error': f'유효하지 않은 URL/핸들: {url_or_handle}'}

    try:
        # 이미 채널 ID인 경우
        if identifier['type'] == 'channel_id':
            # 채널 정보 조회하여 유효성 확인
            request = youtube.channels().list(
                part='snippet',
                id=identifier['value']
            )
            response = request.execute()

            if response.get('items'):
                item = response['items'][0]
                return {
                    'success': True,
                    'channel_id': identifier['value'],
                    'title': item['snippet']['title'],
                    'thumbnail': item['snippet']['thumbnails']['default']['url']
                }
            else:
                return {'success': False, 'error': f'채널을 찾을 수 없음: {identifier["value"]}'}

        # 핸들로 검색
        elif identifier['type'] == 'handle':
            request = youtube.channels().list(
                part='snippet',
                forHandle=identifier['value'].lstrip('@')
            )
            response = request.execute()

            if response.get('items'):
                item = response['items'][0]
                return {
                    'success': True,
                    'channel_id': item['id'],
                    'title': item['snippet']['title'],
                    'thumbnail': item['snippet']['thumbnails']['default']['url']
                }
            else:
                return {'success': False, 'error': f'핸들을 찾을 수 없음: {identifier["value"]}'}

        # custom URL 또는 user로 검색 (search API 사용)
        else:
            # forUsername 시도 (user 타입)
            if identifier['type'] == 'user':
                request = youtube.channels().list(
                    part='snippet',
                    forUsername=identifier['value']
                )
                response = request.execute()

                if response.get('items'):
                    item = response['items'][0]
                    return {
                        'success': True,
                        'channel_id': item['id'],
                        'title': item['snippet']['title'],
                        'thumbnail': item['snippet']['thumbnails']['default']['url']
                    }

            # search API로 검색 (custom 타입 또는 user 실패 시)
            request = youtube.search().list(
                part='snippet',
                q=identifier['value'],
                type='channel',
                maxResults=1
            )
            response = request.execute()

            if response.get('items'):
                item = response['items'][0]
                return {
                    'success': True,
                    'channel_id': item['snippet']['channelId'],
                    'title': item['snippet']['title'],
                    'thumbnail': item['snippet']['thumbnails']['default']['url']
                }
            else:
                return {'success': False, 'error': f'채널을 찾을 수 없음: {identifier["value"]}'}

    except Exception as e:
        return {'success': False, 'error': f'API 오류: {str(e)}'}


def resolve_channel_ids_batch(youtube, urls_or_handles, progress_callback=None):
    """
    여러 URL/핸들에서 채널 ID를 일괄 조회합니다.

    Args:
        youtube: YouTube API 서비스
        urls_or_handles: URL/핸들 리스트
        progress_callback: 진행상황 콜백 함수 (current, total, url, result)

    Returns:
        dict: {'success': [...], 'failed': [...]}
    """
    results = {
        'success': [],
        'failed': []
    }

    total = len(urls_or_handles)
    for i, url in enumerate(urls_or_handles):
        if not url or not url.strip():
            continue

        result = resolve_channel_id(youtube, url.strip())
        result['original_url'] = url

        if result['success']:
            results['success'].append(result)
        else:
            results['failed'].append(result)

        if progress_callback:
            progress_callback(i + 1, total, url, result)

    return results


def get_subscriptions(youtube):
    """
    구독 채널 목록을 가져옵니다 (구독자 수 포함).

    Args:
        youtube: OAuth 인증된 YouTube API 서비스

    Returns:
        list: [{'id': 채널ID, 'title': 채널명, 'thumbnail': 썸네일URL, 'subscriberCount': 구독자수}, ...]
    """
    subscriptions = []
    next_page_token = None

    # 1단계: 구독 채널 ID 목록 수집
    while True:
        request = youtube.subscriptions().list(
            part='snippet',
            mine=True,
            maxResults=50,
            pageToken=next_page_token
        )
        response = request.execute()

        for item in response.get('items', []):
            snippet = item['snippet']
            subscriptions.append({
                'id': snippet['resourceId']['channelId'],
                'title': snippet['title'],
                'thumbnail': snippet['thumbnails']['default']['url'],
                'description': snippet.get('description', '')[:100]
            })

        next_page_token = response.get('nextPageToken')
        if not next_page_token:
            break

    # 2단계: 채널별 구독자 수 조회
    if subscriptions:
        channel_ids = [sub['id'] for sub in subscriptions]
        channel_stats = get_channels_batch(youtube, channel_ids)

        for sub in subscriptions:
            stats = channel_stats.get(sub['id'], {})
            sub['subscriberCount'] = stats.get('subscriberCount', 0)

    return subscriptions


def get_channels_batch(youtube, channel_ids):
    """
    채널 정보를 배치로 가져옵니다 (50개씩).

    Args:
        youtube: YouTube API 서비스
        channel_ids: 채널 ID 리스트

    Returns:
        dict: {채널ID: {'subscriberCount': 구독자수, 'title': 채널명}, ...}
    """
    if not channel_ids:
        return {}

    result = {}
    batch_size = 50

    for i in range(0, len(channel_ids), batch_size):
        batch = channel_ids[i:i + batch_size]

        try:
            request = youtube.channels().list(
                part='snippet,statistics',
                id=','.join(batch)
            )
            response = request.execute()

            for item in response.get('items', []):
                channel_id = item['id']
                stats = item.get('statistics', {})
                snippet = item.get('snippet', {})

                # subscriberCount가 숨김 상태인 채널은 값이 없을 수 있음
                sub_count = stats.get('subscriberCount')
                try:
                    sub_count = int(sub_count) if sub_count else 0
                except (ValueError, TypeError):
                    sub_count = 0

                # 썸네일 안전하게 가져오기
                thumbnails = snippet.get('thumbnails', {})
                thumbnail = (
                    thumbnails.get('default', {}).get('url') or
                    thumbnails.get('medium', {}).get('url') or
                    ''
                )

                result[channel_id] = {
                    'subscriberCount': sub_count,
                    'title': snippet.get('title', ''),
                    'thumbnail': thumbnail
                }

        except Exception as e:
            print(f"채널 정보 조회 실패 (배치 {i // batch_size + 1}): {e}")

    return result


def get_videos_batch(youtube, video_ids):
    """
    영상 정보를 배치로 가져옵니다 (50개씩).

    Args:
        youtube: YouTube API 서비스
        video_ids: 영상 ID 리스트

    Returns:
        dict: {영상ID: {'viewCount': 조회수, 'duration': 길이(초)}, ...}
    """
    if not video_ids:
        return {}

    result = {}
    batch_size = 50

    for i in range(0, len(video_ids), batch_size):
        batch = video_ids[i:i + batch_size]

        try:
            request = youtube.videos().list(
                part='statistics,contentDetails',
                id=','.join(batch)
            )
            response = request.execute()

            for item in response.get('items', []):
                video_id = item['id']
                stats = item.get('statistics', {})
                content = item.get('contentDetails', {})

                # 조회수/좋아요/댓글수 안전하게 가져오기
                def safe_int(val):
                    try:
                        return int(val) if val else 0
                    except (ValueError, TypeError):
                        return 0

                result[video_id] = {
                    'viewCount': safe_int(stats.get('viewCount')),
                    'likeCount': safe_int(stats.get('likeCount')),
                    'commentCount': safe_int(stats.get('commentCount')),
                    'duration': parse_duration(content.get('duration', 'PT0S'))
                }

        except Exception as e:
            print(f"영상 정보 조회 실패 (배치 {i // batch_size + 1}): {e}")

    return result


def parse_duration(duration_str):
    """
    ISO 8601 기간 형식을 초 단위로 변환합니다.

    Args:
        duration_str: 'PT1H2M3S' 형식의 문자열

    Returns:
        int: 총 초
    """
    pattern = r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?'
    match = re.match(pattern, duration_str)

    if not match:
        return 0

    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)

    return hours * 3600 + minutes * 60 + seconds


def get_channel_uploads_playlist_id(youtube, channel_id):
    """
    채널의 업로드 플레이리스트 ID를 가져옵니다.
    채널 ID가 UC...로 시작하면 UU...로 변환하여 업로드 플레이리스트 ID 생성.

    Args:
        youtube: YouTube API 서비스
        channel_id: 채널 ID

    Returns:
        str: 업로드 플레이리스트 ID
    """
    # UC로 시작하는 채널 ID를 UU로 변경하면 업로드 플레이리스트 ID가 됨
    if channel_id.startswith('UC'):
        return 'UU' + channel_id[2:]

    # 그 외의 경우 API로 조회
    try:
        request = youtube.channels().list(
            part='contentDetails',
            id=channel_id
        )
        response = request.execute()

        if response.get('items'):
            return response['items'][0]['contentDetails']['relatedPlaylists']['uploads']
    except Exception as e:
        print(f"업로드 플레이리스트 ID 조회 실패 ({channel_id}): {e}")

    return None


def get_channel_uploads(youtube, channel_id, days_within=30, max_results=50):
    """
    채널의 업로드 영상 목록을 playlistItems API로 가져옵니다.
    RSS로 가져온 15개 이후의 영상을 조회할 때 사용합니다.

    Args:
        youtube: YouTube API 서비스
        channel_id: 채널 ID
        days_within: 최근 N일 이내 영상만
        max_results: 최대 조회 개수

    Returns:
        list: [{'videoId': ..., 'title': ..., 'publishedAt': ..., 'channelId': ..., 'thumbnail': ...}, ...]
    """
    uploads_playlist_id = get_channel_uploads_playlist_id(youtube, channel_id)
    if not uploads_playlist_id:
        return []

    videos = []
    cutoff_date = datetime.now() - timedelta(days=days_within)
    next_page_token = None
    fetched_count = 0

    try:
        while fetched_count < max_results:
            request = youtube.playlistItems().list(
                part='snippet,contentDetails',
                playlistId=uploads_playlist_id,
                maxResults=min(50, max_results - fetched_count),
                pageToken=next_page_token
            )
            response = request.execute()

            for item in response.get('items', []):
                snippet = item['snippet']
                content_details = item['contentDetails']

                # 발행일 확인
                published_str = content_details.get('videoPublishedAt') or snippet.get('publishedAt', '')
                if not published_str:
                    continue

                try:
                    published = datetime.fromisoformat(published_str.replace('Z', '+00:00').replace('+00:00', ''))
                except Exception:
                    continue

                # 기간 필터
                if published < cutoff_date:
                    # 날짜순이므로 이후 영상은 더 오래됨 - 종료
                    return videos

                video_id = content_details.get('videoId', '')
                if not video_id:
                    continue

                # 썸네일
                thumbnails = snippet.get('thumbnails', {})
                thumbnail = (
                    thumbnails.get('medium', {}).get('url') or
                    thumbnails.get('default', {}).get('url') or
                    f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"
                )

                videos.append({
                    'videoId': video_id,
                    'title': snippet.get('title', ''),
                    'channelId': channel_id,
                    'channelTitle': snippet.get('channelTitle', ''),
                    'publishedAt': published.isoformat(),
                    'thumbnail': thumbnail
                })

            fetched_count += len(response.get('items', []))
            next_page_token = response.get('nextPageToken')

            if not next_page_token:
                break

    except Exception as e:
        print(f"채널 업로드 조회 실패 ({channel_id}): {e}")

    return videos


def subscribe_channel(youtube, channel_id):
    """
    채널을 구독합니다.

    Args:
        youtube: YouTube API 서비스
        channel_id: 구독할 채널 ID

    Returns:
        dict: {'success': bool, 'message': str}
    """
    try:
        request = youtube.subscriptions().insert(
            part='snippet',
            body={
                'snippet': {
                    'resourceId': {
                        'kind': 'youtube#channel',
                        'channelId': channel_id
                    }
                }
            }
        )
        response = request.execute()
        return {'success': True, 'message': f'채널 구독 완료', 'subscriptionId': response.get('id')}
    except Exception as e:
        error_msg = str(e)
        if 'subscriptionDuplicate' in error_msg:
            return {'success': True, 'message': '이미 구독 중인 채널입니다', 'already_subscribed': True}
        print(f"채널 구독 실패 ({channel_id}): {e}")
        return {'success': False, 'message': f'구독 실패: {error_msg}'}


def subscribe_channels_batch(youtube, channel_ids, progress_callback=None):
    """
    여러 채널을 일괄 구독합니다.

    Args:
        youtube: YouTube API 서비스
        channel_ids: 구독할 채널 ID 리스트
        progress_callback: 진행상황 콜백 함수 (current, total, channel_id, result)

    Returns:
        dict: {'success': int, 'failed': int, 'already_subscribed': int, 'results': [...]}
    """
    results = {
        'success': 0,
        'failed': 0,
        'already_subscribed': 0,
        'results': []
    }

    total = len(channel_ids)
    for i, channel_id in enumerate(channel_ids):
        result = subscribe_channel(youtube, channel_id)
        result['channel_id'] = channel_id
        results['results'].append(result)

        if result['success']:
            if result.get('already_subscribed'):
                results['already_subscribed'] += 1
            else:
                results['success'] += 1
        else:
            results['failed'] += 1

        if progress_callback:
            progress_callback(i + 1, total, channel_id, result)

    return results


def get_popular_videos(youtube, region_code='KR', video_category_id=None, max_results=50):
    """
    국가별 인기 동영상을 가져옵니다.

    Args:
        youtube: YouTube API 서비스
        region_code: 국가 코드 (기본: KR)
        video_category_id: 카테고리 ID (선택, None이면 전체)
        max_results: 최대 결과 수 (최대 50)

    Returns:
        list: [{'videoId': ..., 'title': ..., 'channelId': ..., 'channelTitle': ...,
                'thumbnail': ..., 'publishedAt': ..., 'viewCount': ..., 'likeCount': ...,
                'duration': ..., 'subscriberCount': ...}, ...]
    """
    videos = []

    try:
        # 인기 동영상 조회
        request_params = {
            'part': 'snippet,statistics,contentDetails',
            'chart': 'mostPopular',
            'regionCode': region_code,
            'maxResults': min(max_results, 50)
        }

        if video_category_id:
            request_params['videoCategoryId'] = video_category_id

        request = youtube.videos().list(**request_params)
        response = request.execute()

        # 채널 ID 목록 수집 (구독자 수 조회용)
        channel_ids = set()
        for item in response.get('items', []):
            channel_ids.add(item['snippet']['channelId'])

        # 채널 구독자 수 조회
        channel_info = get_channels_batch(youtube, list(channel_ids))

        # 영상 정보 파싱
        for item in response.get('items', []):
            video_id = item['id']
            snippet = item['snippet']
            stats = item.get('statistics', {})
            content = item.get('contentDetails', {})
            channel_id = snippet['channelId']

            # 안전한 정수 변환
            def safe_int(val):
                try:
                    return int(val) if val else 0
                except (ValueError, TypeError):
                    return 0

            # 썸네일
            thumbnails = snippet.get('thumbnails', {})
            thumbnail = (
                thumbnails.get('medium', {}).get('url') or
                thumbnails.get('high', {}).get('url') or
                thumbnails.get('default', {}).get('url') or
                f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"
            )

            # 채널 구독자 수
            c_info = channel_info.get(channel_id, {})
            subscriber_count = c_info.get('subscriberCount', 0)

            view_count = safe_int(stats.get('viewCount'))
            like_count = safe_int(stats.get('likeCount'))
            duration = parse_duration(content.get('duration', 'PT0S'))

            # 카테고리 ID (음악=10, 게임=20)
            category_id = snippet.get('categoryId', '')

            videos.append({
                'videoId': video_id,
                'title': snippet.get('title', ''),
                'channelId': channel_id,
                'channelTitle': snippet.get('channelTitle', ''),
                'thumbnail': thumbnail,
                'publishedAt': snippet.get('publishedAt', ''),
                'viewCount': view_count,
                'likeCount': like_count,
                'subscriberCount': subscriber_count,
                'duration': duration,
                'ratio': round(view_count / subscriber_count, 2) if subscriber_count > 0 else 0,
                'categoryId': category_id
            })

    except Exception as e:
        print(f"인기 동영상 조회 실패 ({region_code}): {e}")
        raise e

    return videos


def search_youtube_videos(youtube, query, days_within=7, video_type='long', max_results=50):
    """
    YouTube에서 키워드로 영상을 검색합니다.

    Args:
        youtube: YouTube API 서비스
        query: 검색 키워드
        days_within: 최근 N일 이내 영상만
        video_type: 'long' 또는 'shorts'
        max_results: 최대 결과 수 (최대 50)

    Returns:
        list: [{'videoId': ..., 'title': ..., 'channelId': ..., 'channelTitle': ...,
                'thumbnail': ..., 'publishedAt': ..., 'viewCount': ..., 'likeCount': ...,
                'duration': ..., 'subscriberCount': ...}, ...]
    """
    videos = []

    # 기간 계산
    published_after = (datetime.now() - timedelta(days=days_within)).isoformat() + 'Z'

    # 쇼츠/롱폼 구분을 위한 duration 필터
    # short: 4분 이하, medium: 4~20분, long: 20분 이상
    # API는 단일 값만 허용하므로 'any'로 조회 후 클라이언트에서 필터링
    video_duration = 'short' if video_type == 'shorts' else 'any'

    try:
        # 검색 API 호출
        search_params = {
            'part': 'snippet',
            'q': query,
            'type': 'video',
            'order': 'viewCount',  # 조회수 순
            'publishedAfter': published_after,
            'videoDuration': video_duration,
            'maxResults': min(max_results, 50),
            'regionCode': 'KR'
        }

        request = youtube.search().list(**search_params)
        response = request.execute()

        # 영상 ID 목록 수집
        video_ids = []
        video_snippets = {}
        for item in response.get('items', []):
            video_id = item['id']['videoId']
            video_ids.append(video_id)
            video_snippets[video_id] = item['snippet']

        if not video_ids:
            return videos

        # 영상 상세 정보 조회 (조회수, 좋아요, 길이)
        video_info = get_videos_batch(youtube, video_ids)

        # 채널 ID 목록 수집
        channel_ids = set()
        for snippet in video_snippets.values():
            channel_ids.add(snippet['channelId'])

        # 채널 구독자 수 조회
        channel_info = get_channels_batch(youtube, list(channel_ids))

        # 결과 조합
        for video_id in video_ids:
            snippet = video_snippets[video_id]
            v_info = video_info.get(video_id, {})
            channel_id = snippet['channelId']
            c_info = channel_info.get(channel_id, {})

            # 썸네일
            thumbnails = snippet.get('thumbnails', {})
            thumbnail = (
                thumbnails.get('medium', {}).get('url') or
                thumbnails.get('high', {}).get('url') or
                thumbnails.get('default', {}).get('url') or
                f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"
            )

            view_count = v_info.get('viewCount', 0)
            like_count = v_info.get('likeCount', 0)
            duration = v_info.get('duration', 0)
            subscriber_count = c_info.get('subscriberCount', 0)

            # 쇼츠 필터: 183초 이하만
            if video_type == 'shorts' and duration > 183:
                continue
            # 롱폼 필터: 184초 이상만
            if video_type == 'long' and duration < 184:
                continue

            videos.append({
                'videoId': video_id,
                'title': snippet.get('title', ''),
                'channelId': channel_id,
                'channelTitle': snippet.get('channelTitle', ''),
                'thumbnail': thumbnail,
                'publishedAt': snippet.get('publishedAt', ''),
                'viewCount': view_count,
                'likeCount': like_count,
                'subscriberCount': subscriber_count,
                'duration': duration,
                'ratio': round(view_count / subscriber_count, 2) if subscriber_count > 0 else 0
            })

    except Exception as e:
        print(f"YouTube 검색 실패 ({query}): {e}")
        raise e

    return videos


def get_video_comments(youtube, video_id, max_results=100):
    """
    영상의 댓글을 가져옵니다 (인기순).

    Args:
        youtube: YouTube API 서비스
        video_id: 영상 ID
        max_results: 최대 댓글 수 (기본 100개)

    Returns:
        list: [{'author': 작성자, 'text': 댓글내용, 'likeCount': 좋아요수, 'publishedAt': 작성일}, ...]
    """
    comments = []

    print(f"[get_video_comments] 시작: video_id={video_id}")

    try:
        request = youtube.commentThreads().list(
            part='snippet',
            videoId=video_id,
            order='relevance',  # 인기순
            maxResults=min(max_results, 100),
            textFormat='plainText'
        )
        print(f"[get_video_comments] API 요청 실행 중...")
        response = request.execute()
        print(f"[get_video_comments] 응답 받음: {len(response.get('items', []))}개 항목")

        for item in response.get('items', []):
            snippet = item['snippet']['topLevelComment']['snippet']
            comments.append({
                'author': snippet.get('authorDisplayName', ''),
                'text': snippet.get('textDisplay', ''),
                'likeCount': snippet.get('likeCount', 0),
                'publishedAt': snippet.get('publishedAt', '')
            })

        print(f"[get_video_comments] 완료: {len(comments)}개 댓글")

    except Exception as e:
        # 댓글이 비활성화된 영상 등의 경우 빈 리스트 반환
        print(f"[get_video_comments] 실패 ({video_id}): {e}")
        import traceback
        traceback.print_exc()

    return comments


def get_filtered_comments(youtube, video_id, keywords=None, max_count=20):
    """
    키워드 필터링된 댓글을 가져옵니다.
    키워드가 포함된 댓글을 우선 선별하고, 부족하면 인기순 댓글로 채웁니다.

    Args:
        youtube: YouTube API 서비스
        video_id: 영상 ID
        keywords: 필터 키워드 리스트 (예: ['공감', '위로', '저도 그랬어요'])
        max_count: 최대 반환 댓글 수 (기본 20개)

    Returns:
        list: [{'author': 작성자, 'text': 댓글내용, 'likeCount': 좋아요수, 'publishedAt': 작성일, 'hasKeyword': bool}, ...]
    """
    if keywords is None:
        keywords = ['공감', '위로', '저도 그랬어요']

    # 댓글 100개 가져오기
    all_comments = get_video_comments(youtube, video_id, max_results=100)

    if not all_comments:
        return []

    # 키워드 포함 댓글 분류
    keyword_comments = []
    other_comments = []

    for comment in all_comments:
        text = comment.get('text', '')
        has_keyword = any(kw in text for kw in keywords)
        comment['hasKeyword'] = has_keyword

        if has_keyword:
            keyword_comments.append(comment)
        else:
            other_comments.append(comment)

    # 키워드 댓글 우선 + 나머지 인기순으로 채움
    result = keyword_comments[:max_count]

    if len(result) < max_count:
        remaining = max_count - len(result)
        result.extend(other_comments[:remaining])

    return result


def get_my_channels(youtube):
    """
    현재 인증된 계정이 접근 가능한 모든 YouTube 채널 목록을 가져옵니다.
    - 본인 소유 채널
    - 관리자/편집자 권한을 받은 브랜드 채널

    Args:
        youtube: OAuth 인증된 YouTube API 서비스

    Returns:
        dict: {
            'success': True/False,
            'channels': [
                {
                    'id': 채널ID,
                    'title': 채널명,
                    'customUrl': 커스텀URL (@핸들),
                    'thumbnail': 썸네일URL,
                    'description': 설명,
                    'subscriberCount': 구독자수,
                    'videoCount': 영상수,
                    'viewCount': 총조회수
                }
            ],
            'error': 에러메시지 (실패시)
        }
    """
    try:
        # mine=True로 현재 인증된 사용자가 접근 가능한 모든 채널 조회
        request = youtube.channels().list(
            part='snippet,contentDetails,statistics',
            mine=True,
            maxResults=50  # 일반적으로 한 계정당 채널 수는 많지 않음
        )
        response = request.execute()

        channels = []
        for item in response.get('items', []):
            channel_id = item['id']
            snippet = item.get('snippet', {})
            stats = item.get('statistics', {})

            # 안전한 정수 변환
            def safe_int(val):
                try:
                    return int(val) if val else 0
                except (ValueError, TypeError):
                    return 0

            # 썸네일 URL
            thumbnails = snippet.get('thumbnails', {})
            thumbnail = (
                thumbnails.get('medium', {}).get('url') or
                thumbnails.get('default', {}).get('url') or
                ''
            )

            channels.append({
                'id': channel_id,
                'title': snippet.get('title', ''),
                'customUrl': snippet.get('customUrl', ''),
                'thumbnail': thumbnail,
                'description': snippet.get('description', '')[:200],  # 최대 200자
                'subscriberCount': safe_int(stats.get('subscriberCount')),
                'videoCount': safe_int(stats.get('videoCount')),
                'viewCount': safe_int(stats.get('viewCount'))
            })

        return {
            'success': True,
            'channels': channels
        }

    except Exception as e:
        print(f"채널 목록 조회 실패: {e}")
        return {
            'success': False,
            'error': f'채널 목록 조회 실패: {str(e)}',
            'channels': []
        }
