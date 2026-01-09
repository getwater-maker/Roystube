# utils.py
import os
import sys
import shutil
import subprocess
import re
import json
import io
from tkinter import messagebox
from pydub import AudioSegment
from contextlib import contextmanager

# 이 파일들은 config.py에서 경로를 가져옵니다.
from studio_config import (PROFILES_FILE, VOICE_PROFILES_FILE, DEFAULTS_FILE, API_KEYS_FILE,
                    GLOBAL_PRESETS_FILE, PROFILE_ORDER_FILE, PROFILE_FOLDERS_FILE)

@contextmanager
def suppress_stdout_stderr():
    """일시적으로 표준 출력과 표준 에러를 숨기는 컨텍스트 관리자"""
    with open(os.devnull, 'w') as fnull:
        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = fnull, fnull
        try:
            yield
        finally:
            sys.stdout, sys.stderr = old_stdout, old_stderr

def ensure_pydub_ffmpeg_paths():
    """pydub이 ffmpeg을 찾는 과정에서 발생하는 모든 콘솔 메시지를 숨깁니다."""
    with suppress_stdout_stderr():
        try:
            # 명시적 경로 우선 사용
            ffmpeg_explicit = r"C:\ProgramData\chocolatey\bin\ffmpeg.exe"
            ffprobe_explicit = r"C:\ProgramData\chocolatey\bin\ffprobe.exe"

            # 명시적 경로가 존재하면 사용, 아니면 which()로 검색
            ffmpeg_path = ffmpeg_explicit if os.path.exists(ffmpeg_explicit) else shutil.which("ffmpeg")
            ffprobe_path = ffprobe_explicit if os.path.exists(ffprobe_explicit) else shutil.which("ffprobe")

            if ffmpeg_path:
                AudioSegment.converter = ffmpeg_path
                AudioSegment.ffmpeg = ffmpeg_path
            if ffprobe_path:
                AudioSegment.ffprobe = ffprobe_path

        except Exception:
            pass

def ffmpeg_healthcheck():
    """FFmpeg 관련 도구들의 설치 여부를 확인합니다."""
    # 명시적 경로로 FFmpeg 확인
    ffmpeg_paths = {
        "ffmpeg": r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
        "ffprobe": r"C:\ProgramData\chocolatey\bin\ffprobe.exe",
        "ffplay": r"C:\ProgramData\chocolatey\bin\ffplay.exe"
    }

    missing = []
    for tool, path in ffmpeg_paths.items():
        # 명시적 경로가 존재하면 OK, 아니면 which()로 검색
        if not (os.path.exists(path) or shutil.which(tool)):
            missing.append(tool)
    return missing

def open_file(filepath):
    """OS별로 적절한 방법으로 파일을 엽니다."""
    # 파일 존재 여부 확인
    if not os.path.exists(filepath):
        messagebox.showerror("오류", f"파일을 찾을 수 없습니다: {filepath}")
        return
    
    try:
        if sys.platform == "win32":
            os.startfile(filepath)
        elif sys.platform == "darwin":
            subprocess.run(["open", filepath], check=True)
        else:
            subprocess.run(["xdg-open", filepath], check=True)
    except Exception as e:
        messagebox.showerror("오류", f"파일을 열 수 없습니다: {e}")

def play_audio_with_ffplay(audio_segment):
    """ffplay를 사용하여 오디오를 재생합니다."""
    ffplay_path = shutil.which("ffplay")
    if not ffplay_path:
        raise FileNotFoundError("ffplay를 찾을 수 없습니다. FFmpeg 설치 및 PATH 등록 필요.")

    # Windows에서 콘솔 창 숨기기
    startupinfo = None
    creationflags = 0
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        creationflags = subprocess.CREATE_NO_WINDOW

    with io.BytesIO() as f:
        audio_segment.export(f, format="wav")
        f.seek(0)
        p = subprocess.Popen(
            [ffplay_path, "-nodisp", "-autoexit", "-"],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            startupinfo=startupinfo,
            creationflags=creationflags,
        )
        p.stdin.write(f.read())
        p.stdin.close()
        p.wait()

