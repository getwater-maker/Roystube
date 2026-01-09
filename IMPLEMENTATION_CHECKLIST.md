# RoyStudio 통합 구현 체크리스트

## 📋 사전 준비

### 파일 복사
- [ ] RoyStudio의 모든 파일 (`.py`, `web/` 폴더 등)을 RoyYoutubeSearch 디렉토리에 복사
  - [ ] `config.py`
  - [ ] `services.py`
  - [ ] `utils.py`
  - [ ] `pipeline_processor.py`
  - [ ] `web/` 디렉토리 (css/, js/, images/, index.html 포함)
  - [ ] `icon.ico` (기존 파일 덮어쓰기 또는 병합)

### 문서 확인
- [ ] `ROYSTUDIO_INTEGRATION_GUIDE.md` 읽음
- [ ] `INTEGRATION_SUMMARY.txt` 읽음
- [ ] `WHISPER_FUNCTION.py` 검토

---

## 🔧 코드 수정 (main.py)

### Step 1: Import 추가 (줄 44 다음)
- [ ] 다음 import 블록을 추가:
  ```python
  import io
  import base64
  from pathlib import Path
  import logging
  import multiprocessing

  try:
      import config as roystudio_config
      import utils
      import services
      from pipeline_processor import PipelineProcessor
      ROYSTUDIO_AVAILABLE = True
  except ImportError as e:
      ROYSTUDIO_AVAILABLE = False

  try:
      utils.ensure_pydub_ffmpeg_paths()
  except:
      pass
  ```

### Step 2: Global 변수 추가 (줄 50 근처)
- [ ] 다음을 추가:
  ```python
  roystudio_cancel_event = threading.Event()
  roystudio_progress = {'current': 0, 'total': 0, 'message': ''}
  whisper_model = None
  whisper_model_name = None
  whisper_cancel_event = threading.Event()
  ```

### Step 3: Helper 함수 추가 (if __name__ == '__main__' 이전)
- [ ] `format_timestamp()` 함수 추가 (3줄)
- [ ] `normalize_text_for_comparison()` 함수 추가 (4줄)

  **소스**: ROYSTUDIO_INTEGRATION_GUIDE.md의 "Step 4"

### Step 4: @eel.expose 함수 추가
- [ ] `select_mp3_for_roystudio()` 추가
- [ ] `select_txt_for_roystudio()` 추가
- [ ] `cancel_roystudio_generation()` 추가
- [ ] `generate_srt_with_whisper()` 추가 ⭐ (가장 중요! ~260줄)

  **소스**: WHISPER_FUNCTION.py 또는 ROYSTUDIO_INTEGRATION_GUIDE.md의 "Step 5"

---

## 📦 설정 파일 수정

### requirements.txt
- [ ] 파일 **완전히 교체** (기존 내용 삭제 후 새로운 내용 추가)

  **소스**: ROYSTUDIO_INTEGRATION_GUIDE.md의 "Step 6"

- [ ] 변경 후 설치:
  ```bash
  pip install -r requirements.txt
  ```

### build.spec
- [ ] `VERSION = '2.2.0'` 로 업데이트
- [ ] `hiddenimports` 리스트에 다음 추가:
  ```
  'eel',
  'bottle',
  'moviepy',
  'imageio',
  'imageio_ffmpeg',
  'librosa',
  'google.cloud.texttospeech',
  'google.oauth2.service_account',
  'pydub',
  'matplotlib',
  'numpy',
  'scipy',
  'edge_tts',
  'aiohttp',
  'lxml',
  'lxml.etree',
  'asyncio.windows_events',
  'asyncio.windows_utils',
  ```

---

## 🎨 웹 UI 수정 (web/)

### web/index.html
- [ ] RoyStudio 탭 HTML 추가 (기존 탭 다음에)
  - [ ] 헤더: `<h2>📹 영상 스튜디오 (RoyStudio)</h2>`
  - [ ] MP3 파일 선택 버튼
  - [ ] TXT 파일 선택 버튼
  - [ ] Whisper 모델 선택 드롭다운
  - [ ] 언어 선택 드롭다운
  - [ ] SRT 생성 버튼
  - [ ] 진행률 표시 영역
  - [ ] 로그 출력 영역

  **소스**: ROYSTUDIO_INTEGRATION_GUIDE.md의 "Step 8"

### web/script.js (또는 web/app.js)
- [ ] JavaScript 함수 추가:
  - [ ] `selectMp3ForRoyStudio()`
  - [ ] `selectTxtForRoyStudio()`
  - [ ] `generateSrtWithWhisper()`
  - [ ] `cancelSrtGeneration()`
  - [ ] `logSubtitleMessage()` (eel.expose)
  - [ ] `updateSubtitleProgress()` (eel.expose)

  **소스**: ROYSTUDIO_INTEGRATION_GUIDE.md의 "Step 9"

### web/css/style.css (선택사항)
- [ ] RoyStudio UI에 필요한 스타일 추가 (드롭다운, 버튼, 로그 박스 등)

  **소스**: RoyStudio의 web/css/style.css 참고

---

## 🔨 필수 외부 프로그램 설치

### FFmpeg 설치 (필수!)
- [ ] **Windows**:
  - [ ] https://ffmpeg.org/download.html 에서 다운로드
  - [ ] 또는: `choco install ffmpeg` (Chocolatey 사용)
  - [ ] PATH에 추가되었는지 확인: `ffmpeg -version` 실행

- [ ] **macOS**:
  - [ ] `brew install ffmpeg` 실행

- [ ] **Linux**:
  - [ ] `sudo apt install ffmpeg` 실행

