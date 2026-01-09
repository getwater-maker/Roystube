"""
OAuth 2.0 인증 처리 모듈
- config.py에서 키를 읽어옴
- 전용 Chrome 창에서 로그인 (localhost 리다이렉트)
- 멀티 계정 지원
"""

import os
import socket
import subprocess
import shutil
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import config
from data_path import TOKEN_FILE, DATA_DIR
import account_manager

# OAuth 스코프 (구독 관리 + 댓글 조회 포함)
SCOPES = [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl'
]

# 인증 결과 저장
_auth_result = {'code': None, 'error': None}
_auth_server = None


def find_free_port(start_port=8888):
    """사용 가능한 포트를 찾습니다."""
    for port in range(start_port, start_port + 100):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('localhost', port))
                return port
        except OSError:
            continue
    return start_port


def find_chrome_path():
    """Chrome 실행 파일 경로를 찾습니다."""
    possible_paths = [
        os.path.expandvars(r'%ProgramFiles%\Google\Chrome\Application\chrome.exe'),
        os.path.expandvars(r'%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe'),
        os.path.expandvars(r'%LocalAppData%\Google\Chrome\Application\chrome.exe'),
    ]
    for path in possible_paths:
        if os.path.exists(path):
            return path
    chrome_in_path = shutil.which('chrome')
    if chrome_in_path:
        return chrome_in_path
    return None


def open_auth_browser(url, profile_name=None):
    """전용 Chrome 프로필로 인증 URL을 엽니다.

    Args:
        url: 인증 URL
        profile_name: 프로필 이름 (계정별로 다른 프로필 사용)
    """
    chrome_path = find_chrome_path()
    # 계정별 별도 프로필 (각 계정마다 Chrome 로그인 상태가 분리됨)
    if profile_name:
        auth_profile_dir = os.path.join(DATA_DIR, f'chrome_profile_{profile_name}')
    else:
        auth_profile_dir = os.path.join(DATA_DIR, 'chrome_auth_profile')

    if chrome_path:
        try:
            # 완전히 독립된 Chrome 앱 모드로 실행 (기존 Chrome에 영향 없음)
            subprocess.Popen([
                chrome_path,
                f'--user-data-dir={auth_profile_dir}',
                '--no-first-run',
                '--no-default-browser-check',
                f'--app={url}',  # 앱 모드: 독립 창으로 열림, 기존 Chrome과 완전 분리
            ])
            return True
        except Exception as e:
            print(f"Chrome 실행 실패: {e}")

    import webbrowser
    webbrowser.open(url)
    return False


def get_auth_url_with_localhost(port):
    """
    localhost 리다이렉트 방식의 인증 URL을 생성합니다.
    """
    client_id = config.get_client_id()
    client_secret = config.get_client_secret()

    if not client_id or not client_secret:
        return None, None

    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [f"http://localhost:{port}/"]
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    flow.redirect_uri = f"http://localhost:{port}/"

    # select_account: 항상 구글 계정 선택 화면 표시
    # consent: 권한 동의 화면 표시
    auth_url, _ = flow.authorization_url(
        prompt='select_account consent',
        access_type='offline'
    )

    return flow, auth_url


