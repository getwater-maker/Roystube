"""
RoyStudio 백엔드 모듈
RoyYoutubeSearch에 통합된 로이스튜디오 기능의 Python 백엔드
"""

import eel
import os
import sys
import json
import threading
import time
import traceback
from tkinter import filedialog
import tkinter as tk
from datetime import datetime
from collections import deque

# ========== 백엔드 로그 수집기 ==========
class BackendLogCollector:
    def __init__(self, max_logs=2000):
        self.logs = deque(maxlen=max_logs)
        self._original_print = print

    def add(self, message, log_type="INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] [{log_type}] {message}"
        self.logs.append(log_entry)

    def get_logs(self):
        return list(self.logs)

    def clear(self):
        self.logs.clear()

# 전역 로그 수집기 인스턴스
backend_log_collector = BackendLogCollector()

# print 함수 오버라이드하여 로그 수집
_original_print = print
def print(*args, **kwargs):
    message = ' '.join(str(arg) for arg in args)
    # 로그 타입 감지
    log_type = "INFO"
    if "[ERROR]" in message or "오류" in message or "실패" in message:
        log_type = "ERROR"
    elif "[WARN]" in message or "경고" in message:
        log_type = "WARN"
    elif "[DEBUG]" in message:
        log_type = "DEBUG"

    backend_log_collector.add(message, log_type)
    _original_print(*args, **kwargs)

@eel.expose
def get_backend_logs():
    """백엔드 로그 반환"""
    return {
        'success': True,
        'logs': backend_log_collector.get_logs()
    }

@eel.expose
def clear_backend_logs():
    """백엔드 로그 초기화"""
    backend_log_collector.clear()
    return {'success': True}

print("[RoyStudio] 백엔드 로그 수집기 초기화 완료")

# ========== 하드웨어 인코더 자동 감지 ==========
import subprocess

# 사용 가능한 인코더 캐시 (프로그램 시작 시 한 번만 감지)
_available_encoders = None
_best_encoder = None

def detect_available_encoders():
    """FFmpeg에서 사용 가능한 H.264 인코더 감지"""
    global _available_encoders, _best_encoder

    if _available_encoders is not None:
        return _available_encoders

    # 우선순위 순서 (빠른 순)
    encoder_priority = [
        ('h264_nvenc', 'NVIDIA GPU'),
        ('h264_qsv', 'Intel GPU (Quick Sync)'),
        ('h264_amf', 'AMD GPU'),
        ('libx264', 'CPU (소프트웨어)')
    ]

    _available_encoders = []

    try:
        # FFmpeg 인코더 목록 가져오기
        result = subprocess.run(
            ['ffmpeg', '-encoders'],
            capture_output=True,
            text=True,
            timeout=10
        )
        output = result.stdout + result.stderr

        for codec, name in encoder_priority:
            if codec in output:
                # 실제로 작동하는지 테스트 (NVENC, QSV 등은 하드웨어가 없으면 실패)
                if codec != 'libx264':
                    if test_encoder(codec):
                        _available_encoders.append({'codec': codec, 'name': name, 'available': True})
                    else:
                        _available_encoders.append({'codec': codec, 'name': name, 'available': False})
                else:
                    # libx264는 항상 사용 가능
                    _available_encoders.append({'codec': codec, 'name': name, 'available': True})

        # 최적 인코더 선택 (사용 가능한 것 중 우선순위 가장 높은 것)
        for enc in _available_encoders:
            if enc['available']:
                _best_encoder = enc['codec']
                break

        if not _best_encoder:
            _best_encoder = 'libx264'  # 폴백

        print(f"[RoyStudio] 감지된 인코더: {_available_encoders}")
        print(f"[RoyStudio] 최적 인코더 선택: {_best_encoder}")

    except Exception as e:
        print(f"[RoyStudio] 인코더 감지 오류: {e}")
        _available_encoders = [{'codec': 'libx264', 'name': 'CPU (소프트웨어)', 'available': True}]
        _best_encoder = 'libx264'

    return _available_encoders

def test_encoder(codec):
    """인코더가 실제로 작동하는지 테스트"""
    try:
        # 1초짜리 테스트 인코딩 시도
        result = subprocess.run(
            [
                'ffmpeg', '-y',
                '-f', 'lavfi', '-i', 'color=black:s=64x64:d=0.1',
                '-c:v', codec,
                '-f', 'null', '-'
            ],
            capture_output=True,
            timeout=10
        )
        return result.returncode == 0
    except Exception:
        return False

def get_best_encoder():
    """최적의 인코더 반환"""
    global _best_encoder
    if _best_encoder is None:
        detect_available_encoders()
    return _best_encoder

def get_encoder_preset(codec):
    """인코더별 최적 프리셋 반환"""
    # 하드웨어 인코더는 preset 옵션이 다름
    if codec in ['h264_nvenc', 'h264_qsv', 'h264_amf']:
        return None  # 하드웨어 인코더는 기본값 사용 (충분히 빠름)
    else:
        return 'ultrafast'  # CPU 인코더는 ultrafast 사용

def format_srt_time(seconds):
    """초를 SRT 시간 형식(00:00:00,000)으로 변환"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

@eel.expose
def get_available_encoders():
    """사용 가능한 인코더 목록 반환 (프론트엔드용)"""
    encoders = detect_available_encoders()
    best = get_best_encoder()
    return {
        'success': True,
        'encoders': encoders,
        'best': best,
        'bestName': next((e['name'] for e in encoders if e['codec'] == best), 'CPU')
    }

# 프로그램 시작 시 인코더 감지 (백그라운드)
def _init_encoder_detection():
    try:
        detect_available_encoders()
    except Exception as e:
        print(f"[RoyStudio] 인코더 초기 감지 실패: {e}")

threading.Thread(target=_init_encoder_detection, daemon=True).start()

# RoyStudio 핵심 모듈 import
try:
    import studio_config as config
    import studio_utils as utils
    import studio_services as services
    # studio_blackscreen은 Tkinter UI 기반이므로 직접 사용하지 않음
    # 검은 화면 생성은 studio_backend 내에서 직접 구현
    STUDIO_MODULES_LOADED = True
    print("[RoyStudio] 핵심 모듈 로드 성공")
except ImportError as e:
    STUDIO_MODULES_LOADED = False
    print(f"[RoyStudio] 핵심 모듈 로드 실패: {e}")

# 전역 변수
studio_cancel_event = threading.Event()
studio_processing_thread = None

# 데이터 파일 경로 (studio_config에서 가져오기)
if STUDIO_MODULES_LOADED:
    STUDIO_DATA_DIR = os.path.join(os.path.expanduser('~'), '.audiovis_tts_app_data')
    STUDIO_PROFILES_FILE = config.PROFILES_FILE
    STUDIO_PRESETS_FILE = config.GLOBAL_PRESETS_FILE
    STUDIO_DEFAULTS_FILE = config.DEFAULTS_FILE
else:
    STUDIO_DATA_DIR = os.path.join(os.path.expanduser('~'), '.audiovis_tts_app_data')
    STUDIO_PROFILES_FILE = os.path.join(STUDIO_DATA_DIR, 'profiles.json')
    STUDIO_PRESETS_FILE = os.path.join(STUDIO_DATA_DIR, 'presets.json')
    STUDIO_DEFAULTS_FILE = os.path.join(STUDIO_DATA_DIR, 'defaults.json')

# 데이터 디렉토리 생성
os.makedirs(STUDIO_DATA_DIR, exist_ok=True)


def studio_load_json_file(filepath):
    """JSON 파일 로드"""
    if STUDIO_MODULES_LOADED:
        return utils.load_json_file(filepath)
    try:
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"[RoyStudio] JSON 로드 오류: {e}")
    return {}


def studio_save_json_file(filepath, data):
    """JSON 파일 저장"""
    if STUDIO_MODULES_LOADED:
        try:
            utils.save_json_file(filepath, data)
            return True
        except Exception as e:
            print(f"[RoyStudio] JSON 저장 오류: {e}")
            return False
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[RoyStudio] JSON 저장 오류: {e}")
        return False


# ========== 프로필 관리 API ==========

@eel.expose
def studio_get_profiles():
    """프로필 목록 반환"""
    profiles = studio_load_json_file(STUDIO_PROFILES_FILE)
    return list(profiles.keys())


@eel.expose
def studio_get_profile_info(profile_name):
    """프로필 상세 정보 반환"""
    profiles = studio_load_json_file(STUDIO_PROFILES_FILE)
    return profiles.get(profile_name, {})


@eel.expose
def studio_add_profile(name, credential, folder=''):
    """새 프로필 추가"""
    try:
        profiles = studio_load_json_file(STUDIO_PROFILES_FILE)
        if name in profiles:
            return {'success': False, 'error': '이미 존재하는 계정 이름입니다.'}

        profiles[name] = {
            'credential': credential,
            'folder': folder
        }
        studio_save_json_file(STUDIO_PROFILES_FILE, profiles)
        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_update_profile(name, credential, folder=''):
    """프로필 수정"""
    try:
        profiles = studio_load_json_file(STUDIO_PROFILES_FILE)
        if name not in profiles:
            return {'success': False, 'error': '존재하지 않는 계정입니다.'}

        profiles[name] = {
            'credential': credential,
            'folder': folder
        }
        studio_save_json_file(STUDIO_PROFILES_FILE, profiles)
        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_delete_profile(name):
    """프로필 삭제"""
    try:
        profiles = studio_load_json_file(STUDIO_PROFILES_FILE)
        if name in profiles:
            del profiles[name]
            studio_save_json_file(STUDIO_PROFILES_FILE, profiles)
        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_validate_api_key(api_key):
    """API 키 유효성 검증"""
    try:
        # 간단한 형식 검증
        if not api_key or len(api_key) < 10:
            return {'valid': False, 'error': 'API 키가 너무 짧습니다.'}

        # 실제 Google Cloud TTS API 호출로 검증
        if STUDIO_MODULES_LOADED:
            is_valid, message = services.validate_api_key(api_key)
            return {'valid': is_valid, 'message': message}

        return {'valid': True, 'message': 'API 키 형식이 유효합니다. (실제 검증 미수행)'}
    except Exception as e:
        return {'valid': False, 'error': str(e)}


# ========== 파일 선택 API ==========

@eel.expose
def studio_select_files():
    """여러 파일 선택 다이얼로그"""
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    files = filedialog.askopenfilenames(
        title="파일 선택",
        filetypes=[
            ("텍스트 파일", "*.txt"),
            ("모든 파일", "*.*")
        ]
    )
    root.destroy()
    return list(files) if files else []


@eel.expose
def studio_select_folder():
    """폴더 선택 다이얼로그"""
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    folder = filedialog.askdirectory(title="폴더 선택")
    root.destroy()
    return folder if folder else None


@eel.expose
def studio_select_single_image():
    """단일 이미지 파일 선택"""
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    file = filedialog.askopenfilename(
        title="이미지 선택",
        filetypes=[
            ("이미지 파일", "*.png;*.jpg;*.jpeg;*.bmp;*.gif"),
            ("모든 파일", "*.*")
        ]
    )
    root.destroy()
    return file if file else None


@eel.expose
def studio_get_image_base64(image_path):
    """이미지 파일을 Base64로 변환하여 반환"""
    import base64
    try:
        if not image_path or not os.path.exists(image_path):
            return {'success': False, 'error': '이미지 파일이 존재하지 않습니다.'}

        # 이미지 확장자 확인
        ext = os.path.splitext(image_path)[1].lower()
        mime_types = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.webp': 'image/webp'
        }
        mime_type = mime_types.get(ext, 'image/png')

        with open(image_path, 'rb') as f:
            image_data = f.read()

        base64_data = base64.b64encode(image_data).decode('utf-8')
        data_url = f'data:{mime_type};base64,{base64_data}'

        return {'success': True, 'data_url': data_url}
    except Exception as e:
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_select_text_file():
    """텍스트 파일 선택"""
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    file = filedialog.askopenfilename(
        title="텍스트 파일 선택",
        filetypes=[
            ("텍스트 파일", "*.txt"),
            ("모든 파일", "*.*")
        ]
    )
    root.destroy()
    return file if file else None


@eel.expose
def studio_select_save_path():
    """저장 경로 선택"""
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    file = filedialog.asksaveasfilename(
        title="저장 경로 선택",
        defaultextension=".mp4",
        filetypes=[
            ("MP4 비디오", "*.mp4"),
            ("모든 파일", "*.*")
        ]
    )
    root.destroy()
    return file if file else None


@eel.expose
def studio_get_downloads_folder():
    """사용자 다운로드 폴더 경로 반환"""
    import platform
    if platform.system() == 'Windows':
        # Windows: 사용자 다운로드 폴더
        downloads = os.path.join(os.path.expanduser('~'), 'Downloads')
    else:
        # macOS/Linux
        downloads = os.path.join(os.path.expanduser('~'), 'Downloads')

    # 폴더가 없으면 생성
    if not os.path.exists(downloads):
        os.makedirs(downloads, exist_ok=True)

    return downloads


# ========== 파일 처리 API ==========

@eel.expose
def studio_get_text_files_from_folder(folder_path):
    """폴더에서 텍스트 파일 목록 가져오기"""
    try:
        files = []
        for filename in os.listdir(folder_path):
            if filename.endswith('.txt'):
                files.append(os.path.join(folder_path, filename))
        return files
    except Exception as e:
        print(f"[RoyStudio] 폴더 읽기 오류: {e}")
        return []


@eel.expose
def studio_read_text_file(filepath):
    """텍스트 파일 읽기"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except UnicodeDecodeError:
        try:
            with open(filepath, 'r', encoding='cp949') as f:
                return f.read()
        except Exception as e:
            return f"파일 읽기 오류: {e}"
    except Exception as e:
        return f"파일 읽기 오류: {e}"


# ========== 프리셋 관리 API ==========

@eel.expose
def studio_get_presets():
    """프리셋 목록 반환"""
    presets = studio_load_json_file(STUDIO_PRESETS_FILE)
    return list(presets.keys())


@eel.expose
def studio_load_preset(preset_name):
    """프리셋 로드"""
    presets = studio_load_json_file(STUDIO_PRESETS_FILE)
    return presets.get(preset_name, {})


@eel.expose
def studio_save_preset(preset_name, preset_data):
    """프리셋 저장"""
    try:
        presets = studio_load_json_file(STUDIO_PRESETS_FILE)
        presets[preset_name] = preset_data
        studio_save_json_file(STUDIO_PRESETS_FILE, presets)
        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_delete_preset(preset_name):
    """프리셋 삭제"""
    try:
        presets = studio_load_json_file(STUDIO_PRESETS_FILE)
        if preset_name in presets:
            del presets[preset_name]
            studio_save_json_file(STUDIO_PRESETS_FILE, presets)
        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}


