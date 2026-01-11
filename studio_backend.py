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
from data_path import DATA_DIR

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

def apply_audio_speed_ffmpeg(input_path, output_path, speed):
    """FFmpeg를 사용하여 오디오 속도 변환 (피치 유지)

    Args:
        input_path: 입력 MP3 파일 경로
        output_path: 출력 MP3 파일 경로
        speed: 속도 배율 (0.5 ~ 2.0, 1.0 = 원본)

    Returns:
        bool: 성공 여부
    """
    if speed == 1.0:
        # 속도 변환 필요 없음 - 파일 복사
        import shutil
        shutil.copy(input_path, output_path)
        return True

    try:
        # atempo 필터는 0.5 ~ 2.0 범위만 지원
        # 그 외 범위는 체인으로 연결해야 함
        if speed < 0.5:
            # 예: 0.25 = 0.5 * 0.5
            atempo_chain = []
            remaining = speed
            while remaining < 0.5:
                atempo_chain.append('atempo=0.5')
                remaining *= 2
            atempo_chain.append(f'atempo={remaining:.4f}')
            atempo_filter = ','.join(atempo_chain)
        elif speed > 2.0:
            # 예: 4.0 = 2.0 * 2.0
            atempo_chain = []
            remaining = speed
            while remaining > 2.0:
                atempo_chain.append('atempo=2.0')
                remaining /= 2
            atempo_chain.append(f'atempo={remaining:.4f}')
            atempo_filter = ','.join(atempo_chain)
        else:
            atempo_filter = f'atempo={speed:.4f}'

        cmd = [
            'ffmpeg', '-y',
            '-i', input_path,
            '-filter:a', atempo_filter,
            '-vn',  # 비디오 스트림 제외
            output_path
        ]

        print(f"[RoyStudio] FFmpeg 속도 변환: {speed}x ({atempo_filter})")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120
        )

        if result.returncode == 0:
            print(f"[RoyStudio] 속도 변환 완료: {output_path}")
            return True
        else:
            print(f"[ERROR] FFmpeg 속도 변환 실패: {result.stderr}")
            return False

    except Exception as e:
        print(f"[ERROR] FFmpeg 속도 변환 오류: {e}")
        return False


def get_audio_duration(file_path):
    """오디오 파일의 재생 시간(초) 반환"""
    try:
        result = subprocess.run(
            [
                'ffprobe', '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                file_path
            ],
            capture_output=True,
            text=True,
            timeout=30
        )
        return float(result.stdout.strip())
    except Exception as e:
        print(f"[ERROR] 오디오 길이 확인 실패: {e}")
        return None


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

# 캐릭터 데이터베이스 파일
STUDIO_CHARACTERS_DB_FILE = os.path.join(STUDIO_DATA_DIR, 'characters_db.json')

# 앱 설정 파일
APP_SETTINGS_FILE = os.path.join(STUDIO_DATA_DIR, 'app_settings.json')

# 음성 설정 파일 (프로젝트 루트)
VOICES_CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'voices_config.json')

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


# ========== 캐릭터 데이터베이스 API ==========

@eel.expose
def studio_load_characters_db():
    """캐릭터 데이터베이스 로드"""
    try:
        db = studio_load_json_file(STUDIO_CHARACTERS_DB_FILE)
        # 구조: { "캐릭터명": { "voice": "...", "speed": 1.0, "pitch": 0, "volume": 100, "emotion": "neutral" } }
        return {'success': True, 'characters': db}
    except Exception as e:
        print(f"[RoyStudio] 캐릭터 DB 로드 오류: {e}")
        return {'success': False, 'error': str(e), 'characters': {}}


@eel.expose
def studio_save_character_to_db(character_data):
    """캐릭터를 데이터베이스에 저장

    Args:
        character_data: { 'name': '캐릭터명', 'voice': '...', 'speed': 1.0, 'pitch': 0, 'volume': 100 }
    """
    try:
        db = studio_load_json_file(STUDIO_CHARACTERS_DB_FILE)

        name = character_data.get('name')
        if not name or name.strip() == '':
            return {'success': False, 'error': '유효하지 않은 캐릭터 이름입니다.'}

        # 캐릭터 정보 저장 (name 제외)
        db[name] = {
            'voice': character_data.get('voice', 'ko-KR-Wavenet-A'),
            'speed': character_data.get('speed', 1.0),
            'pitch': character_data.get('pitch', 0),
            'postSpeed': character_data.get('postSpeed', 1.0),  # MP3 후처리 속도
            'volume': character_data.get('volume', 100),
            'color': character_data.get('color')  # 캐릭터 색상
        }

        studio_save_json_file(STUDIO_CHARACTERS_DB_FILE, db)
        print(f"[RoyStudio] 캐릭터 '{name}' 데이터베이스에 저장됨")

        return {'success': True, 'message': f"'{name}' 저장됨"}
    except Exception as e:
        print(f"[RoyStudio] 캐릭터 저장 오류: {e}")
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_check_new_characters(detected_characters):
    """발견된 캐릭터 중 신규 캐릭터 확인

    Args:
        detected_characters: ['캐릭터1', '캐릭터2', ...]

    Returns:
        {
            'newCharacters': ['신규1', '신규2'],
            'existingCharacters': {'캐릭터명': {...설정...}},
            'voiceGroups': {'voice_key': ['캐릭터1', '캐릭터2']}  # 동일 음성 설정 그룹
        }
    """
    try:
        db = studio_load_json_file(STUDIO_CHARACTERS_DB_FILE)

        new_characters = []
        existing_characters = {}

        for char_name in detected_characters:
            if char_name in db:
                # 기존 캐릭터
                existing_characters[char_name] = db[char_name]
            else:
                # 신규 캐릭터
                new_characters.append(char_name)

        # 동일한 음성 설정을 가진 캐릭터 그룹 찾기
        voice_groups = {}
        for char_name, settings in existing_characters.items():
            # 음성 설정의 고유 키 생성 (voice, speed, pitch를 조합)
            voice_key = f"{settings['voice']}_{settings['speed']}_{settings['pitch']}"
            if voice_key not in voice_groups:
                voice_groups[voice_key] = []
            voice_groups[voice_key].append(char_name)

        # 2개 이상인 그룹만 반환
        voice_groups = {k: v for k, v in voice_groups.items() if len(v) >= 2}

        print(f"[RoyStudio] 신규 캐릭터: {new_characters}")
        print(f"[RoyStudio] 기존 캐릭터: {list(existing_characters.keys())}")
        print(f"[RoyStudio] 동일 음성 그룹: {voice_groups}")

        return {
            'success': True,
            'newCharacters': new_characters,
            'existingCharacters': existing_characters,
            'voiceGroups': voice_groups
        }
    except Exception as e:
        print(f"[RoyStudio] 캐릭터 확인 오류: {e}")
        return {
            'success': False,
            'error': str(e),
            'newCharacters': [],
            'existingCharacters': {},
            'voiceGroups': {}
        }


@eel.expose
def studio_get_all_characters():
    """데이터베이스의 모든 캐릭터 조회"""
    try:
        db = studio_load_json_file(STUDIO_CHARACTERS_DB_FILE)
        print(f"[RoyStudio] 전체 캐릭터 조회: {len(db)}개")
        return {'success': True, 'characters': db}
    except Exception as e:
        print(f"[RoyStudio] 캐릭터 조회 오류: {e}")
        return {'success': False, 'error': str(e), 'characters': {}}


