"""
YouTube 계정 관리 및 업로드 모듈
- OAuth 2.0 인증
- 다중 계정 관리
- 비공개 영상 업로드
- 썸네일 업로드
"""

import os
import json
import pickle
import webbrowser
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, List

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError

# YouTube API 스코프
# 모든 YouTube 계정 및 브랜드 계정 관리 권한 포함
SCOPES = [
    'https://www.googleapis.com/auth/youtube',  # 모든 YouTube 기능 접근
    'https://www.googleapis.com/auth/youtube.force-ssl',  # 강제 SSL
    'https://www.googleapis.com/auth/youtubepartner',  # 파트너 채널 관리
]

class YouTubeAccountManager:
    """YouTube 계정 관리 클래스"""

    def __init__(self, credentials_dir='youtube_credentials'):
        """
        초기화

        Args:
            credentials_dir: 인증 정보 저장 디렉토리
        """
        self.credentials_dir = Path(credentials_dir)
        self.credentials_dir.mkdir(exist_ok=True)

        self.accounts_file = self.credentials_dir / 'accounts.json'
        self.client_secrets_file = self.credentials_dir / 'client_secrets.json'

        self.accounts = self._load_accounts()
        self.upload_history = self._load_upload_history()

    def _load_accounts(self) -> Dict:
        """저장된 계정 목록 로드"""
        if self.accounts_file.exists():
            with open(self.accounts_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}

    def _save_accounts(self):
        """계정 목록 저장"""
        with open(self.accounts_file, 'w', encoding='utf-8') as f:
            json.dump(self.accounts, f, indent=2, ensure_ascii=False)

    def _load_upload_history(self) -> Dict:
        """업로드 기록 로드"""
        history_file = self.credentials_dir / 'upload_history.json'
        if history_file.exists():
            with open(history_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}

    def _save_upload_history(self):
        """업로드 기록 저장"""
        history_file = self.credentials_dir / 'upload_history.json'
        with open(history_file, 'w', encoding='utf-8') as f:
            json.dump(self.upload_history, f, indent=2, ensure_ascii=False)

    def has_client_secrets(self) -> bool:
        """client_secrets.json 파일 존재 여부 확인"""
        return self.client_secrets_file.exists()

    def set_client_secrets(self, file_path: str) -> bool:
        """
        Google Cloud Console에서 다운로드한 client_secrets.json 설정

        Args:
            file_path: client_secrets.json 파일 경로

        Returns:
            성공 여부
        """
        try:
            import shutil
            shutil.copy(file_path, self.client_secrets_file)
            return True
        except Exception as e:
            print(f"client_secrets.json 설정 실패: {e}")
            return False

    def add_account(self, account_name: str = None) -> Dict:
        """
        새 YouTube 계정 추가 (OAuth 인증)

        Args:
            account_name: 계정 식별 이름 (없으면 채널명 사용)

        Returns:
            {'success': bool, 'account_name': str, 'channel_info': dict, 'error': str}
        """
        if not self.has_client_secrets():
            return {
                'success': False,
                'error': 'client_secrets.json 파일이 필요합니다. Google Cloud Console에서 다운로드하세요.'
            }

        try:
            # OAuth 인증 플로우
            flow = InstalledAppFlow.from_client_secrets_file(
                str(self.client_secrets_file),
                SCOPES,
                redirect_uri='http://localhost:8080/'
            )

            # 브라우저에서 인증
            creds = flow.run_local_server(port=8080, open_browser=True)

            # YouTube API로 채널 정보 가져오기
            youtube = build('youtube', 'v3', credentials=creds)
            channel_response = youtube.channels().list(
                part='snippet,statistics',
                mine=True
            ).execute()

            if not channel_response.get('items'):
                return {'success': False, 'error': '채널 정보를 가져올 수 없습니다.'}

            channel = channel_response['items'][0]
            channel_id = channel['id']
            channel_title = channel['snippet']['title']

            # 계정 이름 설정
            if not account_name:
                account_name = channel_title

            # 중복 확인
            base_name = account_name
            counter = 1
            while account_name in self.accounts:
                account_name = f"{base_name} ({counter})"
                counter += 1

            # 인증 정보 저장
            token_file = self.credentials_dir / f'{account_name}.pickle'
            with open(token_file, 'wb') as f:
                pickle.dump(creds, f)

            # 계정 정보 저장
            self.accounts[account_name] = {
                'channel_id': channel_id,
                'channel_title': channel_title,
                'token_file': str(token_file),
                'added_at': datetime.now().isoformat(),
                'subscriber_count': channel['statistics'].get('subscriberCount', '0')
            }
            self._save_accounts()

            return {
                'success': True,
                'account_name': account_name,
                'channel_info': self.accounts[account_name]
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    def remove_account(self, account_name: str) -> bool:
        """
        계정 제거

        Args:
            account_name: 계정 이름

        Returns:
            성공 여부
        """
        if account_name not in self.accounts:
            return False

        # 토큰 파일 삭제
        token_file = Path(self.accounts[account_name]['token_file'])
        if token_file.exists():
            token_file.unlink()

        # 계정 정보 삭제
        del self.accounts[account_name]
        self._save_accounts()

        return True

    def get_credentials(self, account_name: str) -> Optional[Credentials]:
        """
        계정의 인증 정보 가져오기 (자동 갱신)

        Args:
            account_name: 계정 이름

        Returns:
            Credentials 객체 또는 None
        """
        if account_name not in self.accounts:
            return None

        token_file = Path(self.accounts[account_name]['token_file'])
        if not token_file.exists():
            return None

        # 토큰 로드
        with open(token_file, 'rb') as f:
            creds = pickle.load(f)

        # 토큰 만료 확인 및 갱신
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                # 갱신된 토큰 저장
                with open(token_file, 'wb') as f:
                    pickle.dump(creds, f)
            except Exception as e:
                print(f"토큰 갱신 실패: {e}")
                return None

        return creds

    def get_accounts_list(self) -> List[Dict]:
        """
        모든 계정 목록 가져오기

        Returns:
            계정 정보 리스트
        """
        result = []
        today = datetime.now().strftime('%Y-%m-%d')

        for name, info in self.accounts.items():
            account_info = {
                'name': name,
                'channel_title': info['channel_title'],
                'channel_id': info['channel_id'],
                'subscriber_count': info.get('subscriber_count', '0'),
                'added_at': info['added_at'],
                'uploads_today': self._get_upload_count(name, today)
            }
            result.append(account_info)

        return result

    def get_managed_channels(self, account_name: str) -> Dict:
        """
        계정이 관리하는 모든 채널 목록 가져오기
        (본인 채널 + 브랜드 계정 + 관리자 권한이 있는 다른 채널들)

        Args:
            account_name: 계정 이름

        Returns:
            {'success': bool, 'channels': List[Dict], 'error': str}
        """
        creds = self.get_credentials(account_name)
        if not creds:
            return {'success': False, 'error': f'계정 "{account_name}"의 인증 정보를 찾을 수 없습니다.', 'channels': []}

        try:
            youtube = build('youtube', 'v3', credentials=creds)
            channels = []
            channel_ids_seen = set()  # 중복 방지

            # 1. mine=True: 본인이 소유한 모든 채널 (개인 채널 + 브랜드 계정)
            print(f"[YouTube] {account_name}: 본인 소유 채널 조회 중 (mine=True)...")
            try:
                channels_response = youtube.channels().list(
                    part='snippet,contentDetails,statistics,brandingSettings',
                    mine=True,
                    maxResults=50
                ).execute()

                for item in channels_response.get('items', []):
                    channel_id = item['id']
                    if channel_id not in channel_ids_seen:
                        channel_ids_seen.add(channel_id)
                        channel_info = {
                            'channel_id': channel_id,
                            'title': item['snippet']['title'],
                            'description': item['snippet'].get('description', ''),
                            'custom_url': item['snippet'].get('customUrl', ''),
                            'thumbnail': item['snippet']['thumbnails'].get('default', {}).get('url', ''),
                            'subscriber_count': item['statistics'].get('subscriberCount', '0'),
                            'video_count': item['statistics'].get('videoCount', '0'),
                            'view_count': item['statistics'].get('viewCount', '0'),
                            'is_owner': True,
                            'type': '본인 채널'
                        }
                        channels.append(channel_info)
                        print(f"[YouTube] ✓ 본인 채널: {channel_info['title']} (구독자 {channel_info['subscriber_count']}명)")
            except HttpError as e:
                print(f"[YouTube] 본인 채널 조회 오류 (HTTP {e.resp.status}): {e}")
            except Exception as e:
                print(f"[YouTube] 본인 채널 조회 예외: {e}")

            # 2. managedByMe=True: 관리자 권한이 있는 채널
            print(f"[YouTube] {account_name}: 관리 권한 채널 조회 중 (managedByMe=True)...")
            try:
                managed_response = youtube.channels().list(
                    part='snippet,contentDetails,statistics,brandingSettings',
                    managedByMe=True,
                    maxResults=50
                ).execute()

                for item in managed_response.get('items', []):
                    channel_id = item['id']
                    if channel_id not in channel_ids_seen:
                        channel_ids_seen.add(channel_id)
                        channel_info = {
                            'channel_id': channel_id,
                            'title': item['snippet']['title'],
                            'description': item['snippet'].get('description', ''),
                            'custom_url': item['snippet'].get('customUrl', ''),
                            'thumbnail': item['snippet']['thumbnails'].get('default', {}).get('url', ''),
                            'subscriber_count': item['statistics'].get('subscriberCount', '0'),
                            'video_count': item['statistics'].get('videoCount', '0'),
                            'view_count': item['statistics'].get('viewCount', '0'),
                            'is_owner': False,
                            'type': '관리 중인 채널'
                        }
                        channels.append(channel_info)
                        print(f"[YouTube] ✓ 관리 채널: {channel_info['title']} (구독자 {channel_info['subscriber_count']}명)")

                print(f"[YouTube] managedByMe=True 조회 완료: {len([c for c in channels if not c['is_owner']])}개 추가")
            except HttpError as e:
                print(f"[YouTube] 관리 채널 조회 오류 (HTTP {e.resp.status}): {e}")
                if e.resp.status == 403:
                    print(f"[YouTube] ⚠️ 403 권한 오류: OAuth scope에 'https://www.googleapis.com/auth/youtubepartner' 권한이 필요할 수 있습니다.")
                    print(f"[YouTube] ⚠️ 계정을 삭제하고 다시 추가하여 새로운 권한으로 재인증하세요.")
            except Exception as e:
                print(f"[YouTube] 관리 채널 조회 예외: {e}")

            # 3. 페이지네이션 처리 (50개 이상인 경우)
            # mine=True 페이지네이션
            next_page_token = channels_response.get('nextPageToken')
            page_count = 1
            while next_page_token and page_count < 5:  # 최대 250개 채널
                page_count += 1
                print(f"[YouTube] {account_name}: 본인 채널 페이지 {page_count} 조회 중...")
                try:
                    channels_response = youtube.channels().list(
                        part='snippet,contentDetails,statistics,brandingSettings',
                        mine=True,
                        maxResults=50,
                        pageToken=next_page_token
                    ).execute()

                    for item in channels_response.get('items', []):
                        channel_id = item['id']
                        if channel_id not in channel_ids_seen:
                            channel_ids_seen.add(channel_id)
                            channel_info = {
                                'channel_id': channel_id,
                                'title': item['snippet']['title'],
                                'description': item['snippet'].get('description', ''),
                                'custom_url': item['snippet'].get('customUrl', ''),
                                'thumbnail': item['snippet']['thumbnails'].get('default', {}).get('url', ''),
                                'subscriber_count': item['statistics'].get('subscriberCount', '0'),
                                'video_count': item['statistics'].get('videoCount', '0'),
                                'view_count': item['statistics'].get('viewCount', '0'),
                                'is_owner': True,
                                'type': '본인 채널'
                            }
                            channels.append(channel_info)
                            print(f"[YouTube] ✓ 본인 채널 (페이지{page_count}): {channel_info['title']}")

                    next_page_token = channels_response.get('nextPageToken')
                except Exception as e:
                    print(f"[YouTube] 페이지네이션 오류: {e}")
                    break

            print(f"[YouTube] {account_name}: 총 {len(channels)}개 채널 조회 완료")
            print(f"[YouTube] - 본인 채널: {len([c for c in channels if c['is_owner']])}개")
            print(f"[YouTube] - 관리 채널: {len([c for c in channels if not c['is_owner']])}개")

            return {
                'success': True,
                'channels': channels,
                'account_name': account_name
            }

        except HttpError as e:
            error_msg = f'YouTube API 오류: {e.resp.status}'
            print(f"[YouTube] API 오류: {error_msg}")
            print(f"[YouTube] 오류 상세: {e}")
            return {'success': False, 'error': error_msg, 'channels': []}
        except Exception as e:
            print(f"[YouTube] 채널 조회 오류: {e}")
            import traceback
            traceback.print_exc()
            return {'success': False, 'error': str(e), 'channels': []}

    def _get_upload_count(self, account_name: str, date: str) -> int:
        """특정 날짜의 업로드 횟수 조회"""
        if account_name not in self.upload_history:
            return 0
        if date not in self.upload_history[account_name]:
            return 0
        return len(self.upload_history[account_name][date])

    def _record_upload(self, account_name: str, video_id: str, video_title: str):
        """업로드 기록 저장"""
        today = datetime.now().strftime('%Y-%m-%d')

        if account_name not in self.upload_history:
            self.upload_history[account_name] = {}

        if today not in self.upload_history[account_name]:
            self.upload_history[account_name][today] = []

        self.upload_history[account_name][today].append({
            'video_id': video_id,
            'title': video_title,
            'uploaded_at': datetime.now().isoformat()
        })

        self._save_upload_history()

    def upload_video(
        self,
        account_name: str,
        video_file: str,
        title: str,
        description: str = '',
        thumbnail_file: str = None,
        privacy_status: str = 'private',
        tags: List[str] = None,
        category_id: str = '22',  # 22 = 사람 및 블로그
        channel_id: str = None
    ) -> Dict:
        """
        비공개 영상 업로드

        Args:
            account_name: 업로드할 계정 이름
            video_file: 영상 파일 경로
            title: 영상 제목
            description: 영상 설명
            thumbnail_file: 썸네일 이미지 경로 (선택)
            privacy_status: 공개 상태 (private/unlisted/public)
            tags: 태그 리스트
            category_id: 카테고리 ID
            channel_id: 업로드할 채널 ID (선택, 없으면 본인 채널)

        Returns:
            {'success': bool, 'video_id': str, 'video_url': str, 'error': str}
        """
        creds = self.get_credentials(account_name)
        if not creds:
            return {'success': False, 'error': f'계정 "{account_name}"의 인증 정보를 찾을 수 없습니다.'}

        try:
            youtube = build('youtube', 'v3', credentials=creds)

            # 영상 메타데이터
            body = {
                'snippet': {
                    'title': title,
                    'description': description,
                    'tags': tags or [],
                    'categoryId': category_id
                },
                'status': {
                    'privacyStatus': privacy_status,
                    'selfDeclaredMadeForKids': False
                }
            }

            # 특정 채널에 업로드하는 경우 channelId 추가
            if channel_id:
                body['snippet']['channelId'] = channel_id

            # 영상 업로드
            media = MediaFileUpload(
                video_file,
                mimetype='video/*',
                resumable=True,
                chunksize=1024*1024  # 1MB chunks
            )

            # onBehalfOfContentOwner 파라미터 추가 (특정 채널 업로드용)
            insert_params = {
                'part': 'snippet,status',
                'body': body,
                'media_body': media
            }

            if channel_id:
                insert_params['onBehalfOfContentOwner'] = channel_id

            request = youtube.videos().insert(**insert_params)

            response = None
            while response is None:
                status, response = request.next_chunk()
                if status:
                    progress = int(status.progress() * 100)
                    print(f"업로드 진행: {progress}%")

            video_id = response['id']
            video_url = f'https://www.youtube.com/watch?v={video_id}'

            # 썸네일 업로드
            if thumbnail_file and os.path.exists(thumbnail_file):
                try:
                    youtube.thumbnails().set(
                        videoId=video_id,
                        media_body=MediaFileUpload(thumbnail_file)
                    ).execute()
                except Exception as e:
                    print(f"썸네일 업로드 실패: {e}")

            # 업로드 기록
            self._record_upload(account_name, video_id, title)

            return {
                'success': True,
                'video_id': video_id,
                'video_url': video_url,
                'title': title
            }

        except HttpError as e:
            error_msg = f'YouTube API 오류: {e.resp.status} - {e.content.decode()}'
            return {'success': False, 'error': error_msg}
        except Exception as e:
            return {'success': False, 'error': str(e)}


# 전역 인스턴스
youtube_manager = YouTubeAccountManager()