# ========== 작업 처리 API ==========

@eel.expose
def studio_process_job(script_path, mode):
    """작업 처리 (스텁)"""
    print(f"[RoyStudio] 작업 처리: {script_path}, 모드: {mode}")
    # TODO: 실제 영상 제작 로직 구현
    # RoyStudio/services.py의 로직을 여기에 통합
    return {'success': True}


@eel.expose
def studio_cancel_production():
    """제작 취소"""
    global studio_cancel_event
    studio_cancel_event.set()
    print("[RoyStudio] 제작 취소 요청")


# ========== 검은 화면 생성 API ==========

class BlackscreenProgressLogger:
    """MoviePy 진행률을 Eel로 전송하는 로거"""
    def __init__(self, cancel_event):
        self.cancel_event = cancel_event
        self.last_progress = 0

    def bars_callback(self, bar, attr, value, old_value=None):
        """프로그레스 바 콜백"""
        if self.cancel_event.is_set():
            raise InterruptedError("사용자에 의해 취소됨")

        if bar == 't' and hasattr(value, '__float__'):
            try:
                # value는 현재 진행률 (0~1)
                progress = int(float(value) * 90) + 10  # 10~100%
                if progress > self.last_progress:
                    self.last_progress = progress
                    status = "인코딩 중..." if progress < 100 else "완료"
                    eel.studioBlackscreenProgressFromPython(progress, status)
            except:
                pass


def _get_gpu_codec():
    """사용 가능한 GPU 인코더 확인 (실제 테스트로 검증)"""
    import subprocess
    import tempfile

    # 테스트할 GPU 코덱 목록 (우선순위순)
    gpu_codecs = [
        ('h264_nvenc', 'p4'),       # NVIDIA
        ('h264_amf', 'balanced'),   # AMD
        ('h264_qsv', 'medium'),     # Intel Quick Sync
    ]

    for codec, preset in gpu_codecs:
        try:
            # 실제로 1프레임 인코딩 테스트
            with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp:
                tmp_path = tmp.name

            result = subprocess.run([
                'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
                '-f', 'lavfi', '-i', 'color=black:s=64x64:d=0.1',
                '-c:v', codec, '-preset', preset,
                '-frames:v', '1',
                tmp_path
            ], capture_output=True, timeout=10)

            # 테스트 파일 삭제
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

            if result.returncode == 0:
                print(f"[RoyStudio] GPU 코덱 사용 가능: {codec}")
                return codec
        except Exception as e:
            continue

    print("[RoyStudio] GPU 코덱 사용 불가, CPU 인코더 사용")
    return 'libx264'  # CPU 인코더 (기본)


def _get_position_coords(position, width, height, timer_size):
    """위치 문자열을 좌표로 변환"""
    # timer_size는 px 단위
    margin = 50  # 가장자리 여백

    positions = {
        'center': (0.5, 0.5),
        'top-center': (0.5, 0.15),
        'bottom-center': (0.5, 0.85),
        'top-left': (0.15, 0.15),
        'top-right': (0.85, 0.15),
        'bottom-left': (0.15, 0.85),
        'bottom-right': (0.85, 0.85),
    }
    return positions.get(position, (0.5, 0.5))


def _generate_black_screen_thread(output_path, bg_color, duration_seconds, resolution,
                                   show_timer, timer_options):
    """검은 화면 비디오 생성 스레드"""
    import math
    from moviepy import ColorClip, VideoClip, CompositeVideoClip
    from PIL import Image, ImageDraw, ImageFont
    import numpy as np

    try:
        # 취소 확인
        if studio_cancel_event.is_set():
            return

        # 배경색 파싱
        color_rgb = tuple(int(bg_color.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))

        # 타이머 색상 파싱
        timer_color = timer_options.get('color', '#ffffff')
        timer_color_rgb = tuple(int(timer_color.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))

        # 해상도 파싱
        width, height = map(int, resolution.split('x')[0:2])
        size = (width, height)

        # 기본 배경 클립 생성
        base_clip = ColorClip(size=size, color=color_rgb, duration=duration_seconds)
        clips_to_compose = [base_clip]

        # 타이머 옵션 추출
        timer_type = timer_options.get('type', 'countdown')
        font_style = timer_options.get('font_style', 'default')
        timer_position = timer_options.get('position', 'center')
        # 크기는 %로 받아서 픽셀로 변환 (높이 기준)
        timer_size_percent = float(timer_options.get('size', 15))
        timer_size_px = int(height * timer_size_percent / 100)
        input_hours = timer_options.get('hours', 0)
        input_minutes = timer_options.get('minutes', 0)
        input_seconds = timer_options.get('seconds', 0)

        # 타이머 추가
        if show_timer:
            pos_x, pos_y = _get_position_coords(timer_position, width, height, timer_size_px)

            def make_timer_frame(t):
                """디지털 타이머 프레임 생성"""
                if studio_cancel_event.is_set():
                    raise StopIteration("작업이 취소되었습니다.")

                # 카운트다운/업 처리
                if timer_type == 'countdown':
                    current_time = max(0, duration_seconds - t)
                else:
                    current_time = t

                total_sec = int(current_time)
                h_int, remainder = divmod(total_sec, 3600)
                m_int, s_int = divmod(remainder, 60)

                # 시간 표시 형식 자동 결정 (입력값 기준으로 형식 결정, 현재값 기준으로 자릿수)
                input_total_seconds = input_hours * 3600 + input_minutes * 60 + input_seconds
                current_total_seconds = h_int * 3600 + m_int * 60 + s_int

                if input_hours >= 1:
                    # 시가 1 이상이면 시:분:초
                    time_str = f"{h_int:02d}:{m_int:02d}:{s_int:02d}"
                elif input_minutes >= 1:
                    # 시가 0이고 분이 1 이상이면 분:초
                    total_min = h_int * 60 + m_int
                    time_str = f"{total_min:02d}:{s_int:02d}"
                elif current_total_seconds >= 10:
                    # 현재 10초 이상이면 두 자리
                    time_str = f"{current_total_seconds:02d}"
                else:
                    # 현재 10초 미만이면 한 자리
                    time_str = f"{current_total_seconds}"

                # 폰트 크기 계산
                font_size = int(timer_size_px / 3)

                # PIL로 텍스트 이미지 생성
                img_width = timer_size_px * 2
                img_height = timer_size_px
                img = Image.new('RGBA', (img_width, img_height), (0, 0, 0, 0))
                draw = ImageDraw.Draw(img)

                # 폰트 스타일 적용
                try:
                    if font_style == 'bold':
                        font = ImageFont.truetype("arialbd.ttf", font_size)
                    elif font_style == 'thin':
                        font = ImageFont.truetype("arial.ttf", int(font_size * 0.8))
                    elif font_style == 'mono':
                        font = ImageFont.truetype("consola.ttf", font_size)
                    elif font_style == 'digital':
                        font = ImageFont.truetype("consola.ttf", font_size)
                    elif font_style == 'neon':
                        font = ImageFont.truetype("arialbd.ttf", font_size)
                    else:
                        font = ImageFont.truetype("arial.ttf", font_size)
                except:
                    font = ImageFont.load_default()

                # 텍스트 바운딩 박스
                bbox = draw.textbbox((0, 0), time_str, font=font)
                text_width = bbox[2] - bbox[0]
                text_height = bbox[3] - bbox[1]

                # 중앙 정렬
                x = (img_width - text_width) // 2
                y = (img_height - text_height) // 2

                # 네온 효과 (글로우)
                if font_style == 'neon':
                    for offset in range(3, 0, -1):
                        glow_color = (*timer_color_rgb, 50)
                        draw.text((x-offset, y), time_str, font=font, fill=glow_color)
                        draw.text((x+offset, y), time_str, font=font, fill=glow_color)
                        draw.text((x, y-offset), time_str, font=font, fill=glow_color)
                        draw.text((x, y+offset), time_str, font=font, fill=glow_color)

                # 메인 텍스트
                draw.text((x, y), time_str, font=font, fill=(*timer_color_rgb, 255))

                return np.array(img)

            # MoviePy 2.x 호환
            timer_clip = VideoClip(make_timer_frame, duration=duration_seconds)
            # 클립 크기 (텍스트 이미지 크기)
            clip_width = timer_size_px * 2
            clip_height = timer_size_px
            # 중앙 정렬을 위해 클립 크기의 절반을 빼서 위치 계산
            actual_x = pos_x * width - clip_width / 2
            actual_y = pos_y * height - clip_height / 2
            timer_clip = timer_clip.with_position((actual_x, actual_y))
            clips_to_compose.append(timer_clip)

        # 최종 합성
        if len(clips_to_compose) == 1:
            final_clip = base_clip
        else:
            final_clip = CompositeVideoClip(clips_to_compose, size=size)

        final_clip = final_clip.with_duration(duration_seconds)
        final_clip = final_clip.with_fps(30)

        # 취소 확인
        if studio_cancel_event.is_set():
            raise InterruptedError("사용자에 의해 취소됨")

        # GPU 코덱 확인
        codec = _get_gpu_codec()
        codec_name = {
            'h264_nvenc': 'NVIDIA GPU (NVENC)',
            'h264_amf': 'AMD GPU (AMF)',
            'h264_qsv': 'Intel Quick Sync',
            'libx264': 'CPU (libx264)'
        }.get(codec, codec)

        eel.studioBlackscreenProgressFromPython(5, f"인코딩 준비 중... ({codec_name})")

        # 비디오 파일 생성
        total_frames = int(duration_seconds * 30)

        def write_with_progress(use_codec, use_codec_name):
            """진행률과 함께 비디오 작성"""
            from moviepy.video.io.ffmpeg_writer import FFMPEG_VideoWriter

            # GPU 코덱 사용 시 프리셋 조정
            preset = 'p4' if use_codec == 'h264_nvenc' else ('balanced' if use_codec == 'h264_amf' else 'medium')

            writer = FFMPEG_VideoWriter(
                output_path,
                size,
                fps=30,
                codec=use_codec,
                preset=preset,
                audiofile=None
            )

            try:
                for frame_idx in range(total_frames):
                    # 취소 확인
                    if studio_cancel_event.is_set():
                        writer.close()
                        if os.path.exists(output_path):
                            os.remove(output_path)
                        raise InterruptedError("사용자에 의해 취소됨")

                    frame_time = frame_idx / 30.0
                    frame = final_clip.get_frame(frame_time)
                    writer.write_frame(frame)

                    # 진행률 업데이트 (매 30프레임마다 = 1초마다)
                    if frame_idx % 30 == 0:
                        progress = int((frame_idx / total_frames) * 90) + 10
                        eel.studioBlackscreenProgressFromPython(progress, f"인코딩 중... ({use_codec_name})")

                writer.close()
            except InterruptedError:
                raise
            except Exception as e:
                writer.close()
                raise e

        # 먼저 선택된 코덱으로 시도, 실패하면 CPU 코덱으로 폴백
        try:
            write_with_progress(codec, codec_name)
        except Exception as e:
            if codec != 'libx264':
                print(f"[RoyStudio] {codec} 인코딩 실패, CPU 인코더로 재시도: {e}")
                eel.studioBlackscreenProgressFromPython(5, "GPU 인코딩 실패, CPU로 재시도...")
                # 실패한 파일 삭제
                if os.path.exists(output_path):
                    try:
                        os.remove(output_path)
                    except:
                        pass
                # CPU 코덱으로 재시도
                write_with_progress('libx264', 'CPU (libx264)')
            else:
                raise e

        eel.studioBlackscreenProgressFromPython(100, "완료")
        eel.studioBlackscreenComplete({'success': True, 'output_path': output_path})

    except InterruptedError:
        print("[RoyStudio] 검은 화면 제작이 사용자에 의해 중지되었습니다.")
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
            except:
                pass
        eel.studioBlackscreenComplete({'success': False, 'error': '사용자에 의해 취소됨'})

    except StopIteration:
        print("[RoyStudio] 검은 화면 제작이 사용자에 의해 중지되었습니다.")
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
            except:
                pass
        eel.studioBlackscreenComplete({'success': False, 'error': '사용자에 의해 취소됨'})

    except Exception as e:
        print(f"[RoyStudio] 검은 화면 제작 중 오류: {e}")
        traceback.print_exc()
        eel.studioBlackscreenComplete({'success': False, 'error': str(e)})


@eel.expose
def studio_generate_black_screen(output_path, bg_color, duration, resolution,
                                  show_timer, timer_type, font_style,
                                  timer_position, timer_size, timer_color):
    """검은 화면 비디오 생성"""
    global studio_processing_thread, studio_cancel_event

    print(f"[RoyStudio] 검은 화면 생성: {output_path}")
    print(f"  - 배경색: {bg_color}")
    print(f"  - 길이: {duration}")
    print(f"  - 해상도: {resolution}")
    print(f"  - 타이머: {show_timer}")

    try:
        # 이전 작업 취소 이벤트 초기화
        studio_cancel_event.clear()

        # 시간 파싱 (HH:MM:SS 형식)
        if isinstance(duration, str) and ':' in duration:
            parts = duration.split(':')
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds = int(parts[2])
            duration_seconds = hours * 3600 + minutes * 60 + seconds
        else:
            duration_seconds = int(duration)
            hours = duration_seconds // 3600
            minutes = (duration_seconds % 3600) // 60
            seconds = duration_seconds % 60

        if duration_seconds <= 0:
            return {'success': False, 'error': '시간은 0보다 커야 합니다.'}

        # 타이머 옵션 딕셔너리로 묶기
        timer_options = {
            'type': timer_type,              # countdown / countup
            'font_style': font_style,        # default / bold / thin / mono / digital / neon
            'position': timer_position,      # center / top-center / etc
            'size': timer_size,
            'color': timer_color,
            'hours': hours,
            'minutes': minutes,
            'seconds': seconds
        }

        # 백그라운드 스레드에서 비디오 생성
        studio_processing_thread = threading.Thread(
            target=_generate_black_screen_thread,
            args=(output_path, bg_color, duration_seconds, resolution, show_timer, timer_options),
            daemon=True
        )
        studio_processing_thread.start()

        return {'success': True, 'message': '생성이 시작되었습니다.'}

    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_cancel_blackscreen_generation():
    """검은 화면 생성 취소"""
    global studio_cancel_event
    studio_cancel_event.set()
    print("[RoyStudio] 검은 화면 생성 취소 요청")
    return {'success': True}


