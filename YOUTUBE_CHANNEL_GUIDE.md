# YouTube 다중 채널 관리 가이드

## 개요

RoysCreator에서 하나의 Google 계정으로 로그인하여 **관리자 권한이 있는 여러 YouTube 채널**에 접근할 수 있습니다.

## 작동 원리

1. **OAuth 로그인**: Google 계정(A계정)으로 OAuth 인증
2. **채널 목록 조회**: A계정이 접근 가능한 모든 채널 표시
   - A계정 자체의 채널
   - A계정이 관리자/편집자 권한을 받은 브랜드 채널들
3. **채널 선택**: 작업할 채널을 선택
4. **API 작업 수행**: 선택된 채널에 대해 업로드, 조회 등 수행

## 사용 방법

### 1. OAuth 설정 (최초 1회)

**계정 관리** 탭에서:
1. "🔐 OAuth 계정" 섹션에 Client ID와 Client Secret 입력
2. 💾 저장 버튼 클릭

### 2. 계정 로그인

1. **➕ 계정 추가** 버튼 클릭
2. Google 계정 로그인 화면에서 A계정으로 로그인
3. 권한 동의 화면에서 모든 권한 승인

### 3. 채널 목록 불러오기

**계정 관리** 탭 → **📺 채널 관리** 섹션에서:
1. **🔄 채널 목록 불러오기** 버튼 클릭
2. A계정이 접근 가능한 모든 채널이 표시됨

### 4. 채널 선택

- 목록에서 작업할 채널을 클릭
- 선택된 채널에 "✓ 선택됨" 배지 표시
- 이후 모든 YouTube API 작업은 선택된 채널에서 수행됨

## 주요 기능

### 채널 정보 표시

각 채널 카드에 다음 정보 표시:
- 채널 썸네일 (프로필 이미지)
- 채널명
- 커스텀 URL (@핸들)
- 구독자 수
- 영상 수
- 총 조회수

### 채널 새로고침

채널 목록을 다시 불러오려면:
- **🔄 채널 목록 불러오기** 버튼 다시 클릭
- API에서 최신 채널 목록을 가져옴

## API 권한

채널 관리를 위해 필요한 YouTube API 스코프:
- `https://www.googleapis.com/auth/youtube`
- `https://www.googleapis.com/auth/youtube.force-ssl`

이 권한으로 다음 작업 가능:
- 채널 정보 조회
- 영상 업로드/수정/삭제
- 재생목록 관리
- 댓글 조회/작성

## 기술 세부사항

### 백엔드 함수

```python
# 채널 목록 조회
youtube_get_my_channels(account_id=None)

# 채널 선택
youtube_select_channel(account_id, channel_id)

# 선택된 채널 조회
youtube_get_selected_channel(account_id=None)

# 채널 새로고침
youtube_refresh_channels(account_id=None)
```

### 데이터 저장

- **채널 목록**: `~/.audiovis_tts_app_data/channel_contexts.json`
- **OAuth 토큰**: `~/.audiovis_tts_app_data/tokens/token_{account_id}.json`
- **계정 정보**: `~/.audiovis_tts_app_data/accounts.json`

### 파일 구조

```
d:\RoysCreator\
├── youtube_api.py           # get_my_channels() 추가
├── channel_context.py       # 새 파일: 채널 컨텍스트 관리
├── studio_backend.py        # Eel 함수 추가
└── web\
    ├── index.html          # 채널 관리 UI 추가
    ├── style.css           # 채널 스타일 추가
    └── app.js              # 채널 로드/선택 함수 추가
```

## 문제 해결

### 채널이 표시되지 않음

1. **로그인 확인**: YouTube 계정에 로그인했는지 확인
2. **권한 확인**: OAuth 권한을 모두 승인했는지 확인
3. **API 키 확인**: OAuth Client ID/Secret이 올바른지 확인

### "인증이 필요합니다" 오류

- 다시 로그인 필요
- **계정 관리** 탭에서 계정 추가 다시 진행

### 특정 채널이 보이지 않음

- 해당 채널에 대한 관리자/편집자 권한이 있는지 확인
- 브랜드 계정의 경우 Google 계정과 채널이 올바르게 연결되어 있는지 확인

## 예시 시나리오

### 시나리오: A계정으로 3개 채널 관리

1. **A계정** (your@gmail.com) 로그인
2. 채널 목록 불러오기:
   - **A계정 개인 채널** (UC1234...)
   - **회사 채널** (UC5678...) - A계정이 관리자
   - **프로젝트 채널** (UC9012...) - A계정이 편집자
3. "회사 채널" 선택
4. 영상 업로드 → **회사 채널**에 업로드됨
5. "프로젝트 채널" 선택
6. 영상 업로드 → **프로젝트 채널**에 업로드됨

## 향후 개선 사항

- [ ] 채널별 업로드 기록 표시
- [ ] 채널별 통계 대시보드
- [ ] 여러 채널에 동시 업로드
- [ ] 채널 그룹 관리
