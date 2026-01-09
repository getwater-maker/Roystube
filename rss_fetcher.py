"""
RSS 피드 수집 모듈
- YouTube 채널 RSS 피드 파싱
- 비동기 처리로 속도 향상
"""

import asyncio
import aiohttp
import feedparser
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor

RSS_URL_TEMPLATE = "https://www.youtube.com/feeds/videos.xml?channel_id={}"
MAX_VIDEOS_PER_CHANNEL = 15  # YouTube RSS는 최대 15개 제공


def parse_published_date(date_str):
    """RSS 날짜 문자열을 datetime으로 변환합니다."""
    try:
        # feedparser가 파싱한 time.struct_time 형식
        if hasattr(date_str, 'tm_year'):
            return datetime(*date_str[:6])
        # ISO 8601 형식 문자열
        return datetime.fromisoformat(date_str.replace('Z', '+00:00').replace('+00:00', ''))
    except Exception:
        return datetime.now()


def fetch_channel_rss(channel_id, days_within=15):
    """
    단일 채널의 RSS 피드를 가져옵니다.

    Args:
        channel_id: YouTube 채널 ID
        days_within: 최근 N일 이내 영상만

    Returns:
        list: [{'videoId': ..., 'title': ..., 'publishedAt': ..., 'channelId': ...}, ...]
    """
    try:
        url = RSS_URL_TEMPLATE.format(channel_id)
        feed = feedparser.parse(url)

        if not feed.entries:
            return []

        cutoff_date = datetime.now() - timedelta(days=days_within)
        videos = []

        for entry in feed.entries[:MAX_VIDEOS_PER_CHANNEL]:
            # 발행일 확인
            published = parse_published_date(entry.get('published_parsed'))

            if published < cutoff_date:
                continue

            # 비디오 ID 추출
            video_id = entry.get('yt_videoid', '')
            if not video_id and 'link' in entry:
                # URL에서 추출: https://www.youtube.com/watch?v=VIDEO_ID
                link = entry.get('link', '')
                if 'v=' in link:
                    video_id = link.split('v=')[1].split('&')[0]

            if not video_id:
                continue

            # 썸네일 URL
            thumbnail = f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"

            videos.append({
                'videoId': video_id,
                'title': entry.get('title', ''),
                'channelId': channel_id,
                'channelTitle': entry.get('author', ''),
                'publishedAt': published.isoformat(),
                'thumbnail': thumbnail
            })

        return videos

    except Exception as e:
        print(f"RSS 피드 오류 ({channel_id}): {e}")
        return []


async def fetch_channel_rss_async(session, channel_id, days_within=15):
    """비동기로 단일 채널의 RSS 피드를 가져옵니다."""
    try:
        url = RSS_URL_TEMPLATE.format(channel_id)

        async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as response:
            if response.status != 200:
                return []

            content = await response.text()

        # feedparser는 동기 함수이므로 ThreadPoolExecutor 사용
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor() as executor:
            feed = await loop.run_in_executor(executor, feedparser.parse, content)

        if not feed.entries:
            return []

        cutoff_date = datetime.now() - timedelta(days=days_within)
        videos = []

        for entry in feed.entries[:MAX_VIDEOS_PER_CHANNEL]:
            published = parse_published_date(entry.get('published_parsed'))

            if published < cutoff_date:
                continue

            video_id = entry.get('yt_videoid', '')
            if not video_id:
                continue

            thumbnail = f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"

            videos.append({
                'videoId': video_id,
                'title': entry.get('title', ''),
                'channelId': channel_id,
                'channelTitle': entry.get('author', ''),
                'publishedAt': published.isoformat(),
                'thumbnail': thumbnail
            })

        return videos

    except asyncio.TimeoutError:
        print(f"RSS 타임아웃 ({channel_id})")
        return []
    except Exception as e:
        print(f"RSS 오류 ({channel_id}): {e}")
        return []


async def fetch_all_channels_async(channel_ids, days_within=15, progress_callback=None):
    """
    모든 채널의 RSS 피드를 비동기로 가져옵니다.

    Args:
        channel_ids: 채널 ID 리스트
        days_within: 최근 N일 이내
        progress_callback: 진행률 콜백 함수 (current, total) -> bool (False면 중단)

    Returns:
        list: 모든 영상 리스트
    """
    all_videos = []
    total = len(channel_ids)

    connector = aiohttp.TCPConnector(limit=20)  # 동시 연결 제한

    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [
            fetch_channel_rss_async(session, cid, days_within)
            for cid in channel_ids
        ]

        for i, task in enumerate(asyncio.as_completed(tasks)):
            videos = await task
            all_videos.extend(videos)

            if progress_callback:
                # 콜백이 False를 반환하면 중단
                should_continue = progress_callback(i + 1, total)
                if should_continue is False:
                    print("RSS 수집 중단됨")
                    break

    return all_videos


def fetch_all_channels(channel_ids, days_within=15, progress_callback=None):
    """
    모든 채널의 RSS 피드를 가져옵니다 (동기 래퍼).

    Args:
        channel_ids: 채널 ID 리스트
        days_within: 최근 N일 이내
        progress_callback: 진행률 콜백 (current, total) -> bool (False면 중단)

    Returns:
        list: 모든 영상 리스트
    """
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(
            fetch_all_channels_async(channel_ids, days_within, progress_callback)
        )
        loop.close()
        return result
    except Exception as e:
        print(f"RSS 수집 오류: {e}")
        # 비동기 실패 시 동기 방식으로 폴백
        all_videos = []
        for i, cid in enumerate(channel_ids):
            videos = fetch_channel_rss(cid, days_within)
            all_videos.extend(videos)
            if progress_callback:
                should_continue = progress_callback(i + 1, len(channel_ids))
                if should_continue is False:
                    print("RSS 수집 중단됨 (동기)")
                    break
        return all_videos