@eel.expose
def get_voices_config():
    """음성 설정 파일에서 전체 음성 목록 조회"""
    try:
        if os.path.exists(VOICES_CONFIG_FILE):
            with open(VOICES_CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
                voices = config.get('voices', [])
                print(f"[RoyStudio] 음성 목록 로드: {len(voices)}개")
                return {'success': True, 'voices': voices}
        else:
            print(f"[RoyStudio] 음성 설정 파일 없음: {VOICES_CONFIG_FILE}")
            return {'success': False, 'error': '음성 설정 파일을 찾을 수 없습니다.', 'voices': []}
    except Exception as e:
        print(f"[RoyStudio] 음성 설정 로드 오류: {e}")
        return {'success': False, 'error': str(e), 'voices': []}


@eel.expose
def studio_delete_character_from_db(character_name):
    """캐릭터 데이터베이스에서 삭제"""
    try:
        db = studio_load_json_file(STUDIO_CHARACTERS_DB_FILE)
        if character_name in db:
            del db[character_name]
            studio_save_json_file(STUDIO_CHARACTERS_DB_FILE, db)
            print(f"[RoyStudio] 캐릭터 '{character_name}' 삭제됨")
            return {'success': True, 'message': f"'{character_name}' 삭제됨"}
        return {'success': False, 'error': '캐릭터를 찾을 수 없습니다.'}
    except Exception as e:
        print(f"[RoyStudio] 캐릭터 삭제 오류: {e}")
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


@eel.expose
def studio_preview_character_voice(character_data):
    """캐릭터 음성 미리듣기"""
    if not STUDIO_MODULES_LOADED:
        return {'success': False, 'error': '핵심 모듈이 로드되지 않았습니다.'}

    try:
        import base64
        import tempfile

        # 프로필 이름 가져오기 (첫 번째 프로필 사용)
        profiles = studio_get_profiles()
        profile_name = profiles[0] if profiles else 'default'

        # 테스트 텍스트
        test_text = "안녕하세요. 이 음성으로 TTS를 생성합니다."

        voice_name = character_data.get('voice', 'ko-KR-Wavenet-A')
        speed = character_data.get('speed', 1.0)
        pitch = character_data.get('pitch', 0)

        audio_bytes = services.synthesize_tts_bytes(
            profile_name=profile_name,
            text=test_text,
            api_voice=voice_name,
            rate=speed,
            pitch=pitch
        )

        if audio_bytes:
            # Base64로 인코딩하여 브라우저에서 직접 재생
            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
            return {'success': True, 'audioData': audio_base64}
        else:
            return {'success': False, 'error': 'TTS 생성 실패'}

    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def studio_preview_sentence(sentence_data, character_data):
    """문장 미리듣기"""
    if not STUDIO_MODULES_LOADED:
        return {'success': False, 'error': '핵심 모듈이 로드되지 않았습니다.'}

    try:
        import base64
        import re

        # 프로필 이름 가져오기
        profiles = studio_get_profiles()
        profile_name = profiles[0] if profiles else 'default'

        text = sentence_data.get('text', '')
        voice_name = character_data.get('voice', 'ko-KR-Wavenet-A')
        speed = character_data.get('speed', 1.0)
        pitch = character_data.get('pitch', 0)

        # HTML 태그 제거 (<br> 등)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = text.strip()

        if not text:
            return {'success': False, 'error': '텍스트가 없습니다.'}

        audio_bytes = services.synthesize_tts_bytes(
            profile_name=profile_name,
            text=text,
            api_voice=voice_name,
            rate=speed,
            pitch=pitch
        )

        if audio_bytes:
            # Base64로 인코딩하여 브라우저에서 직접 재생
            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
            return {'success': True, 'audioData': audio_base64}
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
def get_file_as_base64(file_path):
    """파일을 base64로 인코딩하여 반환 (이미지 미리보기용)"""
    try:
        import base64
        from pathlib import Path

        if not os.path.exists(file_path):
            return {'success': False, 'error': '파일을 찾을 수 없습니다.'}

        # 파일 확장자 확인
        ext = Path(file_path).suffix.lower()

        # 이미지 파일만 처리
        if ext not in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']:
            return {'success': False, 'error': '지원하지 않는 파일 형식입니다.'}

        with open(file_path, 'rb') as f:
            file_data = f.read()
            base64_data = base64.b64encode(file_data).decode('utf-8')

        return {'success': True, 'data': base64_data}

    except Exception as e:
        print(f"[ERROR] get_file_as_base64 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def open_file_with_default_app(file_path):
    """기본 앱으로 파일 열기 (오디오 미리듣기용)"""
    try:
        import subprocess
        import platform

        if not os.path.exists(file_path):
            return {'success': False, 'error': '파일을 찾을 수 없습니다.'}

        system = platform.system()

        if system == 'Windows':
            os.startfile(file_path)
        elif system == 'Darwin':  # macOS
            subprocess.run(['open', file_path])
        else:  # Linux
            subprocess.run(['xdg-open', file_path])

        return {'success': True}

    except Exception as e:
        print(f"[ERROR] open_file_with_default_app 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


def insert_line_break(text, max_chars_per_line=15):
    """텍스트를 2줄로 나누고 \\n 삽입 (단어 단위 보존)

    Args:
        text: 분리할 텍스트 (15-30자)
        max_chars_per_line: 줄당 최대 글자 수 (기본 15자)

    Returns:
        \\n이 삽입된 텍스트 또는 None (분리 불가능한 경우)
    """
    if len(text) <= max_chars_per_line:
        return text

    words = text.split()

    # 단어가 없으면 (공백이 없는 긴 단어) 강제로 자르기
    if len(words) == 1:
        line1 = text[:max_chars_per_line]
        line2 = text[max_chars_per_line:]
    else:
        # 첫 줄을 채울 수 있는 최대 지점 찾기 (단어 단위 보존)
        line1 = ""
        best_split = None

        for i in range(1, len(words) + 1):
            line1_test = ' '.join(words[:i])
            line2_test = ' '.join(words[i:]) if i < len(words) else ""

            # 첫 줄이 15자 이하이고, 두 번째 줄도 15자 이하인 경우
            if len(line1_test) <= max_chars_per_line:
                if not line2_test or len(line2_test) <= max_chars_per_line:
                    best_split = i  # 계속 갱신 (가장 마지막 유효한 지점 선택)

        # 최적 분리점이 있으면 사용
        if best_split is not None:
            line1 = ' '.join(words[:best_split])
            line2 = ' '.join(words[best_split:])

            # 첫 줄 끝 단어가 너무 짧으면 (3자 이하) 두 번째 줄로 이동
            if best_split > 1 and len(words[best_split - 1]) <= 3:
                # 마지막 단어를 두 번째 줄로 이동
                line1 = ' '.join(words[:best_split - 1])
                line2 = ' '.join(words[best_split - 1:])

                # 이동 후 첫 줄이 너무 짧아지면 원래대로 복원
                if len(line1) < 8:  # 최소 8자는 유지
                    line1 = ' '.join(words[:best_split])
                    line2 = ' '.join(words[best_split:])
        else:
            # 최적 분리점이 없으면 None 반환 (상위 함수에서 재분리)
            return None

    # 두 번째 줄이 너무 길면 None 반환 (상위 함수에서 재분리)
    if len(line2) > max_chars_per_line:
        return None

    return line1 + '\n' + line2


def split_long_sentence(text, max_chars_per_line=15, max_lines=2):
    """긴 문장을 2줄 이내로 분리하고 줄바꿈 삽입 (단어 단위 보존)

    Args:
        text: 분리할 문장
        max_chars_per_line: 줄당 최대 글자 수 (기본 15자)
        max_lines: 최대 줄 수 (기본 2줄)

    Returns:
        분리된 문장 리스트 (각 항목은 \\n으로 구분된 1-2줄)
    """
    total_max = max_chars_per_line * max_lines  # 30자

    # 전체 길이가 15자 이하면 1줄로 반환
    if len(text) <= max_chars_per_line:
        return [text]

    # 15자 초과 30자 이하: 쉼표 사용하지 않고 2줄로 분리
    if len(text) <= total_max:
        split_result = insert_line_break(text, max_chars_per_line)
        if split_result:
            return [split_result]
        # 분리 실패: 단어 단위로 분리
        return split_by_words(text, max_chars_per_line, total_max)

    # 30자 초과: 쉼표가 있는지 확인
    if ',' not in text:
        # 쉼표 없음: 단어 단위 분리
        return split_by_words(text, max_chars_per_line, total_max)

    # 쉼표가 있고 30자 초과: 쉼표로 분리하되, 나열인지 확인
    comma_parts = [p.strip() for p in text.split(',') if p.strip()]

    # 나열 항목 감지: 쉼표로 구분된 항목이 모두 짧으면 (5자 이하) 나열로 간주
    is_enumeration = all(len(part) <= 5 for part in comma_parts) and len(comma_parts) >= 3

    # 쉼표로 분리했을 때 너무 짧은 부분이 있는지 확인
    has_too_short_part = any(len(part) < 10 for part in comma_parts)

    if is_enumeration or has_too_short_part:
        # 나열이거나 너무 짧은 부분이 있으면: 쉼표로 나누지 말고 단어 단위로 분리
        return split_by_words(text, max_chars_per_line, total_max)

    # 일반 문장: 쉼표로 분리 (쉼표 보존)
    result = []
    for i, part in enumerate(comma_parts):
        # 마지막 항목이 아니면 쉼표 추가
        if i < len(comma_parts) - 1:
            part_with_comma = part + ','
        else:
            part_with_comma = part

        if len(part_with_comma) <= max_chars_per_line:
            # 15자 이하: 1줄
            result.append(part_with_comma)
        elif len(part_with_comma) <= total_max:
            # 15-30자: 2줄로 분리
            split_result = insert_line_break(part_with_comma, max_chars_per_line)
            if split_result:
                result.append(split_result)
            else:
                # 분리 실패: 단어 단위로 재분리
                sub_results = split_by_words(part_with_comma, max_chars_per_line, total_max)
                result.extend(sub_results)
        else:
            # 30자 초과: 단어 단위 분리
            sub_results = split_by_words(part_with_comma, max_chars_per_line, total_max)
            result.extend(sub_results)

    return result


def split_by_words(text, max_chars_per_line=15, total_max=30):
    """단어 단위로 텍스트 분리 (30자 초과 방지)"""
    words = text.split()
    result = []
    current = ""

    for word in words:
        test = (current + ' ' + word) if current else word

        # 30자를 초과하지 않으면 계속 누적
        if len(test.replace('\n', '')) <= total_max:
            current = test
        else:
            # 현재까지 누적된 것을 저장
            if current:
                # 15자 초과면 2줄로 분리 시도
                if len(current.replace('\n', '')) > max_chars_per_line:
                    split_result = insert_line_break(current, max_chars_per_line)
                    if split_result:
                        result.append(split_result)
                    else:
                        # 분리 불가능: 강제로 15자씩 자르기
                        result.append(current[:max_chars_per_line] + '\n' + current[max_chars_per_line:total_max])
                        if len(current) > total_max:
                            # 30자 초과 부분은 다음 클립으로
                            current = current[total_max:]
                            continue
                else:
                    result.append(current)
            # 새로운 클립 시작
            current = word

    # 마지막 누적분 처리
    if current:
        if len(current.replace('\n', '')) > max_chars_per_line:
            split_result = insert_line_break(current, max_chars_per_line)
            if split_result:
                result.append(split_result)
            else:
                # 분리 불가능: 강제로 15자씩 자르기
                result.append(current[:max_chars_per_line] + '\n' + current[max_chars_per_line:total_max])
        else:
            result.append(current)

    return result


def smart_split_sentences(text, max_chars_per_line=15, max_lines=2, min_chars=10):
    """문장 단위로 분리 (TTS용)

    Args:
        text: 분리할 텍스트
        max_chars_per_line: 사용 안 함 (하위 호환성을 위해 유지)
        max_lines: 사용 안 함 (하위 호환성을 위해 유지)
        min_chars: 사용 안 함 (하위 호환성을 위해 유지)

    Returns:
        분리된 문장 리스트 (마침표, 물음표, 느낌표 기준)
    """
    import re

    # 문장 단위로 분리 (마침표, 물음표, 느낌표 기준)
    # 한글 및 영문 구두점 모두 지원
    sentence_pattern = re.compile(r'([.!?。!?]+)')

    # 구두점으로 분리
    parts = sentence_pattern.split(text)

    # 텍스트와 구두점을 다시 합치기
    sentences = []
    for i in range(0, len(parts)-1, 2):
        text_part = parts[i].strip()
        punct = parts[i+1] if i+1 < len(parts) else ''
        if text_part:
            sentences.append(text_part + punct)

    # 마지막 부분 처리 (구두점 없이 끝나는 경우)
    if len(parts) % 2 == 1 and parts[-1].strip():
        sentences.append(parts[-1].strip())

    return sentences


def format_subtitle_two_lines(text, line_max=15):
    """자막 텍스트를 두 줄로 포맷팅

    Args:
        text: 자막 텍스트 (최대 30자)
        line_max: 한 줄당 최대 글자 수 (기본 15자)

    Returns:
        두 줄로 포맷된 텍스트 (줄바꿈 포함)
    """
    text = text.strip()

    # 15자 이하면 한 줄로
    if len(text) <= line_max:
        return text

    # 중간 지점 찾기
    mid = len(text) // 2

    # 중간 근처에서 공백이나 쉼표 찾기 (자연스러운 줄바꿈)
    best_break = mid
    for offset in range(min(5, mid)):  # 중간에서 ±5자 범위에서 탐색
        # 중간 오른쪽 탐색
        if mid + offset < len(text) and text[mid + offset] in ' ,':
            best_break = mid + offset + 1
            break
        # 중간 왼쪽 탐색
        if mid - offset > 0 and text[mid - offset] in ' ,':
            best_break = mid - offset + 1
            break

    line1 = text[:best_break].strip()
    line2 = text[best_break:].strip()

    # 둘 다 내용이 있으면 두 줄, 아니면 한 줄
    if line1 and line2:
        return f"{line1}\n{line2}"
    return text


def split_text_for_subtitle(text, max_length=30):
    """자막 표시용으로 텍스트를 자연스럽게 분할

    분할 우선순위:
    1. 쉼표(,) - 가장 자연스러운 끊김
    2. 조사 뒤 (~은, ~는, ~이, ~가, ~를, ~에서 등)
    3. 연결어미 뒤 (~고, ~며, ~면, ~서 등)
    4. 공백 - 위 조건 없을 때

    Args:
        text: 분할할 텍스트
        max_length: 최대 글자 수 (기본 30자)

    Returns:
        분할된 텍스트 리스트
    """
    import re

    text = text.strip()
    if len(text) <= max_length:
        return [text]

    clips = []

    # 1단계: 쉼표로 먼저 분할 시도 (나열이 아닌 경우)
    if ',' in text:
        comma_parts = text.split(',')
        # 나열인지 확인 (쉼표 사이 평균 길이가 짧으면 나열)
        if len(comma_parts) >= 3:
            avg_len = sum(len(p.strip()) for p in comma_parts[:-1]) / (len(comma_parts) - 1)
            is_enumeration = avg_len < 6  # 평균 6자 미만이면 나열로 판단
        else:
            is_enumeration = False

        # 나열이 아니면 쉼표에서 분할
        if not is_enumeration and len(comma_parts) >= 2:
            temp_clips = []
            for i, part in enumerate(comma_parts):
                part = part.strip()
                if i < len(comma_parts) - 1:
                    part += ','  # 쉼표 유지
                if part:
                    temp_clips.append(part)

            # 쉼표로 나눈 각 부분이 max_length 이하인지 확인
            all_fit = all(len(p) <= max_length for p in temp_clips)
            if all_fit:
                return temp_clips
            else:
                # 쉼표로 나눈 부분들을 다시 처리
                for part in temp_clips:
                    if len(part) <= max_length:
                        clips.append(part)
                    else:
                        # 긴 부분은 추가 분할
                        clips.extend(_split_by_grammar(part, max_length))
                return clips if clips else [text]

    # 2단계: 문법 기반 분할
    return _split_by_grammar(text, max_length)


def _split_by_grammar(text, max_length=30):
    """문법 기반으로 텍스트 분할

    조사와 연결어미를 기준으로 자연스럽게 분할
    """
    import re

    text = text.strip()
    if len(text) <= max_length:
        return [text]

    clips = []
    remaining = text

    # 분할 지점 패턴 (우선순위 순)
    # 1. 조사 뒤 (~은, ~는, ~이, ~가, ~를, ~에서, ~에게, ~으로, ~와, ~과)
    # 2. 연결어미 뒤 (~고, ~며, ~면, ~서, ~니, ~지만, ~는데, ~어서, ~아서)
    break_patterns = [
        r'(은|는|이|가|을|를|에서|에게|으로|로|와|과|의|도|만|부터|까지|처럼|같이)\s',  # 조사 + 공백
        r'(하고|되고|고|며|면|서|니|지만|는데|어서|아서|으며|으면)\s',  # 연결어미 + 공백
        r'(합니다|입니다|됩니다|습니다|있다|없다|했다|됐다)[,.]?\s',  # 문장 종결 + 공백
    ]

    while len(remaining) > max_length:
        best_break = -1
        best_priority = 999

        # max_length 범위 내에서 분할 지점 찾기
        search_range = remaining[:max_length + 10]  # 약간 여유 있게 탐색

        for priority, pattern in enumerate(break_patterns):
            matches = list(re.finditer(pattern, search_range))
            for match in reversed(matches):  # 뒤에서부터 찾기
                end_pos = match.end()
                if end_pos <= max_length and end_pos > best_break:
                    # 너무 짧은 분할은 피함 (최소 10자)
                    if end_pos >= 10 or best_break == -1:
                        best_break = end_pos
                        best_priority = priority
                        break
            if best_break > 0 and best_priority == priority:
                break

        # 패턴을 못 찾으면 공백에서 분할
        if best_break <= 0:
            # max_length 근처의 공백 찾기
            for i in range(min(max_length, len(remaining)) - 1, max(0, max_length - 15), -1):
                if remaining[i] == ' ':
                    best_break = i + 1
                    break

        # 그래도 못 찾으면 강제 분할
        if best_break <= 0:
            best_break = max_length

        clip = remaining[:best_break].strip()
        if clip:
            clips.append(clip)
        remaining = remaining[best_break:].strip()

    # 남은 텍스트 추가
    if remaining:
        clips.append(remaining)

    return clips if clips else [text]


def match_subtitle_with_word_timestamps(subtitle_clips, word_timestamps):
    """자막 클립과 Whisper word timestamps 매칭

    Whisper가 인식한 단어들을 순차적으로 클립 텍스트와 매칭하여
    각 클립의 시작/종료 시간을 정확하게 찾습니다.

    Args:
        subtitle_clips: 자막 클립 리스트 [{'text': str, 'character': str}, ...]
        word_timestamps: Whisper word timestamps [{'word': str, 'start': float, 'end': float}, ...]

    Returns:
        타임코드가 추가된 자막 클립 리스트
    """
    import re

    if not word_timestamps:
        print("[RoyStudio] ⚠️ Whisper 단어 타임스탬프가 없습니다.")
        return subtitle_clips

    print(f"[RoyStudio] 타임코드 매칭 시작: {len(subtitle_clips)}개 클립, {len(word_timestamps)}개 단어")

    # 텍스트 정규화 함수 (공백, 특수문자, 구두점 제거)
    def normalize(text):
        if not text:
            return ''
        # 공백, 구두점, 특수문자 제거
        return re.sub(r'[\s,\.!?\-\'"…""''·:;~()（）\[\]「」『』]', '', text).lower()

    # Whisper 인식 텍스트 전체를 하나로 합침
    whisper_full_text = ''.join(normalize(w['word']) for w in word_timestamps)

    # 각 단어의 누적 글자 위치 계산 (정규화된 텍스트 기준)
    word_char_positions = []  # [(start_char_idx, end_char_idx, start_time, end_time), ...]
    char_idx = 0
    for w in word_timestamps:
        word_norm = normalize(w['word'])
        word_len = len(word_norm)
        if word_len > 0:
            word_char_positions.append({
                'start_char': char_idx,
                'end_char': char_idx + word_len,
                'start_time': w['start'],
                'end_time': w['end'],
                'word': w['word']
            })
            char_idx += word_len

    total_whisper_chars = char_idx
    print(f"[RoyStudio]   Whisper 인식 텍스트: {total_whisper_chars}자")

    # 클립 텍스트도 전체를 하나로 합침
    clip_full_text = ''.join(normalize(c.get('text', '')) for c in subtitle_clips)
    total_clip_chars = len(clip_full_text)
    print(f"[RoyStudio]   원본 클립 텍스트: {total_clip_chars}자")

    # 누적 클립 글자 수를 Whisper 글자 위치에 매핑
    cumulative_clip_chars = 0

    for idx, clip in enumerate(subtitle_clips):
        clip_text = clip.get('text', '')
        clip_norm = normalize(clip_text)
        clip_len = len(clip_norm)

        if clip_len == 0:
            # 빈 클립 처리
            if idx > 0:
                prev_end = subtitle_clips[idx-1].get('endTime', '00:00:00.000')
                clip['startTime'] = prev_end
                clip['endTime'] = prev_end
            else:
                clip['startTime'] = format_time(word_timestamps[0]['start'])
                clip['endTime'] = format_time(word_timestamps[0]['start'])
            continue

        # 클립 시작 위치 (Whisper 텍스트 기준으로 환산)
        clip_start_ratio = cumulative_clip_chars / total_clip_chars if total_clip_chars > 0 else 0
        whisper_start_char = int(clip_start_ratio * total_whisper_chars)

        # 클립 종료 위치
        cumulative_clip_chars += clip_len
        clip_end_ratio = cumulative_clip_chars / total_clip_chars if total_clip_chars > 0 else 1
        whisper_end_char = int(clip_end_ratio * total_whisper_chars)

        # 해당 글자 범위에 속하는 단어들 찾기
        start_time = None
        end_time = None

        for wp in word_char_positions:
            # 이 단어가 클립 범위와 겹치는지 확인
            if wp['end_char'] > whisper_start_char and wp['start_char'] < whisper_end_char:
                if start_time is None:
                    start_time = wp['start_time']
                end_time = wp['end_time']

        # 매칭 실패 시 이전/다음 클립 기준으로 추정
        if start_time is None or end_time is None:
            if idx > 0 and 'endTime' in subtitle_clips[idx-1]:
                prev_end_str = subtitle_clips[idx-1]['endTime']
                start_time = time_to_seconds(prev_end_str)
                # 글자 수 기반 추정 시간 (1글자당 약 0.15초)
                end_time = start_time + (clip_len * 0.15)
            else:
                start_time = 0
                end_time = clip_len * 0.15

        clip['startTime'] = format_time(start_time)
        clip['endTime'] = format_time(end_time)
        clip['_start_sec'] = start_time  # 임시 저장 (보정용)
        clip['_end_sec'] = end_time

    # 타임코드 순차 보정: 이전 클립보다 시작이 빠르면 조정
    print(f"[RoyStudio] 타임코드 순차 보정 중...")
    corrections = 0
    for idx, clip in enumerate(subtitle_clips):
        if idx == 0:
            continue

        prev_clip = subtitle_clips[idx - 1]
        prev_end = prev_clip.get('_end_sec', 0)
        curr_start = clip.get('_start_sec', 0)
        curr_end = clip.get('_end_sec', 0)

        # 현재 클립 시작이 이전 클립 종료보다 빠르면 보정
        if curr_start < prev_end:
            corrections += 1
            # 이전 클립 종료 시간으로 시작 조정
            new_start = prev_end
            # 종료 시간도 비례해서 조정 (최소 0.5초 보장)
            duration = max(curr_end - curr_start, 0.5)
            new_end = new_start + duration

            clip['startTime'] = format_time(new_start)
            clip['endTime'] = format_time(new_end)
            clip['_start_sec'] = new_start
            clip['_end_sec'] = new_end

    # 임시 키 제거
    for clip in subtitle_clips:
        clip.pop('_start_sec', None)
        clip.pop('_end_sec', None)

    # 디버그 로그
    print(f"[RoyStudio]   → {corrections}개 클립 타임코드 보정됨")
    for idx, clip in enumerate(subtitle_clips[:5]):
        print(f"[RoyStudio]   클립 {idx+1}: {clip['startTime']} ~ {clip['endTime']} '{clip.get('text', '')[:25]}...'")

    print(f"[RoyStudio] 타임코드 매칭 완료")
    return subtitle_clips


@eel.expose
def load_script_for_studio(file_path):
    """대본 파일을 로드하고 문장 단위로 분석"""
    try:
        from pathlib import Path

        if not os.path.exists(file_path):
            return {'success': False, 'error': '파일을 찾을 수 없습니다.'}

        ext = Path(file_path).suffix.lower()

        # TXT 파일 처리
        if ext == '.txt':
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()

        # DOCX 파일 처리
        elif ext == '.docx':
            try:
                from docx import Document
                doc = Document(file_path)
                content = '\n'.join([para.text for para in doc.paragraphs])
            except ImportError:
                return {'success': False, 'error': 'python-docx 모듈이 설치되어 있지 않습니다.'}
        else:
            return {'success': False, 'error': '지원하지 않는 파일 형식입니다.'}

        # 특수기호 정리: 마침표, 쉼표, 물음표, 느낌표, 대괄호만 유지
        import re
        # 한글, 영문, 숫자, 공백, 줄바꿈, 그리고 허용된 문장부호만 남기기
        # 대괄호[]는 캐릭터명 표시에 사용되므로 유지
        allowed_chars = re.compile(r'[^가-힣a-zA-Z0-9\s\n.,!?。、！？\[\]]')
        content = allowed_chars.sub('', content)

        # 스마트 문장 분리 (줄당 15자, 최대 2줄, 최소 10자)
        # 먼저 줄바꿈으로 문단 분리
        paragraphs = content.strip().split('\n')

        all_sentences = []
        sentence_characters = []  # 각 문장의 캐릭터명 저장

        import re
        character_pattern = re.compile(r'^\[([^\]]+)\]\s*(.+)$')  # [캐릭터명] 텍스트

        current_character = '나레이션'  # 현재 캐릭터 (기본값: 나레이션)
        has_any_character = False  # 대본에 캐릭터가 하나라도 있는지 확인

        # 1차 패스: 캐릭터가 있는지 확인
        for para in paragraphs:
            para = para.strip()
            if para:
                match = character_pattern.match(para)
                if match:
                    has_any_character = True
                    break

        # 2차 패스: 실제 문장 분리
        for para in paragraphs:
            para = para.strip()
            if para:  # 빈 줄 제외
                # 캐릭터명 추출
                match = character_pattern.match(para)
                if match:
                    character_name = match.group(1).strip()
                    # '나레이터'를 '나레이션'으로 통일
                    if character_name == '나레이터':
                        character_name = '나레이션'
                    text_content = match.group(2).strip()
                    current_character = character_name  # 현재 캐릭터 업데이트
                else:
                    # 캐릭터명 표시가 없는 경우
                    if has_any_character:
                        # 대본에 캐릭터가 있으면 이전 캐릭터 유지
                        character_name = current_character
                    else:
                        # 대본에 캐릭터가 없으면 나레이션
                        character_name = '나레이션'
                    text_content = para

                # 각 문단을 문장 단위로 분리 (마침표, 물음표, 느낌표 기준)
                para_sentences = smart_split_sentences(text_content)

                # 분리된 모든 문장에 같은 캐릭터명 적용
                for sentence in para_sentences:
                    all_sentences.append(sentence)
                    sentence_characters.append(character_name)

        # 문장 객체 생성
        sentences = []
        detected_characters = set()  # 발견된 캐릭터명 수집

        for idx, (text, character) in enumerate(zip(all_sentences, sentence_characters)):
            # 앞뒤 따옴표 제거
            text = text.strip()
            if text.startswith('"') and text.endswith('"'):
                text = text[1:-1].strip()
            elif text.startswith('"') and text.endswith('"'):
                text = text[1:-1].strip()

            # 빈 문장 제외 (빈 따옴표 "" 제거됨)
            if text:
                sentences.append({
                    'id': idx + 1,
                    'text': text,
                    'character': character,
                    'startTime': None,  # 타임코드는 나중에 계산
                    'endTime': None,
                    'duration': None
                })
                detected_characters.add(character)

        print(f"[RoyStudio] 대본 분석 완료: {len(sentences)}개 문장 클립 생성")
        print(f"[RoyStudio] 클립당 평균 글자 수: {sum(len(s['text']) for s in sentences) / len(sentences):.1f}자")
        print(f"[RoyStudio] 발견된 캐릭터: {', '.join(sorted(detected_characters))}")

        return {
            'success': True,
            'sentences': sentences,
            'detectedCharacters': sorted(list(detected_characters))
        }

    except Exception as e:
        print(f"[ERROR] load_script_for_studio 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e)}

@eel.expose
def calculate_timecode_and_generate_mp3(generate_data):
    """타임코드 계산 및 MP3 생성 (Whisper 기반)

    1. 각 문장의 TTS 생성 (자연스러운 음성)
    2. 모든 음성을 합쳐서 최종 MP3 생성
    3. Whisper로 MP3 분석 → word-level timestamps 추출
    4. 글자 수 제한으로 자막 클립 재분할
    5. Word timestamps와 자막 클립 매칭 → SRT 생성
    """
    try:
        import tempfile
        import shutil
        from pydub import AudioSegment

        print("[RoyStudio] 타임코드 계산 및 MP3 생성 시작...")

        sentences = generate_data.get('sentences', [])
        characters = generate_data.get('characters', [])  # 캐릭터 정보
        output_path = generate_data.get('outputPath', '')

        if not sentences:
            return {'success': False, 'error': '문장 데이터가 없습니다.'}

        # 캐릭터 이름으로 빠르게 찾기 위한 딕셔너리 생성
        character_map = {char['name']: char for char in characters}

        # 임시 디렉토리 생성
        temp_dir = tempfile.mkdtemp(prefix='roystudio_')
        print(f"[RoyStudio] 임시 디렉토리: {temp_dir}")

        try:
            from concurrent.futures import ThreadPoolExecutor, as_completed
            import time

            SILENCE_DURATION_SEC = 0.15  # 문장 사이 침묵 시간 (초)
            MAX_CONCURRENT_TTS = 5  # 동시 TTS 생성 수 (Google API 제한 고려)

            # 1단계: 각 문장 TTS 생성 (병렬 처리)
            print(f"[RoyStudio] 1단계: {len(sentences)}개 문장 TTS 생성 중... (동시 {MAX_CONCURRENT_TTS}개)")

            # TTS 생성 작업 정의
            def generate_single_tts(idx, sentence):
                """단일 TTS 생성 작업"""
                clip_text = sentence.get('text', '')
                character_name = sentence.get('character', '나레이션')

                if not clip_text:
                    return idx, None, 0

                # 해당 문장의 캐릭터 정보 가져오기
                character = character_map.get(character_name)

                if character:
                    voice = character.get('voice', 'ko-KR-Wavenet-A')
                    speed = character.get('speed', 1.0)
                    pitch = character.get('pitch', 0.0)
                    post_speed = character.get('postSpeed', 1.0)
                else:
                    voice = 'ko-KR-Wavenet-A'
                    speed = 1.0
                    pitch = 0.0
                    post_speed = 1.0

                is_chirp3_hd = 'Chirp3-HD' in voice

                try:
                    # TTS 생성
                    if is_chirp3_hd:
                        audio_bytes = services.synthesize_tts_bytes(
                            profile_name='Google',
                            text=clip_text,
                            api_voice=voice,
                            rate=1.0,
                            pitch=0.0
                        )
                    else:
                        audio_bytes = services.synthesize_tts_bytes(
                            profile_name='Google',
                            text=clip_text,
                            api_voice=voice,
                            rate=speed,
                            pitch=pitch
                        )

                    if audio_bytes:
                        # 임시 파일로 저장
                        temp_audio_path = os.path.join(temp_dir, f'clip_{idx}.mp3')
                        with open(temp_audio_path, 'wb') as f:
                            f.write(audio_bytes)

                        # Chirp3-HD 후처리 속도 변환
                        if is_chirp3_hd and post_speed != 1.0:
                            temp_audio_processed = os.path.join(temp_dir, f'clip_{idx}_speed.mp3')
                            if apply_audio_speed_ffmpeg(temp_audio_path, temp_audio_processed, post_speed):
                                temp_audio_path = temp_audio_processed

                        # AudioSegment로 로드
                        audio_segment = AudioSegment.from_mp3(temp_audio_path)
                        clip_duration = len(audio_segment) / 1000.0

                        return idx, audio_segment, clip_duration
                    else:
                        return idx, None, 0
                except Exception as e:
                    print(f"[RoyStudio] TTS 생성 오류 (클립 {idx}): {e}")
                    return idx, None, 0

            # 병렬 TTS 생성
            audio_results = {}
            completed_count = 0
            total_count = len(sentences)

            with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_TTS) as executor:
                # 모든 작업 제출
                futures = {
                    executor.submit(generate_single_tts, idx, sentence): idx
                    for idx, sentence in enumerate(sentences)
                }

                # 완료되는 순서대로 결과 수집
                for future in as_completed(futures):
                    idx, audio_segment, duration = future.result()
                    completed_count += 1

                    if audio_segment:
                        audio_results[idx] = audio_segment
                        print(f"[RoyStudio] [{completed_count}/{total_count}] 클립 {idx+1} 완료 ({duration:.2f}초)")
                    else:
                        print(f"[RoyStudio] [{completed_count}/{total_count}] 클립 {idx+1} 실패")

                    # 진행률 업데이트 (프론트엔드로 전송)
                    progress = int((completed_count / total_count) * 50)  # TTS 생성은 전체의 50%
                    try:
                        eel.updateProgress(progress, f'TTS 생성 중... ({completed_count}/{total_count})')
                    except:
                        pass  # eel 호출 실패 무시

            # 순서대로 정렬하여 audio_segments 생성
            audio_segments = []
            for idx in range(len(sentences)):
                if idx in audio_results:
                    audio_segments.append(audio_results[idx])

            if len(audio_segments) == 0:
                return {'success': False, 'error': 'TTS 생성 실패: 생성된 음성이 없습니다.'}

            print(f"[RoyStudio] TTS 생성 완료: {len(audio_segments)}개 성공")

            # 진행률 업데이트
            try:
                eel.updateProgress(55, '음성 파일 병합 중...')
            except:
                pass

            # 2단계: 모든 음성 합치기
            print(f"[RoyStudio] 2단계: {len(audio_segments)}개 음성 파일 병합 중...")

            if not audio_segments:
                return {'success': False, 'error': '생성된 음성이 없습니다.'}

            # 문장 사이 침묵(무음) 시간 (밀리초)
            SILENCE_DURATION_MS = 150
            silence = AudioSegment.silent(duration=SILENCE_DURATION_MS)

            # 음성 파일 병합 (문장 사이에 침묵 추가)
            final_audio = audio_segments[0]
            for audio in audio_segments[1:]:
                final_audio += silence
                final_audio += audio

            # 최종 MP3 저장
            final_audio.export(output_path, format='mp3', bitrate='192k')
            total_duration = len(final_audio) / 1000.0
            print(f"[RoyStudio] MP3 생성 완료: {output_path} ({total_duration:.2f}초)")

            # 진행률 업데이트
            try:
                eel.updateProgress(60, 'Whisper 음성 분석 중...')
            except:
                pass

            # 3단계: Whisper로 MP3 분석 (word-level timestamps)
            print(f"[RoyStudio] 3단계: Whisper로 MP3 분석 중...")

            try:
                import whisper
                print("[RoyStudio]   Whisper 모델 로딩 중...")
                whisper_model = whisper.load_model("tiny")  # tiny 모델 사용 (타임코드 추출용, 빠른 속도)

                print("[RoyStudio]   음성 인식 중... (시간이 걸릴 수 있습니다)")
                result = whisper_model.transcribe(
                    output_path,
                    language='ko',
                    word_timestamps=True,
                    verbose=False
                )

                segments = result.get('segments', [])
                print(f"[RoyStudio]   ✓ {len(segments)}개 세그먼트 감지됨")

                # Word-level timestamps 추출
                all_words = []
                for seg in segments:
                    for word_info in seg.get('words', []):
                        all_words.append({
                            'word': word_info.get('word', '').strip(),
                            'start': word_info.get('start', 0.0),
                            'end': word_info.get('end', 0.0)
                        })

                print(f"[RoyStudio]   ✓ {len(all_words)}개 단어 타임스탬프 추출됨")

            except ImportError:
                print("[RoyStudio]   ⚠️ Whisper가 설치되지 않았습니다. 기본 타임코드 사용")
                all_words = []
            except Exception as e:
                print(f"[RoyStudio]   ⚠️ Whisper 분석 실패: {e}. 기본 타임코드 사용")
                all_words = []

            # 진행률 업데이트
            try:
                eel.updateProgress(85, '자막 생성 중...')
            except:
                pass

            # 4단계: 자막 클립 재분할 (글자 수 제한 30자)
            print(f"[RoyStudio] 4단계: 자막 클립 재분할 중 (글자 수 제한 30자)...")

            subtitle_clips = []
            for sent in sentences:
                text = sent.get('text', '')
                character = sent.get('character', '나레이션')

                # 30자 단위로 문장 분할 (쉼표, 공백 고려)
                clips = split_text_for_subtitle(text, max_length=30)

                for clip_text in clips:
                    subtitle_clips.append({
                        'text': clip_text,
                        'character': character
                    })

            print(f"[RoyStudio]   ✓ {len(subtitle_clips)}개 자막 클립 생성됨")

            # 5단계: Word timestamps와 자막 클립 매칭
            print(f"[RoyStudio] 5단계: 타임코드 매칭 중...")

            if all_words:
                # Whisper 단어 타임스탬프를 자막 클립에 매칭
                subtitle_clips = match_subtitle_with_word_timestamps(subtitle_clips, all_words)
            else:
                # Whisper 실패 시 균등 분배
                time_per_clip = total_duration / len(subtitle_clips)
                for idx, clip in enumerate(subtitle_clips):
                    clip['startTime'] = format_time(idx * time_per_clip)
                    clip['endTime'] = format_time((idx + 1) * time_per_clip)

            # 6단계: SRT 자막 파일 생성
            srt_path = output_path.replace('MP3_', '자막_').replace('.mp3', '.srt')
            try:
                generate_srt_file(subtitle_clips, srt_path)
                print(f"[RoyStudio] SRT 자막 생성 완료: {srt_path}")
            except Exception as e:
                print(f"[RoyStudio] SRT 생성 오류: {e}")

            # 진행률 업데이트 - 완료
            try:
                eel.updateProgress(100, '완료!')
            except:
                pass

            print(f"[RoyStudio] 🎉 완료! 총 길이: {total_duration:.2f}초, 자막 클립: {len(subtitle_clips)}개")

            return {
                'success': True,
                'sentences': subtitle_clips,  # 재분할된 자막 클립 반환
                'totalDuration': total_duration,
                'outputPath': output_path,
                'srtPath': srt_path
            }

        finally:
            # 임시 디렉토리 정리
            try:
                shutil.rmtree(temp_dir)
                print(f"[RoyStudio] 임시 파일 정리 완료")
            except Exception as e:
                print(f"[RoyStudio] 임시 파일 정리 오류: {e}")

    except Exception as e:
        print(f"[ERROR] calculate_timecode_and_generate_mp3 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


def format_time(seconds):
    """초를 HH:MM:SS.mmm 형식으로 변환 (밀리초 포함)"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60  # 소수점 유지
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def format_srt_time(seconds):
    """초를 SRT 시간 형식으로 변환 (HH:MM:SS,mmm)"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


@eel.expose
def select_mp3_file():
    """MP3 파일 선택 다이얼로그"""
    try:
        import tkinter as tk
        from tkinter import filedialog

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

    except Exception as e:
        print(f"[RoyStudio] MP3 파일 선택 오류: {e}")
        return None


@eel.expose
def convert_mp3_to_srt(mp3_path):
    """MP3 파일을 Whisper로 분석하여 SRT 자막 파일 생성

    Args:
        mp3_path: MP3 파일 경로

    Returns:
        {'success': bool, 'srtPath': str, 'srtFileName': str, 'segmentCount': int, 'duration': float}
    """
    try:
        print(f"[RoyStudio] MP3 → SRT 변환 시작: {mp3_path}")

        if not os.path.exists(mp3_path):
            return {'success': False, 'error': '파일을 찾을 수 없습니다.'}

        # 진행률 업데이트
        try:
            eel.updateProgress(10, 'Whisper 모델 로딩 중...')
        except:
            pass

        # Whisper로 MP3 분석
        import whisper
        print("[RoyStudio] Whisper 모델 로딩 중...")
        whisper_model = whisper.load_model("tiny")  # tiny 모델 (타임코드 추출용)

        try:
            eel.updateProgress(30, 'MP3 음성 인식 중...')
        except:
            pass

        print("[RoyStudio] 음성 인식 중...")
        result = whisper_model.transcribe(
            mp3_path,
            language='ko',
            word_timestamps=True,
            verbose=False
        )

        segments = result.get('segments', [])
        print(f"[RoyStudio] {len(segments)}개 세그먼트 감지됨")

        if not segments:
            return {'success': False, 'error': '음성을 인식할 수 없습니다.'}

        try:
            eel.updateProgress(70, '자막 클립 생성 중...')
        except:
            pass

        # 세그먼트를 자막 클립으로 변환 (30자 단위 분할)
        subtitle_clips = []
        for seg in segments:
            seg_text = seg.get('text', '').strip()
            seg_start = seg.get('start', 0)
            seg_end = seg.get('end', 0)

            if not seg_text:
                continue

            # 30자 단위로 분할
            clips = split_text_for_subtitle(seg_text, max_length=30)

            if len(clips) == 1:
                # 분할 없이 그대로 사용
                subtitle_clips.append({
                    'text': seg_text,
                    'startTime': format_srt_time(seg_start),
                    'endTime': format_srt_time(seg_end)
                })
            else:
                # 분할된 경우 시간도 비례 분배
                seg_duration = seg_end - seg_start
                total_chars = sum(len(c) for c in clips)
                current_time = seg_start

                for clip_text in clips:
                    clip_ratio = len(clip_text) / total_chars if total_chars > 0 else 1
                    clip_duration = seg_duration * clip_ratio
                    clip_end = current_time + clip_duration

                    subtitle_clips.append({
                        'text': clip_text,
                        'startTime': format_srt_time(current_time),
                        'endTime': format_srt_time(clip_end)
                    })
                    current_time = clip_end

        print(f"[RoyStudio] {len(subtitle_clips)}개 자막 클립 생성됨")

        try:
            eel.updateProgress(90, 'SRT 파일 저장 중...')
        except:
            pass

        # SRT 파일 경로 (MP3와 같은 폴더, 같은 파일명)
        srt_path = os.path.splitext(mp3_path)[0] + '.srt'

        # SRT 파일 생성 (두 줄 포맷 적용)
        srt_content = []
        for idx, clip in enumerate(subtitle_clips):
            formatted_text = format_subtitle_two_lines(clip['text'])
            srt_entry = f"{idx + 1}\n{clip['startTime']} --> {clip['endTime']}\n{formatted_text}\n"
            srt_content.append(srt_entry)

        with open(srt_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(srt_content))

        # 총 길이 계산
        total_duration = segments[-1].get('end', 0) if segments else 0

        try:
            eel.updateProgress(100, '완료!')
        except:
            pass

        print(f"[RoyStudio] SRT 생성 완료: {srt_path}")

        return {
            'success': True,
            'srtPath': srt_path,
            'srtFileName': os.path.basename(srt_path),
            'segmentCount': len(subtitle_clips),
            'duration': total_duration
        }

    except ImportError:
        return {'success': False, 'error': 'Whisper가 설치되지 않았습니다.'}
    except Exception as e:
        print(f"[ERROR] MP3 → SRT 변환 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


def generate_srt_file(sentences, output_path):
    """SRT 자막 파일 생성

    Args:
        sentences: 문장 리스트 (각 문장은 startTime, endTime, text 포함)
        output_path: SRT 파일 저장 경로
    """
    srt_content = []

    for idx, sentence in enumerate(sentences):
        # 시간 문자열을 초로 변환
        start_time = sentence.get('startTime', '00:00:00')
        end_time = sentence.get('endTime', '00:00:00')
        text = sentence.get('text', '').strip()

        if not text:
            continue

        # HH:MM:SS 형식을 초로 변환
        start_seconds = time_to_seconds(start_time)
        end_seconds = time_to_seconds(end_time)

        # SRT 형식으로 변환
        srt_start = format_srt_time(start_seconds)
        srt_end = format_srt_time(end_seconds)

        # 자막을 두 줄로 포맷팅 (30자를 15자씩 두 줄로)
        formatted_text = format_subtitle_two_lines(text)

        # SRT 엔트리 생성
        srt_entry = f"{idx + 1}\n{srt_start} --> {srt_end}\n{formatted_text}\n"
        srt_content.append(srt_entry)

    # 파일 저장
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(srt_content))


def time_to_seconds(time_str):
    """HH:MM:SS 또는 HH:MM:SS.mmm 형식을 초로 변환"""
    try:
        parts = time_str.split(':')
        if len(parts) == 3:
            h, m, s = parts
            return int(h) * 3600 + int(m) * 60 + float(s)
        return 0.0
    except:
        return 0.0


@eel.expose
def generate_video_studio(generate_data):
    """영상 탭에서 영상 생성 (MP3 + 검은 배경 + 자막)

    Args:
        generate_data: {
            sentences: 문장 배열,
            characters: 캐릭터 배열 (음성 설정 포함),
            settings: 설정 (해상도, 출력폴더 등),
            outputPath: 출력 파일 경로
        }

    Returns:
        {'success': bool, 'error': str, 'outputPath': str}
    """
    try:
        import tempfile
        import shutil

        print("[RoyStudio] 영상 생성 시작...")

        sentences = generate_data.get('sentences', [])
        characters = generate_data.get('characters', [])
        settings = generate_data.get('settings', {})
        output_path = generate_data.get('outputPath', '')

        if not sentences:
            return {'success': False, 'error': '문장 데이터가 없습니다.'}

        if not output_path:
            return {'success': False, 'error': '출력 경로가 지정되지 않았습니다.'}

        # 캐릭터 맵 생성
        character_map = {char['name']: char for char in characters}

        # 출력 폴더 확인/생성
        output_dir = os.path.dirname(output_path)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        # 임시 MP3 경로
        temp_dir = tempfile.mkdtemp(prefix='roystudio_video_')
        temp_mp3_path = os.path.join(temp_dir, 'temp_audio.mp3')

        try:
            # 1단계: MP3 생성
            print("[RoyStudio] 1단계: MP3 음성 생성 중...")
            mp3_result = calculate_timecode_and_generate_mp3({
                'sentences': sentences,
                'characters': characters,
                'outputPath': temp_mp3_path
            })

            if not mp3_result.get('success'):
                return {'success': False, 'error': mp3_result.get('error', 'MP3 생성 실패')}

            total_duration = mp3_result.get('totalDuration', 0)
            subtitle_clips = mp3_result.get('sentences', [])  # 타임코드가 포함된 자막

            print(f"[RoyStudio] MP3 생성 완료: {total_duration:.2f}초")

            # 2단계: 검은 배경 영상 생성 + MP3 합성
            print("[RoyStudio] 2단계: 영상 생성 중...")

            # 해상도 설정
            resolution = settings.get('resolution', '1920x1080')
            width, height = map(int, resolution.split('x'))

            # 인코더 선택
            best_encoder = get_best_encoder()
            encoder_preset = get_encoder_preset(best_encoder)

            # FFmpeg 명령어 구성
            cmd = [
                'ffmpeg', '-y',
                # 검은 배경 영상 입력
                '-f', 'lavfi', '-i', f'color=c=black:s={width}x{height}:d={total_duration}:r=30',
                # MP3 오디오 입력
                '-i', temp_mp3_path,
                # 인코더 설정
                '-c:v', best_encoder,
                '-c:a', 'aac', '-b:a', '192k',
                # 시간 제한
                '-t', str(total_duration),
                # 출력 파일
                output_path
            ]

            # 프리셋 추가 (해당하는 경우)
            if encoder_preset:
                cmd.insert(-1, '-preset')
                cmd.insert(-1, encoder_preset)

            print(f"[RoyStudio] FFmpeg 실행: {' '.join(cmd[:10])}...")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600  # 10분 타임아웃
            )

            if result.returncode != 0:
                print(f"[ERROR] FFmpeg 오류: {result.stderr}")
                return {'success': False, 'error': f'영상 생성 실패: {result.stderr[:200]}'}

            # 3단계: SRT 자막 파일 저장
            srt_path = output_path.replace('.mp4', '.srt')
            if subtitle_clips:
                generate_srt_file(subtitle_clips, srt_path)
                print(f"[RoyStudio] SRT 생성 완료: {srt_path}")

            print(f"[RoyStudio] 영상 생성 완료: {output_path}")

            return {
                'success': True,
                'outputPath': output_path,
                'srtPath': srt_path,
                'totalDuration': total_duration
            }

        finally:
            # 임시 파일 정리
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                print(f"[RoyStudio] 임시 파일 정리 오류: {e}")

    except Exception as e:
        print(f"[ERROR] generate_video_studio 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


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
            char = clip.get('character', '나레이션')
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
                'character': clip.get('character', '나레이션'),
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

                                            # 두 줄 포맷 적용
                                            formatted_text = format_subtitle_two_lines(text)
                                            srt_content += f"{idx + 1}\n"
                                            srt_content += f"{format_srt_time(start_time)} --> {format_srt_time(end_time)}\n"
                                            srt_content += f"{formatted_text}\n\n"

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
        current_character = '나레이션'
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
        print("[RoyStudio] Whisper 분석 시작 (tiny 모델)...")

        try:
            import whisper

            model = whisper.load_model("tiny")  # tiny 모델 (타임코드 추출용)
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


# ============================================
# 배치 제작 함수들
# ============================================

@eel.expose
def batch_select_multiple_files():
    """배치 제작용 대본 파일 다중 선택 (경로 리스트 반환)"""
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)

        files = filedialog.askopenfilenames(
            title="대본 파일 선택 (다중 선택 가능)",
            filetypes=[
                ("텍스트 파일", "*.txt"),
                ("Word 문서", "*.docx"),
                ("모든 파일", "*.*")
            ]
        )

        root.destroy()

        if files:
            return list(files)  # 경로 리스트만 반환
        return []
    except Exception as e:
        print(f"[BatchProduction] 파일 선택 오류: {e}")
        return []


@eel.expose
def batch_process_script(params):
    """배치 제작: 단일 대본 처리

    Args:
        params: {
            scriptPath: 대본 파일 경로,
            settings: 배치 설정 (출력 형식, 음성 설정 등)
        }

    Returns:
        {'success': bool, 'sentenceCount': int, 'characterCount': int, ...}
    """
    try:
        script_path = params.get('scriptPath')
        settings = params.get('settings', {})

        print(f"[BatchProduction] 대본 처리 시작: {script_path}")

        # 1. 대본 파일 로드
        if not os.path.exists(script_path):
            return {'success': False, 'error': '파일을 찾을 수 없습니다.'}

        with open(script_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 2. 대본 분석 (캐릭터 추출)
        analysis = analyze_script_content(content)
        sentences = analysis.get('sentences', [])
        characters = analysis.get('characters', [])

        if not sentences:
            return {'success': False, 'error': '대본에서 문장을 찾을 수 없습니다.'}

        print(f"[BatchProduction] 분석 완료: {len(sentences)}문장, {len(characters)}캐릭터")

        # 3. 캐릭터별 음성 설정 (기본값 또는 저장된 설정)
        character_map = {}
        default_voice = settings.get('defaultVoice', 'ko-KR-Wavenet-D')
        default_speed = settings.get('defaultSpeed', 1.0)
        default_pitch = settings.get('defaultPitch', 0)
        default_post_speed = settings.get('defaultPostSpeed', 1.0)
        apply_post_speed_all = settings.get('applyPostSpeedToAll', False)

        for char_name in characters:
            char_settings = {
                'name': char_name,
                'voice': default_voice,
                'speed': default_speed,
                'pitch': default_pitch
            }

            # Chirp3-HD 모델인 경우 후처리 속도 설정
            if 'Chirp3-HD' in default_voice or apply_post_speed_all:
                char_settings['postSpeed'] = default_post_speed
            else:
                char_settings['postSpeed'] = 1.0

            character_map[char_name] = char_settings

        # 4. 출력 경로 결정
        output_location = settings.get('outputLocation', 'same')
        custom_folder = settings.get('customFolder', '')

        if output_location == 'custom' and custom_folder:
            output_dir = custom_folder
        else:
            output_dir = os.path.dirname(script_path)

        # 파일명 (확장자 제외)
        base_name = os.path.splitext(os.path.basename(script_path))[0]

        # 5. MP3 생성 (outputMP3 또는 outputVideo가 true인 경우)
        output_mp3 = settings.get('outputMP3', True)
        output_srt = settings.get('outputSRT', True)
        output_video = settings.get('outputVideo', False)

        result_data = {
            'success': True,
            'sentenceCount': len(sentences),
            'characterCount': len(characters),
            'outputs': []
        }

        if output_mp3 or output_video:
            mp3_path = os.path.join(output_dir, f'MP3_{base_name}.mp3')

            # 캐릭터 맵을 캐릭터 리스트로 변환 (calculate_timecode_and_generate_mp3 형식에 맞춤)
            characters_list = list(character_map.values())

            # TTS 생성 호출 (dict 파라미터로 전달)
            tts_result = calculate_timecode_and_generate_mp3({
                'sentences': sentences,
                'characters': characters_list,
                'outputPath': mp3_path
            })

            if tts_result.get('success'):
                result_data['mp3Path'] = mp3_path
                result_data['outputs'].append(mp3_path)
                result_data['totalDuration'] = tts_result.get('totalDuration', 0)

                if output_srt and tts_result.get('srtPath'):
                    result_data['srtPath'] = tts_result.get('srtPath')
                    result_data['outputs'].append(tts_result.get('srtPath'))

                print(f"[BatchProduction] MP3 생성 완료: {mp3_path}")
            else:
                return {'success': False, 'error': tts_result.get('error', 'TTS 생성 실패')}

        # 6. 영상 생성 (outputVideo가 true인 경우)
        if output_video and result_data.get('mp3Path'):
            video_path = os.path.join(output_dir, f'영상_{base_name}.mp4')
            resolution = settings.get('resolution', '1920x1080')
            background = settings.get('background', '')

            # 영상 생성은 추후 구현
            # video_result = generate_video_from_mp3(...)
            print(f"[BatchProduction] 영상 생성은 추후 구현 예정")

        print(f"[BatchProduction] 처리 완료: {script_path}")
        return result_data

    except Exception as e:
        print(f"[BatchProduction] 처리 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


def analyze_script_content(content):
    """대본 내용 분석 (문장 및 캐릭터 추출)"""
    sentences = []
    characters = set()

    lines = content.split('\n')

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # 캐릭터:대사 형식 파싱
        if ':' in line:
            parts = line.split(':', 1)
            char_name = parts[0].strip()
            text = parts[1].strip() if len(parts) > 1 else ''

            # 캐릭터명이 너무 길면 대사로 간주
            if len(char_name) <= 20 and text:
                characters.add(char_name)
                sentences.append({
                    'character': char_name,
                    'text': text
                })
            else:
                # 일반 문장
                sentences.append({
                    'character': '나레이션',
                    'text': line
                })
                characters.add('나레이션')
        else:
            # 캐릭터 없는 일반 문장
            sentences.append({
                'character': '나레이션',
                'text': line
            })
            characters.add('나레이션')

    return {
        'sentences': sentences,
        'characters': list(characters)
    }


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


# ========== 빠른 TTS 변환 API ==========

@eel.expose
def generate_quick_tts_eel(text, voice_name):
    """
    빠른 TTS 변환 - JavaScript에서 호출
    Google Cloud TTS를 사용하여 텍스트를 음성으로 변환
    """
    try:
        import tempfile
        import requests
        from pydub import AudioSegment

        # API 키 가져오기
        if not TTS_QUOTA_LOADED:
            return {
                'success': False,
                'error': 'TTS Quota Manager가 로드되지 않았습니다.'
            }

        # 사용 가능한 API 키 자동 선택
        key_info = quota.get_available_api_key(voice_name, len(text))
        if not key_info:
            return {
                'success': False,
                'error': 'Google TTS API 키가 설정되지 않았습니다. 상단 API 키 버튼에서 설정해주세요.'
            }

        api_key = key_info['api_key']  # 'key'가 아닌 'api_key'

        # Google Cloud TTS API 호출
        url = f"https://texttospeech.googleapis.com/v1/text:synthesize?key={api_key}"

        # 요청 데이터
        data = {
            "input": {"text": text},
            "voice": {
                "languageCode": voice_name[:5],  # 'ko-KR'
                "name": voice_name
            },
            "audioConfig": {
                "audioEncoding": "MP3"
            }
        }

        # API 요청
        response = requests.post(url, json=data, timeout=30)

        if response.status_code != 200:
            error_msg = response.json().get('error', {}).get('message', 'Unknown error')
            return {
                'success': False,
                'error': f'TTS API 오류: {error_msg}'
            }

        # 음성 데이터 추출
        audio_content = response.json()['audioContent']

        # Base64 디코딩
        import base64
        audio_bytes = base64.b64decode(audio_content)

        # 임시 파일로 저장
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.mp3')
        temp_file.write(audio_bytes)
        temp_file.close()

        # 오디오 길이 계산
        audio = AudioSegment.from_mp3(temp_file.name)
        duration = len(audio) / 1000.0  # 밀리초를 초로 변환

        print(f"[QuickTTS] TTS 생성 완료: {text[:30]}... ({duration:.2f}초)")

        return {
            'success': True,
            'file_path': temp_file.name,
            'duration': duration
        }

    except Exception as e:
        print(f'[QuickTTS] TTS 생성 오류: {e}')
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }


@eel.expose
def combine_audio_files_only_eel(audio_segments, output_path):
    """
    빠른 변환 - 여러 오디오 파일을 하나의 MP3로 결합
    """
    try:
        from pydub import AudioSegment

        combined = AudioSegment.empty()

        for segment in audio_segments:
            audio = AudioSegment.from_mp3(segment['file'])
            combined += audio

            # 임시 파일 삭제
            try:
                os.unlink(segment['file'])
            except:
                pass

        # MP3로 저장
        combined.export(output_path, format='mp3', bitrate='192k')

        print(f"[QuickTTS] MP3 결합 완료: {output_path}")

        return {
            'success': True,
            'mp3_path': output_path
        }

    except Exception as e:
        print(f'[QuickTTS] 오디오 결합 오류: {e}')
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }


@eel.expose
def combine_audio_and_generate_srt_eel(audio_segments, base_path):
    """
    빠른 변환 - 오디오 파일 결합 + SRT 자막 파일 생성
    """
    try:
        from pydub import AudioSegment

        # MP3 결합
        combined = AudioSegment.empty()

        for segment in audio_segments:
            audio = AudioSegment.from_mp3(segment['file'])
            combined += audio

            # 임시 파일 삭제
            try:
                os.unlink(segment['file'])
            except:
                pass

        mp3_path = base_path + '.mp3'
        combined.export(mp3_path, format='mp3', bitrate='192k')

        # SRT 생성
        srt_path = base_path + '.srt'
        with open(srt_path, 'w', encoding='utf-8') as f:
            for idx, segment in enumerate(audio_segments, 1):
                start_time = format_srt_time(segment['start'])
                end_time = format_srt_time(segment['end'])

                f.write(f'{idx}\n')
                f.write(f'{start_time} --> {end_time}\n')
                f.write(f'{segment["text"]}\n')
                f.write('\n')

        print(f"[QuickTTS] MP3/SRT 생성 완료: {mp3_path}, {srt_path}")

        return {
            'success': True,
            'mp3_path': mp3_path,
            'srt_path': srt_path
        }

    except Exception as e:
        print(f'[QuickTTS] MP3/SRT 생성 오류: {e}')
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }


def format_srt_time(seconds):
    """
    초를 SRT 시간 형식으로 변환 (HH:MM:SS,mmm)
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)

    return f'{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}'


# ========== YouTube 채널 관리 ==========

@eel.expose
def youtube_get_my_channels(account_id=None):
    """
    현재 인증된 계정의 채널 목록 조회

    Args:
        account_id: 계정 ID (None이면 현재 계정)

    Returns:
        {
            'success': bool,
            'channels': [{'id': ..., 'title': ..., 'thumbnail': ..., ...}],
            'selected_channel_id': str or None,
            'error': str
        }
    """
    try:
        import auth
        import youtube_api
        import channel_context
        import account_manager

        # 계정 ID 결정
        if not account_id:
            current_account = account_manager.get_current_account()
            if not current_account:
                return {'success': False, 'error': '로그인된 계정이 없습니다.', 'channels': []}
            account_id = current_account['id']

        # 인증 확인
        if not auth.is_authenticated(account_id):
            return {'success': False, 'error': '인증이 필요합니다.', 'channels': []}

        # YouTube API 서비스 생성
        youtube = auth.get_authenticated_service(account_id)
        if not youtube:
            return {'success': False, 'error': 'YouTube API 연결 실패', 'channels': []}

        # 채널 목록 조회
        result = youtube_api.get_my_channels(youtube)

        if result['success']:
            # 채널 목록 저장
            channel_context.save_account_channels(account_id, result['channels'])

            # 현재 선택된 채널 ID 가져오기
            selected_id = channel_context.get_selected_channel_id(account_id)

            return {
                'success': True,
                'channels': result['channels'],
                'selected_channel_id': selected_id
            }
        else:
            return result

    except Exception as e:
        print(f"[YouTube] 채널 목록 조회 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e), 'channels': []}


@eel.expose
def youtube_select_channel(account_id, channel_id):
    """
    작업할 채널 선택

    Args:
        account_id: 계정 ID
        channel_id: 채널 ID

    Returns:
        {'success': bool, 'channel': dict, 'error': str}
    """
    try:
        import channel_context

        result = channel_context.select_channel(account_id, channel_id)
        return result

    except Exception as e:
        print(f"[YouTube] 채널 선택 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def youtube_get_selected_channel(account_id=None):
    """
    현재 선택된 채널 정보 조회

    Args:
        account_id: 계정 ID (None이면 현재 계정)

    Returns:
        dict or None: 선택된 채널 정보
    """
    try:
        import channel_context
        import account_manager

        # 계정 ID 결정
        if not account_id:
            current_account = account_manager.get_current_account()
            if not current_account:
                return None
            account_id = current_account['id']

        channel = channel_context.get_selected_channel(account_id)
        return channel

    except Exception as e:
        print(f"[YouTube] 선택된 채널 조회 오류: {e}")
        traceback.print_exc()
        return None


@eel.expose
def youtube_refresh_channels(account_id=None):
    """
    채널 목록 새로고침 (API에서 다시 조회)

    Args:
        account_id: 계정 ID (None이면 현재 계정)

    Returns:
        {'success': bool, 'channels': [...], 'error': str}
    """
    try:
        return youtube_get_my_channels(account_id)

    except Exception as e:
        print(f"[YouTube] 채널 새로고침 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e), 'channels': []}


# ========== 계정 관리 ==========

@eel.expose
def account_get_list():
    """
    등록된 계정 목록 반환
    Returns: {'accounts': [...], 'current_account_id': str}
    """
    try:
        import account_manager
        return account_manager.load_accounts()
    except Exception as e:
        print(f"[Account] 계정 목록 로드 오류: {e}")
        return {'accounts': [], 'current_account_id': None}


@eel.expose
def account_add_new():
    """
    새 OAuth 계정 추가 (로그인 플로우 시작)
    Returns: {'success': bool, 'error': str}
    """
    try:
        import auth
        import account_manager

        # 1. 먼저 임시 계정 ID 생성
        account_id = account_manager.generate_account_id()

        # 2. OAuth 로그인 시작 (account_id 전달)
        account_info = auth.authenticate_with_account_id(account_id)

        if account_info and account_info.get('success'):
            # 3. 계정 정보 저장
            user_info = account_info.get('user_info', {})
            result = account_manager.add_account_with_id(
                account_id=account_id,
                name=user_info.get('name', 'Unknown'),
                email=user_info.get('email', ''),
                thumbnail=user_info.get('picture', '')
            )

            if result['success']:
                # 4. 계정 선택
                account_manager.set_current_account(account_id)
                return {'success': True, 'account_id': account_id}
            else:
                return result
        else:
            return {'success': False, 'error': account_info.get('error', '로그인 실패')}

    except Exception as e:
        print(f"[Account] 계정 추가 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def account_select(account_id):
    """
    활성 계정 전환
    Args:
        account_id: 전환할 계정 ID
    Returns: {'success': bool, 'error': str}
    """
    try:
        import account_manager
        import config

        result = account_manager.set_current_account(account_id)

        if result['success']:
            # API 자격 증명 로드
            creds = account_manager.load_account_api_credentials(account_id)
            if creds:
                config.set_current_credentials(
                    creds.get('api_key', ''),
                    creds.get('client_id', ''),
                    creds.get('client_secret', '')
                )

        return result

    except Exception as e:
        print(f"[Account] 계정 전환 오류: {e}")
        return {'success': False, 'error': str(e)}


@eel.expose
def account_remove(account_id):
    """
    계정 삭제
    Args:
        account_id: 삭제할 계정 ID
    Returns: {'success': bool, 'error': str}
    """
    try:
        import account_manager
        import channel_context

        # 계정 삭제
        result = account_manager.remove_account(account_id)

        if result['success']:
            # 채널 컨텍스트도 삭제
            channel_context.clear_account_channels(account_id)

        return result

    except Exception as e:
        print(f"[Account] 계정 삭제 오류: {e}")
        return {'success': False, 'error': str(e)}


@eel.expose
def oauth_save_credentials(client_id, client_secret):
    """
    OAuth 자격 증명 저장 (공통 또는 현재 계정용)
    Args:
        client_id: OAuth Client ID
        client_secret: OAuth Client Secret
    Returns: {'success': bool, 'error': str}
    """
    try:
        import account_manager
        import config

        # 현재 계정이 있으면 계정별로 저장
        current_account = account_manager.get_current_account()

        if current_account:
            account_id = current_account['id']
            # 기존 API 키 유지
            existing_creds = account_manager.load_account_api_credentials(account_id)
            api_key = existing_creds.get('api_key', '') if existing_creds else ''

            result = account_manager.save_account_api_credentials(
                account_id, api_key, client_id, client_secret
            )

            if result['success']:
                # 현재 세션에도 적용
                config.set_current_credentials(api_key, client_id, client_secret)

            return result
        else:
            # 계정이 없으면 현재 세션에만 적용 (임시)
            config.set_current_credentials('', client_id, client_secret)
            return {'success': True}

    except Exception as e:
        print(f"[OAuth] 자격 증명 저장 오류: {e}")
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


@eel.expose
def oauth_get_credentials():
    """
    현재 OAuth 자격 증명 조회
    Returns: {'client_id': str, 'client_secret': str}
    """
    try:
        import account_manager
        import config

        # 현재 계정의 자격 증명 반환
        current_account = account_manager.get_current_account()

        if current_account:
            creds = account_manager.load_account_api_credentials(current_account['id'])
            if creds:
                return {
                    'client_id': creds.get('client_id', ''),
                    'client_secret': creds.get('client_secret', '')
                }

        # 현재 세션 값 반환
        return {
            'client_id': config.get_client_id() or '',
            'client_secret': config.get_client_secret() or ''
        }

    except Exception as e:
        print(f"[OAuth] 자격 증명 조회 오류: {e}")
        return {'client_id': '', 'client_secret': ''}


# ============================================================================
# 앱 설정 관리
# ============================================================================

@eel.expose
def get_app_settings():
    """앱 설정 불러오기"""
    try:
        settings = studio_load_json_file(APP_SETTINGS_FILE)
        if not settings:
            # 기본값 반환
            settings = {
                'whisperModel': 'base',
                'outputFolder': '',
                'subtitleMaxLength': 30,
                'silenceDuration': 0.3,
                'theme': 'dark'
            }
        return settings
    except Exception as e:
        print(f"[Settings] 설정 로드 오류: {e}")
        return {
            'whisperModel': 'base',
            'outputFolder': '',
            'subtitleMaxLength': 30,
            'silenceDuration': 0.3,
            'theme': 'dark'
        }


@eel.expose
def save_app_settings(settings):
    """앱 설정 저장"""
    try:
        studio_save_json_file(APP_SETTINGS_FILE, settings)
        print(f"[Settings] 설정 저장 완료: {APP_SETTINGS_FILE}")
        return {'success': True}
    except Exception as e:
        print(f"[Settings] 설정 저장 오류: {e}")
        return {'success': False, 'error': str(e)}


@eel.expose
def get_oauth_config():
    """OAuth 설정 불러오기"""
    try:
        import config

        # 1. 먼저 런타임 메모리에서 확인
        client_id = config.get_client_id()
        client_secret = config.get_client_secret()

        if client_id and client_secret:
            return {
                'client_id': client_id,
                'client_secret': client_secret
            }

        # 2. 파일에서 읽기
        oauth_file = os.path.join(DATA_DIR, 'oauth_config.json')
        oauth_settings = studio_load_json_file(oauth_file)

        if oauth_settings and oauth_settings.get('client_id') and oauth_settings.get('client_secret'):
            # 파일에서 읽은 설정을 런타임에 설정
            config.set_current_credentials(
                api_key=config.get_api_key(),
                client_id=oauth_settings['client_id'],
                client_secret=oauth_settings['client_secret']
            )
            return {
                'client_id': oauth_settings['client_id'],
                'client_secret': oauth_settings['client_secret']
            }

        return None
    except Exception as e:
        print(f"[OAuth] 설정 로드 오류: {e}")
        import traceback
        traceback.print_exc()
        return None


@eel.expose
def save_oauth_config(client_id, client_secret):
    """OAuth 설정 저장"""
    try:
        import config

        # 런타임 설정 업데이트
        config.set_current_credentials(
            api_key=config.get_api_key(),  # 기존 API Key 유지
            client_id=client_id,
            client_secret=client_secret
        )

        # 파일에 저장 (계정 관리자를 통해)
        import account_manager

        # OAuth 설정을 계정별 설정으로 저장
        # 기본 계정이 없으면 OAuth 설정만 저장
        oauth_settings = {
            'client_id': client_id,
            'client_secret': client_secret
        }

        # OAuth 설정 파일에 저장
        oauth_file = os.path.join(DATA_DIR, 'oauth_config.json')
        studio_save_json_file(oauth_file, oauth_settings)

        print(f"[OAuth] OAuth 설정 저장 완료")
        return {'success': True}
    except Exception as e:
        print(f"[OAuth] 설정 저장 오류: {e}")
        import traceback
        traceback.print_exc()
        return {'success': False, 'error': str(e)}


print("[RoyStudio] 백엔드 모듈 로드 완료")
