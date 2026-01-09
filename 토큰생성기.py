# -*- coding: utf-8 -*-
"""
토큰 생성기
- json 폴더의 OAuth 파일을 선택하여 토큰 파일 생성
- 한 번만 실행하면 이후 메인 프로그램에서 로그인 없이 사용 가능
"""

import os
import sys
import json
from google_auth_oauthlib.flow import InstalledAppFlow

# OAuth 스코프
SCOPES = [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl'
]


def get_json_dir():
    """json 폴더 경로 반환"""
    if getattr(sys, 'frozen', False):
        exe_dir = os.path.dirname(sys.executable)
    else:
        exe_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(exe_dir, 'json')


def get_oauth_files():
    """OAuth 파일 목록 반환"""
    json_dir = get_json_dir()
    if not os.path.exists(json_dir):
        return []

    files = []
    for filename in os.listdir(json_dir):
        if filename.endswith('_OAuth.json'):
            name_part = filename.replace('_OAuth.json', '')
            token_file = name_part + '_token.json'
            token_path = os.path.join(json_dir, token_file)
            has_token = os.path.exists(token_path)

            files.append({
                'filename': filename,
                'name_part': name_part,
                'token_file': token_file,
                'has_token': has_token,
                'path': os.path.join(json_dir, filename)
            })
    return files


def create_token(oauth_file):
    """토큰 생성"""
    json_dir = get_json_dir()
    oauth_path = oauth_file['path']
    token_path = os.path.join(json_dir, oauth_file['token_file'])

    print(f"\n[{oauth_file['name_part']}] 토큰 생성 중...")
    print("브라우저에서 구글 로그인을 진행하세요.")
    print("중요: 이 OAuth 파일에 해당하는 구글 계정으로 로그인하세요!\n")

    try:
        # OAuth 파일 로드
        with open(oauth_path, 'r', encoding='utf-8') as f:
            client_config = json.load(f)

        # Flow 생성 (run_local_server 사용 - 가장 안정적)
        flow = InstalledAppFlow.from_client_config(client_config, SCOPES)

        # 로컬 서버로 인증 (브라우저 자동 열림)
        creds = flow.run_local_server(
            port=0,  # 사용 가능한 포트 자동 선택
            prompt='consent',
            success_message='인증 완료! 이 창을 닫아도 됩니다.',
            open_browser=True
        )

        # 토큰 저장
        with open(token_path, 'w', encoding='utf-8') as f:
            f.write(creds.to_json())

        print(f"토큰 저장 완료: {oauth_file['token_file']}")
        return True

    except Exception as e:
        print(f"토큰 생성 실패: {e}")
        return False


def main():
    print("=" * 50)
    print("       토큰 생성기")
    print("=" * 50)
    print("\njson 폴더의 OAuth 파일에 대한 토큰을 생성합니다.")
    print("한 번 생성하면 메인 프로그램에서 로그인 없이 사용 가능합니다.\n")

    # json 폴더 확인
    json_dir = get_json_dir()
    if not os.path.exists(json_dir):
        print(f"오류: json 폴더가 없습니다: {json_dir}")
        print("이 파일과 같은 폴더에 'json' 폴더를 만들고 OAuth 파일을 넣어주세요.")
        input("\n아무 키나 누르면 종료...")
        return

    # OAuth 파일 목록
    oauth_files = get_oauth_files()
    if not oauth_files:
        print("오류: json 폴더에 OAuth 파일이 없습니다.")
        print("'이름_이메일_OAuth.json' 형식의 파일을 넣어주세요.")
        input("\n아무 키나 누르면 종료...")
        return

    while True:
        print("\n" + "-" * 50)
        print("OAuth 파일 목록:")
        print("-" * 50)

        for i, f in enumerate(oauth_files, 1):
            status = "[토큰있음]" if f['has_token'] else "[토큰없음]"
            print(f"  {i}. {f['name_part']} {status}")

        print(f"\n  0. 종료")
        print(f"  A. 토큰 없는 계정 전체 생성")
        print("-" * 50)

        choice = input("선택 (번호 또는 A): ").strip().upper()

        if choice == '0':
            print("종료합니다.")
            break
        elif choice == 'A':
            # 토큰 없는 계정 전체 생성
            no_token = [f for f in oauth_files if not f['has_token']]
            if not no_token:
                print("\n모든 계정에 토큰이 있습니다.")
                continue

            print(f"\n토큰 없는 {len(no_token)}개 계정의 토큰을 생성합니다.")
            for f in no_token:
                if create_token(f):
                    f['has_token'] = True
                input("\n다음 계정으로 진행하려면 Enter...")
        else:
            try:
                idx = int(choice) - 1
                if 0 <= idx < len(oauth_files):
                    if create_token(oauth_files[idx]):
                        oauth_files[idx]['has_token'] = True
                else:
                    print("잘못된 번호입니다.")
            except ValueError:
                print("잘못된 입력입니다.")

    input("\n아무 키나 누르면 종료...")


if __name__ == '__main__':
    main()