# ========== TTS API ==========

# 음성 데이터 (Google Cloud TTS 기준)
VOICE_DATA = {
    'ko-KR': {
        'name': '한국어',
        'groups': {
            'Wavenet': ['ko-KR-Wavenet-A', 'ko-KR-Wavenet-B', 'ko-KR-Wavenet-C', 'ko-KR-Wavenet-D'],
            'Neural2': ['ko-KR-Neural2-A', 'ko-KR-Neural2-B', 'ko-KR-Neural2-C'],
            'Standard': ['ko-KR-Standard-A', 'ko-KR-Standard-B', 'ko-KR-Standard-C', 'ko-KR-Standard-D'],
            # Chirp3-HD: 여성 먼저 (알파벳순), 남성 (알파벳순)
            'Chirp3-HD': [
                # 여성 (14명)
                'ko-KR-Chirp3-HD-Achernar', 'ko-KR-Chirp3-HD-Aoede', 'ko-KR-Chirp3-HD-Autonoe',
                'ko-KR-Chirp3-HD-Callirrhoe', 'ko-KR-Chirp3-HD-Despina', 'ko-KR-Chirp3-HD-Erinome',
                'ko-KR-Chirp3-HD-Gacrux', 'ko-KR-Chirp3-HD-Kore', 'ko-KR-Chirp3-HD-Laomedeia',
                'ko-KR-Chirp3-HD-Leda', 'ko-KR-Chirp3-HD-Pulcherrima', 'ko-KR-Chirp3-HD-Sulafat',
                'ko-KR-Chirp3-HD-Vindemiatrix', 'ko-KR-Chirp3-HD-Zephyr',
                # 남성 (16명)
                'ko-KR-Chirp3-HD-Achird', 'ko-KR-Chirp3-HD-Algenib', 'ko-KR-Chirp3-HD-Algieba',
                'ko-KR-Chirp3-HD-Alnilam', 'ko-KR-Chirp3-HD-Charon', 'ko-KR-Chirp3-HD-Enceladus',
                'ko-KR-Chirp3-HD-Fenrir', 'ko-KR-Chirp3-HD-Iapetus', 'ko-KR-Chirp3-HD-Orus',
                'ko-KR-Chirp3-HD-Puck', 'ko-KR-Chirp3-HD-Rasalgethi', 'ko-KR-Chirp3-HD-Sadachbia',
                'ko-KR-Chirp3-HD-Sadaltager', 'ko-KR-Chirp3-HD-Schedar', 'ko-KR-Chirp3-HD-Umbriel',
                'ko-KR-Chirp3-HD-Zubenelgenubi'
            ]
        }
    },
    'en-US': {
        'name': '영어 (미국)',
        'groups': {
            'Wavenet': ['en-US-Wavenet-A', 'en-US-Wavenet-B', 'en-US-Wavenet-C', 'en-US-Wavenet-D',
                       'en-US-Wavenet-E', 'en-US-Wavenet-F', 'en-US-Wavenet-G', 'en-US-Wavenet-H',
                       'en-US-Wavenet-I', 'en-US-Wavenet-J'],
            'Neural2': ['en-US-Neural2-A', 'en-US-Neural2-C', 'en-US-Neural2-D', 'en-US-Neural2-E',
                       'en-US-Neural2-F', 'en-US-Neural2-G', 'en-US-Neural2-H', 'en-US-Neural2-I', 'en-US-Neural2-J'],
            'Standard': ['en-US-Standard-A', 'en-US-Standard-B', 'en-US-Standard-C', 'en-US-Standard-D',
                        'en-US-Standard-E', 'en-US-Standard-F', 'en-US-Standard-G', 'en-US-Standard-H',
                        'en-US-Standard-I', 'en-US-Standard-J'],
            'Chirp3-HD': ['en-US-Chirp3-HD-Achernar', 'en-US-Chirp3-HD-Aoede', 'en-US-Chirp3-HD-Charon',
                          'en-US-Chirp3-HD-Fenrir', 'en-US-Chirp3-HD-Kore', 'en-US-Chirp3-HD-Leda',
                          'en-US-Chirp3-HD-Orus', 'en-US-Chirp3-HD-Puck', 'en-US-Chirp3-HD-Zephyr']
        }
    },
    'ja-JP': {
        'name': '일본어',
        'groups': {
            'Wavenet': ['ja-JP-Wavenet-A', 'ja-JP-Wavenet-B', 'ja-JP-Wavenet-C', 'ja-JP-Wavenet-D'],
            'Neural2': ['ja-JP-Neural2-B', 'ja-JP-Neural2-C', 'ja-JP-Neural2-D'],
            'Standard': ['ja-JP-Standard-A', 'ja-JP-Standard-B', 'ja-JP-Standard-C', 'ja-JP-Standard-D']
        }
    },
    'zh-CN': {
        'name': '중국어 (간체)',
        'groups': {
            'Wavenet': ['cmn-CN-Wavenet-A', 'cmn-CN-Wavenet-B', 'cmn-CN-Wavenet-C', 'cmn-CN-Wavenet-D'],
            'Standard': ['cmn-CN-Standard-A', 'cmn-CN-Standard-B', 'cmn-CN-Standard-C', 'cmn-CN-Standard-D']
        }
    }
}

@eel.expose
def studio_get_languages():
    """사용 가능한 언어 목록 반환"""
    return [{'code': code, 'name': data['name']} for code, data in VOICE_DATA.items()]


@eel.expose
def studio_get_voice_groups(language_code):
    """언어별 음성 그룹 반환"""
    if language_code in VOICE_DATA:
        return list(VOICE_DATA[language_code]['groups'].keys())
    return ['Standard']


@eel.expose
def studio_get_voice_names(language_code, group):
    """언어 및 그룹별 음성 이름 반환"""
    if language_code in VOICE_DATA and group in VOICE_DATA[language_code]['groups']:
        return VOICE_DATA[language_code]['groups'][group]
    return []


@eel.expose
def studio_test_voice(text, voice_name, profile_name, rate=1.0, pitch=0.0):
    """음성 미리듣기"""
    print(f"[RoyStudio] 음성 테스트: {voice_name}, 프로필: {profile_name}")

    if not STUDIO_MODULES_LOADED:
        return {'success': False, 'error': '핵심 모듈이 로드되지 않았습니다.'}

    try:
        # TTS 생성
        audio_bytes = services.synthesize_tts_bytes(
            profile_name=profile_name,
            text=text,
            api_voice=voice_name,
            rate=rate,
            pitch=pitch
        )

        if audio_bytes:
            # 임시 파일로 저장 후 재생
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
                f.write(audio_bytes)
                temp_path = f.name

            # 오디오 재생 (pydub + ffplay 사용)
            from pydub import AudioSegment
            audio = AudioSegment.from_mp3(temp_path)
            utils.play_audio_with_ffplay(audio)

            # 임시 파일 삭제
            os.unlink(temp_path)

            return {'success': True}
        else:
            return {'success': False, 'error': 'TTS 생성 실패'}

    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_synthesize_tts(profile_name, text, voice_name, rate=1.0, pitch=0.0):
    """TTS 음성 합성 (바이트 반환 - base64 인코딩)"""
    if not STUDIO_MODULES_LOADED:
        return {'success': False, 'error': '핵심 모듈이 로드되지 않았습니다.'}

    try:
        import base64
        audio_bytes = services.synthesize_tts_bytes(
            profile_name=profile_name,
            text=text,
            api_voice=voice_name,
            rate=rate,
            pitch=pitch
        )

        if audio_bytes:
            audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
            return {'success': True, 'audio': audio_b64}
        else:
            return {'success': False, 'error': 'TTS 생성 실패'}

    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


# ========== FFmpeg 체크 ==========

@eel.expose
def studio_check_ffmpeg():
    """FFmpeg 설치 확인"""
    import shutil

    ffmpeg_path = shutil.which('ffmpeg')
    if ffmpeg_path:
        return {'ok': True, 'path': ffmpeg_path}
    else:
        return {'ok': False, 'message': 'FFmpeg가 설치되어 있지 않습니다.'}


# ========== 유틸리티 ==========

@eel.expose
def studio_open_folder(folder_path):
    """폴더 열기"""
    try:
        if sys.platform == 'win32':
            os.startfile(folder_path)
        elif sys.platform == 'darwin':
            os.system(f'open "{folder_path}"')
        else:
            os.system(f'xdg-open "{folder_path}"')
        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_open_file(file_path):
    """파일 열기"""
    try:
        if sys.platform == 'win32':
            os.startfile(file_path)
        elif sys.platform == 'darwin':
            os.system(f'open "{file_path}"')
        else:
            os.system(f'xdg-open "{file_path}"')
        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}


# ========== 영상 제작 API ==========

class DummyTab:
    """studio_services 호환용 더미 탭 클래스"""
    def __init__(self):
        self.brightness_var = type('obj', (object,), {'get': lambda self: 100.0})()

    def _format_voice_name_internal(self, name, gender):
        """음성 이름 포맷 (Eel 버전에서는 사용 안함)"""
        return name


class StudioApp:
    """studio_services와 호환되는 앱 인터페이스"""
    def __init__(self):
        self.cancel_event = studio_cancel_event
        # studio_services 호환용 더미 탭
        self.video_maker_tab = DummyTab()
        self.batch_process_tab = DummyTab()

    def log_message(self, message):
        """로그 메시지 전송"""
        try:
            eel.studioLogFromPython(message)
        except:
            print(f"[RoyStudio] {message}")

    def update_progress(self, message, progress, is_batch=False):
        """진행률 업데이트"""
        try:
            eel.studioUpdateProgressFromPython(progress, message)
        except:
            print(f"[RoyStudio] Progress: {progress}% - {message}")


