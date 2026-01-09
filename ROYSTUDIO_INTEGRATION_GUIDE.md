# RoyStudio를 RoyYoutubeSearch에 통합하는 가이드

## 📋 개요

이 가이드는 RoyStudio의 영상 제작 및 자막 싱크 기능을 RoyYoutubeSearch에 통합하는 방법을 설명합니다.

### 통합 후 기능
- ✅ YouTube 영상 검색 (기존)
- ✅ 영상 대본 작성 및 자막 싱크 (새로 추가)
- ✅ TTS 음성 합성
- ✅ 비디오 제작 및 렌더링
- ✅ Whisper 기반 정확한 자막 생성

---

## 🔧 통합 단계

### 1단계: 파일 복사

RoyStudio의 모든 파일을 RoyYoutubeSearch 폴더에 복사합니다:

```
RoyYoutubeSearch/
├── main.py (수정 필요)
├── config.py (추가)
├── services.py (추가)
├── utils.py (추가)
├── pipeline_processor.py (추가)
├── requirements.txt (수정 필요)
├── build.spec (수정 필요)
└── web/
    ├── index.html (수정 필요)
    ├── css/
    │   └── style.css (추가)
    ├── js/
    │   └── app.js (추가)
    └── images/ (추가)
```

---

### 2단계: main.py에 import 추가

**위치**: `main.py` 상단, 기존 import 섹션 아래 (약 줄 44 다음)

```python
# === RoyStudio 통합을 위한 import ===
# 다음을 기존 import 섹션에 추가

import io
import base64
from pathlib import Path
import logging
import multiprocessing

# RoyStudio 모듈들
try:
    import config as roystudio_config  # utils.py 임포트 전에 필요
    import utils
    import services
    from pipeline_processor import PipelineProcessor
    ROYSTUDIO_AVAILABLE = True
except ImportError as e:
    print(f"[경고] RoyStudio 모듈 일부 임포트 실패: {e}")
    ROYSTUDIO_AVAILABLE = False

# FFmpeg 초기화 (pydub 및 moviepy 필수)
try:
    utils.ensure_pydub_ffmpeg_paths()
except:
    pass

# 로깅 설정
logging.getLogger('eel').setLevel(logging.CRITICAL)
logging.getLogger('gevent').setLevel(logging.CRITICAL)
logging.getLogger('matplotlib').setLevel(logging.CRITICAL)
```

---

### 3단계: global 변수 추가

**위치**: main.py의 global 변수 섹션 (약 줄 45-50)

```python
# === RoyStudio 관련 전역 변수 ===
roystudio_cancel_event = threading.Event()
roystudio_progress = {'current': 0, 'total': 0, 'message': ''}
whisper_model = None
whisper_model_name = None
whisper_cancel_event = threading.Event()
```

---

### 4단계: RoyStudio의 Helper 함수 추가

**위치**: main.py의 맨 끝, `if __name__ == '__main__':` 이전

```python
# === RoyStudio Helper Functions ===

def format_timestamp(seconds):
    """초를 SRT 타임스탬프 형식으로 변환 (HH:MM:SS,mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def normalize_text_for_comparison(text):
    """텍스트 비교를 위한 정규화 (공백, 특수문자 제거)"""
    import re
    # 공백, 구두점 제거하고 소문자로 변환
    text = re.sub(r'[^\w\s가-힣]', '', text)
    text = re.sub(r'\s+', '', text)
    return text.lower()

```

---

### 5단계: RoyStudio의 Eel expose 함수 추가

**위치**: main.py의 `@eel.expose` 함수들 구간 (약 줄 2000-4000 사이의 적절한 위치)

