# services.py
import os
import io
import base64
import tempfile
import numpy as np
import math
import librosa
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation, FFMpegWriter
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.patches import Rectangle, Wedge
from matplotlib.collections import PatchCollection
from matplotlib import cm
import subprocess

# Windows에서 FFmpeg 콘솔 창 숨기기 위한 설정
SUBPROCESS_STARTUP_INFO = None
SUBPROCESS_CREATION_FLAGS = 0
if os.name == 'nt':
    SUBPROCESS_STARTUP_INFO = subprocess.STARTUPINFO()
    SUBPROCESS_STARTUP_INFO.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    SUBPROCESS_STARTUP_INFO.wShowWindow = subprocess.SW_HIDE
    SUBPROCESS_CREATION_FLAGS = subprocess.CREATE_NO_WINDOW

# FFmpeg 경로를 PATH에 추가 (여러 가능한 경로 시도)
import shutil
possible_ffmpeg_paths = [
    r"C:\ProgramData\chocolatey\bin",  # Chocolatey 설치 경로
    r"C:\ffmpeg\bin",  # 수동 설치 일반 경로
    r"C:\Program Files\ffmpeg\bin",
]

for path in possible_ffmpeg_paths:
    if os.path.exists(path) and path not in os.environ["PATH"]:
        os.environ["PATH"] = path + os.pathsep + os.environ["PATH"]
        break

from pydub import AudioSegment

from moviepy.video.io.VideoFileClip import VideoFileClip
from moviepy.video.io.ImageSequenceClip import ImageSequenceClip
from moviepy.audio.io.AudioFileClip import AudioFileClip
from moviepy.video.VideoClip import ImageClip, TextClip
from moviepy.video.compositing.CompositeVideoClip import CompositeVideoClip
from moviepy import vfx

# FFmpeg 경로 명시적 설정 (shutil.which()로 시스템에서 찾기)
ffmpeg_path = shutil.which("ffmpeg")
ffprobe_path = shutil.which("ffprobe")

if ffmpeg_path:
    AudioSegment.converter = ffmpeg_path
    AudioSegment.ffmpeg = ffmpeg_path
if ffprobe_path:
    AudioSegment.ffprobe = ffprobe_path

from PIL import Image
import requests
from google.cloud import texttospeech
from google.oauth2 import service_account
import uuid
import re
import warnings

# Windows에서 콘솔 창 숨기기 위한 Popen 클래스
# 클래스 상속 방식으로 패치 (함수로 교체하면 asyncio.windows_utils에서 상속 오류 발생)
if os.name == 'nt':
    class _PopenNoConsole(subprocess.Popen):
        """콘솔 창을 숨기는 Popen 클래스"""
        def __init__(self, *args, **kwargs):
            if 'startupinfo' not in kwargs or kwargs['startupinfo'] is None:
                kwargs['startupinfo'] = SUBPROCESS_STARTUP_INFO
            if 'creationflags' not in kwargs or kwargs['creationflags'] == 0:
                kwargs['creationflags'] = SUBPROCESS_CREATION_FLAGS
            super().__init__(*args, **kwargs)

    # pydub가 import 시점에 Popen을 복사하므로 해당 모듈도 패치
    try:
        from pydub import utils as pydub_utils
        if hasattr(pydub_utils, 'Popen'):
            pydub_utils.Popen = _PopenNoConsole
    except Exception as e:
        print(f"[WARNING] pydub 패치 실패: {e}")

    # MoviePy ffmpeg 모듈들 패치 (이미 import된 sp.Popen 참조 업데이트)
    try:
        from moviepy.video.io import ffmpeg_writer
        from moviepy.video.io import ffmpeg_reader
        from moviepy.audio.io import ffmpeg_audiowriter

        if hasattr(ffmpeg_writer, 'sp'):
            ffmpeg_writer.sp.Popen = _PopenNoConsole
        if hasattr(ffmpeg_reader, 'sp'):
            ffmpeg_reader.sp.Popen = _PopenNoConsole
        if hasattr(ffmpeg_audiowriter, 'sp'):
            ffmpeg_audiowriter.sp.Popen = _PopenNoConsole
    except Exception as e:
        print(f"[WARNING] MoviePy 패치 실패: {e}")

import studio_utils as utils
import studio_config as config
# from ui_dialogs import CompletionDialog
from studio_config import TEMP_DIR

# numpy 경고 메시지 억제 (비주얼라이저 렌더링 시 무음 구간 처리)
warnings.filterwarnings('ignore', category=RuntimeWarning, message='Mean of empty slice')
warnings.filterwarnings('ignore', category=RuntimeWarning, message='invalid value encountered in divide')

class MoviePyLogger:
    def __init__(self, app, is_batch=False):
        self.app = app
        self.is_batch = is_batch

    def __call__(self, *args, **kwargs):
        message = kwargs.get('message')
        if message and "audio" not in message and "Done." not in message:
            self.app.log_message(message)
        pass

    def write(self, s):
        s = s.strip()
        if not s or 't:' not in s or '%' not in s: return
        try:
            match = re.search(r'(\d+)\%', s)
            if match:
                percent = int(match.group(1))
                overall_progress = 85 + (percent / 100.0) * 15
                self.app.update_progress(f"최종 영상 인코딩 중... {percent}%", overall_progress, self.is_batch)
        except Exception: pass

    def flush(self): pass
    
    def iter_bar(self, t=None, chunk=None, **kwargs):
        """moviepy 호환 iter_bar"""
        if t is not None:
            return t
        if chunk is not None:
            return chunk
        return range(0)

# services.py의 72-149번 줄을 아래 코드로 교체하세요
# 안정성 최우선 개선 버전

import time
import random
import threading
import asyncio

# TTS API 키 사용량 추적 모듈
try:
    import tts_quota_manager as quota_manager
    TTS_QUOTA_ENABLED = True
    print("[studio_services] TTS Quota Manager 연동 완료")
except ImportError:
    TTS_QUOTA_ENABLED = False
    print("[studio_services] TTS Quota Manager 미사용 (기존 방식)")

# Google TTS API 제한: 5000 bytes
# 안정성을 위해 더 보수적으로 설정 (4800 → 4000)
TTS_SAFE_LIMIT_BYTES = 4000

def _monitor_encoding_progress(output_path, app, stop_event, duration_seconds, total_frames=None, fps=30):
    """
    별도 스레드에서 인코딩 진행률을 모니터링
    영상 길이 기반 예상 시간으로 선형 진행률 표시 (85% ~ 99%)
    """
    start_time = time.time()
    last_update_time = start_time

    # 인코딩 예상 시간 계산 (영상 길이의 약 0.5~1배 시간 소요로 가정)
    # 실제로는 하드웨어에 따라 다르지만 평균적으로 영상 길이와 비슷하거나 짧음
    estimated_encoding_time = max(duration_seconds * 0.8, 10)  # 최소 10초

    # Eel을 통해 프론트엔드에 진행률 업데이트
    try:
        import eel
        has_eel = True
    except:
        has_eel = False

    # 총 프레임 수 계산 (없으면 duration으로 추정)
    if total_frames is None:
        total_frames = int(duration_seconds * fps)

    while not stop_event.is_set():
        time.sleep(1)  # 1초마다 체크

        try:
            now = time.time()
            elapsed = now - start_time
            elapsed_int = int(elapsed)
            elapsed_min = elapsed_int // 60
            elapsed_sec = elapsed_int % 60

            # 시간 기반 선형 진행률 (최대 99%까지)
            # 인코딩은 예상 시간 내에 완료되는 것으로 가정하고 선형 증가
            progress = min(99, (elapsed / estimated_encoding_time) * 100)

            # 진행바 업데이트 (85% ~ 99%)
            bar_progress = 85 + (progress * 0.14)

            # 파일 크기 표시 (있으면)
            size_text = ""
            if os.path.exists(output_path):
                try:
                    current_size = os.path.getsize(output_path)
                    size_mb = current_size / (1024 * 1024)
                    size_text = f" ({size_mb:.1f}MB)"
                except:
                    pass

            detail_text = f"경과 시간: {elapsed_min}분 {elapsed_sec}초{size_text}"

            # Eel을 통해 프론트엔드 업데이트
            if has_eel:
                try:
                    eel.studioUpdateProgressFromPython(bar_progress, f"인코딩 중... {int(progress)}%", detail_text)
                except:
                    pass  # Eel 호출 실패 시 무시

            last_update_time = now
        except Exception:
            pass  # 오류 무시

def validate_api_key(secret):
    try:
        _synthesize_chunk(secret, "test", "en-US-Standard-A", 1.0, 0.0, is_ssml=False)
        return True, "API 키가 유효합니다."
    except Exception as e:
        return False, f"API 키가 유효하지 않거나 네트워크에 문제가 있습니다.\n\n오류: {e}"

def _synthesize_chunk(secret, text, api_voice, rate, pitch, volume_gain_db=0, is_ssml=False, max_retries=5):
    """
    안정적인 TTS API 호출 (재시도 로직 포함)

    Args:
        rate: 속도 (0.25 ~ 4.0)
        pitch: 피치 (-20 ~ 20)
        volume_gain_db: 볼륨 게인 dB (-10 ~ 10, 기본값: 0)
        max_retries: 최대 재시도 횟수 (기본값: 5)
    """
    # Chirp3-HD, Chirp-HD, Studio 모델은 속도/피치 조절 불가
    is_unsupported_voice = "Chirp" in api_voice or "Studio" in api_voice
    language_code = "-".join(api_voice.split('-', 2)[:2])

    # 서비스 계정 JSON 파일 사용 (더 안정적)
    if os.path.isabs(secret) and os.path.exists(secret) and secret.lower().endswith(".json"):
        creds = service_account.Credentials.from_service_account_file(secret)
        client = texttospeech.TextToSpeechClient(credentials=creds)
        audio_config_args = {'audio_encoding': texttospeech.AudioEncoding.MP3}
        if not is_unsupported_voice and not is_ssml:
            audio_config_args['speaking_rate'] = rate
            audio_config_args['pitch'] = pitch
        # 볼륨 게인은 항상 적용 가능 (-96.0 ~ 16.0 dB)
        if volume_gain_db != 0:
            audio_config_args['volume_gain_db'] = float(volume_gain_db)
        audio_config = texttospeech.AudioConfig(**audio_config_args)
        synthesis_input = texttospeech.SynthesisInput(ssml=text) if is_ssml else texttospeech.SynthesisInput(text=text)
        
        # SDK 호출도 재시도 로직 적용
        for attempt in range(max_retries):
            try:
                resp = client.synthesize_speech(
                    input=synthesis_input, 
                    voice=texttospeech.VoiceSelectionParams(language_code=language_code, name=api_voice), 
                    audio_config=audio_config
                )
                return resp.audio_content
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_time = (2 ** attempt) + random.uniform(0, 1)  # Exponential backoff
                    time.sleep(wait_time)
                else:
                    raise
    
    # REST API 사용 (재시도 로직 강화)
    url = f"https://texttospeech.googleapis.com/v1/text:synthesize?key={secret}"
    audio_config_payload = {"audioEncoding": "MP3"}
    if not is_unsupported_voice and not is_ssml:
        audio_config_payload["speakingRate"] = rate
        audio_config_payload["pitch"] = pitch
    # 볼륨 게인은 항상 적용 가능
    if volume_gain_db != 0:
        audio_config_payload["volumeGainDb"] = float(volume_gain_db)
    input_payload = {"ssml": text} if is_ssml else {"text": text}
    payload = {
        "input": input_payload,
        "voice": {"languageCode": language_code, "name": api_voice},
        "audioConfig": audio_config_payload
    }
    
    for attempt in range(max_retries):
        try:
            r = requests.post(url, json=payload, timeout=90)  # 타임아웃 60→90초로 증가
            r.raise_for_status()
            data = r.json()
            
            if "audioContent" not in data:
                raise RuntimeError(f"TTS REST 응답에 audioContent가 없습니다: {data}")
            
            return base64.b64decode(data["audioContent"])
            
        except requests.exceptions.HTTPError as e:
            status_code = e.response.status_code if e.response else 0
            
            # 재시도 가능한 에러인지 판단
            if status_code in [500, 502, 503, 504]:  # 서버 에러
                if attempt < max_retries - 1:
                    wait_time = (2 ** attempt) * 2 + random.uniform(0, 2)  # 더 긴 대기
                    print(f"[재시도 {attempt+1}/{max_retries}] 서버 에러 ({status_code}), {wait_time:.1f}초 후 재시도...")
                    time.sleep(wait_time)
                else:
                    raise
            elif status_code == 429:  # Rate limit
                if attempt < max_retries - 1:
                    wait_time = (2 ** attempt) * 3 + random.uniform(0, 3)  # 훨씬 더 긴 대기
                    print(f"[재시도 {attempt+1}/{max_retries}] Rate limit 초과, {wait_time:.1f}초 후 재시도...")
                    time.sleep(wait_time)
                else:
                    raise
            elif status_code == 400:  # Bad Request - 상세 로깅
                error_details = ""
                try:
                    error_data = e.response.json()
                    error_details = f"\n상세 오류: {error_data}"
                except:
                    error_details = f"\n응답 내용: {e.response.text[:500]}"

                print(f"[400 Bad Request] 텍스트 길이: {len(text)}자")
                print(f"[400 Bad Request] 텍스트 미리보기: {text[:100]}...")
                print(f"[400 Bad Request]{error_details}")
                raise RuntimeError(f"400 Bad Request: 텍스트가 TTS API에서 거부되었습니다.{error_details}")
            else:
                # 재시도 불가능한 에러 (401, 403 등)
                raise
                
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            if attempt < max_retries - 1:
                wait_time = (2 ** attempt) + random.uniform(0, 1)
                print(f"[재시도 {attempt+1}/{max_retries}] 네트워크 에러, {wait_time:.1f}초 후 재시도...")
                time.sleep(wait_time)
            else:
                raise