def _execute_video_production_thread(job_data, output_folder):
    """영상 제작 스레드"""
    if not STUDIO_MODULES_LOADED:
        eel.studioProductionComplete({'success': False, 'error': '핵심 모듈이 로드되지 않았습니다.'})
        return

    app = StudioApp()

    try:
        app.log_message("영상 제작 시작...")

        # clips 데이터 처리 (프론트엔드에서 전달된 클립 정보)
        clips_data = job_data.get('clips', [])

        # narration_settings 생성 (캐릭터별 음성 설정)
        narration_settings = {}
        for clip in clips_data:
            char = clip.get('character', '나레이터')
            if char not in narration_settings:
                narration_settings[char] = {
                    'voice': clip.get('voice', 'ko-KR-Wavenet-A'),
                    'speed': clip.get('rate', 1.0),
                    'pitch': clip.get('pitch', 0.0),
                    'lang': 'ko-KR',
                    'group': 'Wavenet',
                    'volumeGain': 0,
                    'pauseAfter': 0
                }

        # 클립 데이터 변환
        clips = []
        for clip in clips_data:
            clips.append({
                'character': clip.get('character', '나레이터'),
                'text': clip.get('text', ''),
                'is_ssml': clip.get('text', '').strip().lower().startswith('<speak>')
            })

        # 작업 데이터 준비
        file_name = job_data.get('fileName', 'output')
        output_path = os.path.join(output_folder, f"{file_name}.mp4")

        job = {
            'scriptPath': job_data.get('scriptPath', ''),
            'image_path': job_data.get('imagePath', ''),  # image_path로 변환 (services 모듈 호환)
            'imagePath': job_data.get('imagePath', ''),
            'fileName': file_name,
            'outputFolder': output_folder,
            'output_path': output_path,  # 출력 파일 경로
            'api_key_profile': job_data.get('profile', ''),  # api_key_profile로 변환
            'profile': job_data.get('profile', ''),
            'voice': job_data.get('voice', 'ko-KR-Wavenet-A'),
            'rate': job_data.get('rate', 1.0),
            'pitch': job_data.get('pitch', 0.0),
            'eqEnabled': job_data.get('eqEnabled', True),
            'eqSettings': job_data.get('eqSettings', {}),
            'clips': clips,
            'narration_settings': narration_settings,
        }

        # eq_settings 변환 (프론트엔드 형식 -> studio_services 형식)
        # 프론트엔드: x, y (픽셀), width, height (픽셀)
        # studio_services: x, y, w, h (퍼센트 0-100)
        raw_eq = job_data.get('eqSettings') or {}
        resolution = raw_eq.get('resolution') or '1920x1080'
        res_w, res_h = map(int, resolution.split('x'))

        # 스타일 이름 매핑 (한글 -> 영문)
        style_map = {
            '막대형': 'bar',
            '미러막대형': 'mirror',  # 미러막대형은 mirror로 정확히 매핑
            '원형': 'circular',      # 원형 (점 스타일)
            '파형': 'wave',
        }
        raw_style = raw_eq.get('style', '막대형')
        mapped_style = style_map.get(raw_style, 'bar')

        # None 값 처리를 위한 안전한 기본값 적용
        eq_x = raw_eq.get('x') if raw_eq.get('x') is not None else res_w // 2
        eq_y = raw_eq.get('y') if raw_eq.get('y') is not None else res_h // 2
        eq_w = raw_eq.get('width') if raw_eq.get('width') is not None else 800
        eq_h = raw_eq.get('height') if raw_eq.get('height') is not None else 200

        job['eq_settings'] = {
            'enabled': raw_eq.get('enabled', True),  # EQ 활성화 여부
            'style': mapped_style,
            'x': eq_x,  # 픽셀 값 그대로 전달
            'y': eq_y,
            'width': eq_w,
            'height': eq_h,
            'fps': raw_eq.get('fps') or 20,
            'brightness': raw_eq.get('brightness') or 100,
            'barCount': raw_eq.get('barCount') or 24,
            'barWidth': raw_eq.get('barWidth') or 20,  # 바 1개 가로 (px)
            'barGap': raw_eq.get('barGap') or 3,       # 바 간격 (px)
            'color1': raw_eq.get('color1') or '#667eea',
            'color2': raw_eq.get('color2') or '#764ba2',
        }
        print(f"[RoyStudio] EQ 설정: enabled={job['eq_settings']['enabled']}, style={raw_style} -> {mapped_style}")

        # 자막 설정 처리
        raw_subtitle = job_data.get('subtitleSettings') or {}
        job['subtitle_settings'] = {
            'enabled': raw_subtitle.get('enabled', True),
            'font': raw_subtitle.get('font') or 'Noto Sans KR',
            'size': raw_subtitle.get('size') or 24,
            'color': raw_subtitle.get('color') or '#ffffff',
            'bgColor': raw_subtitle.get('bgColor') or '#000000',
            'bgOpacity': raw_subtitle.get('bgOpacity') or 70,
            'bgNone': raw_subtitle.get('bgNone', False),
            'x': raw_subtitle.get('x') or 50,
            'y': raw_subtitle.get('y') or 90,
        }
        print(f"[RoyStudio] 자막 설정: enabled={job['subtitle_settings']['enabled']}, font={job['subtitle_settings']['font']}")

        # 인코더 및 프리셋 설정
        job['encoder'] = job_data.get('encoder', 'auto')
        job['encodingPreset'] = job_data.get('encodingPreset', 'ultrafast')
        print(f"[RoyStudio] 인코더: {job['encoder']}, 프리셋: {job['encodingPreset']}")

        # 대본 읽기
        if job['scriptPath'] and os.path.exists(job['scriptPath']):
            job['script'] = utils.read_script_file(job['scriptPath'])
        else:
            job['script'] = job_data.get('script', '')

        if not job['script']:
            eel.studioProductionComplete({'success': False, 'error': '대본이 없습니다.'})
            return

        # clips가 없으면 에러
        if not clips:
            eel.studioProductionComplete({'success': False, 'error': '분석된 클립이 없습니다. 대본을 먼저 분석해주세요.'})
            return

        # image_path 체크
        if not job['image_path'] or not os.path.exists(job['image_path']):
            eel.studioProductionComplete({'success': False, 'error': '배경 이미지가 선택되지 않았거나 파일이 존재하지 않습니다.'})
            return

        print(f"[RoyStudio] [디버그] clips 수: {len(clips)}")
        print(f"[RoyStudio] [디버그] narration_settings: {list(narration_settings.keys())}")
        print(f"[RoyStudio] [디버그] image_path: {job['image_path']}")
        print(f"[RoyStudio] [디버그] output_folder: {output_folder}")
        print(f"[RoyStudio] [디버그] eqSettings: {job['eqSettings']}")

        # 영상 제작 실행
        print("[RoyStudio] services._execute_single_video_job 호출 시작...")
        result = services._execute_single_video_job(app, job, is_batch=False)
        print(f"[RoyStudio] services._execute_single_video_job 결과: {result}")

        # result가 bool인 경우 처리 (True = 성공, False = 실패)
        if isinstance(result, bool):
            if result:
                print("[RoyStudio] 영상 제작 성공!")
                eel.studioProductionComplete({
                    'success': True,
                    'output_path': job['output_path'],
                    'message': '영상 제작이 완료되었습니다.'
                })
            else:
                print("[RoyStudio] 영상 제작 실패 (False 반환)")
                eel.studioProductionComplete({'success': False, 'error': '제작 실패'})
        elif result and isinstance(result, dict) and result.get('success'):
            print("[RoyStudio] 영상 제작 성공!")
            eel.studioProductionComplete({
                'success': True,
                'output_path': result.get('output_path', job['output_path']),
                'message': '영상 제작이 완료되었습니다.'
            })
        else:
            error_msg = result.get('error', '알 수 없는 오류') if isinstance(result, dict) else '제작 실패'
            print(f"[RoyStudio] 영상 제작 실패: {error_msg}")
            eel.studioProductionComplete({'success': False, 'error': error_msg})

    except Exception as e:
        print(f"[RoyStudio] 영상 제작 예외 발생: {e}")
        traceback.print_exc()
        eel.studioProductionComplete({'success': False, 'error': str(e)})


@eel.expose
def studio_start_production(job_data, output_folder):
    """영상 제작 시작"""
    global studio_processing_thread, studio_cancel_event

    print(f"[RoyStudio] 영상 제작 시작: {job_data.get('fileName', 'unknown')}")

    try:
        studio_cancel_event.clear()

        studio_processing_thread = threading.Thread(
            target=_execute_video_production_thread,
            args=(job_data, output_folder),
            daemon=True
        )
        studio_processing_thread.start()

        return {'success': True, 'message': '제작이 시작되었습니다.'}

    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_start_batch_production(jobs_data, output_folder):
    """배치 영상 제작 시작"""
    global studio_processing_thread, studio_cancel_event

    print(f"[RoyStudio] 배치 영상 제작 시작: {len(jobs_data)}개 작업")

    if not STUDIO_MODULES_LOADED:
        return {'success': False, 'error': '핵심 모듈이 로드되지 않았습니다.'}

    try:
        studio_cancel_event.clear()

        def batch_thread():
            app = StudioApp()
            results = []
            errors = []

            for i, job_data in enumerate(jobs_data):
                if studio_cancel_event.is_set():
                    app.log_message("배치 작업이 취소되었습니다.")
                    break

                app.log_message(f"작업 {i+1}/{len(jobs_data)}: {job_data.get('fileName', 'unknown')}")

                try:
                    # 출력 폴더는 job_data에서 직접 가져옴 (각 파일마다 다를 수 있음)
                    output_folder_path = job_data.get('outputFolder', output_folder)
                    file_name = job_data.get('fileName', f'output_{i+1}')

                    # 영상 출력 경로 생성 (영상_ 접두사 추가)
                    video_file_name = '영상_' + file_name
                    output_path = os.path.join(output_folder_path, f"{video_file_name}.mp4")

                    # characterVoices를 narration_settings 형식으로 변환
                    character_voices = job_data.get('characterVoices', {})
                    narration_settings = {}
                    for char_name, voice_settings in character_voices.items():
                        narration_settings[char_name] = {
                            'voice': voice_settings.get('voice', 'ko-KR-Wavenet-A'),
                            'speed': voice_settings.get('rate', 1.0),
                            'pitch': voice_settings.get('pitch', 0.0),
                            'lang': 'ko-KR',
                            'group': 'Wavenet',
                            'volumeGain': 0,
                            'pauseAfter': 0
                        }

                    # eq_settings 변환 (영상 탭과 동일한 방식)
                    raw_eq = job_data.get('eqSettings') or {}
                    resolution = job_data.get('resolution', '1920x1080')
                    res_w, res_h = map(int, resolution.split('x'))

                    # 스타일 이름 매핑 (한글 -> 영문)
                    style_map = {
                        '막대형': 'bar',
                        '미러막대형': 'mirror',
                        '원형': 'circular',
                        '파형': 'wave',
                    }
                    raw_style = raw_eq.get('style', '막대형')
                    mapped_style = style_map.get(raw_style, 'bar')

                    # None 값 처리를 위한 안전한 기본값 적용
                    eq_x = raw_eq.get('x') if raw_eq.get('x') is not None else res_w // 2
                    eq_y = raw_eq.get('y') if raw_eq.get('y') is not None else res_h // 2
                    eq_w = raw_eq.get('width') if raw_eq.get('width') is not None else 800
                    eq_h = raw_eq.get('height') if raw_eq.get('height') is not None else 200

                    eq_settings = {
                        'enabled': raw_eq.get('enabled', False),  # 배치 탭의 enabled 값 사용
                        'style': mapped_style,
                        'x': eq_x,
                        'y': eq_y,
                        'width': eq_w,
                        'height': eq_h,
                        'fps': raw_eq.get('fps') or 20,
                        'brightness': raw_eq.get('brightness') or 100,
                        'barCount': raw_eq.get('barCount') or 24,
                        'barWidth': raw_eq.get('barWidth') or 20,
                        'barGap': raw_eq.get('barGap') or 3,
                        'color1': raw_eq.get('color1') or '#667eea',
                        'color2': raw_eq.get('color2') or '#764ba2',
                        'resolution': resolution
                    }

                    app.log_message(f"[배치] EQ 설정: enabled={eq_settings['enabled']}, style={raw_style} -> {mapped_style}")

                    # 자막 설정 처리 (영상 탭과 동일)
                    raw_subtitle = job_data.get('subtitleSettings') or {}
                    subtitle_settings = {
                        'enabled': raw_subtitle.get('enabled', False),
                        'font': raw_subtitle.get('font') or 'Noto Sans KR',
                        'size': raw_subtitle.get('size') or 24,
                        'color': raw_subtitle.get('color') or '#ffffff',
                        'bgColor': raw_subtitle.get('bgColor') or '#000000',
                        'bgOpacity': raw_subtitle.get('bgOpacity') or 70,
                        'bgNone': raw_subtitle.get('bgNone', False),
                        'x': raw_subtitle.get('x') or 50,
                        'y': raw_subtitle.get('y') or 90,
                    }

                    job = {
                        'scriptPath': job_data.get('scriptPath', ''),
                        'image_path': job_data.get('imagePath', ''),
                        'fileName': video_file_name,
                        'output_path': output_path,
                        'narration_settings': narration_settings,
                        'eq_settings': eq_settings,
                        'subtitle_settings': subtitle_settings,
                        'api_key_profile': 'default',  # 배치 작업은 기본 API 키 사용
                    }

                    # 일반 영상 제작
                    if job_data.get('outputVideo', False):
                        result = services._execute_single_video_job(app, job, is_batch=True)

                        if result and isinstance(result, dict) and result.get('success'):
                            results.append(result)
                        else:
                            # result가 dict가 아니면 (예: bool) 오류로 처리
                            if isinstance(result, dict):
                                error_msg = result.get('error', '알 수 없는 오류')
                            else:
                                error_msg = f'제작 실패 (반환 타입: {type(result).__name__})'
                            errors.append({'job': job_data, 'error': error_msg})

                    # 투명EQ 생성 (영상탭과 동일)
                    if job_data.get('outputTransparentEQ', False):
                        try:
                            app.log_message(f"[배치] 투명 EQ 생성 중: {file_name}")

                            # clips 데이터 생성 (영상탭과 동일 형식)
                            clips_for_eq = []
                            for char_name, voice_settings in character_voices.items():
                                # 실제 대본에서 해당 캐릭터의 대사를 파싱해야 하지만,
                                # 간단하게 캐릭터별 음성 설정만 전달
                                clips_for_eq.append({
                                    'character': char_name,
                                    'text': '',  # 대본 파싱은 studio_create_transparent_eq에서 처리
                                    'voice': voice_settings.get('voice', 'ko-KR-Wavenet-A'),
                                    'rate': voice_settings.get('rate', 1.0),
                                    'pitch': voice_settings.get('pitch', 0.0)
                                })

                            eq_file_name = f'EQ_{file_name}'
                            eq_job_data = {
                                'scriptPath': job_data.get('scriptPath', ''),
                                'fileName': eq_file_name,
                                'characterVoices': character_voices,
                                'eqSettings': eq_settings,
                                'resolution': resolution
                            }

                            eq_result = studio_create_transparent_eq_batch(eq_job_data, output_folder_path, app)

                            if eq_result.get('success'):
                                app.log_message(f"[배치] 투명 EQ 생성 완료: {eq_result.get('output_path', '')}")
                                # 투명EQ 생성 성공을 results에 추가
                                results.append({
                                    'success': True,
                                    'output_path': eq_result.get('output_path', ''),
                                    'file_name': file_name,
                                    'type': 'transparent_eq'
                                })
                            else:
                                app.log_message(f"[배치] 투명 EQ 생성 실패: {eq_result.get('error', '알 수 없는 오류')}")

                        except Exception as eq_error:
                            app.log_message(f"[배치] 투명 EQ 생성 중 오류: {eq_error}")

                    # MP3 생성 (SRT 자막도 함께 생성)
                    if job_data.get('outputMp3', False):
                        try:
                            app.log_message(f"[배치] MP3 생성 중: {file_name}")
                            mp3_file_name = f'MP3_{file_name}'

                            # 대본 읽기 및 클립 데이터 생성 (영상 제작과 동일한 방식으로 파싱)
                            script_text = utils.read_script_file(job_data.get('scriptPath', ''))
                            if script_text:
                                # 대본 파싱: [캐릭터명] 패턴으로 파싱
                                clips_for_mp3 = []
                                current_character = '나레이터'
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
                                            # 캐릭터별 음성 설정 가져오기
                                            voice_settings = character_voices.get(current_character, {})
                                            clips_for_mp3.append({
                                                'text': text,
                                                'character': current_character,
                                                'voice': voice_settings.get('voice', 'ko-KR-Wavenet-A'),
                                                'rate': voice_settings.get('rate', 1.0),
                                                'pitch': voice_settings.get('pitch', 0)
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
                                    voice_settings = character_voices.get(current_character, {})
                                    clips_for_mp3.append({
                                        'text': text,
                                        'character': current_character,
                                        'voice': voice_settings.get('voice', 'ko-KR-Wavenet-A'),
                                        'rate': voice_settings.get('rate', 1.0),
                                        'pitch': voice_settings.get('pitch', 0)
                                    })

                                app.log_message(f"[배치] 대본 파싱 완료: {len(clips_for_mp3)}개 클립")

                                # studio_generate_tts_and_merge 호출
                                mp3_result = studio_generate_tts_and_merge(clips_for_mp3, output_folder_path, mp3_file_name)

                                if mp3_result.get('success'):
                                    app.log_message(f"[배치] MP3 생성 완료: {mp3_result.get('filename', '')}")

                                    # SRT 자막 파일 생성
                                    try:
                                        srt_content = ''
                                        current_time = 0.0

                                        # 각 클립의 길이를 추정 (실제로는 audio_segments에서 가져와야 하지만 간단하게 추정)
                                        for idx, clip in enumerate(clips_for_mp3):
                                            text = clip.get('text', '')
                                            # 대략적인 길이 추정: 한글 1글자당 0.3초
                                            estimated_duration = max(len(text) * 0.3, 1.0)

                                            start_time = current_time
                                            end_time = current_time + estimated_duration

                                            srt_content += f"{idx + 1}\n"
                                            srt_content += f"{format_srt_time(start_time)} --> {format_srt_time(end_time)}\n"
                                            srt_content += f"{text}\n\n"

                                            current_time = end_time

                                        # SRT 파일 저장
                                        srt_file_name = f'{mp3_file_name}.srt'
                                        srt_path = os.path.join(output_folder_path, srt_file_name)
                                        with open(srt_path, 'w', encoding='utf-8-sig') as f:
                                            f.write(srt_content)

                                        app.log_message(f"[배치] SRT 자막 파일 생성 완료: {srt_path}")
                                    except Exception as srt_error:
                                        app.log_message(f"[배치] SRT 생성 중 오류: {srt_error}")

                                    # MP3 생성 성공을 results에 추가
                                    mp3_path = os.path.join(output_folder_path, f'{mp3_file_name}.mp3')
                                    results.append({
                                        'success': True,
                                        'output_path': mp3_path,
                                        'file_name': file_name,
                                        'type': 'mp3'
                                    })
                                else:
                                    app.log_message(f"[배치] MP3 생성 실패: {mp3_result.get('error', '알 수 없는 오류')}")
                            else:
                                app.log_message(f"[배치] MP3 생성 실패: 대본을 읽을 수 없음")
                        except Exception as mp3_error:
                            app.log_message(f"[배치] MP3 생성 중 오류: {mp3_error}")

                except Exception as e:
                    errors.append({'job': job_data, 'error': str(e)})

                # 진행률 업데이트
                progress = ((i + 1) / len(jobs_data)) * 100
                eel.studioUpdateBatchProgress(progress, f"{i+1}/{len(jobs_data)} 완료")

            eel.studioBatchComplete({
                'success': len(results) > 0,
                'completed': len(results),
                'failed': len(errors),
                'results': results,
                'errors': errors
            })

        studio_processing_thread = threading.Thread(target=batch_thread, daemon=True)
        studio_processing_thread.start()

        return {'success': True, 'message': f'{len(jobs_data)}개 작업 시작'}

    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_get_default_settings(profile_name):
    """프로필의 기본 설정 반환"""
    if STUDIO_MODULES_LOADED:
        defaults = utils.load_defaults()
        return defaults.get(profile_name, {})
    return {}


@eel.expose
def studio_save_default_settings(profile_name, settings):
    """프로필의 기본 설정 저장"""
    if STUDIO_MODULES_LOADED:
        defaults = utils.load_defaults()
        defaults[profile_name] = settings
        utils.save_defaults(defaults)
        return {'success': True}
    return {'success': False, 'error': '모듈 로드 실패'}


@eel.expose
def studio_get_voice_profiles():
    """음성 프로필 목록 반환"""
    if STUDIO_MODULES_LOADED:
        profiles_file = config.VOICE_PROFILES_FILE
        return utils.load_json_file(profiles_file)
    return {}


@eel.expose
def studio_is_modules_loaded():
    """핵심 모듈 로드 상태 확인"""
    return {'loaded': STUDIO_MODULES_LOADED}


# ========== 자막 탭 API ==========

@eel.expose
def studio_generate_subtitle_mp3(profile_name, text, voice_name, rate, pitch, output_folder, index):
    """자막용 개별 MP3 생성"""
    if not STUDIO_MODULES_LOADED:
        return {'success': False, 'error': '핵심 모듈이 로드되지 않았습니다.'}

    try:
        # TTS 생성
        audio_bytes = services.synthesize_tts_bytes(
            profile_name=profile_name,
            text=text,
            api_voice=voice_name,
            rate=rate,
            pitch=pitch
        )

        if not audio_bytes:
            return {'success': False, 'error': 'TTS 생성 실패'}

        # MP3 파일 저장
        mp3_filename = f"subtitle_{index:04d}.mp3"
        mp3_path = os.path.join(output_folder, mp3_filename)

        with open(mp3_path, 'wb') as f:
            f.write(audio_bytes)

        # 오디오 길이 계산
        from pydub import AudioSegment
        audio = AudioSegment.from_mp3(mp3_path)
        duration = len(audio) / 1000.0  # 밀리초 -> 초

        return {
            'success': True,
            'mp3Path': mp3_path,
            'duration': duration
        }

    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_save_srt_file(output_folder, file_name, srt_content):
    """SRT 파일 저장

    Args:
        output_folder: 출력 폴더 경로
        file_name: 파일명 (예: 'subtitles.srt' 또는 '대본파일명.srt')
        srt_content: SRT 내용
    """
    try:
        # 출력 폴더 확인/생성
        os.makedirs(output_folder, exist_ok=True)

        srt_path = os.path.join(output_folder, file_name)

        # UTF-8 BOM으로 저장 (한글 호환성)
        with open(srt_path, 'w', encoding='utf-8-sig') as f:
            f.write(srt_content)

        print(f"[RoyStudio] SRT 파일 저장 완료: {srt_path}")

        return {'success': True, 'path': srt_path}

    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_render_subtitle_video(subtitles, bg_image, output_folder):
    """자막이 포함된 영상 렌더링"""
    if not STUDIO_MODULES_LOADED:
        return {'success': False, 'error': '핵심 모듈이 로드되지 않았습니다.'}

    try:
        from moviepy.video.VideoClip import ColorClip, ImageClip
        from moviepy.audio.io.AudioFileClip import AudioFileClip
        from moviepy.video.compositing.CompositeVideoClip import CompositeVideoClip
        from moviepy.video.compositing.concatenate_videoclips import concatenate_videoclips
        from pydub import AudioSegment

        clips = []

        for sub in subtitles:
            if not sub.get('mp3Path') or not os.path.exists(sub['mp3Path']):
                continue

            # 오디오 클립
            audio_clip = AudioFileClip(sub['mp3Path'])
            duration = audio_clip.duration

            # 배경 클립
            if bg_image and os.path.exists(bg_image):
                video_clip = ImageClip(bg_image).with_duration(duration)
            else:
                video_clip = ColorClip(size=(1920, 1080), color=(0, 0, 0), duration=duration)

            # 오디오 연결
            video_clip = video_clip.with_audio(audio_clip)
            clips.append(video_clip)

        if not clips:
            return {'success': False, 'error': '처리할 클립이 없습니다.'}

        # 클립 연결
        final_clip = concatenate_videoclips(clips, method='compose')

        # 출력 파일명
        import datetime
        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        output_path = os.path.join(output_folder, f"subtitle_video_{timestamp}.mp4")

        # 비디오 렌더링
        final_clip.write_videofile(
            output_path,
            codec='libx264',
            audio_codec='aac',
            fps=30,
            threads=os.cpu_count() or 1
        )

        # 정리
        final_clip.close()
        for clip in clips:
            clip.close()

        return {'success': True, 'outputPath': output_path}

    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


# ========== TTS API 키 관리 ==========

try:
    import tts_quota_manager as quota
    TTS_QUOTA_LOADED = True
    print("[RoyStudio] TTS Quota Manager 로드 성공")
except ImportError as e:
    TTS_QUOTA_LOADED = False
    print(f"[RoyStudio] TTS Quota Manager 로드 실패: {e}")


@eel.expose
def studio_get_tts_api_keys():
    """TTS API 키 목록 조회"""
    if not TTS_QUOTA_LOADED:
        return {'success': False, 'error': 'TTS Quota Manager가 로드되지 않았습니다.', 'keys': []}

    try:
        keys = quota.get_tts_api_keys()
        # API 키 마스킹 (보안)
        masked_keys = []
        for k in keys:
            masked = {
                'id': k['id'],
                'name': k['name'],
                'key_preview': k['key'][:8] + '...' + k['key'][-4:] if len(k['key']) > 12 else '***',
                'registered_at': k.get('registered_at', ''),
                'active': k.get('active', True)
            }
            masked_keys.append(masked)
        return {'success': True, 'keys': masked_keys}
    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e), 'keys': []}