```python
# === RoyStudio 통합: Eel expose 함수들 ===

@eel.expose
def select_mp3_for_roystudio():
    """자막 생성용 MP3 파일 선택"""
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    file_path = filedialog.askopenfilename(
        title="MP3 파일 선택",
        filetypes=[
            ("MP3 파일", "*.mp3"),
            ("오디오 파일", "*.mp3;*.wav;*.m4a"),
            ("모든 파일", "*.*")
        ]
    )

    root.destroy()
    return file_path if file_path else None


@eel.expose
def select_txt_for_roystudio():
    """자막용 TXT 파일 선택"""
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    file_path = filedialog.askopenfilename(
        title="자막용 텍스트 파일 선택",
        filetypes=[
            ("텍스트 파일", "*.txt"),
            ("모든 파일", "*.*")
        ]
    )

    root.destroy()
    return file_path if file_path else None


@eel.expose
def cancel_roystudio_generation():
    """RoyStudio 자막 생성 취소"""
    global whisper_cancel_event
    whisper_cancel_event.set()
    return {'success': True}


@eel.expose
def log_roystudio_message(message):
    """RoyStudio 로그 메시지 (JavaScript에서 호출됨)"""
    print(f"[RoyStudio] {message}")


@eel.expose
def update_roystudio_progress(message, progress):
    """RoyStudio 진행 상황 업데이트"""
    global roystudio_progress
    roystudio_progress = {'message': message, 'progress': progress}


# === 핵심: Whisper 기반 자막 생성 함수 ===
@eel.expose
def generate_srt_with_whisper(mp3_path, txt_path, output_srt_path=None, model_name='medium', language='ko'):
    """
    Whisper 음성인식을 사용하여 TXT 파일의 각 줄에 정확한 타이밍 부여

    Args:
        mp3_path: TTS로 생성된 MP3 파일 경로
        txt_path: 자막용 텍스트 파일 경로 (줄 단위로 자막 생성)
        output_srt_path: SRT 출력 경로 (None이면 MP3와 같은 폴더에 생성)
        model_name: Whisper 모델 (tiny, base, small, medium, large)
        language: 언어 코드 (ko, en, ja 등)

    Returns:
        {'success': True, 'output_path': str, 'subtitle_count': int}
    """
    global whisper_model, whisper_model_name, whisper_cancel_event

    whisper_cancel_event.clear()

    try:
        eel.logSubtitleMessage(f"\n{'='*50}")
        eel.logSubtitleMessage(f"🎯 Whisper 기반 자막 싱크 생성 시작")
        eel.logSubtitleMessage(f"   (정확도 우선 모드)")
        eel.updateSubtitleProgress("파일 확인 중...", 2)

        # 파일 존재 확인
        if not os.path.exists(mp3_path):
            return {'success': False, 'error': f'MP3 파일을 찾을 수 없습니다: {mp3_path}'}

        if not os.path.exists(txt_path):
            return {'success': False, 'error': f'텍스트 파일을 찾을 수 없습니다: {txt_path}'}

        # 텍스트 파일 읽기 (줄 단위)
        eel.logSubtitleMessage(f"\n📝 텍스트 파일 읽는 중: {os.path.basename(txt_path)}")
        with open(txt_path, 'r', encoding='utf-8') as f:
            lines = [line.strip() for line in f.readlines() if line.strip()]

        if not lines:
            return {'success': False, 'error': '텍스트 파일이 비어있습니다.'}

        eel.logSubtitleMessage(f"   ✓ {len(lines)}줄 감지")

        # 출력 경로 결정
        if not output_srt_path:
            base_name = os.path.splitext(mp3_path)[0]
            output_srt_path = base_name + '.srt'

        # Whisper 모듈 로드
        eel.updateSubtitleProgress("Whisper 모듈 로딩 중...", 5)
        eel.logSubtitleMessage(f"\n📦 Whisper 모듈 로딩 중...")

        try:
            import whisper
        except ImportError:
            return {'success': False, 'error': 'openai-whisper 패키지가 설치되지 않았습니다.\npip install openai-whisper 를 실행하세요.'}

        if whisper_cancel_event.is_set():
            return {'success': False, 'error': '사용자가 취소했습니다.'}

        # 모델 로드
        eel.updateSubtitleProgress(f"Whisper '{model_name}' 모델 로딩 중...", 10)
        eel.logSubtitleMessage(f"   모델: {model_name}")
        eel.logSubtitleMessage(f"   (첫 실행 시 모델 다운로드가 필요합니다)")

        if whisper_model is None or whisper_model_name != model_name:
            whisper_model = whisper.load_model(model_name)
            whisper_model_name = model_name
            eel.logSubtitleMessage(f"   ✓ 모델 로드 완료")
        else:
            eel.logSubtitleMessage(f"   ✓ 기존 로드된 모델 재사용")

        if whisper_cancel_event.is_set():
            return {'success': False, 'error': '사용자가 취소했습니다.'}

        # 음성 인식 시작
        eel.updateSubtitleProgress("음성 인식 중... (시간이 걸릴 수 있습니다)", 20)
        eel.logSubtitleMessage(f"\n🎤 음성 인식 시작: {os.path.basename(mp3_path)}")
        eel.logSubtitleMessage(f"   언어: {language}")
        eel.logSubtitleMessage(f"   word_timestamps: True (단어별 타이밍 추출)")
        eel.logSubtitleMessage(f"   ⏳ 처리 중... (파일 길이에 따라 수 분 소요될 수 있습니다)")

        # Whisper 트랜스크립션 (단어별 타이밍 포함)
        result = whisper_model.transcribe(
            mp3_path,
            language=language,
            word_timestamps=True,
            verbose=False
        )

        if whisper_cancel_event.is_set():
            return {'success': False, 'error': '사용자가 취소했습니다.'}

        eel.updateSubtitleProgress("음성 인식 완료, 자막 매핑 중...", 70)

        segments = result.get('segments', [])
        eel.logSubtitleMessage(f"\n📊 Whisper 인식 결과:")
        eel.logSubtitleMessage(f"   ✓ {len(segments)}개 세그먼트 감지")

        if not segments:
            return {'success': False, 'error': '음성을 감지하지 못했습니다.'}

        # 인식된 텍스트 미리보기
        eel.logSubtitleMessage(f"\n🔍 인식된 텍스트 샘플:")
        for i, seg in enumerate(segments[:3]):
            text = seg.get('text', '').strip()[:50]
            eel.logSubtitleMessage(f"   [{i+1}] {text}...")

        # ===== 핵심: TXT 줄과 Whisper 세그먼트 매칭 =====
        eel.updateSubtitleProgress("TXT 줄과 타이밍 매핑 중...", 80)
        eel.logSubtitleMessage(f"\n🔗 TXT 줄 ↔ Whisper 타이밍 매핑")

        subtitles = []

        # 방법 1: 세그먼트 수와 줄 수가 비슷하면 순차 매핑
        if abs(len(segments) - len(lines)) <= len(lines) * 0.2:  # 20% 오차 허용
            eel.logSubtitleMessage(f"   매핑 방식: 순차 매핑 (세그먼트 {len(segments)}개 ≈ 줄 {len(lines)}개)")

            if len(segments) >= len(lines):
                # 세그먼트가 더 많거나 같으면 병합
                segs_per_line = len(segments) / len(lines)
                for i, line_text in enumerate(lines):
                    start_idx = int(i * segs_per_line)
                    end_idx = int((i + 1) * segs_per_line) - 1
                    end_idx = min(end_idx, len(segments) - 1)

                    start_time = segments[start_idx]['start']
                    end_time = segments[end_idx]['end']

                    subtitles.append({
                        'index': i + 1,
                        'start': start_time,
                        'end': end_time,
                        'text': line_text
                    })
            else:
                # 줄이 더 많으면 시간 분배
                total_duration = segments[-1]['end'] - segments[0]['start']
                time_per_line = total_duration / len(lines)
                base_time = segments[0]['start']

                for i, line_text in enumerate(lines):
                    start_time = base_time + (i * time_per_line)
                    end_time = base_time + ((i + 1) * time_per_line)

                    subtitles.append({
                        'index': i + 1,
                        'start': start_time,
                        'end': end_time,
                        'text': line_text
                    })
        else:
            # 방법 2: 텍스트 유사도 기반 매칭
            eel.logSubtitleMessage(f"   매핑 방식: 텍스트 유사도 기반")

            used_indices = set()
            current_seg_idx = 0

            for i, line_text in enumerate(lines):
                # 현재 위치부터 순차적으로 매칭 시도
                best_idx = -1
                best_score = 0

                # 현재 위치 근처에서 매칭 찾기
                search_range = min(5, len(segments) - current_seg_idx)
                for offset in range(search_range):
                    idx = current_seg_idx + offset
                    if idx >= len(segments) or idx in used_indices:
                        continue

                    seg_text = normalize_text_for_comparison(segments[idx].get('text', ''))
                    line_normalized = normalize_text_for_comparison(line_text)

                    # 부분 매칭 점수 계산
                    if line_normalized and seg_text:
                        # 공통 문자 비율
                        common = sum(1 for c in line_normalized if c in seg_text)
                        score = common / max(len(line_normalized), 1) * 100

                        if score > best_score:
                            best_score = score
                            best_idx = idx

                if best_idx >= 0 and best_score > 20:
                    used_indices.add(best_idx)
                    current_seg_idx = best_idx + 1

                    subtitles.append({
                        'index': i + 1,
                        'start': segments[best_idx]['start'],
                        'end': segments[best_idx]['end'],
                        'text': line_text
                    })
                else:
                    # 매칭 실패 시 이전 자막 기준으로 추정
                    if subtitles:
                        prev_end = subtitles[-1]['end']
                        estimated_duration = 2.0  # 기본 2초
                        subtitles.append({
                            'index': i + 1,
                            'start': prev_end,
                            'end': prev_end + estimated_duration,
                            'text': line_text
                        })
                    elif segments:
                        # 첫 번째 줄인데 매칭 실패
                        subtitles.append({
                            'index': i + 1,
                            'start': segments[0]['start'],
                            'end': segments[0]['end'],
                            'text': line_text
                        })

        # SRT 파일 생성
        eel.updateSubtitleProgress("SRT 파일 저장 중...", 90)

        srt_lines = []
        for sub in subtitles:
            start_str = format_timestamp(sub['start'])
            end_str = format_timestamp(sub['end'])

            srt_lines.append(str(sub['index']))
            srt_lines.append(f"{start_str} --> {end_str}")
            srt_lines.append(sub['text'])
            srt_lines.append("")

        with open(output_srt_path, 'w', encoding='utf-8') as f:
            f.write("\n".join(srt_lines))

        eel.updateSubtitleProgress("완료!", 100)
        eel.logSubtitleMessage(f"\n✅ SRT 파일 생성 완료!")
        eel.logSubtitleMessage(f"   저장 위치: {output_srt_path}")
        eel.logSubtitleMessage(f"   총 자막 수: {len(subtitles)}개")

        # 미리보기
        eel.logSubtitleMessage(f"\n📋 자막 미리보기:")
        for sub in subtitles[:5]:
            start_str = format_timestamp(sub['start'])
            end_str = format_timestamp(sub['end'])
            text = sub['text'][:40] + "..." if len(sub['text']) > 40 else sub['text']
            eel.logSubtitleMessage(f"   [{sub['index']}] {start_str} → {end_str}")
            eel.logSubtitleMessage(f"       {text}")

        if len(subtitles) > 5:
            eel.logSubtitleMessage(f"   ... 외 {len(subtitles) - 5}개")

        return {
            'success': True,
            'output_path': output_srt_path,
            'subtitle_count': len(subtitles),
            'subtitles': subtitles
        }

    except Exception as e:
        import traceback
        error_msg = str(e)
        eel.logSubtitleMessage(f"\n❌ 오류 발생: {error_msg}")
        eel.logSubtitleMessage(traceback.format_exc())
        return {'success': False, 'error': error_msg}

```