# --- Edge TTS 합성 함수 (무료) ---
def synthesize_edge_tts_bytes(text, voice_name, rate=1.0, pitch=0.0, app=None, pause_after_ms=0):
    """
    Edge TTS를 사용한 음성 합성 (무료)

    Args:
        text: 합성할 텍스트
        voice_name: Edge TTS 음성 이름 (예: "ko-KR-SunHiNeural")
        rate: 속도 (0.5 ~ 2.0, 기본값 1.0)
        pitch: 피치 조절 (-50 ~ +50 Hz, 기본값 0)
        app: 로그 출력용 앱 객체
        pause_after_ms: 문장 후 쉬는 시간 (밀리초, 기본값: 0)

    Returns:
        bytes: MP3 오디오 데이터
    """
    try:
        import edge_tts
    except ImportError:
        raise ImportError("edge-tts 패키지가 설치되지 않았습니다. 'pip install edge-tts'를 실행하세요.")

    # 텍스트 유효성 검사
    if not text or not text.strip():
        raise ValueError("합성할 텍스트가 비어있습니다.")

    # 음성 이름 유효성 검사
    if not voice_name or not voice_name.strip():
        raise ValueError("Edge TTS 음성이 선택되지 않았습니다.")

    async def _synthesize():
        # rate를 퍼센트 문자열로 변환 (1.0 = +0%, 1.5 = +50%, 0.5 = -50%)
        rate_percent = int((rate - 1.0) * 100)
        rate_str = f"+{rate_percent}%" if rate_percent >= 0 else f"{rate_percent}%"

        # pitch를 Hz 문자열로 변환
        pitch_hz = int(pitch)
        pitch_str = f"+{pitch_hz}Hz" if pitch_hz >= 0 else f"{pitch_hz}Hz"

        communicate = edge_tts.Communicate(text.strip(), voice_name.strip(), rate=rate_str, pitch=pitch_str)

        audio_data = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data += chunk["data"]

        if not audio_data:
            raise RuntimeError(f"Edge TTS에서 오디오를 받지 못했습니다. 음성: {voice_name}")

        return audio_data

    if app:
        app.log_message(f"  → Edge TTS 합성 중... (음성: {voice_name}, 텍스트: {len(text)}자)")

    # asyncio 이벤트 루프 처리 (새 스레드에서 실행)
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(asyncio.run, _synthesize())
        audio_bytes = future.result()

    # pause_after 적용
    if pause_after_ms > 0:
        audio_seg = AudioSegment.from_mp3(io.BytesIO(audio_bytes))
        audio_seg += AudioSegment.silent(duration=pause_after_ms)
        byte_io = io.BytesIO()
        audio_seg.export(byte_io, format="mp3")
        return byte_io.getvalue()

    return audio_bytes

def is_edge_tts_voice(voice_name):
    """Edge TTS 음성인지 확인 (예: ko-KR-SunHiNeural, en-US-JennyNeural)"""
    if not voice_name:
        return False
    # Edge TTS 음성은 "Neural"로 끝나고, Google TTS 패턴이 아님
    google_patterns = ["Chirp", "Wavenet", "Standard", "Studio", "News", "Casual", "Polyglot", "Neural2"]
    if any(p in voice_name for p in google_patterns):
        return False
    return voice_name.endswith("Neural")

def synthesize_tts_bytes(profile_name, text, api_voice, rate, pitch, volume_gain_db=0, is_ssml=False, app=None, use_edge_tts=False, pause_after_ms=0):
    """
    안정적인 TTS 음성 합성 (긴 텍스트 자동 분할 + 재시도)

    Args:
        rate: 속도 (0.25 ~ 4.0)
        pitch: 피치 (-20 ~ 20)
        volume_gain_db: 볼륨 게인 dB (-10 ~ 10, 기본값: 0)
        use_edge_tts: True이면 Edge TTS 사용 (무료, API 키 불필요)
        pause_after_ms: 문장 후 쉬는 시간 (밀리초, 기본값: 0)
    """
    # Edge TTS 사용 시 (무료) - Edge TTS는 volume_gain_db 미지원
    if use_edge_tts or is_edge_tts_voice(api_voice):
        return synthesize_edge_tts_bytes(text, api_voice, rate, pitch, app, pause_after_ms)

    # Google TTS 사용 시 - Quota Manager를 통한 자동 키 선택
    secret = None
    key_id = None
    char_count = len(text)

    if TTS_QUOTA_ENABLED:
        # 사용 가능한 API 키 자동 선택
        available_key = quota_manager.get_available_api_key(api_voice, char_count)
        if available_key:
            secret = available_key['api_key']
            key_id = available_key['key_id']
            if app and available_key.get('warning'):
                app.log_message(f"  ⚠️ {available_key['warning']}")
            if app:
                app.log_message(f"  🔑 TTS 키 사용: {available_key['name']}")
        else:
            if app:
                app.log_message("  ⚠️ 자동 키 선택 불가 - 프로필 키 사용")

    # Quota Manager에서 키를 못 찾았으면 기존 프로필 사용
    if not secret:
        secret = utils.get_profiles().get(profile_name, "").strip()
        if not secret:
            raise ValueError(f"'{profile_name}' 프로필 값이 비어 있습니다.")

    text_length = len(text)
    text_bytes = len(text.encode('utf-8'))

    # 사용량 추적 헬퍼 함수
    def _track_usage(char_count):
        if TTS_QUOTA_ENABLED and key_id:
            quota_manager.add_usage(key_id, api_voice, char_count)

    # SSML 처리
    if is_ssml:
        if app:
            app.log_message(f"  → SSML 음성 합성 중... (텍스트 길이: {text_length}자)")
        audio_bytes = _synthesize_chunk(secret, text, api_voice, 1.0, 0.0, volume_gain_db, is_ssml=True)
        _track_usage(text_length)  # 사용량 기록
        # pause_after 적용
        if pause_after_ms > 0:
            audio_seg = AudioSegment.from_mp3(io.BytesIO(audio_bytes))
            audio_seg += AudioSegment.silent(duration=pause_after_ms)
            byte_io = io.BytesIO()
            audio_seg.export(byte_io, format="mp3")
            return byte_io.getvalue()
        return audio_bytes

    # 짧은 텍스트는 바로 처리
    if text_bytes <= TTS_SAFE_LIMIT_BYTES:
        if app:
            app.log_message(f"  → TTS API 호출 중... (텍스트: {text_length}자, {text_bytes} bytes)")
        audio_bytes = _synthesize_chunk(secret, text, api_voice, rate, pitch, volume_gain_db, is_ssml=False)
        _track_usage(text_length)  # 사용량 기록
        # pause_after 적용
        if pause_after_ms > 0:
            audio_seg = AudioSegment.from_mp3(io.BytesIO(audio_bytes))
            audio_seg += AudioSegment.silent(duration=pause_after_ms)
            byte_io = io.BytesIO()
            audio_seg.export(byte_io, format="mp3")
            return byte_io.getvalue()
        return audio_bytes
    
    # 긴 텍스트 청크 분할 (다중 구두점 지원)
    import re

    # 여러 구두점으로 문장 분할 (한국어/영어 지원)
    # 마침표, 물음표, 느낌표, 쉼표, 세미콜론 등
    sentence_pattern = r'([^.!?\n]+[.!?\n]+|[^,;]+[,;]+)'
    raw_sentences = re.findall(sentence_pattern, text)

    # 분할되지 않은 나머지 텍스트 처리
    if raw_sentences:
        remaining = text
        for s in raw_sentences:
            remaining = remaining.replace(s, '', 1)
        if remaining.strip():
            raw_sentences.append(remaining.strip())
    else:
        # 패턴 매칭 실패 시 전체 텍스트를 문장으로 취급
        raw_sentences = [text]

    chunks, current_chunk = [], ""

    for sentence in raw_sentences:
        if not sentence.strip():
            continue

        # 현재 청크에 문장 추가 시도
        test_chunk = current_chunk + sentence
        test_bytes = len(test_chunk.encode('utf-8'))

        if test_bytes > TTS_SAFE_LIMIT_BYTES:
            # 현재 청크 저장
            if current_chunk:
                chunks.append(current_chunk)
                current_chunk = sentence
            else:
                # 단일 문장이 너무 큼 -> 단어 단위로 분할
                words = sentence.split()
                word_chunk = ""
                for word in words:
                    test_word_chunk = word_chunk + word + " "
                    if len(test_word_chunk.encode('utf-8')) > TTS_SAFE_LIMIT_BYTES:
                        if word_chunk:
                            chunks.append(word_chunk.strip())
                        word_chunk = word + " "
                    else:
                        word_chunk = test_word_chunk
                if word_chunk:
                    current_chunk = word_chunk.strip()
        else:
            current_chunk = test_chunk

    if current_chunk:
        chunks.append(current_chunk)
    
    if app:
        app.log_message(f"  → 긴 텍스트 감지: {text_length}자 ({text_bytes} bytes)")
        app.log_message(f"  → {len(chunks)}개 청크로 분할하여 처리합니다...")
        app.log_message(f"  → API 안정성을 위해 각 청크 간 0.5초 대기합니다.")
    
    # 청크 검증 및 정리
    validated_chunks = []
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:  # 빈 청크 제거
            continue
        chunk_bytes = len(chunk.encode('utf-8'))

        # 너무 작은 청크는 경고 (10바이트 미만)
        if chunk_bytes < 10:
            if app:
                app.log_message(f"  ⚠️ 경고: 너무 작은 청크 발견 ({chunk_bytes} bytes), 건너뜀: {chunk[:50]}")
            continue

        # 너무 큰 청크는 에러
        if chunk_bytes > TTS_SAFE_LIMIT_BYTES:
            if app:
                app.log_message(f"  ❌ 오류: 청크가 너무 큽니다 ({chunk_bytes} bytes). 문장을 더 짧게 나눠주세요.")
            raise ValueError(f"청크가 너무 큽니다: {chunk_bytes} bytes (최대 {TTS_SAFE_LIMIT_BYTES} bytes)")

        validated_chunks.append(chunk)

    if not validated_chunks:
        raise ValueError("유효한 청크가 없습니다. 텍스트를 확인해주세요.")

    if app:
        app.log_message(f"  ✓ {len(validated_chunks)}개의 유효한 청크 준비 완료")

    # 청크별 처리 (안정성 최우선)
    combined_audio = AudioSegment.empty()

    for idx, chunk in enumerate(validated_chunks):
        # 중지 요청 확인
        if app and hasattr(app, 'cancel_event') and app.cancel_event.is_set():
            if app:
                app.log_message(f"  ⚠️ TTS 처리 중 중지됨 (청크 {idx+1}/{len(validated_chunks)})")
            raise RuntimeError("사용자에 의해 중지되었습니다")

        if not chunk.strip():
            continue

        if app:
            app.log_message(f"     • 청크 {idx+1}/{len(validated_chunks)} 처리 중...")

        # API 호출 (재시도 로직 내장)
        try:
            audio_bytes = _synthesize_chunk(secret, chunk, api_voice, rate, pitch, volume_gain_db, is_ssml=False)
            combined_audio += AudioSegment.from_mp3(io.BytesIO(audio_bytes))

            if app:
                app.log_message(f"       ✓ 성공 (크기: {len(audio_bytes)} bytes)")

            # Rate Limit 방지: 청크 간 짧은 대기 (0.5초)
            if idx < len(validated_chunks) - 1:  # 마지막 청크가 아니면
                # 대기 중에도 중지 확인 (0.1초 단위로 5번 = 0.5초)
                for _ in range(5):
                    if app and hasattr(app, 'cancel_event') and app.cancel_event.is_set():
                        if app:
                            app.log_message(f"  ⚠️ 대기 중 중지됨")
                        raise RuntimeError("사용자에 의해 중지되었습니다")
                    time.sleep(0.1)

        except Exception as e:
            if app:
                app.log_message(f"       ✗ 청크 {idx+1} 처리 최종 실패: {e}")
            raise  # 실패 시 전체 작업 중단

    if app:
        app.log_message(f"  → 모든 청크 결합 완료! (총 {len(validated_chunks)}개)")

    # 전체 텍스트에 대한 사용량 기록
    _track_usage(text_length)

    # pause_after 적용
    if pause_after_ms > 0:
        combined_audio += AudioSegment.silent(duration=pause_after_ms)

    byte_io = io.BytesIO()
    combined_audio.export(byte_io, format="mp3")
    return byte_io.getvalue()