@eel.expose
def studio_add_tts_api_key(api_key, name=''):
    """TTS API 키 추가"""
    print(f"[TTS Backend] API 키 추가 요청: {api_key[:10]}..., 이름: {name}")

    if not TTS_QUOTA_LOADED:
        print("[TTS Backend] TTS Quota Manager 로드 안됨")
        return {'success': False, 'error': 'TTS Quota Manager가 로드되지 않았습니다.'}

    try:
        result = quota.add_tts_api_key(api_key, name)
        print(f"[TTS Backend] 추가 결과: {result}")
        return result
    except Exception as e:
        print(f"[TTS Backend] 추가 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_remove_tts_api_key(key_id):
    """TTS API 키 삭제"""
    if not TTS_QUOTA_LOADED:
        return {'success': False, 'error': 'TTS Quota Manager가 로드되지 않았습니다.'}

    try:
        result = quota.remove_tts_api_key(key_id)
        return result
    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_update_tts_api_key(key_id, name=None, active=None):
    """TTS API 키 정보 업데이트"""
    if not TTS_QUOTA_LOADED:
        return {'success': False, 'error': 'TTS Quota Manager가 로드되지 않았습니다.'}

    try:
        result = quota.update_tts_api_key(key_id, name, active)
        return result
    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_reorder_tts_api_keys(key_ids):
    """TTS API 키 순서 변경"""
    if not TTS_QUOTA_LOADED:
        return {'success': False, 'error': 'TTS Quota Manager가 로드되지 않았습니다.'}

    try:
        result = quota.reorder_tts_api_keys(key_ids)
        return result
    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_get_tts_usage_summary():
    """TTS 사용량 요약 조회"""
    if not TTS_QUOTA_LOADED:
        return {'success': False, 'error': 'TTS Quota Manager가 로드되지 않았습니다.', 'summary': []}

    try:
        summary = quota.get_usage_summary()
        return {'success': True, 'summary': summary}
    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e), 'summary': []}


@eel.expose
def studio_get_available_tts_key(voice_name, char_count=0):
    """사용 가능한 TTS API 키 자동 선택"""
    if not TTS_QUOTA_LOADED:
        return {'success': False, 'error': 'TTS Quota Manager가 로드되지 않았습니다.'}

    try:
        key_info = quota.get_available_api_key(voice_name, char_count)
        if key_info:
            return {
                'success': True,
                'key_id': key_info['key_id'],
                'name': key_info['name'],
                'warning': key_info.get('warning', '')
            }
        else:
            return {
                'success': False,
                'error': '사용 가능한 API 키가 없습니다. 모든 키가 80% 한도에 도달했습니다.'
            }
    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_validate_tts_api_key(api_key):
    """TTS API 키 유효성 검증 (실제 API 호출)"""
    print(f"[TTS Validate] API 키 검증 시작: {api_key[:10]}...")

    try:
        import requests

        url = f"https://texttospeech.googleapis.com/v1/voices?key={api_key}"
        print(f"[TTS Validate] 요청 URL: {url[:50]}...")

        response = requests.get(url, timeout=30)
        print(f"[TTS Validate] 응답 코드: {response.status_code}")

        if response.status_code == 200:
            data = response.json()
            voice_count = len(data.get('voices', []))
            print(f"[TTS Validate] 성공! {voice_count}개 음성")
            return {
                'valid': True,
                'message': f'유효한 API 키입니다. ({voice_count}개 음성 사용 가능)'
            }
        elif response.status_code == 400:
            print("[TTS Validate] 실패: 잘못된 형식")
            return {'valid': False, 'error': 'API 키 형식이 올바르지 않습니다.'}
        elif response.status_code == 403:
            print("[TTS Validate] 실패: 권한 없음")
            return {'valid': False, 'error': 'API 키가 비활성화되었거나 TTS API가 활성화되지 않았습니다.'}
        else:
            print(f"[TTS Validate] 실패: HTTP {response.status_code}")
            return {'valid': False, 'error': f'검증 실패: HTTP {response.status_code}'}

    except requests.exceptions.Timeout:
        print("[TTS Validate] 타임아웃")
        return {'valid': False, 'error': '요청 시간 초과 (30초)'}
    except requests.exceptions.ConnectionError as e:
        print(f"[TTS Validate] 연결 오류: {e}")
        return {'valid': False, 'error': '네트워크 연결 오류'}
    except Exception as e:
        print(f"[TTS Validate] 예외: {e}")
        traceback.print_exc()
        return {'valid': False, 'error': str(e)}


