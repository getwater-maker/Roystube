# 로이의 영상찾기

YouTube 구독 채널에서 조건에 맞는 영상을 찾아주는 데스크톱 앱입니다.

## 기능

- **일반 필터**: 구독자 수 N명 이하 채널에서 조회수 M회 이상 영상 찾기
- **돌연변이 필터**: 조회수/구독자 비율이 높은 영상 찾기
- RSS 피드 기반으로 API 쿼터 절약
- 24시간 캐시로 빠른 재검색

## 설치

### 1. 저장소 클론
```bash
git clone https://github.com/your-username/youtube-subscriber-search.git
cd youtube-subscriber-search
```

### 2. 가상환경 생성 및 패키지 설치
```bash
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Mac/Linux

pip install -r requirements.txt
```

### 3. Google API 설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트 생성
2. YouTube Data API v3 활성화
3. OAuth 2.0 클라이언트 ID 생성 (데스크톱 앱)
4. `config.example.py`를 `config.py`로 복사
5. CLIENT_ID, CLIENT_SECRET 입력

```bash
copy config.example.py config.py
# 에디터로 config.py 열어서 실제 값 입력
```

### 4. 실행
```bash
python main.py
```

## 사용법

1. Google 계정으로 로그인
2. "채널 불러오기" 클릭
3. 필터 조건 설정 (일반/돌연변이)
4. "검색" 클릭
5. 결과에서 영상 클릭하면 YouTube로 이동

## 파일 구조

```
youtube-subscriber-search/
├── main.py           # Eel 앱 메인
├── auth.py           # OAuth 인증
├── youtube_api.py    # YouTube API 호출
├── rss_fetcher.py    # RSS 피드 수집
├── cache_manager.py  # 캐시 관리
├── config.py         # API 키 (gitignore)
├── requirements.txt  # 패키지 목록
└── web/              # 프론트엔드
    ├── index.html
    ├── style.css
    └── script.js
```

## 주의사항

- `config.py`와 `token.json`은 절대 공유하지 마세요
- YouTube API 일일 쿼터: 10,000 유닛
