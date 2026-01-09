# RoyStudio 통합 가이드 - README

## 🎯 개요

이 문서는 RoyStudio (영상 제작 및 자막 동기화 도구)를 RoyYoutubeSearch (YouTube 검색 도구)에 통합하는 방법을 설명합니다.

---

## 📚 문서 구조

본 디렉토리에 있는 다음 문서들을 순서대로 읽으세요:

### 1️⃣ **INTEGRATION_SUMMARY.txt** ⭐ (먼저 읽기)
- **목적**: 빠른 개요 및 수정할 코드의 위치
- **대상**: 빠르게 구현하고 싶은 개발자
- **분량**: ~300줄
- **읽는 시간**: 10-15분

### 2️⃣ **ROYSTUDIO_INTEGRATION_GUIDE.md** (상세 가이드)
- **목적**: 단계별 상세 설명 및 전체 코드
- **대상**: 단계별로 정확하게 따라하고 싶은 개발자
- **분량**: ~800줄
- **읽는 시간**: 30-45분

### 3️⃣ **IMPLEMENTATION_CHECKLIST.md** (체크리스트)
- **목적**: 구현 과정 중 빠진 항목 확인
- **대상**: 구현 중이거나 테스트 중인 개발자
- **분량**: ~400줄
- **읽는 시간**: 10분 (실제 구현은 2-3시간)

### 4️⃣ **WHISPER_FUNCTION.py** (함수 소스)
- **목적**: Whisper 자막 생성 함수 복사용
- **대상**: main.py에 함수를 복사하려는 개발자
- **사용법**: 전체 내용을 복사해서 main.py의 @eel.expose 섹션에 붙여넣기

---

## 🚀 빠른 시작 (5분 요약)

### 준비
1. RoyStudio의 모든 파일을 RoyYoutubeSearch에 복사
2. `INTEGRATION_SUMMARY.txt` 읽기

### 수정 항목
1. **main.py**: 4개 섹션 수정
   - Import 추가
   - Global 변수 추가
   - Helper 함수 추가
   - @eel.expose 함수 추가

2. **requirements.txt**: 완전히 교체

3. **build.spec**: VERSION과 hiddenimports 수정

4. **web/index.html**: 새로운 탭 추가

5. **web/script.js**: JavaScript 함수 추가

### 설치
```bash
pip install -r requirements.txt
# FFmpeg 별도 설치 필요
```

### 테스트
```bash
python main.py
```

---

## 📖 상세 가이드로 진행

### Step 1: INTEGRATION_SUMMARY.txt 읽기
빠른 개요를 이해합니다.

### Step 2: ROYSTUDIO_INTEGRATION_GUIDE.md로 단계별 진행
각 단계의 정확한 코드와 설명을 따릅니다.

### Step 3: IMPLEMENTATION_CHECKLIST.md로 확인
모든 항목이 제대로 구현되었는지 체크합니다.

### Step 4: 테스트
기능이 정상 작동하는지 테스트합니다.

### Step 5: 빌드
PyInstaller로 최종 실행 파일을 만듭니다.

---

## 🔑 핵심 수정 사항

### 가장 중요한 3가지

#### 1. main.py에 generate_srt_with_whisper() 함수 추가
- **위치**: @eel.expose 함수 섹션
- **줄 수**: ~260줄
- **역할**: Whisper를 사용하여 MP3의 음성을 인식하고 TXT 파일의 각 줄에 정확한 타이밍 부여
- **소스**: WHISPER_FUNCTION.py 참고

#### 2. requirements.txt 업데이트
- **변경**: 완전히 교체 (기존 내용 삭제)
- **추가 패키지**:
  - `moviepy`, `pillow`, `pydub`: 비디오/오디오 처리
  - `librosa`, `numpy`, `scipy`: 음향 분석
  - `google-cloud-texttospeech`: TTS
  - `openai-whisper`: 음성 인식
  - `matplotlib`: 시각화
  - `edge-tts`: Edge TTS 지원