@eel.expose
def studio_merge_mp3_files(mp3_paths, output_path):
    """여러 MP3 파일을 하나로 합치기"""
    try:
        from pydub import AudioSegment

        if not mp3_paths:
            return {'success': False, 'error': 'MP3 파일 목록이 비어있습니다.'}

        # 첫 번째 파일로 시작
        combined = AudioSegment.empty()

        for mp3_path in mp3_paths:
            if os.path.exists(mp3_path):
                audio = AudioSegment.from_mp3(mp3_path)
                combined += audio
            else:
                print(f"[RoyStudio] MP3 파일 없음: {mp3_path}")

        if len(combined) == 0:
            return {'success': False, 'error': '합칠 수 있는 MP3 파일이 없습니다.'}

        # 합쳐진 파일 저장
        combined.export(output_path, format='mp3', bitrate='192k')

        duration = len(combined) / 1000.0  # 밀리초 -> 초

        return {
            'success': True,
            'output_path': output_path,
            'duration': duration,
            'file_count': len(mp3_paths)
        }

    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_generate_transparent_eq_video(audio_path, output_path, settings):
    """투명 배경 EQ 영상 생성 (WebM 형식)"""
    try:
        import subprocess
        import tempfile
        import numpy as np
        from PIL import Image
        import wave
        import struct

        if not os.path.exists(audio_path):
            return {'success': False, 'error': '오디오 파일이 존재하지 않습니다.'}

        # 설정 파싱
        # 해상도 파싱 (예: "1920x1080")
        resolution = settings.get('resolution', '1920x1080')
        res_parts = resolution.split('x')
        width = int(res_parts[0]) if len(res_parts) >= 2 else 1920
        height = int(res_parts[1]) if len(res_parts) >= 2 else 1080

        fps = settings.get('fps', 30)
        bar_count = settings.get('barCount', 24)
        eq_style = settings.get('style', '막대형')

        # 프론트엔드 키에 맞게 수정 (x, y, width, height)
        eq_x = settings.get('x', settings.get('eqX', width // 2))
        eq_y = settings.get('y', settings.get('eqY', height // 2))
        eq_w = settings.get('width', settings.get('eqW', 800))
        eq_h = settings.get('height', settings.get('eqH', 200))

        color1 = settings.get('color1', '#667eea')
        color2 = settings.get('color2', '#764ba2')

        print(f"[RoyStudio] 투명 EQ 설정: 해상도={width}x{height}, EQ위치=({eq_x},{eq_y}), EQ크기={eq_w}x{eq_h}, 바갯수={bar_count}, 스타일={eq_style}")
        print(f"[RoyStudio] 투명 EQ 색상: color1={color1}, color2={color2}")

        # 색상 파싱 (hex to RGB)
        def hex_to_rgb(hex_color):
            hex_color = hex_color.lstrip('#')
            return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

        rgb1 = hex_to_rgb(color1)
        rgb2 = hex_to_rgb(color2)

        # 오디오 분석을 위한 librosa 사용
        import librosa

        # 오디오 로드 및 분석
        y, sr = librosa.load(audio_path, sr=None, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)
        total_frames = int(duration * fps)

        # 멜 스펙트로그램 계산
        hop_length = 512
        S = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=2048, hop_length=hop_length, n_mels=bar_count)

        # dB 스케일로 변환
        max_val = np.max(S)
        if max_val > 0:
            S_db = librosa.power_to_db(S, ref=max_val)
        else:
            S_db = np.zeros_like(S)

        smin, smax = float(np.min(S_db)), float(np.max(S_db))
        if smax - smin < 1e-6:
            smin, smax = -80.0, 0.0

        print(f"[RoyStudio] 오디오 분석 완료: sr={sr}, duration={duration:.2f}초")

        # 임시 프레임 디렉토리
        temp_dir = tempfile.mkdtemp(prefix='eq_frames_')

        print(f"[RoyStudio] 투명 EQ 영상 생성 시작: {total_frames}프레임, {duration:.2f}초")

        # 이전 값 저장 (부드러운 감쇠용)
        prev_bars = np.zeros(bar_count)
        decay = 0.15  # 감쇠율

        # 각 프레임 생성
        for frame_idx in range(total_frames):
            # RGBA 이미지 생성 (투명 배경)
            img = Image.new('RGBA', (width, height), (0, 0, 0, 0))

            # 실제 오디오 스펙트럼 데이터 가져오기
            t = frame_idx / fps
            spec_idx = min(int(t * sr / hop_length), S_db.shape[1] - 1)

            # 현재 프레임의 바 값 계산 (0~1 범위로 정규화)
            current_bars = np.clip((S_db[:, spec_idx] - smin) / (smax - smin + 1e-6), 0, 1)

            # 부드러운 감쇠 적용
            bars = np.maximum(current_bars, prev_bars - decay)
            prev_bars = bars.copy()

            # PIL ImageDraw로 바 그리기
            from PIL import ImageDraw
            draw = ImageDraw.Draw(img)

            # EQ 영역 계산
            start_x = eq_x - eq_w // 2
            start_y = eq_y - eq_h // 2

            bar_width = eq_w / bar_count
            gap = bar_width * 0.15  # 바 간격 (미리보기와 동일)
            actual_bar_width = bar_width - gap
            border_radius = max(2, int(actual_bar_width * 0.15))  # 라운드 처리 반경

            # 라운드 처리된 사각형 그리기 함수
            def draw_rounded_bar(draw, x, y, w, h, radius, color):
                """라운드 처리된 막대 그리기 (그라데이션 포함)"""
                if h <= 0 or w <= 0:
                    return
                radius = min(radius, w // 2, h // 2)
                # 메인 사각형
                draw.rectangle([x + radius, y, x + w - radius, y + h], fill=color)
                draw.rectangle([x, y + radius, x + w, y + h - radius], fill=color)
                # 모서리 원
                draw.ellipse([x, y, x + radius * 2, y + radius * 2], fill=color)
                draw.ellipse([x + w - radius * 2, y, x + w, y + radius * 2], fill=color)
                draw.ellipse([x, y + h - radius * 2, x + radius * 2, y + h], fill=color)
                draw.ellipse([x + w - radius * 2, y + h - radius * 2, x + w, y + h], fill=color)

            for i, bar_val in enumerate(bars):
                bar_height = int(bar_val * eq_h * 0.9)
                x = start_x + i * bar_width

                # 수평 그라데이션 색상 계산 (왼쪽 -> 오른쪽)
                progress = i / max(bar_count - 1, 1)
                r = int(rgb1[0] + (rgb2[0] - rgb1[0]) * progress)
                g = int(rgb1[1] + (rgb2[1] - rgb1[1]) * progress)
                b = int(rgb1[2] + (rgb2[2] - rgb1[2]) * progress)
                bar_color = (r, g, b, 230)

                if eq_style == '미러막대형':
                    # 미러막대형 - 위아래 대칭, 라운드 처리 (미리보기와 동일)
                    half_height = int(bar_val * eq_h * 0.45)
                    if half_height > 0:
                        # 상단 막대
                        draw_rounded_bar(draw, x, eq_y - half_height, actual_bar_width, half_height, border_radius, bar_color)
                        # 하단 막대 (미러, 약간 투명)
                        mirror_color = (r, g, b, 180)
                        draw_rounded_bar(draw, x, eq_y, actual_bar_width, half_height, border_radius, mirror_color)

                elif eq_style == '파형':
                    # 파형 스타일 - 사인파 높이 변화, 라운드 막대 (미리보기와 동일)
                    wave = np.sin(i * 0.3) * 0.3
                    wave_height = int(bar_val * eq_h * 0.9 * (0.7 + wave))
                    if wave_height > 0:
                        y = start_y + eq_h - wave_height
                        draw_rounded_bar(draw, x, y, actual_bar_width, wave_height, border_radius, bar_color)

                elif eq_style == '원형':
                    # 원형 (점 스타일) - 한 줄로 점들 배치 (미리보기와 동일)
                    dot_size = actual_bar_width * 0.4 * (0.3 + bar_val * 0.7)
                    dot_x = x + actual_bar_width / 2
                    dot_y = eq_y
                    draw.ellipse([dot_x - dot_size, dot_y - dot_size, dot_x + dot_size, dot_y + dot_size], fill=bar_color)

                else:
                    # 기본 막대형 - 라운드 처리된 막대 (미리보기와 동일)
                    if bar_height > 0:
                        y = start_y + eq_h - bar_height
                        draw_rounded_bar(draw, x, y, actual_bar_width, bar_height, border_radius, bar_color)

            # 프레임 저장 (PNG로 투명도 유지)
            frame_path = os.path.join(temp_dir, f'frame_{frame_idx:06d}.png')
            img.save(frame_path, 'PNG')

            if frame_idx % 30 == 0:
                print(f"[RoyStudio] 프레임 생성 중: {frame_idx}/{total_frames}")

        print("[RoyStudio] 프레임 생성 완료, 영상 인코딩 중...")

        # 출력 포맷 결정 (확장자 기반)
        output_ext = os.path.splitext(output_path)[1].lower()

        if output_ext == '.mov':
            # ProRes 4444 (프리미어 호환, 투명도 지원)
            ffmpeg_cmd = [
                'ffmpeg', '-y',
                '-framerate', str(fps),
                '-i', os.path.join(temp_dir, 'frame_%06d.png'),
                '-i', audio_path,
                '-c:v', 'prores_ks',
                '-profile:v', '4444',
                '-pix_fmt', 'yuva444p10le',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-shortest',
                output_path
            ]
        elif output_ext == '.webm':
            # WebM VP9 (투명도 지원, 웹용)
            ffmpeg_cmd = [
                'ffmpeg', '-y',
                '-framerate', str(fps),
                '-i', os.path.join(temp_dir, 'frame_%06d.png'),
                '-i', audio_path,
                '-c:v', 'libvpx-vp9',
                '-pix_fmt', 'yuva420p',
                '-c:a', 'libopus',
                '-b:v', '2M',
                '-shortest',
                output_path
            ]
        else:
            # 기본: MOV ProRes 4444
            if not output_path.endswith('.mov'):
                output_path = output_path.rsplit('.', 1)[0] + '.mov'
            ffmpeg_cmd = [
                'ffmpeg', '-y',
                '-framerate', str(fps),
                '-i', os.path.join(temp_dir, 'frame_%06d.png'),
                '-i', audio_path,
                '-c:v', 'prores_ks',
                '-profile:v', '4444',
                '-pix_fmt', 'yuva444p10le',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-shortest',
                output_path
            ]

        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')

        # 임시 파일 정리
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)

        if result.returncode != 0:
            print(f"[RoyStudio] FFmpeg 오류: {result.stderr}")
            return {'success': False, 'error': f'FFmpeg 오류: {result.stderr[:200] if result.stderr else "알 수 없는 오류"}'}

        print(f"[RoyStudio] 투명 EQ 영상 생성 완료: {output_path}")

        return {
            'success': True,
            'output_path': output_path,
            'duration': duration,
            'frames': total_frames
        }

    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_generate_tts_and_merge(clips_data, output_folder, custom_filename=None):
    """여러 클립의 TTS를 생성하고 하나의 MP3로 합치기 (병렬 처리)"""
    try:
        from pydub import AudioSegment
        import tempfile
        from concurrent.futures import ThreadPoolExecutor, as_completed

        if not clips_data:
            return {'success': False, 'error': '클립 데이터가 비어있습니다.'}

        # 임시 폴더 생성
        temp_dir = tempfile.mkdtemp(prefix='tts_merge_')
        temp_files = []

        print(f"[RoyStudio] TTS 생성 및 합치기 시작: {len(clips_data)}개 클립 (병렬 처리)")

        # TTS 생성 함수 (병렬 실행용)
        def generate_single_tts(idx, clip):
            text = clip.get('text', '')
            voice = clip.get('voice', 'ko-KR-Wavenet-A')
            rate = clip.get('rate', 1.0)
            pitch = clip.get('pitch', 0)

            if not text.strip():
                return None

            try:
                # TTS 생성
                audio_bytes = services.synthesize_tts_bytes(
                    profile_name='',
                    text=text,
                    api_voice=voice,
                    rate=rate,
                    pitch=pitch
                )

                if audio_bytes:
                    temp_path = os.path.join(temp_dir, f'clip_{idx:04d}.mp3')
                    with open(temp_path, 'wb') as f:
                        f.write(audio_bytes)
                    print(f"[RoyStudio] 클립 {idx+1}/{len(clips_data)} TTS 생성 완료")
                    return (idx, temp_path)
                else:
                    print(f"[RoyStudio] 클립 {idx+1} TTS 생성 실패")
                    return None

            except Exception as e:
                print(f"[RoyStudio] 클립 {idx+1} TTS 오류: {e}")
                return None

        # 병렬 처리 (최대 5개 동시 실행)
        results = {}
        max_workers = min(5, len(clips_data))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(generate_single_tts, idx, clip): idx
                      for idx, clip in enumerate(clips_data)}

            for future in as_completed(futures):
                result = future.result()
                if result:
                    idx, temp_path = result
                    results[idx] = temp_path

        # 인덱스 순서대로 정렬
        temp_files = [results[idx] for idx in sorted(results.keys())]

        if not temp_files:
            return {'success': False, 'error': '생성된 TTS가 없습니다.'}

        # MP3 파일 합치기
        combined = AudioSegment.empty()
        for temp_path in temp_files:
            audio = AudioSegment.from_mp3(temp_path)
            combined += audio

        # 최종 파일 저장
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

        # custom_filename이 있으면 사용, 없으면 타임스탬프 기반 파일명
        if custom_filename:
            output_filename = f'{custom_filename}.mp3'
        else:
            output_filename = f'combined_tts_{timestamp}.mp3'
        output_path = os.path.join(output_folder, output_filename)

        combined.export(output_path, format='mp3', bitrate='192k')

        # 임시 파일 정리
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)

        duration = len(combined) / 1000.0

        print(f"[RoyStudio] MP3 합치기 완료: {output_path} ({duration:.2f}초)")

        return {
            'success': True,
            'output_path': output_path,
            'filename': output_filename,
            'duration': duration,
            'clip_count': len(temp_files)
        }

    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_generate_transparent_eq_only(clips_data, output_folder, eq_settings, script_base_name=None):
    """TTS 생성 후 투명 EQ 영상과 MP3 함께 생성 (병렬 처리)"""
    try:
        from pydub import AudioSegment
        import tempfile
        import shutil
        from concurrent.futures import ThreadPoolExecutor, as_completed

        if not clips_data:
            return {'success': False, 'error': '클립 데이터가 비어있습니다.'}

        # 임시 폴더 생성
        temp_dir = tempfile.mkdtemp(prefix='eq_tts_')
        temp_files = []

        print(f"[RoyStudio] 투명 EQ 영상 + MP3 생성 시작: {len(clips_data)}개 클립 (병렬 처리)")

        # TTS 생성 함수 (병렬 실행용)
        def generate_single_tts(idx, clip):
            text = clip.get('text', '')
            voice = clip.get('voice', 'ko-KR-Wavenet-A')
            rate = clip.get('rate', 1.0)
            pitch = clip.get('pitch', 0)

            if not text.strip():
                return None

            try:
                audio_bytes = services.synthesize_tts_bytes(
                    profile_name='',
                    text=text,
                    api_voice=voice,
                    rate=rate,
                    pitch=pitch
                )

                if audio_bytes:
                    temp_path = os.path.join(temp_dir, f'clip_{idx:04d}.mp3')
                    with open(temp_path, 'wb') as f:
                        f.write(audio_bytes)
                    print(f"[RoyStudio] 클립 {idx+1}/{len(clips_data)} TTS 생성 완료")
                    return (idx, temp_path)
                else:
                    print(f"[RoyStudio] 클립 {idx+1} TTS 생성 실패")
                    return None

            except Exception as e:
                print(f"[RoyStudio] 클립 {idx+1} TTS 오류: {e}")
                return None

        # 병렬 처리 (최대 5개 동시 실행)
        results = {}
        max_workers = min(5, len(clips_data))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(generate_single_tts, idx, clip): idx
                      for idx, clip in enumerate(clips_data)}

            for future in as_completed(futures):
                result = future.result()
                if result:
                    idx, temp_path = result
                    results[idx] = temp_path

        # 인덱스 순서대로 정렬
        temp_files = [results[idx] for idx in sorted(results.keys())]

        if not temp_files:
            shutil.rmtree(temp_dir, ignore_errors=True)
            return {'success': False, 'error': '생성된 TTS가 없습니다.'}

        # 2단계: MP3 합치기
        combined = AudioSegment.empty()
        for temp_path in temp_files:
            audio = AudioSegment.from_mp3(temp_path)
            combined += audio

        duration = len(combined) / 1000.0

        # MP3 파일을 출력 폴더에 저장
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

        # script_base_name이 있으면 MP3_대본파일명, EQ_대본파일명 형식 사용
        if script_base_name:
            mp3_filename = f'MP3_{script_base_name}.mp3'
            mov_filename = f'EQ_{script_base_name}.mov'
        else:
            mp3_filename = f'combined_tts_{timestamp}.mp3'
            mov_filename = f'transparent_eq_{timestamp}.mov'

        mp3_output_path = os.path.join(output_folder, mp3_filename)
        combined.export(mp3_output_path, format='mp3', bitrate='192k')
        print(f"[RoyStudio] MP3 저장 완료: {mp3_output_path} ({duration:.2f}초)")

        # 3단계: 투명 EQ 영상 생성
        mov_output_path = os.path.join(output_folder, mov_filename)

        eq_result = studio_generate_transparent_eq_video(mp3_output_path, mov_output_path, eq_settings)

        # 임시 폴더 정리
        shutil.rmtree(temp_dir, ignore_errors=True)

        if eq_result.get('success'):
            return {
                'success': True,
                'output_path': mov_output_path,
                'mp3_path': mp3_output_path,
                'duration': duration,
                'frames': eq_result.get('frames', 0),
                'clip_count': len(temp_files)
            }
        else:
            return eq_result

    except Exception as e:
        traceback.print_exc()
        # 임시 폴더 정리
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except:
            pass
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_create_transparent_eq(job_data, output_folder):
    """투명 EQ MOV 파일만 생성 (영상 제작과 별도)"""
    try:
        from pydub import AudioSegment
        import tempfile
        import shutil

        clips_data = job_data.get('clips', [])
        eq_settings = job_data.get('eqSettings', {})
        file_name = job_data.get('fileName', 'EQ_output')

        if not clips_data:
            return {'success': False, 'error': '클립 데이터가 비어있습니다.'}

        # 임시 폴더 생성
        temp_dir = tempfile.mkdtemp(prefix='eq_only_')
        temp_files = []

        print(f"[RoyStudio] 투명 EQ 영상 생성 시작: {len(clips_data)}개 클립")

        # 1단계: TTS 생성
        for idx, clip in enumerate(clips_data):
            text = clip.get('text', '')
            voice = clip.get('voice', 'ko-KR-Wavenet-A')
            rate = clip.get('rate', 1.0)
            pitch = clip.get('pitch', 0)

            if not text.strip():
                continue

            try:
                audio_bytes = services.synthesize_tts_bytes(
                    profile_name='',
                    text=text,
                    api_voice=voice,
                    rate=rate,
                    pitch=pitch
                )

                if audio_bytes:
                    temp_path = os.path.join(temp_dir, f'clip_{idx:04d}.mp3')
                    with open(temp_path, 'wb') as f:
                        f.write(audio_bytes)
                    temp_files.append(temp_path)
                    print(f"[RoyStudio] 클립 {idx+1}/{len(clips_data)} TTS 생성 완료")
                else:
                    print(f"[RoyStudio] 클립 {idx+1} TTS 생성 실패")

            except Exception as e:
                print(f"[RoyStudio] 클립 {idx+1} TTS 오류: {e}")

        if not temp_files:
            shutil.rmtree(temp_dir, ignore_errors=True)
            return {'success': False, 'error': '생성된 TTS가 없습니다.'}

        # 2단계: MP3 합치기 (임시)
        combined = AudioSegment.empty()
        for temp_path in temp_files:
            audio = AudioSegment.from_mp3(temp_path)
            combined += audio

        duration = len(combined) / 1000.0

        # 임시 MP3 저장
        temp_mp3_path = os.path.join(temp_dir, 'temp_combined.mp3')
        combined.export(temp_mp3_path, format='mp3', bitrate='192k')
        print(f"[RoyStudio] 임시 MP3 저장 완료: {duration:.2f}초")

        # 3단계: 투명 EQ 영상 생성 (MOV)
        mov_filename = f'{file_name}.mov'
        mov_output_path = os.path.join(output_folder, mov_filename)

        eq_result = studio_generate_transparent_eq_video(temp_mp3_path, mov_output_path, eq_settings)

        # 임시 폴더 정리
        shutil.rmtree(temp_dir, ignore_errors=True)

        if eq_result.get('success'):
            return {
                'success': True,
                'path': mov_output_path,
                'duration': duration,
                'frames': eq_result.get('frames', 0)
            }
        else:
            return eq_result

    except Exception as e:
        traceback.print_exc()
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except:
            pass
        return {'success': False, 'error': str(e)}