### Python 패키지 설치
- [ ] `pip install -r requirements.txt` 실행
- [ ] Whisper 모델 다운로드 (처음 실행 시 자동):
  - [ ] medium 모델: ~1.4GB
  - [ ] large 모델: ~2.9GB

---

## ✅ 테스트

### 개발 환경 테스트
- [ ] `python main.py` 실행
- [ ] 기존 YouTube 검색 기능 정상 작동
- [ ] RoyStudio 탭이 UI에 표시됨
- [ ] MP3 파일 선택 가능
- [ ] TXT 파일 선택 가능
- [ ] Whisper 모델 선택 가능
- [ ] 언어 선택 가능
- [ ] SRT 생성 버튼 동작

### 기능 테스트
#### 테스트 파일 준비
- [ ] 테스트용 MP3 파일 준비 (10-30초 권장)
- [ ] 테스트용 TXT 파일 준비 (MP3와 같은 내용)

#### Whisper SRT 생성 테스트
- [ ] MP3 파일 선택
- [ ] TXT 파일 선택
- [ ] Whisper 모델 선택 (medium 권장)
- [ ] 언어 선택 (한국어: ko)
- [ ] SRT 생성 버튼 클릭
- [ ] Whisper 모델 다운로드 진행 상황 확인 (첫 실행)
- [ ] 음성 인식 진행 상황 확인
- [ ] SRT 파일 생성 완료 확인
- [ ] 생성된 SRT 파일 내용 확인
  - [ ] 올바른 형식인가? (index, timecode, text)
  - [ ] 자막이 음성과 맞는가?
  - [ ] 모든 줄이 포함되었는가?

### 문제 해결 테스트
- [ ] 비어있는 MP3 파일로 테스트 → 오류 메시지 확인
- [ ] 비어있는 TXT 파일로 테스트 → 오류 메시지 확인
- [ ] 잘못된 경로로 테스트 → 오류 메시지 확인
- [ ] 취소 버튼 테스트 → SRT 생성 중지 확인

---

## 🔨 빌드

### PyInstaller 빌드
- [ ] 명령어 실행: `pyinstaller build.spec`
- [ ] 빌드 완료 확인 (dist/ 폴더에 exe 생성)
- [ ] 실행 파일명 확인: `로이의영상찾기_2.2.0.exe`

### 빌드 후 테스트
- [ ] 생성된 exe 파일 실행
- [ ] YouTube 검색 기능 테스트
- [ ] RoyStudio 탭 표시 확인
- [ ] Whisper SRT 생성 테스트

---

## 🐛 오류 발생 시 대처

| 오류 | 원인 | 해결 방법 |
|------|------|---------|
| `ModuleNotFoundError: No module named 'config'` | RoyStudio 파일 복사 안 함 | RoyStudio 모든 파일 복사 |
| `ImportError: openai-whisper` | Whisper 미설치 | `pip install openai-whisper` |
| `FileNotFoundError: ffmpeg` | FFmpeg 미설치 | FFmpeg 설치 및 PATH 추가 |
| `AttributeError: logSubtitleMessage` | JavaScript에서 Python 함수 호출 안 함 | eel.expose 데코레이터 확인 |
| Whisper 모델 다운로드 느림 | 네트워크 느림 또는 모델 크기 | 작은 모델(tiny/base) 사용 후 재시도 |
| SRT 자막 싱크 맞지 않음 | MP3/TXT 내용 불일치 또는 음질 | 더 큰 모델(large) 사용 |

---

## 📚 참고 자료

| 문서 | 설명 |
|------|------|
| `ROYSTUDIO_INTEGRATION_GUIDE.md` | 상세한 단계별 통합 가이드 |
| `INTEGRATION_SUMMARY.txt` | 빠른 요약 및 체크리스트 |
| `WHISPER_FUNCTION.py` | Whisper 함수 복사용 파일 |
| `IMPLEMENTATION_CHECKLIST.md` | 이 파일 - 구현 체크리스트 |

---

## ✨ 완료!

모든 항목을 체크했다면:

1. ✅ 파일 복사 완료
2. ✅ main.py 수정 완료
3. ✅ 설정 파일 업데이트 완료
4. ✅ 웹 UI 추가 완료
5. ✅ 필수 프로그램 설치 완료
6. ✅ 테스트 완료
7. ✅ 빌드 완료

**축하합니다! RoyStudio가 RoyYoutubeSearch에 성공적으로 통합되었습니다!** 🎉

---

## 📞 추가 도움

### 자주 묻는 질문 (FAQ)

**Q: Whisper 모델을 어떤 것으로 선택해야 하나?**
A: 정확도와 속도의 트레이드오프:
- `tiny`: 빠르지만 정확도 낮음 (~30분 영상 5분)
- `base`: 중간 (~30분 영상 10분)
- `small`: 좋음 (~30분 영상 15분)
- `medium`: 권장 (~30분 영상 20-30분)
- `large`: 최고 정확도 (~30분 영상 1시간 이상)

**Q: SRT 자막이 정확하지 않아요**
A: 다음을 확인하세요:
1. MP3와 TXT 파일이 같은 내용인가?
2. MP3 음질이 좋은가?
3. 더 큰 모델(medium→large)을 사용해봤는가?

**Q: FFmpeg를 설치했는데도 오류가 나요**
A: 터미널에서 `ffmpeg -version` 실행해서 PATH에 있는지 확인하세요.

---

## 🎬 다음 단계

1. **배포**: 빌드된 exe를 사용자에게 배포
2. **피드백**: 사용자 피드백 수집
3. **개선**: 필요시 추가 기능 구현
4. **문서화**: 사용자 설명서 작성