---

### 6단계: requirements.txt 업데이트

**파일**: `requirements.txt`

현재 내용을 다음으로 **완전히 교체**:

```
# YouTube Search & Authentication
eel>=0.16.0
google-auth>=2.23.0
google-auth-oauthlib>=1.1.0
google-api-python-client>=2.100.0
feedparser>=6.0.10
aiohttp>=3.9.0
cryptography>=42.0.0
openpyxl>=3.1.0

# RoyStudio 비디오 제작 필요
moviepy>=2.0.0
pillow>=10.0.0
pydub>=0.25.1
librosa>=0.10.0
numpy>=1.24.0
scipy>=1.11.0

# Google Cloud Text-to-Speech
google-cloud-texttospeech>=2.14.0

# Audio/Visualization
matplotlib>=3.7.0
soundfile>=0.12.1

# Text Processing
kss>=4.0.0
requests>=2.31.0

# Microsoft Office
python-docx>=1.0.0

# Additional
decorator>=5.1.1
edge-tts>=6.1.0

# Speech-to-Text (Whisper)
openai-whisper>=20231117

# Note: FFmpeg must be installed separately
# Download from: https://ffmpeg.org/download.html
```

---

### 7단계: build.spec 업데이트

**파일**: `build.spec`

```python
# -*- mode: python ; coding: utf-8 -*-

VERSION = '2.2.0'  # 버전 업그레이드

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[('web', 'web')],
    hiddenimports=[
        'bottle_websocket',
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
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name=f'로이의영상찾기_{VERSION}',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icon.ico',
)
```