def generate_single_clip_audio(app_tab, cid, api_key_profile_name=None):
    clip = app_tab._get_clip_by_id(cid)
    if not clip: return None, "클립 정보를 찾을 수 없습니다."

    char, text = clip["character"], clip["text"]; is_ssml = clip.get("is_ssml", False)
    if char not in app_tab.character_widgets: return None, f"'{char}' 캐릭터 설정이 없습니다."

    w = app_tab.character_widgets[char]
    if w["voice_var"].get() == "음성 선택": return None, f"'{char}' 캐릭터의 음성이 선택되지 않았습니다."

    try:
        profile_name = api_key_profile_name or app_tab.profile_var.get()
        if not profile_name: raise ValueError("TTS 작업용 프로필을 선택해주세요.")

        selected_lang, selected_group, selected_voice_ui = w['lang_var'].get(), w['group_var'].get(), w['voice_var'].get()
        api_voice = next((name for name, gender in config.LANG_VOICE_GROUPS.get(selected_lang, {}).get(selected_group, {}).items() if app_tab._format_voice_name_internal(name, gender) == selected_voice_ui), None)
        if not api_voice: raise ValueError(f"선택된 음성 '{selected_voice_ui}'을(를) 찾을 수 없습니다.")

        bytes_ = synthesize_tts_bytes(profile_name, text, api_voice, w["speed_var"].get(), w["pitch_var"].get(), volume_gain_db=0, is_ssml=is_ssml, app=getattr(app_tab, 'app', None))
        return AudioSegment.from_mp3(io.BytesIO(bytes_)), None
    except Exception as e:
        return None, f"오디오 생성 중 API 오류가 발생했습니다: {e}"