def sanitize_filename(filename):
    """파일명에서 사용할 수 없는 문자를 제거합니다."""
    return re.sub(r'[\\/*?:"<>|]', "", filename)

def read_script_file(filepath):
    """대본 파일을 읽어 텍스트를 반환합니다. TXT와 DOCX 파일을 지원합니다."""
    ext = os.path.splitext(filepath)[1].lower()

    if ext == '.docx':
        try:
            from docx import Document
            doc = Document(filepath)
            # 모든 문단의 텍스트를 줄바꿈으로 연결
            return '\n'.join(paragraph.text for paragraph in doc.paragraphs)
        except ImportError:
            raise ImportError("python-docx 패키지가 설치되지 않았습니다. 'pip install python-docx' 명령으로 설치해주세요.")
    else:
        # TXT 및 기타 텍스트 파일
        with open(filepath, "r", encoding="utf-8-sig") as f:
            return f.read()

def validate_float(new_value):
    """Tkinter entry 위젯 유효성 검사: 실수 또는 빈 문자열만 허용"""
    if not new_value:  # 빈 문자열 허용
        return True
    try:
        # 소수점이나 마이너스 부호만 있는 경우도 임시로 허용
        if new_value == "." or new_value == "-":
            return True
        float(new_value)
        return True
    except ValueError:
        return False

def auto_find_image_for_script(script_path):
    """스크립트 파일과 동일한 이름의 이미지 파일을 찾습니다."""
    if not os.path.exists(script_path):
        return None
    
    base_name = os.path.splitext(os.path.basename(script_path))[0]
    folder = os.path.dirname(script_path)
    
    for ext in ['.png', '.jpg', '.jpeg', '.bmp', '.webp']:
        image_path = os.path.join(folder, base_name + ext)
        if os.path.exists(image_path):
            return image_path
    
    return None

def _get_unique_filepath(directory, base_name, extension):
    """중복되지 않는 파일 경로를 생성합니다."""
    counter = 1
    filepath = os.path.join(directory, f"{base_name}{extension}")
    
    while os.path.exists(filepath):
        filepath = os.path.join(directory, f"{base_name} ({counter}){extension}")
        counter += 1
    
    return filepath

# --- JSON IO ---
def load_json_file(path):
    """JSON 파일을 로드합니다. 파일이 없거나 잘못된 경우 빈 딕셔너리 반환"""
    try:
        if not os.path.exists(path):
            return {}
        
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
            
    except json.JSONDecodeError as e:
        print(f"JSON 파싱 오류 ({path}): {e}")
        return {}
    except PermissionError as e:
        print(f"파일 접근 권한 오류 ({path}): {e}")
        return {}
    except Exception as e:
        print(f"예상치 못한 오류 발생 ({path}): {e}")
        return {}

def save_json_file(path, data):
    """JSON 파일을 저장합니다."""
    try:
        # 디렉토리가 없으면 생성
        directory = os.path.dirname(path)
        if directory and not os.path.exists(directory):
            os.makedirs(directory, exist_ok=True)

        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)

    except PermissionError as e:
        print(f"파일 저장 권한 오류 ({path}): {e}")
        raise
    except Exception as e:
        print(f"파일 저장 중 오류 ({path}): {e}")
        raise

# 편의 함수
get_profiles = lambda: load_json_file(PROFILES_FILE)
load_defaults = lambda: load_json_file(DEFAULTS_FILE)
save_defaults = lambda x: save_json_file(DEFAULTS_FILE, x)

# 프리셋 저장 함수
def save_preset_for_profile(profile_name, preset_name, preset_data):
    """특정 프로필의 프리셋을 저장합니다."""
    all_defaults = load_defaults()
    
    if profile_name not in all_defaults:
        all_defaults[profile_name] = {"presets": {}}
    
    if "presets" not in all_defaults[profile_name]:
        all_defaults[profile_name]["presets"] = {}
    
    all_defaults[profile_name]["presets"][preset_name] = preset_data
    save_defaults(all_defaults)