def studio_create_transparent_eq_batch(job_data, output_folder, app):
    """배치 모드에서 투명 EQ MOV 파일 생성 (대본 파일 파싱 포함)"""
    try:
        from pydub import AudioSegment
        import tempfile
        import shutil
        import re

        script_path = job_data.get('scriptPath', '')
        character_voices = job_data.get('characterVoices', {})
        eq_settings = job_data.get('eqSettings', {})
        file_name = job_data.get('fileName', 'EQ_output')

        if not script_path or not os.path.exists(script_path):
            return {'success': False, 'error': '대본 파일이 없습니다.'}

        # 대본 파일 읽기 및 파싱
        script_text = utils.read_script_file(script_path)
        if not script_text:
            return {'success': False, 'error': '대본을 읽을 수 없습니다.'}

        # 대본 파싱 ([캐릭터명] 패턴)
        clips_data = []
        current_character = '나레이터'
        current_lines = []

        for line in script_text.split('\n'):
            line = line.strip()
            if not line:
                continue

            char_match = re.match(r'^\[([^\]]+)\]\s*(.*)', line)
            if char_match:
                # 이전 캐릭터의 대사가 있으면 clips에 추가
                if current_lines:
                    text = ' '.join(current_lines)
                    voice_setting = character_voices.get(current_character, {})
                    clips_data.append({
                        'text': text,
                        'voice': voice_setting.get('voice', 'ko-KR-Wavenet-A'),
                        'rate': voice_setting.get('rate', 1.0),
                        'pitch': voice_setting.get('pitch', 0.0)
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
            voice_setting = character_voices.get(current_character, {})
            clips_data.append({
                'text': text,
                'voice': voice_setting.get('voice', 'ko-KR-Wavenet-A'),
                'rate': voice_setting.get('rate', 1.0),
                'pitch': voice_setting.get('pitch', 0.0)
            })

        if not clips_data:
            return {'success': False, 'error': '파싱된 클립이 없습니다.'}

        app.log_message(f"[배치] 투명 EQ 대본 파싱 완료: {len(clips_data)}개 클립")

        # 임시 폴더 생성
        temp_dir = tempfile.mkdtemp(prefix='batch_eq_')
        temp_files = []

        # 1단계: TTS 생성
        for idx, clip in enumerate(clips_data):
            text = clip.get('text', '')
            voice = clip.get('voice', 'ko-KR-Wavenet-A')
            rate = clip.get('rate', 1.0)
            pitch = clip.get('pitch', 0)

            if not text.strip():
                continue

            try:
                audio_bytes = services.synthesize_tts_bytes(
                    profile_name='',
                    text=text,
                    api_voice=voice,
                    rate=rate,
                    pitch=pitch
                )

                if audio_bytes:
                    temp_path = os.path.join(temp_dir, f'clip_{idx:04d}.mp3')
                    with open(temp_path, 'wb') as f:
                        f.write(audio_bytes)
                    temp_files.append(temp_path)
                    app.log_message(f"[배치] 클립 {idx+1}/{len(clips_data)} TTS 생성 완료")

            except Exception as e:
                app.log_message(f"[배치] 클립 {idx+1} TTS 오류: {e}")

        if not temp_files:
            shutil.rmtree(temp_dir, ignore_errors=True)
            return {'success': False, 'error': '생성된 TTS가 없습니다.'}

        # 2단계: MP3 합치기
        combined = AudioSegment.empty()
        for temp_path in temp_files:
            audio = AudioSegment.from_mp3(temp_path)
            combined += audio

        duration = len(combined) / 1000.0

        # 임시 MP3 저장
        temp_mp3_path = os.path.join(temp_dir, 'temp_combined.mp3')
        combined.export(temp_mp3_path, format='mp3', bitrate='192k')
        app.log_message(f"[배치] 임시 MP3 저장 완료: {duration:.2f}초")

        # 3단계: 투명 EQ 영상 생성 (MOV)
        mov_filename = f'{file_name}.mov'
        mov_output_path = os.path.join(output_folder, mov_filename)

        eq_result = studio_generate_transparent_eq_video(temp_mp3_path, mov_output_path, eq_settings)

        # 임시 폴더 정리
        shutil.rmtree(temp_dir, ignore_errors=True)

        if eq_result.get('success'):
            return {
                'success': True,
                'output_path': mov_output_path,
                'duration': duration,
                'frames': eq_result.get('frames', 0)
            }
        else:
            return eq_result

    except Exception as e:
        app.log_message(f"[배치] 투명 EQ 생성 중 예외 발생: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_sync_timecode_with_whisper(clips_data, output_folder, script_base_name=None):
    """
    클립들의 TTS를 생성하고 Whisper로 분석하여 정확한 타임코드를 반환

    1. 각 클립의 TTS 생성 → MP3 합치기
    2. Whisper base 모델로 MP3 분석 → 타임스탬프 추출
    3. 클립별 정확한 시작/끝 타임코드 계산
    """
    try:
        from pydub import AudioSegment
        import tempfile
        import shutil

        if not clips_data:
            return {'success': False, 'error': '클립 데이터가 비어있습니다.'}

        # 임시 폴더 생성
        temp_dir = tempfile.mkdtemp(prefix='timecode_sync_')
        temp_files = []
        clip_durations = []  # 각 클립의 실제 오디오 길이

        print(f"[RoyStudio] 타임코드 동기화 시작: {len(clips_data)}개 클립")

        # 1단계: 각 클립 TTS 생성
        for idx, clip in enumerate(clips_data):
            text = clip.get('text', '')
            voice = clip.get('voice', 'ko-KR-Wavenet-A')
            rate = clip.get('rate', 1.0)
            pitch = clip.get('pitch', 0)

            if not text.strip():
                clip_durations.append(0)
                continue

            try:
                audio_bytes = services.synthesize_tts_bytes(
                    profile_name='',
                    text=text,
                    api_voice=voice,
                    rate=rate,
                    pitch=pitch
                )

                if audio_bytes:
                    temp_path = os.path.join(temp_dir, f'clip_{idx:04d}.mp3')
                    with open(temp_path, 'wb') as f:
                        f.write(audio_bytes)
                    temp_files.append((idx, temp_path))

                    # 클립 길이 측정
                    audio_segment = AudioSegment.from_mp3(temp_path)
                    clip_durations.append(len(audio_segment) / 1000.0)

                    print(f"[RoyStudio] 클립 {idx+1}/{len(clips_data)} TTS 생성 완료 ({clip_durations[-1]:.2f}초)")
                else:
                    clip_durations.append(0)
                    print(f"[RoyStudio] 클립 {idx+1} TTS 생성 실패")

            except Exception as e:
                clip_durations.append(0)
                print(f"[RoyStudio] 클립 {idx+1} TTS 오류: {e}")

        if not temp_files:
            shutil.rmtree(temp_dir, ignore_errors=True)
            return {'success': False, 'error': '생성된 TTS가 없습니다.'}

        # 2단계: MP3 합치기
        combined = AudioSegment.empty()
        for idx, temp_path in temp_files:
            audio = AudioSegment.from_mp3(temp_path)
            combined += audio

        total_duration = len(combined) / 1000.0

        # MP3 파일 저장
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

        if script_base_name:
            mp3_filename = f'MP3_{script_base_name}.mp3'
        else:
            mp3_filename = f'combined_tts_{timestamp}.mp3'

        mp3_output_path = os.path.join(output_folder, mp3_filename)
        combined.export(mp3_output_path, format='mp3', bitrate='192k')
        print(f"[RoyStudio] MP3 저장 완료: {mp3_output_path} ({total_duration:.2f}초)")

        # 3단계: Whisper로 타임스탬프 추출
        print("[RoyStudio] Whisper 분석 시작 (base 모델)...")

        try:
            import whisper

            model = whisper.load_model("base")
            result = model.transcribe(
                mp3_output_path,
                language="ko",
                word_timestamps=True
            )

            whisper_segments = result.get('segments', [])
            print(f"[RoyStudio] Whisper 분석 완료: {len(whisper_segments)}개 세그먼트 감지")

        except ImportError:
            print("[RoyStudio] Whisper 미설치 - 순차 계산 방식으로 대체")
            whisper_segments = None
        except Exception as e:
            print(f"[RoyStudio] Whisper 오류: {e} - 순차 계산 방식으로 대체")
            whisper_segments = None

        # 4단계: 타임코드 계산
        synced_clips = []

        # 클립 수와 Whisper 세그먼트 수가 동일하면 1:1 직접 매핑
        if whisper_segments and len(whisper_segments) == len(clips_data):
            print(f"[RoyStudio] Whisper 1:1 직접 매핑 (클립 {len(clips_data)}개 = 세그먼트 {len(whisper_segments)}개)")
            for idx, seg in enumerate(whisper_segments):
                synced_clips.append({
                    'index': idx,
                    'start': round(seg['start'], 2),
                    'end': round(seg['end'], 2),
                    'duration': round(seg['end'] - seg['start'], 2),
                    'text': clips_data[idx].get('text', '')
                })
                print(f"[RoyStudio]   클립 {idx}: {seg['start']:.2f} ~ {seg['end']:.2f}초")
        else:
            # 순차 계산 방식 (TTS 실제 길이 기반)
            print(f"[RoyStudio] 순차 계산 방식 (TTS 길이 기반)")
            current_time = 0
            for idx, clip in enumerate(clips_data):
                duration = clip_durations[idx] if idx < len(clip_durations) else 0
                synced_clips.append({
                    'index': idx,
                    'start': round(current_time, 2),
                    'end': round(current_time + duration, 2),
                    'duration': round(duration, 2),
                    'text': clip.get('text', '')
                })
                print(f"[RoyStudio]   클립 {idx}: {current_time:.2f} ~ {current_time + duration:.2f}초 (길이: {duration:.2f}초)")
                current_time += duration

        # 임시 폴더 정리
        shutil.rmtree(temp_dir, ignore_errors=True)

        print(f"[RoyStudio] 타임코드 동기화 완료")

        return {
            'success': True,
            'mp3_path': mp3_output_path,
            'total_duration': total_duration,
            'clips': synced_clips,
            'clip_count': len(synced_clips)
        }

    except Exception as e:
        traceback.print_exc()
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except:
            pass
        return {'success': False, 'error': str(e)}


def match_clips_with_whisper(clips_data, whisper_segments, clip_durations):
    """
    자막 클립과 Whisper 세그먼트를 매칭하여 정확한 타임코드 반환

    매칭 전략:
    - 순서 기반 매칭 (TTS 순서와 Whisper 감지 순서가 동일하다고 가정)
    - 클립 길이를 기준으로 세그먼트 그룹핑
    """
    synced_clips = []
    segment_idx = 0
    current_time = 0

    for clip_idx, clip in enumerate(clips_data):
        clip_text = clip.get('text', '').strip()
        expected_duration = clip_durations[clip_idx] if clip_idx < len(clip_durations) else 0

        if not clip_text or expected_duration == 0:
            synced_clips.append({
                'index': clip_idx,
                'start': round(current_time, 2),
                'end': round(current_time, 2),
                'duration': 0,
                'text': clip_text
            })
            continue

        # 현재 클립에 해당하는 Whisper 세그먼트 찾기
        clip_start = None
        clip_end = None
        accumulated_duration = 0

        while segment_idx < len(whisper_segments) and accumulated_duration < expected_duration * 0.9:
            seg = whisper_segments[segment_idx]

            if clip_start is None:
                clip_start = seg['start']

            clip_end = seg['end']
            accumulated_duration = clip_end - clip_start
            segment_idx += 1

            # 예상 길이의 90% 이상 도달하면 다음 클립으로
            if accumulated_duration >= expected_duration * 0.9:
                break

        # 매칭 실패 시 순차 계산
        if clip_start is None:
            clip_start = current_time
            clip_end = current_time + expected_duration

        synced_clips.append({
            'index': clip_idx,
            'start': round(clip_start, 2),
            'end': round(clip_end, 2),
            'duration': round(clip_end - clip_start, 2),
            'text': clip_text
        })

        current_time = clip_end

    return synced_clips


# ========== 영상 프리셋 관리 ==========

VIDEO_PRESETS_FILE = os.path.join(os.path.dirname(__file__), 'data', 'video_presets.json')

@eel.expose
def load_video_presets():
    """영상 프리셋 목록 로드"""
    try:
        if os.path.exists(VIDEO_PRESETS_FILE):
            with open(VIDEO_PRESETS_FILE, 'r', encoding='utf-8') as f:
                presets = json.load(f)
            return {'success': True, 'presets': presets}
        return {'success': True, 'presets': {}}
    except Exception as e:
        print(f"[RoyStudio] 영상 프리셋 로드 오류: {e}")
        return {'success': False, 'error': str(e)}

@eel.expose
def save_video_preset(name, preset):
    """영상 프리셋 저장"""
    try:
        presets = {}
        if os.path.exists(VIDEO_PRESETS_FILE):
            with open(VIDEO_PRESETS_FILE, 'r', encoding='utf-8') as f:
                presets = json.load(f)

        presets[name] = preset

        # data 폴더 생성
        os.makedirs(os.path.dirname(VIDEO_PRESETS_FILE), exist_ok=True)

        with open(VIDEO_PRESETS_FILE, 'w', encoding='utf-8') as f:
            json.dump(presets, f, ensure_ascii=False, indent=2)

        print(f"[RoyStudio] 영상 프리셋 저장: {name}")
        return {'success': True}
    except Exception as e:
        print(f"[RoyStudio] 영상 프리셋 저장 오류: {e}")
        return {'success': False, 'error': str(e)}

@eel.expose
def delete_video_preset(name):
    """영상 프리셋 삭제"""
    try:
        if not os.path.exists(VIDEO_PRESETS_FILE):
            return {'success': False, 'error': '프리셋 파일이 없습니다.'}

        with open(VIDEO_PRESETS_FILE, 'r', encoding='utf-8') as f:
            presets = json.load(f)

        if name in presets:
            del presets[name]
            with open(VIDEO_PRESETS_FILE, 'w', encoding='utf-8') as f:
                json.dump(presets, f, ensure_ascii=False, indent=2)
            print(f"[RoyStudio] 영상 프리셋 삭제: {name}")
            return {'success': True}
        else:
            return {'success': False, 'error': '프리셋을 찾을 수 없습니다.'}
    except Exception as e:
        print(f"[RoyStudio] 영상 프리셋 삭제 오류: {e}")
        return {'success': False, 'error': str(e)}


# ========== 배치 탭용 파일 선택 함수 ==========
# 주의: select_output_folder, select_image_file 등은 main.py에 이미 정의되어 있음
# 여기서는 배치 탭 전용 함수만 정의

@eel.expose
def check_file_exists(file_path):
    """파일 존재 여부 확인"""
    try:
        exists = os.path.isfile(file_path)
        return {'exists': exists, 'path': file_path}
    except Exception as e:
        return {'exists': False, 'error': str(e)}

@eel.expose
def select_script_files():
    """대본 파일 다중 선택"""
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)

        files = filedialog.askopenfilenames(
            title="대본 파일 선택",
            filetypes=[
                ("텍스트 파일", "*.txt"),
                ("모든 파일", "*.*")
            ]
        )

        root.destroy()

        if files:
            return {'success': True, 'files': list(files)}
        return {'success': False, 'error': '파일이 선택되지 않았습니다.'}
    except Exception as e:
        print(f"[RoyStudio] 파일 선택 오류: {e}")
        return {'success': False, 'error': str(e)}

@eel.expose
def select_script_folder():
    """대본 폴더 선택 (폴더 내 txt 파일 목록 반환)"""
    try:
        import tkinter as tk
        from tkinter import filedialog
        import glob

        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)

        folder = filedialog.askdirectory(title="대본 폴더 선택")

        root.destroy()

        if folder:
            # 폴더 내 txt 파일 검색
            txt_files = glob.glob(os.path.join(folder, "*.txt"))
            if txt_files:
                return {'success': True, 'files': txt_files}
            return {'success': False, 'error': '폴더에 txt 파일이 없습니다.'}
        return {'success': False, 'error': '폴더가 선택되지 않았습니다.'}
    except Exception as e:
        print(f"[RoyStudio] 폴더 선택 오류: {e}")
        return {'success': False, 'error': str(e)}

@eel.expose
def get_script_file_info(file_path):
    """대본 파일 정보 가져오기 (문장 수, 예상 길이)"""
    try:
        if not os.path.exists(file_path):
            return {'success': False, 'error': '파일을 찾을 수 없습니다.'}

        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 줄 단위로 분리 (빈 줄 제외)
        lines = [line.strip() for line in content.split('\n') if line.strip()]
        sentence_count = len(lines)

        # 예상 길이 계산 (평균 음성 속도 기준: 약 150자/분)
        total_chars = sum(len(line) for line in lines)
        estimated_seconds = total_chars / 2.5  # 대략 초당 2.5자

        # 시간 포맷
        if estimated_seconds < 60:
            estimated_length = f"{int(estimated_seconds)}초"
        elif estimated_seconds < 3600:
            mins = int(estimated_seconds // 60)
            secs = int(estimated_seconds % 60)
            estimated_length = f"{mins}분 {secs}초"
        else:
            hours = int(estimated_seconds // 3600)
            mins = int((estimated_seconds % 3600) // 60)
            estimated_length = f"{hours}시간 {mins}분"

        return {
            'success': True,
            'sentenceCount': sentence_count,
            'estimatedLength': estimated_length,
            'totalChars': total_chars
        }
    except Exception as e:
        print(f"[RoyStudio] 파일 정보 가져오기 오류: {e}")
        return {'success': False, 'error': str(e)}

@eel.expose
def load_voice_presets():
    """음성 프리셋 목록 로드 (캐릭터 음성 설정용)"""
    try:
        presets_file = os.path.join(os.path.dirname(__file__), 'data', 'voice_presets.json')
        if os.path.exists(presets_file):
            with open(presets_file, 'r', encoding='utf-8') as f:
                presets = json.load(f)
            return {'success': True, 'presets': presets}
        return {'success': True, 'presets': {}}
    except Exception as e:
        print(f"[RoyStudio] 음성 프리셋 로드 오류: {e}")
        return {'success': False, 'error': str(e)}


# ========== YouTube 계정 관리 ==========

from youtube_manager import youtube_manager

@eel.expose
def youtube_has_client_secrets():
    """client_secrets.json 파일 존재 여부 확인"""
    return youtube_manager.has_client_secrets()

@eel.expose
def youtube_set_client_secrets():
    """client_secrets.json 파일 선택 및 설정"""
    try:
        print("[YouTube] client_secrets.json 파일 선택 대화상자 열기...")

        root = tk.Tk()
        root.attributes('-topmost', True)  # 최상위 창으로 설정
        root.withdraw()
        root.update()  # GUI 업데이트

        file_path = filedialog.askopenfilename(
            parent=root,
            title="Google Cloud client_secrets.json 선택",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
            initialdir=os.path.expanduser("~\\Downloads")  # 다운로드 폴더에서 시작
        )

        root.destroy()

        print(f"[YouTube] 선택된 파일: {file_path}")

        if file_path:
            success = youtube_manager.set_client_secrets(file_path)
            if success:
                print("[YouTube] client_secrets.json 설정 완료!")
                return {'success': True, 'message': 'client_secrets.json 설정 완료'}
            else:
                print("[YouTube] 파일 설정 실패")
                return {'success': False, 'error': '파일 설정 실패'}

        print("[YouTube] 파일 선택 취소됨")
        return {'success': False, 'error': '파일 선택 취소'}
    except Exception as e:
        print(f"[YouTube] 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        return {'success': False, 'error': str(e)}

@eel.expose
def youtube_add_account(account_name=None):
    """
    새 YouTube 계정 추가 (OAuth 인증)

    Args:
        account_name: 계정 식별 이름 (없으면 채널명 사용)

    Returns:
        {'success': bool, 'account_name': str, 'channel_info': dict, 'error': str}
    """
    try:
        result = youtube_manager.add_account(account_name)
        return result
    except Exception as e:
        print(f"[YouTube] 계정 추가 오류: {e}")
        return {'success': False, 'error': str(e)}

@eel.expose
def youtube_remove_account(account_name):
    """
    계정 제거

    Args:
        account_name: 계정 이름

    Returns:
        {'success': bool}
    """
    try:
        success = youtube_manager.remove_account(account_name)
        return {'success': success}
    except Exception as e:
        print(f"[YouTube] 계정 제거 오류: {e}")
        return {'success': False, 'error': str(e)}

@eel.expose
def youtube_get_accounts():
    """
    모든 계정 목록 가져오기

    Returns:
        {'success': bool, 'accounts': list}
    """
    try:
        accounts = youtube_manager.get_accounts_list()
        return {'success': True, 'accounts': accounts}
    except Exception as e:
        print(f"[YouTube] 계정 목록 조회 오류: {e}")
        return {'success': False, 'error': str(e), 'accounts': []}

@eel.expose
def youtube_get_managed_channels(account_name):
    """
    계정이 관리하는 모든 채널 목록 가져오기
    (본인 채널 + 관리자 권한이 있는 다른 채널들)

    Args:
        account_name: 계정 이름

    Returns:
        {'success': bool, 'channels': list, 'account_name': str, 'error': str}
    """
    try:
        result = youtube_manager.get_managed_channels(account_name)
        return result
    except Exception as e:
        print(f"[YouTube] 관리 채널 조회 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e), 'channels': []}

@eel.expose
def youtube_upload_video(
    account_name,
    video_file,
    title,
    description='',
    thumbnail_file=None,
    privacy_status='private',
    tags=None,
    channel_id=None
):
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
        channel_id: 업로드할 채널 ID (선택, 없으면 본인 채널)

    Returns:
        {'success': bool, 'video_id': str, 'video_url': str, 'error': str}
    """
    try:
        print(f"[YouTube] 영상 업로드 시작: {title} -> {account_name}")
        if channel_id:
            print(f"[YouTube] 대상 채널 ID: {channel_id}")

        result = youtube_manager.upload_video(
            account_name=account_name,
            video_file=video_file,
            title=title,
            description=description,
            thumbnail_file=thumbnail_file,
            privacy_status=privacy_status,
            tags=tags or [],
            channel_id=channel_id
        )

        if result['success']:
            print(f"[YouTube] 업로드 성공: {result['video_url']}")
        else:
            print(f"[YouTube] 업로드 실패: {result.get('error')}")

        return result
    except Exception as e:
        print(f"[YouTube] 업로드 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e)}

@eel.expose
def youtube_select_thumbnail():
    """썸네일 이미지 파일 선택"""
    try:
        root = tk.Tk()
        root.withdraw()
        file_path = filedialog.askopenfilename(
            title="썸네일 이미지 선택",
            filetypes=[
                ("Image files", "*.jpg *.jpeg *.png"),
                ("All files", "*.*")
            ]
        )
        root.destroy()

        if file_path:
            return {'success': True, 'file_path': file_path}
        return {'success': False, 'error': '파일 선택 취소'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


print("[RoyStudio] 백엔드 모듈 로드 완료")