def generate_srt_from_audio(audio_path, output_srt_path, app=None, model_size="base"):
    """
    Whisper를 사용하여 오디오 파일에서 SRT 자막 생성

    Args:
        audio_path: 입력 오디오 파일 경로 (MP3 등)
        output_srt_path: 출력 SRT 파일 경로
        app: 로그 출력을 위한 앱 객체 (옵션)
        model_size: Whisper 모델 크기 ("tiny", "base", "small", "medium", "large")
                    기본값은 "base" (속도와 정확도의 균형)

    Returns:
        True if successful, False otherwise
    """
    try:
        import whisper

        if app:
            app.log_message(f"\n📝 Whisper STT 자막 생성 시작...")
            app.log_message(f"  모델: {model_size}")
            app.log_message(f"  입력: {audio_path}")

        # Whisper 모델 로드
        if app:
            app.log_message(f"  → Whisper 모델 로딩 중... (최초 실행 시 모델 다운로드)")

        model = whisper.load_model(model_size)

        if app:
            app.log_message(f"  ✓ 모델 로드 완료")
            app.log_message(f"  → 음성 인식 시작...")

        # 음성 인식 실행
        result = model.transcribe(
            audio_path,
            language="ko",  # 한국어 지정 (정확도 향상)
            task="transcribe",  # 번역이 아닌 전사
            verbose=False  # 상세 로그 비활성화
        )

        if app:
            app.log_message(f"  ✓ 음성 인식 완료")
            app.log_message(f"  → SRT 파일 생성 중...")

        # SRT 형식으로 변환
        def format_timestamp(seconds):
            """초 단위 시간을 SRT 타임스탬프 형식으로 변환 (HH:MM:SS,mmm)"""
            hours = int(seconds // 3600)
            minutes = int((seconds % 3600) // 60)
            secs = int(seconds % 60)
            millis = int((seconds - int(seconds)) * 1000)
            return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

        # SRT 파일 작성
        with open(output_srt_path, 'w', encoding='utf-8') as srt_file:
            for i, segment in enumerate(result['segments'], start=1):
                start_time = format_timestamp(segment['start'])
                end_time = format_timestamp(segment['end'])
                text = segment['text'].strip()

                # SRT 형식: 번호, 타임스탬프, 텍스트, 빈 줄
                srt_file.write(f"{i}\n")
                srt_file.write(f"{start_time} --> {end_time}\n")
                srt_file.write(f"{text}\n\n")

        if app:
            app.log_message(f"  ✓ SRT 파일 생성 완료: {output_srt_path}")
            app.log_message(f"  📊 총 {len(result['segments'])}개의 자막 세그먼트 생성됨")

        return True

    except ImportError:
        if app:
            app.log_message(f"  ❌ 오류: openai-whisper 패키지가 설치되지 않았습니다.")
            app.log_message(f"     다음 명령으로 설치하세요: pip install openai-whisper")
        return False
    except Exception as e:
        import traceback
        if app:
            app.log_message(f"  ❌ SRT 생성 중 오류 발생: {e}")
            app.log_message(f"{traceback.format_exc()}")
        return False

def generate_srt_from_clips(clips, audio_segments, output_srt_path, app=None, max_chars=35):
    """
    클립 데이터와 오디오 세그먼트를 사용하여 원본 텍스트 기반 정확한 SRT 자막 생성

    Args:
        clips: 클립 데이터 리스트 [{'character': '캐릭터명', 'text': '대사'}]
        audio_segments: AudioSegment 리스트 (각 클립별 오디오)
        output_srt_path: 출력 SRT 파일 경로
        app: 로그 출력을 위한 앱 객체 (옵션)
        max_chars: 자막 한 줄 최대 글자 수 (기본값: 35, 약 1-2줄)

    Returns:
        True if successful, False otherwise
    """
    try:
        if app:
            app.log_message(f"\n📝 SRT 자막 생성 시작...")

        def format_timestamp(seconds):
            """초 단위 시간을 SRT 타임스탬프 형식으로 변환 (HH:MM:SS,mmm)"""
            hours = int(seconds // 3600)
            minutes = int((seconds % 3600) // 60)
            secs = int(seconds % 60)
            millis = int((seconds - int(seconds)) * 1000)
            return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

        def split_text_smartly(text, max_length):
            """텍스트를 자연스럽게 분할 (단어 중간 절대 안 자름)"""
            # 이미 짧으면 그대로 반환
            if len(text) <= max_length:
                return [text]

            segments = []

            # 1단계: 문장 부호로 먼저 분할 (., !, ?)
            sentence_endings = ['. ', '! ', '? ', '.\n', '!\n', '?\n']
            sentences = []
            current = ""

            i = 0
            while i < len(text):
                current += text[i]
                # 문장 부호 체크
                found_ending = False
                for ending in sentence_endings:
                    if current.endswith(ending):
                        sentences.append(current.strip())
                        current = ""
                        found_ending = True
                        break
                i += 1

            # 남은 텍스트 추가
            if current.strip():
                sentences.append(current.strip())

            # 문장이 없으면 전체를 하나의 문장으로
            if not sentences:
                sentences = [text]

            # 2단계: 각 문장이 max_length를 넘으면 추가 분할
            for sentence in sentences:
                if len(sentence) <= max_length:
                    segments.append(sentence)
                else:
                    # 쉼표로 나누기 시도
                    if ',' in sentence:
                        parts = sentence.split(',')
                        temp = ""
                        for j, part in enumerate(parts):
                            part = part.strip()
                            if not part:
                                continue

                            # 쉼표 다시 추가 (마지막 제외)
                            if j < len(parts) - 1:
                                part_with_comma = part + ','
                            else:
                                part_with_comma = part

                            if len(temp + ' ' + part_with_comma) <= max_length and temp:
                                temp = temp + ' ' + part_with_comma
                            else:
                                if temp:
                                    segments.append(temp.strip())
                                temp = part_with_comma

                        if temp:
                            segments.append(temp.strip())
                    else:
                        # 쉼표도 없으면 공백 기준으로 분할
                        words = sentence.split()
                        temp = ""
                        for word in words:
                            if len(temp + ' ' + word) <= max_length and temp:
                                temp = temp + ' ' + word
                            else:
                                if temp:
                                    segments.append(temp.strip())
                                temp = word

                        if temp:
                            segments.append(temp.strip())

            return [seg for seg in segments if seg]  # 빈 문자열 제거

        # SRT 파일 작성
        with open(output_srt_path, 'w', encoding='utf-8') as srt_file:
            current_time = 0.0  # 누적 시간 (초)
            srt_index = 1  # 자막 번호

            for clip, audio_seg in zip(clips, audio_segments):
                # 오디오 길이 (밀리초 → 초)
                duration = len(audio_seg) / 1000.0

                # 텍스트 (SSML 태그 제거)
                text = clip['text'].strip()
                if text.startswith('<speak>') and text.endswith('</speak>'):
                    text = text.replace('<speak>', '').replace('</speak>', '').strip()

                # 텍스트를 자연스럽게 분할
                text_segments = split_text_smartly(text, max_chars)

                # 각 세그먼트에 시간 할당
                time_per_segment = duration / len(text_segments)

                for seg_idx, seg_text in enumerate(text_segments):
                    seg_start = current_time + (seg_idx * time_per_segment)
                    seg_end = seg_start + time_per_segment

                    # SRT 형식: 번호, 타임스탬프, 텍스트, 빈 줄
                    srt_file.write(f"{srt_index}\n")
                    srt_file.write(f"{format_timestamp(seg_start)} --> {format_timestamp(seg_end)}\n")
                    srt_file.write(f"{seg_text}\n\n")

                    srt_index += 1

                # 다음 클립을 위해 시간 누적
                current_time += duration

        if app:
            app.log_message(f"  ✓ SRT 파일 생성 완료: {output_srt_path}")
            app.log_message(f"  📊 총 {srt_index - 1}개의 자막 세그먼트 생성됨")

        return True

    except Exception as e:
        import traceback
        if app:
            app.log_message(f"  ❌ SRT 생성 중 오류 발생: {e}")
            app.log_message(f"{traceback.format_exc()}")
        return False

def _render_chunk_worker(args):
    app, audio_chunk_path, job, chunk_index, is_batch = args
    try:
        y, sr = librosa.load(audio_chunk_path, sr=None, mono=True, dtype=np.float32)
        duration = librosa.get_duration(y=y, sr=sr)
        tab_ref = app.batch_process_tab if is_batch else app.video_maker_tab

        eq_settings = job['eq_settings']
        raw_style = eq_settings.get('style', '막대형')

        # 한글 스타일명 -> 내부 스타일 코드 매핑
        style_map = {
            '막대형': 'bar',
            '미러막대형': 'mirror',
            '원형': 'circular',
            '파형': 'wave',
            'bar': 'bar',
            'mirror': 'mirror',
            'circular': 'circular',
            'wave': 'wave'
        }
        visualizer_style = style_map.get(raw_style, 'bar')

        # EQ 크기 계산: 바 가로 + 간격 × 바갯수
        bar_width_px = eq_settings.get('barWidth', 20)  # 바 1개 가로 (px)
        bar_gap_px = eq_settings.get('barGap', 3)       # 바 간격 (px)
        n_bars = eq_settings.get('barCount', 24)        # 바 갯수
        n_bars = max(4, min(128, int(n_bars)))          # 4~128 범위로 제한

        eq_width = (bar_width_px + bar_gap_px) * n_bars   # EQ 전체 가로
        eq_height = eq_settings.get('height', 100)        # 바 세로 최대 높이 (px)

        # 미러막대형은 위아래 대칭이므로 높이 2배
        if visualizer_style == 'mirror':
            render_w, render_h = eq_width, eq_height * 2
        else:
            render_w, render_h = eq_width, eq_height

        # 크로마키 방식: 녹색 배경으로 렌더링 후 투명으로 변환
        # (matplotlib의 투명 배경은 buffer_rgba()에서 제대로 작동하지 않음)
        CHROMA_KEY = (0, 255, 0)  # 순수 녹색 배경

        fig = plt.Figure(figsize=(render_w / 100.0, render_h / 100.0), dpi=100, facecolor=(0, 1, 0, 1))  # 녹색 배경
        fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
        canvas = FigureCanvasAgg(fig)
        ax = fig.add_axes([0, 0, 1, 1])
        ax.set_facecolor((0, 1, 0, 1))  # 녹색 배경
        ax.axis("off")
        ax.set_xlim(0, 1); ax.set_ylim(0, 1)

        # n_bars는 이미 위에서 설정됨
        n_segs = 18  # side_bar 스타일용 세그먼트 수
        S = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=2048, hop_length=512, n_mels=n_bars)
        
        # 안전한 스펙트로그램 처리 (무음 구간 대응)
        max_val = np.max(S)
        if max_val > 0:
            S_db = librosa.power_to_db(S, ref=max_val)
        else:
            S_db = np.zeros_like(S)
        
        smin, smax = float(np.min(S_db)), float(np.max(S_db))
        if smax - smin < 1e-6:
            smin, smax = -80.0, 0.0

        # 사용자 설정 색상 사용 (color1 -> color2 그라데이션)
        # 미리보기와 동일: 각 바 내부에서 아래(color1) -> 위(color2) 세로 그라데이션
        color1 = eq_settings.get('color1', '#667eea')
        color2 = eq_settings.get('color2', '#764ba2')
        app.log_message(f"  EQ 색상 설정: color1={color1}, color2={color2}")

        def hex_to_rgb(hex_color):
            hex_color = hex_color.lstrip('#')
            return tuple(int(hex_color[i:i+2], 16) / 255.0 for i in (0, 2, 4))

        rgb1 = hex_to_rgb(color1)  # 아래쪽 색상
        rgb2 = hex_to_rgb(color2)  # 위쪽 색상

        # 세로 그라데이션을 위한 세그먼트 수 (각 바를 여러 조각으로 나눔)
        n_gradient_segments = 20
        
        if visualizer_style == 'bar':
            # 막대형 스타일 - 라운드 처리된 막대 (미리보기와 동일)
            from matplotlib.patches import FancyBboxPatch
            bars_patches = []

            bar_w_ratio = bar_width_px / render_w
            gap_ratio = bar_gap_px / render_w
            bar_slot = bar_w_ratio + gap_ratio
            max_height = 1.0
            border_radius = bar_w_ratio * 0.15  # 라운드 반경

            # 수평 그라데이션 색상 (왼쪽 -> 오른쪽)
            for b in range(n_bars):
                x0 = b * bar_slot
                t = b / max(n_bars - 1, 1)
                col = (
                    rgb1[0] + (rgb2[0] - rgb1[0]) * t,
                    rgb1[1] + (rgb2[1] - rgb1[1]) * t,
                    rgb1[2] + (rgb2[2] - rgb1[2]) * t
                )
                # 라운드 처리된 막대
                bar_patch = FancyBboxPatch(
                    (x0, 0), bar_w_ratio, 0.01,
                    boxstyle=f"round,pad=0,rounding_size={border_radius}",
                    facecolor=(*col, 1.0), edgecolor='none'
                )
                ax.add_patch(bar_patch)
                bars_patches.append((bar_patch, col))

            prev = np.zeros(n_bars, dtype=np.float32)
            decay = 0.15

            def update_bar(i):
                if app.cancel_event.is_set(): raise StopIteration
                t = i / fps
                idx = min(int(t * sr / 512), S_db.shape[1] - 1)
                cur = np.clip((S_db[:, idx] - smin) / (smax - smin + 1e-6), 0, 1)
                levels = np.maximum(cur, prev - decay); prev[:] = levels

                for b in range(n_bars):
                    bar_height = max(0.01, levels[b] * max_height * 0.9)
                    x0 = b * bar_slot
                    patch, col = bars_patches[b]
                    patch.set_bounds(x0, 0, bar_w_ratio, bar_height)
                    patch.set_alpha(min(0.5 + levels[b] * 0.5, 1.0))

                return [p[0] for p in bars_patches]

            update_func = update_bar

        elif visualizer_style == 'mirror':
            # 미러막대형 스타일 - 위아래 대칭 (중앙에서 위아래로 뻗어나감)
            # FancyBboxPatch로 라운드 처리된 막대 사용
            from matplotlib.patches import FancyBboxPatch
            bars_top = []
            bars_bottom = []

            bar_w_ratio = bar_width_px / render_w
            gap_ratio = bar_gap_px / render_w
            bar_slot = bar_w_ratio + gap_ratio
            half_height = 0.5  # 위/아래 각각 절반씩 차지
            border_radius = bar_w_ratio * 0.15  # 라운드 크기

            for b in range(n_bars):
                x0 = b * bar_slot
                # 가로 그라데이션 색상 (왼쪽에서 오른쪽)
                t = b / max(n_bars - 1, 1)
                col = (
                    rgb1[0] + (rgb2[0] - rgb1[0]) * t,
                    rgb1[1] + (rgb2[1] - rgb1[1]) * t,
                    rgb1[2] + (rgb2[2] - rgb1[2]) * t
                )
                # 상단 바 (0.5에서 위로)
                bar_top = FancyBboxPatch(
                    (x0, 0.5), bar_w_ratio, 0.01,
                    boxstyle=f"round,pad=0,rounding_size={border_radius}",
                    facecolor=(*col, 1.0), edgecolor='none'
                )
                ax.add_patch(bar_top)
                bars_top.append((bar_top, col))

                # 하단 바 (0.5에서 아래로)
                bar_bottom = FancyBboxPatch(
                    (x0, 0.49), bar_w_ratio, 0.01,
                    boxstyle=f"round,pad=0,rounding_size={border_radius}",
                    facecolor=(*col, 1.0), edgecolor='none'
                )
                ax.add_patch(bar_bottom)
                bars_bottom.append((bar_bottom, col))

            prev = np.zeros(n_bars, dtype=np.float32)
            decay = 0.08

            def update_mirror(i):
                if app.cancel_event.is_set(): raise StopIteration
                t = i / fps
                idx = min(int(t * sr / 512), S_db.shape[1] - 1)
                cur = np.clip((S_db[:, idx] - smin) / (smax - smin + 1e-6), 0, 1)
                levels = np.maximum(cur, prev - decay); prev[:] = levels

                for b in range(n_bars):
                    bar_height = max(0.01, levels[b] * half_height * 0.9)
                    x0 = b * bar_slot
                    patch_top, col = bars_top[b]
                    patch_bottom, _ = bars_bottom[b]
                    # 상단: 중앙에서 위로
                    patch_top.set_bounds(x0, 0.5, bar_w_ratio, bar_height)
                    patch_top.set_alpha(min(0.5 + levels[b] * 0.5, 1.0))
                    # 하단: 중앙에서 아래로 (y좌표를 아래로)
                    patch_bottom.set_bounds(x0, 0.5 - bar_height, bar_w_ratio, bar_height)
                    patch_bottom.set_alpha(min(0.5 + levels[b] * 0.5, 1.0))

                return [p[0] for p in bars_top] + [p[0] for p in bars_bottom]

            update_func = update_mirror

        elif visualizer_style == 'side_bar':
            # 좌우 측면 막대형 스타일 - 개별 패치 사용
            patches = []
            patch_colors = []  # 각 패치의 기본 색상 저장
            bar_gap, seg_gap = 0.5, 0.35
            bar_slot, bar_w = 1/n_bars, 1/n_bars*(1-bar_gap)
            seg_slot_w, seg_w = 1/n_segs, 1/n_segs*(1-seg_gap)

            for b in range(n_bars):
                # 그라데이션 색상 계산
                t = b / max(n_bars - 1, 1)
                col = (
                    rgb1[0] + (rgb2[0] - rgb1[0]) * t,
                    rgb1[1] + (rgb2[1] - rgb1[1]) * t,
                    rgb1[2] + (rgb2[2] - rgb1[2]) * t
                )
                y0 = b*bar_slot + (bar_slot-bar_w)/2
                for s in range(n_segs):
                    # 왼쪽 막대
                    x0_left = 0.5 - (s*seg_slot_w/2 + (seg_slot_w/2 - seg_w/2)/2) - seg_w/2
                    # 오른쪽 막대
                    x0_right = 0.5 + s*seg_slot_w/2 + (seg_slot_w/2 - seg_w/2)/2
                    rect_left = Rectangle((x0_left, y0), seg_w/2, bar_w, facecolor=(*col, 0), edgecolor='none')
                    rect_right = Rectangle((x0_right, y0), seg_w/2, bar_w, facecolor=(*col, 0), edgecolor='none')
                    ax.add_patch(rect_left)
                    ax.add_patch(rect_right)
                    patches.extend([rect_left, rect_right])
                    patch_colors.extend([col, col])

            prev = np.zeros(n_bars, dtype=np.float32)
            decay = 0.08

            def update_side_bar(i):
                if app.cancel_event.is_set(): raise StopIteration
                t = i / fps; idx = min(int(t * sr / 512), S_db.shape[1] - 1)
                cur = np.clip((S_db[:, idx] - smin) / (smax - smin + 1e-6), 0, 1)
                levels = np.maximum(cur, prev - decay); prev[:] = levels
                on = (levels * n_segs + 1e-6).astype(int)
                k = 0
                for b in range(n_bars):
                    nb = on[b]
                    for s in range(n_segs):
                        alpha = 1.0 if s < nb else 0.0
                        patches[k].set_facecolor((*patch_colors[k], alpha))
                        patches[k+1].set_facecolor((*patch_colors[k+1], alpha))
                        k += 2
                app.update_progress(f"영상 렌더링 중: {i + 1}/{total_frames}", 40 + ((i + 1) / total_frames * 45), is_batch=is_batch)
                return patches

            update_func = update_side_bar

        elif visualizer_style == 'spectrum':
            # 스펙트럼 스타일 (하단 가로 막대)
            # PatchCollection 대신 개별 Rectangle을 ax에 직접 추가
            patches = []
            # 바 가로 = bar_width_px, 간격 = bar_gap_px (픽셀 기준)
            bar_w_ratio = bar_width_px / render_w
            gap_ratio = bar_gap_px / render_w
            bar_slot = bar_w_ratio + gap_ratio
            max_height = 0.3  # 최대 높이 (화면 하단에서 30%)

            for b in range(n_bars):
                # 그라데이션 색상 계산
                t = b / max(n_bars - 1, 1)
                col = (
                    rgb1[0] + (rgb2[0] - rgb1[0]) * t,
                    rgb1[1] + (rgb2[1] - rgb1[1]) * t,
                    rgb1[2] + (rgb2[2] - rgb1[2]) * t
                )
                x0 = b * bar_slot
                rect = Rectangle((x0, 0), bar_w_ratio, 0.01, facecolor=(*col, 0.8), edgecolor='none')
                ax.add_patch(rect)
                patches.append(rect)

            prev = np.zeros(n_bars, dtype=np.float32)
            decay = 0.08

            def update_spectrum(i):
                if app.cancel_event.is_set(): raise StopIteration
                t = i / fps; idx = min(int(t * sr / 512), S_db.shape[1] - 1)
                cur = np.clip((S_db[:, idx] - smin) / (smax - smin + 1e-6), 0, 1)
                levels = np.maximum(cur, prev - decay); prev[:] = levels

                for b in range(n_bars):
                    height = max(levels[b] * max_height, 0.01)
                    patches[b].set_height(height)

                return patches

            update_func = update_spectrum

        elif visualizer_style == 'circular':
            # 원형 (점 스타일) - 한 줄로 점들 배치 (미리보기와 동일)
            from matplotlib.patches import Circle
            dots = []

            bar_w_ratio = bar_width_px / render_w
            gap_ratio = bar_gap_px / render_w
            bar_slot = bar_w_ratio + gap_ratio
            dot_size_base = bar_w_ratio * 0.4  # 점 기본 크기

            for b in range(n_bars):
                # 그라데이션 색상 계산
                t = b / max(n_bars - 1, 1)
                col = (
                    rgb1[0] + (rgb2[0] - rgb1[0]) * t,
                    rgb1[1] + (rgb2[1] - rgb1[1]) * t,
                    rgb1[2] + (rgb2[2] - rgb1[2]) * t
                )
                x0 = b * bar_slot + bar_w_ratio / 2
                dot = Circle((x0, 0.5), dot_size_base, facecolor=(*col, 0), edgecolor='none')
                ax.add_patch(dot)
                dots.append(dot)

            prev = np.zeros(n_bars, dtype=np.float32)
            decay = 0.08

            def update_circular(i):
                if app.cancel_event.is_set(): raise StopIteration
                t = i / fps; idx = min(int(t * sr / 512), S_db.shape[1] - 1)
                cur = np.clip((S_db[:, idx] - smin) / (smax - smin + 1e-6), 0, 1)
                levels = np.maximum(cur, prev - decay); prev[:] = levels

                for b in range(n_bars):
                    # 점 크기와 투명도를 오디오 레벨에 따라 조절
                    size = dot_size_base * (0.3 + levels[b] * 0.7)
                    dots[b].set_radius(size)
                    dots[b].set_alpha(min(0.3 + levels[b] * 0.7, 1.0))

                app.update_progress(f"영상 렌더링 중: {i + 1}/{total_frames}", 40 + ((i + 1) / total_frames * 45), is_batch=is_batch)
                return dots

            update_func = update_circular

        elif visualizer_style == 'wave':
            # 파형 스타일 - 사인파 형태 막대 (라운드 처리)
            from matplotlib.patches import FancyBboxPatch
            bars_patches = []

            bar_w_ratio = bar_width_px / render_w
            gap_ratio = bar_gap_px / render_w
            bar_slot = bar_w_ratio + gap_ratio
            max_height = 1.0
            border_radius = bar_w_ratio * 0.15  # 라운드 크기

            for b in range(n_bars):
                x0 = b * bar_slot
                # 가로 그라데이션 색상 (왼쪽에서 오른쪽)
                t = b / max(n_bars - 1, 1)
                col = (
                    rgb1[0] + (rgb2[0] - rgb1[0]) * t,
                    rgb1[1] + (rgb2[1] - rgb1[1]) * t,
                    rgb1[2] + (rgb2[2] - rgb1[2]) * t
                )
                bar_patch = FancyBboxPatch(
                    (x0, 0), bar_w_ratio, 0.01,
                    boxstyle=f"round,pad=0,rounding_size={border_radius}",
                    facecolor=(*col, 1.0), edgecolor='none'
                )
                ax.add_patch(bar_patch)
                bars_patches.append((bar_patch, col))

            prev = np.zeros(n_bars, dtype=np.float32)
            decay = 0.15

            def update_wave(i):
                if app.cancel_event.is_set(): raise StopIteration
                t = i / fps; idx = min(int(t * sr / 512), S_db.shape[1] - 1)
                cur = np.clip((S_db[:, idx] - smin) / (smax - smin + 1e-6), 0, 1)
                levels = np.maximum(cur, prev - decay); prev[:] = levels

                for b in range(n_bars):
                    # 파형 효과 추가 (사인파로 높이 변조)
                    wave_factor = np.sin(b * 0.3 + i * 0.1) * 0.2
                    level = max(0.01, levels[b] * (0.8 + wave_factor) * max_height * 0.9)
                    x0 = b * bar_slot
                    patch, col = bars_patches[b]
                    patch.set_bounds(x0, 0, bar_w_ratio, level)
                    patch.set_alpha(min(0.5 + levels[b] * 0.5, 1.0))

                app.update_progress(f"영상 렌더링 중: {i + 1}/{total_frames}", 40 + ((i + 1) / total_frames * 45), is_batch=is_batch)
                return [p[0] for p in bars_patches]

            update_func = update_wave
        
        # FPS는 job의 eq_settings에서 가져오기
        fps = eq_settings.get('fps', 20)  # 기본값 20
        total_frames = max(1, int(duration * fps))
        output_path = os.path.join(TEMP_DIR, f"vis_chunk_{chunk_index}.mov")

        # PNG 시퀀스 방식으로 EQ 렌더링 (투명 배경 보장)
        app.log_message(f"  EQ 영상 렌더링 시작: {total_frames}프레임, {fps}fps")

        from PIL import Image as PILImage
        import subprocess

        # 임시 프레임 폴더 생성
        frames_dir = os.path.join(TEMP_DIR, f"eq_frames_{chunk_index}_{uuid.uuid4().hex[:8]}")
        os.makedirs(frames_dir, exist_ok=True)

        try:
            # 프레임별로 PNG 저장
            app.log_message(f"  PNG 프레임 폴더: {frames_dir}")

            for i in range(total_frames):
                if app.cancel_event.is_set():
                    return None

                # 업데이트 함수 호출
                update_func(i)

                # canvas에서 RGBA 버퍼 직접 추출
                canvas.draw()
                buf = canvas.buffer_rgba()
                rgba_array = np.asarray(buf).copy()  # copy()로 버퍼 고정

                # 크로마키 녹색(0,255,0)을 투명으로 변환
                # 녹색 픽셀 찾기 (R<10, G>240, B<10)
                green_mask = (rgba_array[:,:,0] < 10) & (rgba_array[:,:,1] > 240) & (rgba_array[:,:,2] < 10)
                rgba_array[green_mask, 3] = 0  # 녹색 픽셀의 알파를 0으로

                # 첫 프레임 디버그 정보
                non_green_count = np.sum(~green_mask)
                if i == 0:
                    app.log_message(f"  첫 프레임 RGBA: shape={rgba_array.shape}, 비녹색픽셀수={non_green_count}, A_max={rgba_array[:,:,3].max()}, A_min={rgba_array[:,:,3].min()}")

                # PIL로 RGBA 이미지 저장
                pil_img = PILImage.fromarray(rgba_array, 'RGBA')
                frame_path = os.path.join(frames_dir, f"frame_{i:05d}.png")
                pil_img.save(frame_path, 'PNG')

                # 진행률 업데이트 (20프레임마다)
                if i % 20 == 0:
                    progress = 40 + ((i + 1) / total_frames * 40)
                    app.update_progress(f"EQ 렌더링 중: {i + 1}/{total_frames}", progress, is_batch=is_batch)

            plt.close(fig)

            # PNG 파일 수 확인
            import glob
            png_files = glob.glob(os.path.join(frames_dir, '*.png'))
            app.log_message(f"  생성된 PNG 파일 수: {len(png_files)}")

            # FFmpeg로 PNG 시퀀스를 MOV로 변환 (투명 배경 유지)
            app.log_message(f"  PNG 시퀀스를 MOV로 변환 중...")
            ffmpeg_cmd = [
                'ffmpeg', '-y',
                '-framerate', str(fps),
                '-i', os.path.join(frames_dir, 'frame_%05d.png'),
                '-c:v', 'qtrle',  # QuickTime Animation codec
                '-pix_fmt', 'argb',  # ARGB for transparency
                output_path
            ]

            result = subprocess.run(
                ffmpeg_cmd,
                capture_output=True,
                text=True,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            )

            if result.returncode != 0:
                app.log_message(f"  FFmpeg 오류: {result.stderr[:500]}")
                raise RuntimeError(f"FFmpeg 변환 실패: {result.stderr[:200]}")

            app.log_message(f"  ✓ EQ 영상 생성 완료: {output_path}")
            return output_path

        finally:
            # 임시 프레임 폴더 삭제
            import shutil
            if os.path.exists(frames_dir):
                try:
                    shutil.rmtree(frames_dir)
                except:
                    pass
    except Exception as e:
        import traceback
        app.log_message(f"오류: 비주얼라이저 청크 {chunk_index} 렌더링 실패 - {e}\n{traceback.format_exc()}")
        return None

def render_visualizer_video(app, audio_path, job, is_batch=False):
    app.log_message("비주얼라이저 렌더링 시작..."); args = (app, audio_path, job, 0, is_batch); return _render_chunk_worker(args)

def _execute_single_video_job(app, job, is_batch=False):
    temp_files = []
    try:
        app.log_message(f"\n[디버그] _execute_single_video_job 시작")
        app.log_message(f"  - is_batch: {is_batch}")
        app.log_message(f"  - image_path 존재: {'image_path' in job}")
        if 'image_path' in job:
            app.log_message(f"  - image_path ê°': {job['image_path']}")
            app.log_message(f"  - image_path 파일 존재: {os.path.exists(job['image_path'])}")
        app.log_message(f"  - eq_settings 존재: {'eq_settings' in job}")
        if 'eq_settings' in job:
            app.log_message(f"  - eq_settings ê°': {job['eq_settings']}")
        
        app.update_progress("오디오 생성 시작...", 5, is_batch)
        combined_audio = AudioSegment.empty()
        audio_segments = []  # 각 클립별 오디오 저장 (SRT 생성용)
        if is_batch:
            # 배치 모드: 대본 파일을 읽어서 [캐릭터명] 패턴으로 파싱
            script_text = utils.read_script_file(job['scriptPath'])
            clips = []
            current_character = '나레이션'
            current_lines = []

            for line in script_text.split('\n'):
                line = line.strip()
                if not line:
                    continue

                # [캐릭터명] 패턴 체크
                import re
                char_match = re.match(r'^\[([^\]]+)\]\s*(.*)', line)
                if char_match:
                    # 이전 캐릭터의 대사가 있으면 clips에 추가
                    if current_lines:
                        text = ' '.join(current_lines)
                        clips.append({
                            "character": current_character,
                            "text": text,
                            "is_ssml": False
                        })
                        current_lines = []

                    # 새 캐릭터 시작
                    current_character = char_match.group(1).strip()
                    remaining_text = char_match.group(2).strip()
                    if remaining_text:
                        current_lines.append(remaining_text)
                else:
                    # 캐릭터 지정이 없는 라인은 현재 캐릭터에 추가
                    current_lines.append(line)

            # 마지막 캐릭터의 대사 추가
            if current_lines:
                text = ' '.join(current_lines)
                clips.append({
                    "character": current_character,
                    "text": text,
                    "is_ssml": False
                })

            app.log_message(f"[배치] 대본 파싱 완료: {len(clips)}개 클립")
        else: clips = job['clips']

        for i, clip in enumerate(clips):
            if app.cancel_event.is_set(): return False

            char = clip['character']
            text_preview = clip['text'][:50] + "..." if len(clip['text']) > 50 else clip['text']
            app.log_message(f"\n[클립 {i+1}/{len(clips)}] '{char}' 처리 중...")
            app.log_message(f"  텍스트: {text_preview}")

            app.update_progress(f"음성 생성 중 ({i+1}/{len(clips)})...", 5 + (i/len(clips)*35), is_batch)

            # narration_settings에서 캐릭터 설정 가져오기 (없으면 기본값 사용)
            if char in job['narration_settings']:
                w = job['narration_settings'][char]
            else:
                # 기본 음성 설정 사용
                app.log_message(f"  경고: '{char}' 음성 설정이 없어 기본값 사용")
                w = {
                    'voice': 'ko-KR-Wavenet-A',
                    'speed': 1.0,
                    'pitch': 0.0
                }

            # voice 필드가 이미 API 형식인지 확인 (Eel 버전 호환성)
            if w['voice'].startswith(('ko-', 'en-', 'ja-', 'es-', 'fr-', 'de-', 'it-', 'pt-', 'ru-', 'zh-', 'hi-', 'ar-')):
                # 이미 API 형식 (예: ko-KR-Standard-A)
                api_voice = w['voice']
            else:
                # 내부 형식 (예: 여성_A) -> API 형식으로 변환 필요 (Tkinter 버전)
                api_voice = next((name for name, gender in config.LANG_VOICE_GROUPS.get(w['lang'], {}).get(w['group'], {}).items() if app.video_maker_tab._format_voice_name_internal(name, gender) == w['voice']), None)
                if not api_voice: raise ValueError(f"API 음성을 찾을 수 없습니다: {w['voice']}")

            audio_bytes = synthesize_tts_bytes(job['api_key_profile'], clip['text'], api_voice, w['speed'], w['pitch'], w.get('volumeGain', 0), clip.get('is_ssml', False), app=app, pause_after_ms=w.get('pauseAfter', 0))
            audio_seg = AudioSegment.from_mp3(io.BytesIO(audio_bytes))
            audio_segments.append(audio_seg)  # SRT 생성용 저장
            combined_audio += audio_seg
            app.log_message(f"  ✓ 완료!")

        if app.cancel_event.is_set(): return False
        audio_path = os.path.join(TEMP_DIR, f"temp_audio_{job.get('id', uuid.uuid4())}.mp3")
        temp_files.append(audio_path); combined_audio.export(audio_path, format="mp3")
        app.log_message(f"\n[디버그] 오디오 파일 저장 완료: {audio_path}")

        # EQ 활성화 여부 확인
        eq_settings = job.get('eq_settings', {})
        eq_enabled = eq_settings.get('enabled', True)
        app.log_message(f"[디버그] EQ 활성화: {eq_enabled}")

        vis_path = None
        if eq_enabled:
            app.update_progress("비주얼라이저 렌더링...", 40, is_batch)
            app.log_message(f"[디버그] 비주얼라이저 렌더링 시작...")
            vis_path = render_visualizer_video(app, audio_path, job, is_batch)
            if not vis_path:
                app.log_message(f"[오류] 비주얼라이저 렌더링 실패 - vis_path가 None입니다")
                raise RuntimeError("비주얼라이저 렌더링 실패")
            app.log_message(f"[디버그] 비주얼라이저 렌더링 완료: {vis_path}")
            temp_files.append(vis_path)
        else:
            app.log_message(f"[디버그] EQ 비활성화 - 비주얼라이저 렌더링 건너뜀")
            app.update_progress("영상 준비 중...", 40, is_batch)

        if app.cancel_event.is_set(): return False

        app.update_progress("최종 영상 결합 중...", 85, is_batch)
        app.log_message(f"[디버그] 영상 결합 시작...")
        app.log_message(f"  - image_path: {job.get('image_path', 'None')}")

        # 출력 해상도 가져오기
        output_resolution = eq_settings.get('resolution', '1920x1080')
        target_w, target_h = map(int, output_resolution.split('x'))
        app.log_message(f"  - 출력 해상도: {target_w}x{target_h}")

        # 원본 이미지 크기 확인
        with Image.open(job['image_path']) as img:
            orig_w, orig_h = img.size
        app.log_message(f"  - 원본 이미지 크기: {orig_w}x{orig_h}")

        # 출력 해상도를 최종 영상 크기로 사용
        img_w, img_h = target_w, target_h
        app.log_message(f"  - 최종 출력 크기: {img_w}x{img_h}")

        # EQ 활성화 여부에 따라 다른 처리
        if eq_enabled and vis_path:
            # RoyStudio 방식: VideoFileClip으로 투명도 있는 MOV 파일 로드
            # 먼저 MOV 파일 존재 확인
            if not os.path.exists(vis_path):
                app.log_message(f"[오류] EQ MOV 파일이 존재하지 않습니다: {vis_path}")
                raise RuntimeError(f"EQ MOV 파일 없음: {vis_path}")

            vis_file_size = os.path.getsize(vis_path)
            app.log_message(f"[디버그] EQ MOV 파일 크기: {vis_file_size / 1024:.1f} KB")

            with VideoFileClip(vis_path, has_mask=True) as vis_clip, \
                 AudioFileClip(audio_path) as audio_clip, \
                 ImageClip(job['image_path'], duration=audio_clip.duration) as bg_clip_orig:

                # 배경 이미지를 출력 해상도에 맞게 리사이즈
                if bg_clip_orig.size != (img_w, img_h):
                    bg_clip = bg_clip_orig.resized((img_w, img_h))
                    app.log_message(f"[디버그] 배경 이미지 리사이즈: {bg_clip_orig.size} -> {bg_clip.size}")
                else:
                    bg_clip = bg_clip_orig

                app.log_message(f"[디버그] 클립 로드 완료:")
                app.log_message(f"  - vis_clip 크기: {vis_clip.size}")
                app.log_message(f"  - vis_clip 마스크: {vis_clip.mask}")
                app.log_message(f"  - vis_clip duration: {vis_clip.duration}초")
                app.log_message(f"  - audio_clip 길이: {audio_clip.duration}초")
                app.log_message(f"  - bg_clip 크기: {bg_clip.size}, 길이: {bg_clip.duration}초")

                # EQ 클립 첫 프레임 확인
                if vis_clip.duration > 0:
                    test_frame = vis_clip.get_frame(0)
                    app.log_message(f"  - vis_clip 첫 프레임: shape={test_frame.shape}, dtype={test_frame.dtype}, max={test_frame.max()}, min={test_frame.min()}")

                # 마스크가 없으면 경고 (EQ가 검은 배경으로 보일 수 있음)
                if vis_clip.mask is None:
                    app.log_message(f"  ⚠️ 경고: vis_clip에 마스크(투명도)가 없습니다. EQ가 검은 배경과 함께 표시될 수 있습니다.")

                final_bg = bg_clip
                # 밝기 조절 (Tkinter 버전과 Eel 버전 모두 호환)
                brightness_val = 100.0  # 기본값
                if not is_batch:
                    # Tkinter 버전 (brightness_var 사용)
                    if hasattr(app, 'video_maker_tab') and hasattr(app.video_maker_tab, 'brightness_var'):
                        brightness_val = app.video_maker_tab.brightness_var.get()
                    # Eel 버전 (eq_settings에서 brightness 가져오기)
                    elif 'eq_settings' in job and 'brightness' in job['eq_settings']:
                        brightness_val = float(job['eq_settings']['brightness'])

                    if brightness_val != 100.0:
                        base_brightness = brightness_val / 100.0; oscillation = 0.1; period = 10
                        def brightness_func(t): return base_brightness + oscillation * math.sin(2 * math.pi * t / period)
                        final_bg = final_bg.fl(lambda gf, t: (gf(t) * brightness_func(t)).clip(0,255).astype('uint8'))

                app.log_message(f"[디버그] EQ 설정: {eq_settings}")

                # EQ 크기 (픽셀 값 그대로 사용)
                eq_w_pixels = eq_settings.get('width', 800)

                # EQ 위치 (중앙 기준점, 픽셀 값)
                center_x = eq_settings.get('x', img_w // 2)
                center_y = eq_settings.get('y', img_h // 2)
                pos_x = center_x - (eq_w_pixels / 2)
                pos_y = center_y - (eq_settings.get('height', 200) / 2)

                app.log_message(f"[디버그] EQ 위치: ({pos_x}, {pos_y}), 너비: {eq_w_pixels}px")

                # 리사이즈
                resized_vis_clip = vis_clip.resized(width=eq_w_pixels)
                app.log_message(f"[디버그] 비주얼라이저 리사이즈 완료: {resized_vis_clip.size}")

                # 자막 클립 생성
                subtitle_clips = []
                subtitle_settings = job.get('subtitle_settings', {})
                subtitle_enabled = subtitle_settings.get('enabled', False)  # 기본값 False (OFF)
                app.log_message(f"[디버그] 자막 설정: {subtitle_settings}")
                app.log_message(f"[디버그] 자막 활성화: {subtitle_enabled}")

                if subtitle_enabled:
                    app.log_message(f"[디버그] 자막 생성 시작...")

                    # PIL 모듈 import (Image 변수 충돌 방지를 위해 별칭 사용)
                    from PIL import Image as PILImage, ImageDraw, ImageFont

                    # 자막 설정 추출
                    sub_font = subtitle_settings.get('font', 'Noto Sans KR')
                    sub_size = int(subtitle_settings.get('size', 24) * (img_h / 1080))  # 해상도에 맞게 스케일
                    sub_size = max(sub_size, 20)  # 최소 크기 보장
                    sub_color = subtitle_settings.get('color', '#ffffff')
                    sub_bg_color = subtitle_settings.get('bgColor', '#000000')
                    sub_bg_opacity = subtitle_settings.get('bgOpacity', 70) / 100.0
                    sub_bg_none = subtitle_settings.get('bgNone', False)
                    sub_x = subtitle_settings.get('x', 50) / 100.0  # 퍼센트 -> 비율
                    sub_y = subtitle_settings.get('y', 90) / 100.0

                    app.log_message(f"[디버그] 자막 크기: {sub_size}px, 색상: {sub_color}, 위치: ({sub_x}, {sub_y})")

                    # 폰트 로드 (Windows 기본 한글 폰트)
                    font_path = None
                    font_candidates = [
                        'C:/Windows/Fonts/malgun.ttf',      # 맑은 고딕
                        'C:/Windows/Fonts/NanumGothic.ttf', # 나눔고딕
                        'C:/Windows/Fonts/gulim.ttc',       # 굴림
                        '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',  # Linux
                    ]
                    for fc in font_candidates:
                        if os.path.exists(fc):
                            font_path = fc
                            break

                    if font_path:
                        pil_font = ImageFont.truetype(font_path, sub_size)
                        app.log_message(f"[디버그] 폰트 로드: {font_path}")
                    else:
                        pil_font = ImageFont.load_default()
                        app.log_message(f"  ⚠️ 한글 폰트를 찾을 수 없어 기본 폰트 사용")

                    # 각 클립별 자막 생성
                    current_time = 0
                    for i, (clip, audio_seg) in enumerate(zip(clips, audio_segments)):
                        clip_duration = len(audio_seg) / 1000.0  # ms -> 초
                        clip_text = clip['text']

                        try:
                            # 텍스트 크기 측정
                            temp_img = PILImage.new('RGBA', (1, 1))
                            temp_draw = ImageDraw.Draw(temp_img)
                            bbox = temp_draw.textbbox((0, 0), clip_text, font=pil_font)
                            text_w = bbox[2] - bbox[0]
                            text_h = bbox[3] - bbox[1]

                            # 패딩 추가
                            padding_x = 20
                            padding_y = 10
                            img_w_sub = text_w + padding_x * 2
                            img_h_sub = text_h + padding_y * 2

                            # 자막 이미지 생성 (RGBA)
                            subtitle_img = PILImage.new('RGBA', (img_w_sub, img_h_sub), (0, 0, 0, 0))
                            draw = ImageDraw.Draw(subtitle_img)

                            # 배경 그리기 (반투명)
                            if not sub_bg_none:
                                # 배경색 파싱
                                bg_r = int(sub_bg_color[1:3], 16)
                                bg_g = int(sub_bg_color[3:5], 16)
                                bg_b = int(sub_bg_color[5:7], 16)
                                bg_a = int(255 * sub_bg_opacity)

                                # 둥근 사각형 배경
                                draw.rounded_rectangle(
                                    [(0, 0), (img_w_sub, img_h_sub)],
                                    radius=8,
                                    fill=(bg_r, bg_g, bg_b, bg_a)
                                )

                            # 텍스트 색상 파싱
                            txt_r = int(sub_color[1:3], 16)
                            txt_g = int(sub_color[3:5], 16)
                            txt_b = int(sub_color[5:7], 16)

                            # 텍스트 그리기 (외곽선 있으면 먼저 그림)
                            if sub_bg_none:
                                # 외곽선 그리기
                                for dx in [-2, -1, 0, 1, 2]:
                                    for dy in [-2, -1, 0, 1, 2]:
                                        if dx != 0 or dy != 0:
                                            draw.text((padding_x + dx, padding_y + dy), clip_text, font=pil_font, fill=(0, 0, 0, 255))

                            # 메인 텍스트 그리기
                            draw.text((padding_x, padding_y), clip_text, font=pil_font, fill=(txt_r, txt_g, txt_b, 255))

                            # PIL 이미지를 numpy 배열로 변환 (RGBA)
                            subtitle_array = np.array(subtitle_img)

                            # RGB와 알파 채널 분리
                            rgb_array = subtitle_array[:, :, :3]
                            alpha_array = subtitle_array[:, :, 3] / 255.0  # 0-1 범위로 정규화

                            # ImageClip 생성 (RGB)
                            txt_clip = ImageClip(rgb_array)

                            # 알파 마스크 생성
                            mask_clip = ImageClip(alpha_array, is_mask=True)
                            txt_clip = txt_clip.with_mask(mask_clip)

                            # 자막 위치 설정 (중앙 기준점)
                            txt_x = int(sub_x * img_w - img_w_sub / 2)
                            txt_y = int(sub_y * img_h - img_h_sub / 2)

                            # 시간 설정
                            txt_clip = txt_clip.with_start(current_time).with_duration(clip_duration).with_position((txt_x, txt_y))
                            subtitle_clips.append(txt_clip)

                            if i == 0:
                                app.log_message(f"  ✓ 자막 1 생성: '{clip_text[:20]}...' ({img_w_sub}x{img_h_sub}px)")

                        except Exception as e:
                            app.log_message(f"  ⚠️ 자막 {i+1} 생성 실패: {e}")
                            import traceback
                            app.log_message(f"  {traceback.format_exc()}")

                        current_time += clip_duration

                    app.log_message(f"[디버그] 자막 {len(subtitle_clips)}개 생성 완료")

                # 최종 합성 (배경 + EQ + 자막)
                eq_layer = resized_vis_clip.with_position((pos_x, pos_y))
                app.log_message(f"[디버그] EQ 레이어 생성: position=({pos_x}, {pos_y}), size={eq_layer.size}, mask={eq_layer.mask is not None}")

                composite_layers = [final_bg, eq_layer]
                composite_layers.extend(subtitle_clips)
                app.log_message(f"[디버그] 합성 레이어 수: {len(composite_layers)} (배경 + EQ + 자막 {len(subtitle_clips)}개)")

                final_clip = CompositeVideoClip(composite_layers, size=(img_w, img_h)).with_audio(audio_clip)

                # 최종 합성 결과 프레임 테스트
                final_test_frame = final_clip.get_frame(0.5)  # 0.5초 지점 프레임
                app.log_message(f"[디버그] 최종 합성 프레임 shape: {final_test_frame.shape}, dtype: {final_test_frame.dtype}")
                app.log_message(f"[디버그] 최종 클립 생성 완료: {final_clip.size}, {final_clip.duration}초")
                app.log_message(f"[디버그] 출력 경로: {job['output_path']}")
            
                # FPS는 job의 eq_settings에서 가져오기
                fps = job['eq_settings'].get('fps', 20)

                # GPU 인코딩 시도 (없으면 CPU로 fallback)
                # 프리미어 프로 스타일: VBR, 높은 비트레이트, 하드웨어 인코딩
                codec = "libx264"
                preset = "superfast"  # CPU 인코딩 프리셋
                ffmpeg_params = ['-crf', '23']  # 품질 설정 (기본값, 좋은 품질)

                # GPU 가속 감지 및 설정 (프리미어 프로 스타일 최적화)
                gpu_detected = False
                gpu_type = None
                try:
                    result = subprocess.run(
                        ['ffmpeg', '-hide_banner', '-encoders'],
                        capture_output=True,
                        text=True,
                        timeout=2,
                        startupinfo=SUBPROCESS_STARTUP_INFO,
                        creationflags=SUBPROCESS_CREATION_FLAGS
                    )

                    # Intel QSV 우선 확인 (프리미어 프로가 사용하는 방식)
                    # 대부분의 PC에 Intel 내장 GPU가 있으므로 호환성이 높음
                    if 'h264_qsv' in result.stdout:
                        codec = "h264_qsv"
                        # 프리미어 프로 스타일: VBR, 1패스, 약 19Mbps
                        ffmpeg_params = [
                            '-look_ahead', '1',           # lookahead 활성화 (품질 향상)
                            '-global_quality', '23',      # 품질 레벨 (낮을수록 고품질)
                            '-b:v', '15M',                # 목표 비트레이트 15Mbps
                            '-maxrate', '20M',            # 최대 비트레이트 20Mbps
                            '-bufsize', '25M',            # 버퍼 크기
                        ]
                        gpu_detected = True
                        gpu_type = "Intel QSV"
                        app.log_message(f"  ✅ Intel Quick Sync 인코더 감지 (프리미어 프로 스타일)")

                    # NVIDIA GPU 확인 (h264_nvenc)
                    elif 'h264_nvenc' in result.stdout:
                        codec = "h264_nvenc"
                        # NVIDIA 최적화: VBR, 높은 비트레이트
                        ffmpeg_params = [
                            '-preset', 'p4',              # 균형 잡힌 프리셋
                            '-tune', 'hq',                # 고품질 튜닝
                            '-rc', 'vbr',                 # VBR 모드
                            '-cq', '23',                  # 품질 레벨
                            '-b:v', '15M',                # 목표 비트레이트
                            '-maxrate', '20M',            # 최대 비트레이트
                            '-bufsize', '25M',            # 버퍼 크기
                        ]
                        gpu_detected = True
                        gpu_type = "NVIDIA NVENC"
                        app.log_message(f"  ✅ NVIDIA NVENC 인코더 감지")

                    # AMD GPU 확인 (h264_amf)
                    elif 'h264_amf' in result.stdout:
                        codec = "h264_amf"
                        ffmpeg_params = [
                            '-quality', 'balanced',       # 균형 모드
                            '-rc', 'vbr_peak',            # VBR 모드
                            '-b:v', '15M',
                            '-maxrate', '20M',
                        ]
                        gpu_detected = True
                        gpu_type = "AMD AMF"
                        app.log_message(f"  ✅ AMD AMF 인코더 감지")

                    else:
                        # CPU 인코딩 (최적화)
                        ffmpeg_params = [
                            '-crf', '23',                 # 좋은 품질
                            '-preset', 'fast',            # 빠른 프리셋 (superfast보다 품질 좋음)
                        ]
                        app.log_message(f"  ℹ️ CPU 인코딩 사용 (하드웨어 인코더 없음)")

                except Exception as e:
                    app.log_message(f"  ℹ️ GPU 감지 실패, CPU 인코딩 사용: {e}")

                # 오디오 설정 (프리미어 프로 스타일: AAC 320kbps)
                audio_bitrate = "320k"

                # 진행률 표시를 위한 완벽한 커스텀 logger
                class ProgressLogger:
                    def __init__(self, app, total_frames, fps):
                        self.app = app
                        self.total_frames = total_frames
                        self.fps = fps
                        self.last_log_time = time.time()
                        self.start_time = time.time()
                        self.current_frame = 0
                        self.bars = {}  # 여러 프로그레스 바 추적

                    def __call__(self, message=None, **kwargs):
                        # MoviePy는 't' (현재 시간, 초 단위)를 전달함
                        current_time = kwargs.get('t', 0)
                        self.current_frame = int(current_time * self.fps)

                        # 5초마다 한 번씩 진행률 로그
                        now = time.time()
                        if now - self.last_log_time >= 5:
                            if self.total_frames > 0:
                                progress = min(100, (self.current_frame / self.total_frames) * 100)
                                elapsed = int(now - self.start_time)
                                elapsed_str = f"{elapsed // 60}분 {elapsed % 60}초"
                                self.app.log_message(f"  🎬 인코딩 진행 중: {progress:.1f}% (경과: {elapsed_str})")

                            self.last_log_time = now

                    def iter_bar(self, chunk=None, **kwargs):
                        """MoviePy의 iter_bar 메서드 - 오디오/비디오 청크 반복 처리"""
                        if chunk is not None:
                            # 청크를 순회하면서 진행률 업데이트
                            total = len(chunk) if hasattr(chunk, '__len__') else None
                            for i, item in enumerate(chunk):
                                # 주기적으로 진행률 체크
                                if total and i % max(1, total // 20) == 0:  # 5% 단위로 체크
                                    now = time.time()
                                    if now - self.last_log_time >= 5:
                                        progress = (i / total) * 100
                                        elapsed = int(now - self.start_time)
                                        self.app.log_message(f"  🎵 오디오 처리 중: {progress:.1f}%")
                                        self.last_log_time = now
                                yield item
                        else:
                            return iter([])

                    def bars(self, name=None):
                        """MoviePy의 bars 메서드 - 프로그레스 바 객체 반환"""
                        if name not in self.bars:
                            self.bars[name] = self
                        return self.bars[name]

                    def add(self, n=1):
                        """프로그레스 바 업데이트"""
                        pass

                    def update(self, n=1):
                        """프로그레스 바 업데이트"""
                        pass

                    def close(self):
                        """프로그레스 바 종료"""
                        pass

                # 총 프레임 수 계산
                total_frames = int(final_clip.duration * fps)
                progress_logger = ProgressLogger(app, total_frames, fps)

                # 인코딩 시작 메시지
                duration_min = int(final_clip.duration // 60)
                duration_sec = int(final_clip.duration % 60)
                app.log_message(f"  📹 영상 인코딩 시작 (길이: {duration_min}분 {duration_sec}초, 총 {total_frames:,}프레임)")

                # 영상 파일 작성 (GPU 실패 시 CPU로 자동 전환)
                encoding_success = False

                # 진행률 모니터링 스레드 준비
                stop_monitor = threading.Event()
                monitor_thread = threading.Thread(
                    target=_monitor_encoding_progress,
                    args=(job['output_path'], app, stop_monitor, final_clip.duration),
                    daemon=True
                )

                try:
                    # 진행률 모니터링 시작
                    monitor_thread.start()

                    # GPU 인코더는 preset 옵션을 지원하지 않음 (ffmpeg_params에 포함됨)
                    write_params = {
                        'codec': codec,
                        'audio_codec': "aac",
                        'audio_bitrate': audio_bitrate,  # 프리미어 스타일: 320kbps
                        'threads': os.cpu_count() or 4,
                        'fps': fps,
                        'logger': None,
                        'ffmpeg_params': ffmpeg_params
                    }

                    # CPU 인코딩일 때만 preset 추가
                    if not gpu_detected:
                        write_params['preset'] = preset

                    final_clip.write_videofile(job['output_path'], **write_params)

                    # 모니터링 중지
                    stop_monitor.set()

                    # 파일 크기 검증 (0 bytes면 실패)
                    if os.path.exists(job['output_path']):
                        file_size = os.path.getsize(job['output_path'])
                        if file_size == 0:
                            raise RuntimeError("인코딩된 파일 크기가 0 bytes입니다. GPU 하드웨어 미지원으로 추정됩니다.")
                        encoding_success = True
                        if gpu_detected:
                            file_size_mb = file_size / (1024 * 1024)
                            app.log_message(f"  ✓ {gpu_type} 인코딩 성공 ({file_size_mb:.1f} MB)")
                    else:
                        raise RuntimeError("출력 파일이 생성되지 않았습니다.")
                except Exception as gpu_error:
                    if gpu_detected:
                        # GPU 인코딩 실패, CPU로 재시도
                        error_msg = str(gpu_error)[:150]
                        app.log_message(f"  ⚠️ {gpu_type} 인코딩 실패, CPU로 재시도 중...")
                        app.log_message(f"     오류: {error_msg}")

                        # CPU 설정으로 변경
                        codec = "libx264"
                        preset = "fast"
                        ffmpeg_params = ['-crf', '23']

                        # 이전 모니터링 중지
                        stop_monitor.set()

                        # CPU 재시도 시작 메시지
                        app.log_message(f"  📹 CPU 인코딩 시작 (길이: {duration_min}분 {duration_sec}초, 총 {total_frames:,}프레임)")

                        # 새로운 모니터링 스레드 시작
                        stop_monitor_cpu = threading.Event()
                        monitor_thread_cpu = threading.Thread(
                            target=_monitor_encoding_progress,
                            args=(job['output_path'], app, stop_monitor_cpu, final_clip.duration),
                            daemon=True
                        )
                        monitor_thread_cpu.start()

                        # CPU로 재시도
                        final_clip.write_videofile(
                            job['output_path'],
                            codec=codec,
                            preset=preset,
                            audio_codec="aac",
                            audio_bitrate=audio_bitrate,
                            threads=os.cpu_count() or 4,
                            fps=fps,
                            logger=None,
                            ffmpeg_params=ffmpeg_params
                        )

                        # 모니터링 중지
                        stop_monitor_cpu.set()

                        # 파일 크기 검증 (0 bytes면 실패)
                        if os.path.exists(job['output_path']):
                            file_size = os.path.getsize(job['output_path'])
                            if file_size == 0:
                                raise RuntimeError("CPU 인코딩 후에도 파일 크기가 0 bytes입니다.")
                            encoding_success = True
                            file_size_mb = file_size / (1024 * 1024)
                            app.log_message(f"  ✓ CPU 인코딩 성공 ({file_size_mb:.1f} MB)")
                        else:
                            raise RuntimeError("CPU 인코딩 후 출력 파일이 생성되지 않았습니다.")
                    else:
                        # CPU 인코딩도 실패
                        raise

        else:
            # EQ 없이 배경 이미지 + 오디오만 결합
            with AudioFileClip(audio_path) as audio_clip, \
                 ImageClip(job['image_path'], duration=audio_clip.duration) as bg_clip_orig:

                # 배경 이미지를 출력 해상도에 맞게 리사이즈
                if bg_clip_orig.size != (img_w, img_h):
                    bg_clip = bg_clip_orig.resized((img_w, img_h))
                    app.log_message(f"[디버그] 배경 이미지 리사이즈 (EQ 없음): {bg_clip_orig.size} -> {bg_clip.size}")
                else:
                    bg_clip = bg_clip_orig

                app.log_message(f"[디버그] 클립 로드 완료 (EQ 없음):")
                app.log_message(f"  - audio_clip 길이: {audio_clip.duration}초")
                app.log_message(f"  - bg_clip 크기: {bg_clip.size}, 길이: {bg_clip.duration}초")

                final_bg = bg_clip
                # 밝기 조절
                brightness_val = 100.0
                if not is_batch:
                    if hasattr(app, 'video_maker_tab') and hasattr(app.video_maker_tab, 'brightness_var'):
                        brightness_val = app.video_maker_tab.brightness_var.get()
                    elif 'eq_settings' in job and 'brightness' in job['eq_settings']:
                        brightness_val = float(job['eq_settings']['brightness'])

                    if brightness_val != 100.0:
                        base_brightness = brightness_val / 100.0
                        oscillation = 0.1
                        period = 10
                        def brightness_func(t): return base_brightness + oscillation * math.sin(2 * math.pi * t / period)
                        final_bg = final_bg.fl(lambda gf, t: (gf(t) * brightness_func(t)).clip(0,255).astype('uint8'))

                final_clip = final_bg.with_audio(audio_clip)
                app.log_message(f"[디버그] 최종 클립 생성 완료 (EQ 없음): {final_clip.size}, {final_clip.duration}초")
                app.log_message(f"[디버그] 출력 경로: {job['output_path']}")

                # FPS
                fps = eq_settings.get('fps', 30)

                # GPU 인코딩
                codec = "libx264"
                preset = "superfast"
                ffmpeg_params = ['-crf', '23']
                gpu_detected = False

                try:
                    result = subprocess.run(
                        ['ffmpeg', '-hide_banner', '-encoders'],
                        capture_output=True,
                        text=True,
                        timeout=2,
                        startupinfo=SUBPROCESS_STARTUP_INFO,
                        creationflags=SUBPROCESS_CREATION_FLAGS
                    )

                    if 'h264_qsv' in result.stdout:
                        codec = "h264_qsv"
                        ffmpeg_params = ['-look_ahead', '1', '-global_quality', '23', '-b:v', '15M', '-maxrate', '20M', '-bufsize', '25M']
                        gpu_detected = True
                        app.log_message(f"  ✅ Intel Quick Sync 인코더 감지")
                    elif 'h264_nvenc' in result.stdout:
                        codec = "h264_nvenc"
                        ffmpeg_params = ['-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', '23', '-b:v', '15M', '-maxrate', '20M', '-bufsize', '25M']
                        gpu_detected = True
                        app.log_message(f"  ✅ NVIDIA NVENC 인코더 감지")
                except:
                    pass

                # 인코딩
                audio_bitrate = "320k"
                write_params = {
                    'codec': codec,
                    'audio_codec': "aac",
                    'audio_bitrate': audio_bitrate,
                    'threads': os.cpu_count() or 4,
                    'fps': fps,
                    'logger': None,
                    'ffmpeg_params': ffmpeg_params
                }

                if not gpu_detected:
                    write_params['preset'] = preset

                app.log_message(f"  📹 영상 인코딩 시작 (EQ 없음, codec: {codec})")
                final_clip.write_videofile(job['output_path'], **write_params)

                file_size = os.path.getsize(job['output_path'])
                file_size_mb = file_size / (1024 * 1024)
                app.log_message(f"  ✓ 인코딩 성공 ({file_size_mb:.1f} MB)")

        # SRT 자막 파일 생성 (배치 모드 포함)
        if not app.cancel_event.is_set() and clips and audio_segments:
            try:
                srt_path = job['output_path'].replace('.mp4', '.srt')
                app.log_message(f"\n📝 SRT 자막 파일 생성 중...")
                generate_srt_from_clips(clips, audio_segments, srt_path, app=app)
            except Exception as e:
                app.log_message(f"⚠️ SRT 생성 실패 (영상은 정상 생성됨): {e}")

        # 프리미어 프로 프로젝트 파일 생성 (옵션)
        if not app.cancel_event.is_set() and job.get('create_premiere_project', False):
            try:
                app.log_message(f"\n📁 프리미어 프로 프로젝트 생성 중...")
                import premiere_project

                prproj_path = premiere_project.create_premiere_project(
                    video_path=job['output_path'],
                    background_image=job['image_path'],
                    eq_video=vis_path,
                    width=img_w,
                    height=img_h,
                    fps=fps,
                    audio_path=audio_path
                )

                app.log_message(f"✅ 프리미어 프로젝트 생성 완료: {os.path.basename(prproj_path)}")
                app.log_message(f"   이제 프리미어 프로에서 .prproj 파일을 열 수 있습니다!")
            except Exception as e:
                app.log_message(f"⚠️ 프리미어 프로젝트 생성 실패 (영상은 정상 생성됨): {e}")

        if not app.cancel_event.is_set() and not is_batch:
            # Tkinter 버전만 CompletionDialog 표시
            if hasattr(app, 'root') and app.root is not None:
                from ui_dialogs import CompletionDialog
                app.root.after(0, lambda: CompletionDialog(app.root, "제작 완료", job['output_path']))

        # 배치 모드일 때는 dict 반환
        if is_batch:
            return {
                'success': True,
                'output_path': job.get('output_path', ''),
                'fileName': job.get('fileName', 'output')
            }
        else:
            return True

    except Exception as e:
        import traceback
        app.log_message(f"영상 제작 중 오류 발생: {e}\n{traceback.format_exc()}")

        # 배치 모드일 때는 dict 반환
        if is_batch:
            return {
                'success': False,
                'error': str(e)
            }
        else:
            return False
    finally:
        import shutil
        for f in temp_files:
            if os.path.exists(f):
                try:
                    if os.path.isdir(f):
                        shutil.rmtree(f)
                    else:
                        os.remove(f)
                except Exception as e:
                    app.log_message(f"임시 파일 삭제 실패: {e}")

def _execute_single_video_job_transparent(job, app, cancel_event):
    """투명 배경 EQ 영상 생성 (배경 이미지 없이 EQ만 렌더링)"""
    temp_files = []
    try:
        app.log_message(f"\n[디버그] 투명 EQ 영상 생성 시작")
        app.log_message(f"  - eq_settings: {job.get('eq_settings', {})}")

        app.update_progress("오디오 생성 시작...", 5)
        combined_audio = AudioSegment.empty()
        audio_segments = []  # 각 클립별 오디오 저장 (SRT 생성용)
        clips = job['clips']

        for i, clip in enumerate(clips):
            if cancel_event.is_set():
                return {'status': 'cancelled'}

            char = clip['character']
            text_preview = clip['text'][:50] + "..." if len(clip['text']) > 50 else clip['text']
            app.log_message(f"\n[클립 {i+1}/{len(clips)}] '{char}' 처리 중...")
            app.log_message(f"  텍스트: {text_preview}")

            app.update_progress(f"음성 생성 중 ({i+1}/{len(clips)})...", 5 + (i/len(clips)*35))

            # 캐릭터별 음성 설정 사용
            if char in job['narration_settings']:
                w = job['narration_settings'][char]
                # API 음성 이름 추출
                api_voice = w.get('voice', '')
                rate = float(w.get('speed', 1.0))
                pitch = float(w.get('pitch', 0.0))
                volume_gain = float(w.get('volumeGain', 0))
            else:
                app.log_message(f"  경고: '{char}' 음성 설정 없음, 기본 설정 사용")
                # 기본 음성 설정 (한국어 Standard A)
                api_voice = 'ko-KR-Standard-A'
                rate = 1.0
                pitch = 0.0
                volume_gain = 0

            audio_bytes = synthesize_tts_bytes(
                job['api_key_profile'],
                clip['text'],
                api_voice,
                rate,
                pitch,
                volume_gain,
                clip.get('is_ssml', False),
                app=app
            )
            audio_seg = AudioSegment.from_mp3(io.BytesIO(audio_bytes))
            audio_segments.append(audio_seg)  # SRT 생성용 저장
            combined_audio += audio_seg
            app.log_message(f"  ✓ 완료!")

        if cancel_event.is_set():
            return {'status': 'cancelled'}

        audio_path = os.path.join(TEMP_DIR, f"temp_audio_{job.get('id', uuid.uuid4())}.mp3")
        temp_files.append(audio_path)
        combined_audio.export(audio_path, format="mp3")
        app.log_message(f"\n[디버그] 오디오 파일 저장 완료: {audio_path}")

        app.update_progress("비주얼라이저 렌더링...", 40)
        app.log_message(f"[디버그] 비주얼라이저 렌더링 시작...")
        vis_path = render_visualizer_video(app, audio_path, job, is_batch=False)
        if not vis_path:
            app.log_message(f"[오류] 비주얼라이저 렌더링 실패")
            return {'status': 'error', 'error': '비주얼라이저 렌더링 실패'}
        app.log_message(f"[디버그] 비주얼라이저 렌더링 완료: {vis_path}")
        temp_files.append(vis_path)

        if cancel_event.is_set():
            return {'status': 'cancelled'}

        app.update_progress("투명 배경 영상 생성 중...", 85)
        app.log_message(f"[디버그] 투명 배경 영상 생성 시작...")

        # RoyStudio 방식: 이미 생성된 MOV 파일을 그대로 사용 (이미 투명 배경)
        # 오디오만 추가하면 됨
        with VideoFileClip(vis_path, has_mask=True) as vis_clip, \
             AudioFileClip(audio_path) as audio_clip:

            app.log_message(f"[디버그] 클립 로드 완료:")
            app.log_message(f"  - vis_clip 크기: {vis_clip.size}")
            app.log_message(f"  - audio_clip 길이: {audio_clip.duration}초")

            # EQ 클립에 오디오 추가
            final_clip = vis_clip.with_audio(audio_clip)
            app.log_message(f"[디버그] 최종 클립 생성 완료: {final_clip.size}, {final_clip.duration}초")
            app.log_message(f"[디버그] 출력 경로: {job['output_path']}")

            # MOV 형식으로 저장 (투명 배경 지원)
            fps = job['eq_settings'].get('fps', 20)
            final_clip.write_videofile(
                job['output_path'],
                codec="qtrle",  # QuickTime Animation codec (투명 배경 지원)
                fps=fps,
                ffmpeg_params=['-pix_fmt', 'argb'],  # 투명 배경을 위한 ARGB 픽셀 포맷
                threads=(os.cpu_count() or 1),
                logger=None
            )

        # SRT 자막 파일 생성
        if not cancel_event.is_set() and clips and audio_segments:
            try:
                srt_path = job['output_path'].replace('.mov', '.srt')
                app.log_message(f"\n📝 SRT 자막 파일 생성 중...")
                generate_srt_from_clips(clips, audio_segments, srt_path, app=app)
            except Exception as e:
                app.log_message(f"⚠️ SRT 생성 실패 (영상은 정상 생성됨): {e}")

        app.log_message(f"✅ 투명 EQ 영상 생성 완료!")
        return {'status': 'success'}

    except Exception as e:
        import traceback
        error_msg = f"{str(e)}\n{traceback.format_exc()}"
        app.log_message(f"투명 EQ 영상 생성 중 오류 발생: {error_msg}")
        return {'status': 'error', 'error': str(e)}
    finally:
        import shutil
        for f in temp_files:
            if os.path.exists(f):
                try:
                    if os.path.isdir(f):
                        shutil.rmtree(f)
                    else:
                        os.remove(f)
                except Exception as e:
                    app.log_message(f"임시 파일 삭제 실패: {e}")