---

### 8단계: web/index.html 업데이트

**중요**: RoyStudio의 자막 생성 UI를 RoyYoutubeSearch의 index.html에 추가해야 합니다.

RoyStudio의 `web/index.html`에서 다음 섹션을 찾아서 RoyYoutubeSearch의 `web/index.html`에 **새로운 탭으로** 추가:

```html
<!-- RoyStudio 탭 추가 (기존 탭들 다음에) -->
<div id="studio-tab" class="tab-content">
    <h2>📹 영상 스튜디오 (RoyStudio)</h2>

    <!-- Whisper 자막 싱크 생성 도구 -->
    <div class="tool-panel">
        <h3>🎯 Whisper 자막 싱크 생성</h3>
        <p>MP3 파일의 음성을 인식하여 TXT 파일의 각 줄에 정확한 타이밍을 부여합니다.</p>

        <div class="control-group">
            <label>MP3 파일:</label>
            <input type="text" id="silence-mp3-path" placeholder="MP3 파일 경로" readonly>
            <button onclick="selectMp3ForRoyStudio()">선택</button>
        </div>

        <div class="control-group">
            <label>텍스트 파일:</label>
            <input type="text" id="silence-txt-path" placeholder="TXT 파일 경로" readonly>
            <button onclick="selectTxtForRoyStudio()">선택</button>
        </div>

        <div class="control-group">
            <label>Whisper 모델:</label>
            <select id="whisper-model-select">
                <option value="tiny">Tiny (가장 빠름, 낮은 정확도)</option>
                <option value="base">Base</option>
                <option value="small">Small</option>
                <option value="medium" selected>Medium (권장)</option>
                <option value="large">Large (가장 느림, 높은 정확도)</option>
            </select>
        </div>

        <div class="control-group">
            <label>언어:</label>
            <select id="whisper-lang-select">
                <option value="ko" selected>한국어</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="zh">中文</option>
            </select>
        </div>

        <button id="srt-generate-btn" onclick="generateSrtWithWhisper()">🎯 SRT 생성 (Whisper)</button>
        <button id="srt-cancel-btn" onclick="cancelSrtGeneration()" style="display:none;">취소</button>
    </div>

    <!-- 진행 상황 표시 -->
    <div id="subtitle-progress-container" style="display:none;">
        <div class="progress-bar">
            <div id="subtitle-progress" class="progress-fill"></div>
        </div>
        <div id="subtitle-message"></div>
    </div>

    <!-- 로그 표시 -->
    <div id="subtitle-log" class="log-output">
        <div id="subtitle-log-content"></div>
    </div>
</div>
```