class AuthHandler(BaseHTTPRequestHandler):
    """OAuth 콜백을 처리하는 HTTP 핸들러"""

    def log_message(self, format, *args):
        pass  # 로그 출력 안 함

    def do_GET(self):
        global _auth_result

        query = urlparse(self.path).query
        params = parse_qs(query)

        if 'code' in params:
            _auth_result['code'] = params['code'][0]
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            html = '''
            <!DOCTYPE html>
            <html>
            <head><title>로그인 완료</title></head>
            <body style="font-family:sans-serif;text-align:center;padding:50px;background:#1a1a1a;color:#fff;">
                <h1 style="color:#4caf50;">✓ 로그인 완료!</h1>
                <p>이 창을 닫고 프로그램으로 돌아가세요.</p>
                <script>setTimeout(()=>window.close(),2000);</script>
            </body>
            </html>
            '''
            self.wfile.write(html.encode('utf-8'))
        elif 'error' in params:
            _auth_result['error'] = params.get('error_description', params['error'])[0]
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            html = f'''
            <!DOCTYPE html>
            <html>
            <head><title>로그인 실패</title></head>
            <body style="font-family:sans-serif;text-align:center;padding:50px;background:#1a1a1a;color:#fff;">
                <h1 style="color:#f44336;">✗ 로그인 실패</h1>
                <p>{_auth_result['error']}</p>
                <script>setTimeout(()=>window.close(),3000);</script>
            </body>
            </html>
            '''
            self.wfile.write(html.encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()


def start_auth_server(port):
    """인증 콜백 서버를 시작합니다."""
    global _auth_server, _auth_result
    _auth_result = {'code': None, 'error': None}

    print(f"[인증] localhost:{port}에서 콜백 대기 중...")
    _auth_server = HTTPServer(('localhost', port), AuthHandler)
    _auth_server.timeout = 300  # 5분 타임아웃 (충분한 시간 제공)

    # 단일 요청만 처리
    _auth_server.handle_request()
    _auth_server.server_close()
    _auth_server = None

    print(f"[인증] 콜백 수신 완료: code={bool(_auth_result.get('code'))}, error={_auth_result.get('error')}")
    return _auth_result


def get_auth_url():
    """수동 코드 입력용 인증 URL (fallback)"""
    client_id = config.get_client_id()
    client_secret = config.get_client_secret()

    if not client_id or not client_secret:
        return None, None

    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob"]
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    flow.redirect_uri = "urn:ietf:wg:oauth:2.0:oob"

    auth_url, _ = flow.authorization_url(
        prompt='consent',
        access_type='offline'
    )

    return flow, auth_url


def exchange_code_for_token(flow, code, account_id=None):
    """
    인증 코드를 토큰으로 교환합니다.

    Args:
        flow: OAuth flow 객체
        code: 사용자가 입력한 인증 코드
        account_id: 계정 ID (멀티 계정용, None이면 현재 계정)

    Returns:
        Credentials 또는 None
    """
    try:
        flow.fetch_token(code=code)
        creds = flow.credentials

        # 토큰 저장 경로 결정
        if account_id:
            token_path = account_manager.get_account_token_path(account_id)
        else:
            # 현재 계정 또는 기본 경로
            token_path = account_manager.get_current_token_path()
            if not token_path:
                token_path = TOKEN_FILE

        # 토큰 저장
        with open(token_path, 'w') as token:
            token.write(creds.to_json())

        return creds
    except Exception as e:
        print(f"토큰 교환 실패: {e}")
        return None


def get_authenticated_service(account_id=None):
    """
    OAuth 인증된 YouTube API 서비스를 반환합니다.

    Args:
        account_id: 계정 ID (None이면 현재 계정 사용)

    Returns:
        YouTube API 서비스 객체 또는 None
    """
    if not config.is_configured():
        print("오류: API 설정이 필요합니다. 프로그램에서 'API 설정하기' 버튼을 클릭하세요.")
        return None

    # 토큰 파일 경로 결정
    if account_id:
        token_path = account_manager.get_account_token_path(account_id)
    else:
        # 현재 계정의 토큰 경로
        token_path = account_manager.get_current_token_path()
        if not token_path:
            # 마이그레이션 시도
            account_manager.migrate_single_token()
            token_path = account_manager.get_current_token_path()

        # 여전히 없으면 기존 경로 확인
        if not token_path and os.path.exists(TOKEN_FILE):
            token_path = TOKEN_FILE

    if not token_path:
        return None

    creds = None

    # 저장된 토큰 확인
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    # 토큰이 없거나 유효하지 않으면 인증 진행
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            # 토큰 갱신
            try:
                creds.refresh(Request())
                # 갱신된 토큰 저장
                with open(token_path, 'w') as token:
                    token.write(creds.to_json())
            except Exception as e:
                print(f"토큰 갱신 실패: {e}")
                creds = None

        if not creds:
            # 새 로그인이 필요함 - None 반환하여 UI에서 수동 로그인 처리하도록 함
            # (UI에서 start_login → complete_login 흐름 사용)
            return None

    # YouTube API 서비스 생성
    return build('youtube', 'v3', credentials=creds)


def is_configured():
    """OAuth 설정이 완료되었는지 확인합니다."""
    return config.is_configured()


def is_authenticated(account_id=None):
    """
    인증 상태를 확인합니다. 토큰이 만료되었으면 갱신을 시도합니다.

    Args:
        account_id: 계정 ID (None이면 현재 계정 확인)
    """
    # 토큰 파일 경로 결정
    if account_id:
        # 특정 계정의 인증 상태 확인 - 해당 계정의 API 자격 증명이 있는지도 확인
        if not account_manager.has_account_api_credentials(account_id):
            return False
        token_path = account_manager.get_account_token_path(account_id)
    else:
        token_path = account_manager.get_current_token_path()
        # 마이그레이션 시도
        if not token_path:
            account_manager.migrate_single_token()
            token_path = account_manager.get_current_token_path()
        # 여전히 없으면 기존 경로 확인
        if not token_path and os.path.exists(TOKEN_FILE):
            token_path = TOKEN_FILE

    if not token_path or not os.path.exists(token_path):
        return False

    try:
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        if not creds:
            return False

        # 토큰이 유효하면 True
        if creds.valid:
            return True

        # 토큰이 만료되었지만 refresh_token이 있으면 갱신 시도
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                # 갱신 성공 시 토큰 저장
                with open(token_path, 'w') as token:
                    token.write(creds.to_json())
                return True
            except Exception as e:
                print(f"토큰 자동 갱신 실패: {e}")
                # 갱신 실패 시 토큰 파일 삭제
                os.remove(token_path)
                return False

        return False
    except Exception:
        return False


def logout(account_id=None):
    """
    저장된 토큰을 삭제합니다.

    Args:
        account_id: 계정 ID (None이면 현재 계정의 토큰 삭제)
    """
    if account_id:
        token_path = account_manager.get_account_token_path(account_id)
    else:
        token_path = account_manager.get_current_token_path()
        if not token_path:
            token_path = TOKEN_FILE

    if token_path and os.path.exists(token_path):
        os.remove(token_path)
        return True
    return False