#### 3. build.spec의 hiddenimports 수정
- **변경**: hiddenimports 리스트에 20+ 개 패키지 추가
- **목적**: PyInstaller 빌드 시 필요한 모듈이 포함되도록 함

---

## 📋 파일 구조 (복사 후)

```
RoyYoutubeSearch/
├── main.py                          (수정: import, global, 함수 추가)
├── config.py                        (복사: RoyStudio에서)
├── services.py                      (복사: RoyStudio에서)
├── utils.py                         (복사: RoyStudio에서)
├── pipeline_processor.py            (복사: RoyStudio에서)
│
├── requirements.txt                 (수정: 완전히 교체)
├── build.spec                       (수정: hiddenimports)
│
├── web/
│   ├── index.html                   (수정: RoyStudio 탭 추가)
│   ├── script.js                    (수정: JavaScript 함수 추가)
│   ├── style.css                    (수정: 스타일 추가)
│   ├── css/                         (복사: RoyStudio에서)
│   ├── js/                          (복사: RoyStudio에서)
│   └── images/                      (복사: RoyStudio에서)
│
├── icon.ico                         (복사: RoyStudio에서)
│
├── ROYSTUDIO_INTEGRATION_GUIDE.md   (이 디렉토리)
├── INTEGRATION_SUMMARY.txt          (이 디렉토리)
├── IMPLEMENTATION_CHECKLIST.md      (이 디렉토리)
├── WHISPER_FUNCTION.py              (이 디렉토리)
└── ROYSTUDIO_README.md              (이 파일)
```

---

## 🔧 필수 설치 항목

### Python 패키지
```bash
pip install -r requirements.txt
```

### FFmpeg (운영체제별)

**Windows**:
1. https://ffmpeg.org/download.html 방문
2. "Full" 버전 다운로드 및 설치
3. 또는: `choco install ffmpeg` (Chocolatey)

**macOS**:
```bash
brew install ffmpeg
```

**Linux**:
```bash
sudo apt install ffmpeg
```

**확인**:
```bash
ffmpeg -version
```

---

## 🎯 주요 기능

### 통합 후 사용 가능한 기능

#### 기존 기능 (YouTube 검색)
- ✅ YouTube 채널 검색
- ✅ 구독 채널 필터링
- ✅ 동영상 조회수 확인

#### 새로운 기능 (RoyStudio)
- ✅ MP3 파일의 음성 인식 (Whisper)
- ✅ 자막 자동 생성 (SRT 형식)
- ✅ 음성과 텍스트 자동 동기화
- ✅ 정확한 타이밍 정보 추출

---

## 💡 Whisper 음성 인식

### 작동 방식
1. 사용자가 MP3 파일 선택
2. 사용자가 TXT 파일 선택 (각 줄이 하나의 자막)
3. Whisper 모델이 MP3의 음성을 인식
4. 인식된 텍스트를 TXT 줄과 매칭
5. 각 줄의 시작/종료 시간 결정
6. SRT 파일 생성

### 모델 선택
| 모델 | 크기 | 속도 | 정확도 | 추천 용도 |
|------|------|------|--------|---------|
| tiny | 39MB | ⚡⚡⚡⚡⚡ | ⭐ | 빠른 테스트 |
| base | 140MB | ⚡⚡⚡⚡ | ⭐⭐ | 테스트 |
| small | 466MB | ⚡⚡⚡ | ⭐⭐⭐ | 일반 용도 |
| **medium** | **1.4GB** | **⚡⚡** | **⭐⭐⭐⭐** | **권장** |
| large | 2.9GB | ⚡ | ⭐⭐⭐⭐⭐ | 최고 정확도 |

---

## ⚠️ 주의사항

### 첫 실행 시
- Whisper 모델이 자동으로 다운로드됨 (1-3GB)
- 인터넷 연결 필수
- 시간이 걸릴 수 있음 (네트워크 속도에 따라)