# --- API 키 관리 함수 ---
def load_api_keys():
    """저장된 API 키 목록을 불러옵니다."""
    return load_json_file(API_KEYS_FILE)

def save_api_keys(keys_data):
    """API 키 목록을 저장합니다."""
    save_json_file(API_KEYS_FILE, keys_data)

def get_default_api_key():
    """기본으로 설정된 API 키를 반환합니다."""
    keys = load_api_keys()
    
    # 기본값으로 설정된 키 찾기
    for key_name, key_data in keys.items():
        if isinstance(key_data, dict) and key_data.get('is_default', False):
            return key_name, key_data.get('key', '')
    
    # 기본값이 없으면 첫 번째 키 반환
    if keys:
        first_key = next(iter(keys))
        first_data = keys[first_key]
        
        if isinstance(first_data, dict):
            return first_key, first_data.get('key', '')
        else:
            # 레거시 형식 처리
            return first_key, first_data
    
    return None, None

def set_default_api_key(key_name):
    """특정 API 키를 기본값으로 설정합니다."""
    keys = load_api_keys()
    
    for name in keys:
        if isinstance(keys[name], dict):
            keys[name]['is_default'] = (name == key_name)
    
    save_api_keys(keys)
# --- 전역 프리셋 관리 함수 ---
def load_global_presets():
    """전역 프리셋 목록을 불러옵니다."""
    return load_json_file(GLOBAL_PRESETS_FILE)

def save_global_presets(presets_data):
    """전역 프리셋 목록을 저장합니다."""
    save_json_file(GLOBAL_PRESETS_FILE, presets_data)

def get_global_preset_names():
    """전역 프리셋 이름 목록을 반환합니다."""
    presets = load_global_presets()
    return list(presets.keys()) if presets else []

def get_global_preset(preset_name):
    """특정 전역 프리셋의 설정을 반환합니다."""
    presets = load_global_presets()
    return presets.get(preset_name, None)

def add_global_preset(preset_name, preset_data):
    """전역 프리셋을 추가하거나 업데이트합니다."""
    presets = load_global_presets()
    presets[preset_name] = preset_data
    save_global_presets(presets)

def delete_global_preset(preset_name):
    """전역 프리셋을 삭제합니다."""
    presets = load_global_presets()
    if preset_name in presets:
        del presets[preset_name]
        save_global_presets(presets)
        return True
    return False

def rename_global_preset(old_name, new_name):
    """전역 프리셋 이름을 변경합니다."""
    presets = load_global_presets()
    if old_name in presets and new_name not in presets:
        presets[new_name] = presets.pop(old_name)
        save_global_presets(presets)
        return True
    return False

# --- 계정 순서 관리 함수 ---
def get_profile_order():
    """계정 표시 순서를 불러옵니다."""
    order = load_json_file(PROFILE_ORDER_FILE)
    if isinstance(order, list):
        return order
    return []

def save_profile_order(order_list):
    """계정 표시 순서를 저장합니다."""
    save_json_file(PROFILE_ORDER_FILE, order_list)

# --- 계정별 기본 폴더 관리 함수 ---
def get_profile_folders():
    """계정별 기본 저장 폴더를 불러옵니다."""
    folders = load_json_file(PROFILE_FOLDERS_FILE)
    if isinstance(folders, dict):
        return folders
    return {}

def save_profile_folders(folders_dict):
    """계정별 기본 저장 폴더를 저장합니다."""
    save_json_file(PROFILE_FOLDERS_FILE, folders_dict)

def get_profile_default_folder(profile_name):
    """특정 계정의 기본 저장 폴더를 반환합니다."""
    folders = get_profile_folders()
    return folders.get(profile_name, None)