---

### 9단계: web/js/app.js에 함수 추가

RoyStudio의 `web/js/app.js`에서 다음 JavaScript 함수들을 찾아서 RoyYoutubeSearch의 `web/script.js`에 추가:

```javascript
// === RoyStudio 통합: Whisper 자막 생성 함수들 ===

async function selectMp3ForRoyStudio() {
    const result = await eel.select_mp3_for_roystudio()();
    if (result) {
        document.getElementById('silence-mp3-path').value = result;
    }
}

async function selectTxtForRoyStudio() {
    const result = await eel.select_txt_for_roystudio()();
    if (result) {
        document.getElementById('silence-txt-path').value = result;
    }
}

async function generateSrtWithWhisper() {
    const mp3Path = document.getElementById('silence-mp3-path').value;
    const txtPath = document.getElementById('silence-txt-path').value;
    const modelName = document.getElementById('whisper-model-select').value || 'medium';
    const language = document.getElementById('whisper-lang-select').value || 'ko';

    if (!mp3Path) {
        alert('MP3 파일을 선택해주세요.');
        return;
    }
    if (!txtPath) {
        alert('텍스트 파일을 선택해주세요.');
        return;
    }

    document.getElementById('srt-generate-btn').style.display = 'none';
    document.getElementById('srt-cancel-btn').style.display = 'block';
    document.getElementById('subtitle-progress-container').style.display = 'block';
    document.getElementById('subtitle-log-content').innerHTML = '';

    try {
        const result = await eel.generate_srt_with_whisper(
            mp3Path, txtPath, null, modelName, language
        )();

        if (result.success) {
            alert(`✅ SRT 생성 완료!\n${result.subtitle_count}개 자막\n\n저장 위치: ${result.output_path}`);
        } else {
            alert(`❌ 오류: ${result.error}`);
        }
    } catch (error) {
        alert(`❌ 오류 발생: ${error}`);
    } finally {
        document.getElementById('srt-generate-btn').style.display = 'block';
        document.getElementById('srt-cancel-btn').style.display = 'none';
    }
}

async function cancelSrtGeneration() {
    await eel.cancel_roystudio_generation()();
    alert('자막 생성이 취소되었습니다.');
}

// Eel 콜백 함수들
eel.expose(function logSubtitleMessage(message) {
    const logDiv = document.getElementById('subtitle-log-content');
    const line = document.createElement('div');
    line.textContent = message;
    logDiv.appendChild(line);
    logDiv.parentElement.scrollTop = logDiv.parentElement.scrollHeight;
});

eel.expose(function updateSubtitleProgress(message, progress) {
    const progressBar = document.getElementById('subtitle-progress');
    const progressMsg = document.getElementById('subtitle-message');

    progressBar.style.width = progress + '%';
    progressMsg.textContent = message;
});
```