### 음성 인식 정확도
- MP3와 TXT 파일이 **정확히 같은 내용**이어야 함
- 음질이 좋을수록 정확도 높음
- 배경음이 적을수록 정확도 높음
- 더 큰 모델(medium, large)이 더 정확함

### 처리 시간
- 10분 영상: 2-5분 (medium 모델)
- 30분 영상: 10-30분 (medium 모델)
- 60분 영상: 30-60분 (medium 모델)

---

## 🐛 일반적인 문제 해결

### 1. "Whisper 패키지가 설치되지 않았습니다" 오류
```bash
pip install openai-whisper
```

### 2. "FFmpeg를 찾을 수 없습니다" 오류
- FFmpeg가 설치되어 있는지 확인
- PATH 환경 변수에 FFmpeg 경로가 있는지 확인
- `ffmpeg -version` 실행해서 테스트

### 3. "config 모듈을 찾을 수 없습니다" 오류
- RoyStudio의 `config.py`를 RoyYoutubeSearch 폴더에 복사했는지 확인
- `services.py`, `utils.py` 등 모든 파일이 복사되었는지 확인

### 4. SRT 파일 생성이 느림
- 인터넷 연결 확인
- 더 작은 모델 사용 시도 (large → medium → small)
- 파일 크기 확인

### 5. SRT 자막 타이밍이 맞지 않음
- MP3와 TXT 내용이 정확히 같은지 확인
- MP3 음질 확인 (잡음 제거)
- 더 큰 모델 사용 (small → medium → large)

---

## 📚 추가 학습

### Whisper 관련
- [OpenAI Whisper GitHub](https://github.com/openai/whisper)
- [Whisper 모델 비교](https://github.com/openai/whisper#available-models)

### Eel 프레임워크
- [Eel 문서](https://github.com/ChrisKnott/Eel)
- [Python-JavaScript 통신](https://github.com/ChrisKnott/Eel/wiki)

### PyInstaller
- [PyInstaller 문서](https://pyinstaller.org)
- [Hidden imports](https://pyinstaller.org/en/latest/hooks-config.html)

---

## 📞 지원

### 문서 확인
1. 이 파일 (ROYSTUDIO_README.md)
2. INTEGRATION_SUMMARY.txt
3. ROYSTUDIO_INTEGRATION_GUIDE.md
4. IMPLEMENTATION_CHECKLIST.md

### 자주 묻는 질문
IMPLEMENTATION_CHECKLIST.md의 "추가 도움" 섹션 참고

### 오류 해결
IMPLEMENTATION_CHECKLIST.md의 "🐛 오류 발생 시 대처" 섹션 참고

---

## ✅ 체크리스트

통합을 시작하기 전에:

- [ ] RoyStudio의 모든 파일을 복사했는가?
- [ ] Python 3.9 이상을 사용하는가?
- [ ] 충분한 디스크 공간이 있는가 (~5GB)?
- [ ] 인터넷 연결이 안정적인가?
- [ ] FFmpeg를 설치할 수 있는가?

준비 완료되었으면:

1. **INTEGRATION_SUMMARY.txt** 읽기 (5-10분)
2. **ROYSTUDIO_INTEGRATION_GUIDE.md** 따라하기 (1-2시간)
3. **IMPLEMENTATION_CHECKLIST.md**로 확인 (30분)
4. **테스트** (30분)
5. **빌드** (10-30분)

---

## 🎉 완료!

모든 단계를 완료하면:

✅ RoyStudio가 RoyYoutubeSearch에 통합됨
✅ Whisper 기반 자막 생성 가능
✅ MP3 음성 자동 인식
✅ 정확한 타이밍 정보 추출
✅ 통합 애플리케이션 빌드 완료

---

**행운을 빕니다! 🚀**

궁금한 점이 있으면 문서를 다시 읽거나, 오류 메시지를 검색해보세요.