---

### 10단계: web/css/style.css에 스타일 추가

RoyStudio의 `web/css/style.css`를 참고하여 필요한 스타일을 RoyYoutubeSearch의 `web/style.css`에 추가합니다.

---

## 📦 필수 설치 항목

### 1. Python 패키지 설치

```bash
pip install -r requirements.txt
```

### 2. FFmpeg 설치

**Windows**:
- https://ffmpeg.org/download.html에서 다운로드
- 또는 chocolatey: `choco install ffmpeg`

**macOS**:
```bash
brew install ffmpeg
```

**Linux**:
```bash
sudo apt install ffmpeg
```

---

## 🔨 빌드 및 실행

### 개발 환경에서 실행

```bash
python main.py
```

### PyInstaller로 빌드

```bash
pyinstaller build.spec
```

빌드 완료 후 실행 파일은 `dist/로이의영상찾기_2.2.0.exe`에 생성됩니다.

---

## 🧪 테스트 체크리스트

- [ ] 기존 YouTube 검색 기능 정상 작동
- [ ] RoyStudio 탭 표시됨
- [ ] MP3 파일 선택 가능
- [ ] TXT 파일 선택 가능
- [ ] Whisper 모델 다운로드 (첫 실행 시)
- [ ] SRT 파일 생성 성공
- [ ] 생성된 SRT 파일 재생 확인

---

## 📝 주요 코드 위치

| 기능 | 파일 | 줄 번호 |
|------|------|--------|
| Whisper 자막 생성 | main.py | ~4200 |
| 파일 선택 함수 | main.py | ~3900 |
| Helper 함수 | main.py | ~3700 |
| UI 탭 | web/index.html | (새로 추가) |
| JavaScript 함수 | web/script.js | (새로 추가) |

---

## 🐛 문제 해결

### "Whisper 패키지가 설치되지 않았습니다" 오류
```bash
pip install openai-whisper
```

### "FFmpeg를 찾을 수 없습니다" 오류
FFmpeg를 설치하고 PATH에 추가했는지 확인하세요.

### Whisper 모델 다운로드가 느림
대용량 모델(large)은 2-3GB이므로 시간이 걸릴 수 있습니다. 작은 모델(tiny, base)을 먼저 시도하세요.

### SRT 자막 싱크가 맞지 않음
- MP3와 TXT 파일이 실제로 같은 내용인지 확인
- 더 큰 Whisper 모델(medium, large) 사용
- 아주 긴 파일은 여러 부분으로 나누어 처리

---

## 📧 지원

문제가 발생하면 다음을 확인하세요:
1. 모든 의존성이 설치되었는가
2. FFmpeg가 설치되고 PATH에 있는가
3. Python 3.9 이상 버전을 사용하는가
4. 충분한 디스크 공간이 있는가

