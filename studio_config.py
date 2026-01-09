# config.py
import os
import sys

# --- 앱 버전 ---
APP_VERSION = "1.06"
APP_NAME = "로이의스튜디오"

# --- 전역 경로 설정 ---
try:
    home_dir = os.path.expanduser('~')
    app_data_dir = os.path.join(home_dir, '.audiovis_tts_app_data')
    
    # 디렉토리 생성 시도
    os.makedirs(app_data_dir, exist_ok=True)
    TEMP_DIR = os.path.join(app_data_dir, 'temp_audio_cache')
    os.makedirs(TEMP_DIR, exist_ok=True)
    
except PermissionError:
    # 권한 문제 발생 시 현재 디렉토리 사용
    print("⚠️ 홈 디렉토리 접근 권한이 없습니다. 현재 디렉토리를 사용합니다.")
    app_data_dir = os.path.join(os.getcwd(), '.audiovis_tts_app_data')
    os.makedirs(app_data_dir, exist_ok=True)
    TEMP_DIR = os.path.join(app_data_dir, 'temp_audio_cache')
    os.makedirs(TEMP_DIR, exist_ok=True)
    
except Exception as e:
    # 기타 오류 발생 시 시스템 임시 디렉토리 사용
    print(f"⚠️ 데이터 디렉토리 생성 오류: {e}")
    import tempfile
    app_data_dir = os.path.join(tempfile.gettempdir(), '.audiovis_tts_app_data')
    os.makedirs(app_data_dir, exist_ok=True)
    TEMP_DIR = os.path.join(app_data_dir, 'temp_audio_cache')
    os.makedirs(TEMP_DIR, exist_ok=True)

# 설정 파일 경로
PROFILES_FILE = os.path.join(app_data_dir, "profiles.json")
DEFAULTS_FILE = os.path.join(app_data_dir, "defaults.json")
VOICE_PROFILES_FILE = os.path.join(app_data_dir, "voice_profiles.json")  # Legacy
API_KEYS_FILE = os.path.join(app_data_dir, "api_keys.json")
GLOBAL_PRESETS_FILE = os.path.join(app_data_dir, "global_presets.json")
PROFILE_ORDER_FILE = os.path.join(app_data_dir, "profile_order.json")
PROFILE_FOLDERS_FILE = os.path.join(app_data_dir, "profile_folders.json")  

# --- 언어, 음성 유형(모델), 음성 이름(API 코드) 및 성별 데이터 ---
LANG_VOICE_GROUPS = {
    "한국어": {
        "Chirp3-HD": {
            "ko-KR-Chirp3-HD-Achernar": "여성", "ko-KR-Chirp3-HD-Aoede": "여성", "ko-KR-Chirp3-HD-Autonoe": "여성",
            "ko-KR-Chirp3-HD-Callirrhoe": "여성", "ko-KR-Chirp3-HD-Despina": "여성", "ko-KR-Chirp3-HD-Erinome": "여성",
            "ko-KR-Chirp3-HD-Gacrux": "여성", "ko-KR-Chirp3-HD-Kore": "여성", "ko-KR-Chirp3-HD-Laomedeia": "여성",
            "ko-KR-Chirp3-HD-Leda": "여성", "ko-KR-Chirp3-HD-Pulcherrima": "여성", "ko-KR-Chirp3-HD-Sulafat": "여성",
            "ko-KR-Chirp3-HD-Vindemiatrix": "여성", "ko-KR-Chirp3-HD-Zephyr": "여성",
            "ko-KR-Chirp3-HD-Achird": "남성", "ko-KR-Chirp3-HD-Algenib": "남성", "ko-KR-Chirp3-HD-Algieba": "남성",
            "ko-KR-Chirp3-HD-Alnilam": "남성", "ko-KR-Chirp3-HD-Charon": "남성", "ko-KR-Chirp3-HD-Enceladus": "남성",
            "ko-KR-Chirp3-HD-Fenrir": "남성", "ko-KR-Chirp3-HD-Iapetus": "남성", "ko-KR-Chirp3-HD-Orus": "남성",
            "ko-KR-Chirp3-HD-Puck": "남성", "ko-KR-Chirp3-HD-Rasalgethi": "남성", "ko-KR-Chirp3-HD-Sadachbia": "남성",
            "ko-KR-Chirp3-HD-Sadaltager": "남성", "ko-KR-Chirp3-HD-Schedar": "남성", "ko-KR-Chirp3-HD-Umbriel": "남성",
            "ko-KR-Chirp3-HD-Zubenelgenubi": "남성",
        },
        "Edge-Neural (무료)": {
            "ko-KR-SunHiNeural": "여성", "ko-KR-JiMinNeural": "여성", "ko-KR-SeoHyeonNeural": "여성",
            "ko-KR-SoonBokNeural": "여성", "ko-KR-YuJinNeural": "여성",
            "ko-KR-InJoonNeural": "남성", "ko-KR-BongJinNeural": "남성", "ko-KR-GookMinNeural": "남성",
            "ko-KR-HyunsuNeural": "남성",
        },
        "Neural2": { "ko-KR-Neural2-A": "여성", "ko-KR-Neural2-B": "여성", "ko-KR-Neural2-C": "남성" },
        "WaveNet": { "ko-KR-Wavenet-A": "여성", "ko-KR-Wavenet-B": "여성", "ko-KR-Wavenet-C": "남성", "ko-KR-Wavenet-D": "남성" },
        "Standard": { "ko-KR-Standard-A": "여성", "ko-KR-Standard-B": "여성", "ko-KR-Standard-C": "남성", "ko-KR-Standard-D": "남성" },
    },
    "English": {
        "Chirp3-HD": {
            "en-US-Chirp3-HD-Achernar": "여성", "en-US-Chirp3-HD-Aoede": "여성", "en-US-Chirp3-HD-Autonoe": "여성",
            "en-US-Chirp3-HD-Callirrhoe": "여성", "en-US-Chirp3-HD-Despina": "여성", "en-US-Chirp3-HD-Erinome": "여성",
            "en-US-Chirp3-HD-Gacrux": "여성", "en-US-Chirp3-HD-Kore": "여성", "en-US-Chirp3-HD-Laomedeia": "여성",
            "en-US-Chirp3-HD-Leda": "여성", "en-US-Chirp3-HD-Pulcherrima": "여성", "en-US-Chirp3-HD-Sulafat": "여성",
            "en-US-Chirp3-HD-Vindemiatrix": "여성", "en-US-Chirp3-HD-Zephyr": "여성", "en-US-Chirp3-HD-Breezy": "여성",
            "en-US-Chirp3-HD-Achird": "남성", "en-US-Chirp3-HD-Algenib": "남성", "en-US-Chirp3-HD-Algieba": "남성",
            "en-US-Chirp3-HD-Alnilam": "남성", "en-US-Chirp3-HD-Charon": "남성", "en-US-Chirp3-HD-Enceladus": "남성",
            "en-US-Chirp3-HD-Fenrir": "남성", "en-US-Chirp3-HD-Iapetus": "남성", "en-US-Chirp3-HD-Orus": "남성",
            "en-US-Chirp3-HD-Puck": "남성", "en-US-Chirp3-HD-Rasalgethi": "남성", "en-US-Chirp3-HD-Sadachbia": "남성",
            "en-US-Chirp3-HD-Sadaltager": "남성", "en-US-Chirp3-HD-Schedar": "남성", "en-US-Chirp3-HD-Umbriel": "남성",
            "en-US-Chirp3-HD-Zubenelgenubi": "남성",
        },
        "Edge-Neural (무료)": {
            "en-US-JennyNeural": "여성", "en-US-AriaNeural": "여성", "en-US-AmberNeural": "여성",
            "en-US-AnaNeural": "여성", "en-US-AshleyNeural": "여성", "en-US-CoraNeural": "여성",
            "en-US-ElizabethNeural": "여성", "en-US-JaneNeural": "여성", "en-US-MichelleNeural": "여성",
            "en-US-MonicaNeural": "여성", "en-US-NancyNeural": "여성", "en-US-SaraNeural": "여성",
            "en-US-GuyNeural": "남성", "en-US-DavisNeural": "남성", "en-US-BrandonNeural": "남성",
            "en-US-ChristopherNeural": "남성", "en-US-EricNeural": "남성", "en-US-JacobNeural": "남성",
            "en-US-JasonNeural": "남성", "en-US-RogerNeural": "남성", "en-US-SteffanNeural": "남성",
            "en-US-TonyNeural": "남성",
        },
        "Chirp-HD": { "en-US-Chirp-HD-F": "여성", "en-US-Chirp-HD-O": "여성", "en-US-Chirp-HD-D": "남성", },
        "Studio": { "en-US-Studio-O": "여성", "en-US-Studio-Q": "남성" },
        "Neural2": {
            "en-US-Neural2-C": "여성", "en-US-Neural2-E": "여성", "en-US-Neural2-F": "여성", "en-US-Neural2-G": "여성", "en-US-Neural2-H": "여성",
            "en-US-Neural2-A": "남성", "en-US-Neural2-D": "남성", "en-US-Neural2-I": "남성", "en-US-Neural2-J": "남성",
        },
        "WaveNet": {
            "en-US-Wavenet-C": "여성", "en-US-Wavenet-E": "여성", "en-US-Wavenet-F": "여성", "en-US-Wavenet-G": "여성", "en-US-Wavenet-H": "여성",
            "en-US-Wavenet-A": "남성", "en-US-Wavenet-B": "남성", "en-US-Wavenet-D": "남성", "en-US-Wavenet-I": "남성", "en-US-Wavenet-J": "남성",
        },
        "Standard": {
            "en-US-Standard-C": "여성", "en-US-Standard-E": "여성", "en-US-Standard-F": "여성", "en-US-Standard-G": "여성", "en-US-Standard-H": "여성",
            "en-US-Standard-A": "남성", "en-US-Standard-B": "남성", "en-US-Standard-D": "남성", "en-US-Standard-I": "남성", "en-US-Standard-J": "남성",
        },
        "News": { "en-US-News-K": "여성", "en-US-News-L": "여성", "en-US-News-N": "남성" },
        "Casual": { "en-US-Casual-K": "남성" },
        "Polyglot": { "en-US-Polyglot-1": "남성"},
    },
    "日本語": {
        "Chirp3-HD": {
            "ja-JP-Chirp3-HD-Achernar": "여성", "ja-JP-Chirp3-HD-Aoede": "여성", "ja-JP-Chirp3-HD-Autonoe": "여성",
            "ja-JP-Chirp3-HD-Callirrhoe": "여성", "ja-JP-Chirp3-HD-Despina": "여성", "ja-JP-Chirp3-HD-Erinome": "여성",
            "ja-JP-Chirp3-HD-Gacrux": "여성", "ja-JP-Chirp3-HD-Kore": "여성", "ja-JP-Chirp3-HD-Laomedeia": "여성",
            "ja-JP-Chirp3-HD-Leda": "여성", "ja-JP-Chirp3-HD-Pulcherrima": "여성", "ja-JP-Chirp3-HD-Sulafat": "여성",
            "ja-JP-Chirp3-HD-Vindemiatrix": "여성", "ja-JP-Chirp3-HD-Zephyr": "여성",
            "ja-JP-Chirp3-HD-Achird": "남성", "ja-JP-Chirp3-HD-Algenib": "남성", "ja-JP-Chirp3-HD-Algieba": "남성",
            "ja-JP-Chirp3-HD-Alnilam": "남성", "ja-JP-Chirp3-HD-Charon": "남성", "ja-JP-Chirp3-HD-Enceladus": "남성",
            "ja-JP-Chirp3-HD-Fenrir": "남성", "ja-JP-Chirp3-HD-Iapetus": "남성", "ja-JP-Chirp3-HD-Orus": "남성",
            "ja-JP-Chirp3-HD-Puck": "남성", "ja-JP-Chirp3-HD-Rasalgethi": "남성", "ja-JP-Chirp3-HD-Sadachbia": "남성",
            "ja-JP-Chirp3-HD-Sadaltager": "남성", "ja-JP-Chirp3-HD-Schedar": "남성", "ja-JP-Chirp3-HD-Umbriel": "남성",
            "ja-JP-Chirp3-HD-Zubenelgenubi": "남성",
        },
        "Edge-Neural (무료)": {
            "ja-JP-NanamiNeural": "여성", "ja-JP-AoiNeural": "여성", "ja-JP-MayuNeural": "여성", "ja-JP-ShioriNeural": "여성",
            "ja-JP-KeitaNeural": "남성", "ja-JP-DaichiNeural": "남성", "ja-JP-NaokiNeural": "남성",
        },
        "Neural2": { "ja-JP-Neural2-B": "여성", "ja-JP-Neural2-C": "남성", "ja-JP-Neural2-D": "남성" },
        "WaveNet": { "ja-JP-Wavenet-A": "여성", "ja-JP-Wavenet-B": "여성", "ja-JP-Wavenet-C": "남성", "ja-JP-Wavenet-D": "남성" },
        "Standard": { "ja-JP-Standard-A": "여성", "ja-JP-Standard-B": "여성", "ja-JP-Standard-C": "남성", "ja-JP-Standard-D": "남성" },
    },
    "Español": {
        "Chirp3-HD": {
            "es-ES-Chirp3-HD-Achernar": "여성", "es-ES-Chirp3-HD-Aoede": "여성", "es-ES-Chirp3-HD-Autonoe": "여성",
            "es-ES-Chirp3-HD-Callirrhoe": "여성", "es-ES-Chirp3-HD-Despina": "여성", "es-ES-Chirp3-HD-Erinome": "여성",
            "es-ES-Chirp3-HD-Gacrux": "여성", "es-ES-Chirp3-HD-Kore": "여성", "es-ES-Chirp3-HD-Laomedeia": "여성",
            "es-ES-Chirp3-HD-Leda": "여성", "es-ES-Chirp3-HD-Pulcherrima": "여성", "es-ES-Chirp3-HD-Sulafat": "여성",
            "es-ES-Chirp3-HD-Vindemiatrix": "여성", "es-ES-Chirp3-HD-Zephyr": "여성",
            "es-ES-Chirp3-HD-Achird": "남성", "es-ES-Chirp3-HD-Algenib": "남성", "es-ES-Chirp3-HD-Algieba": "남성",
            "es-ES-Chirp3-HD-Alnilam": "남성", "es-ES-Chirp3-HD-Charon": "남성", "es-ES-Chirp3-HD-Enceladus": "남성",
            "es-ES-Chirp3-HD-Fenrir": "남성", "es-ES-Chirp3-HD-Iapetus": "남성", "es-ES-Chirp3-HD-Orus": "남성",
            "es-ES-Chirp3-HD-Puck": "남성", "es-ES-Chirp3-HD-Rasalgethi": "남성", "es-ES-Chirp3-HD-Sadachbia": "남성",
            "es-ES-Chirp3-HD-Sadaltager": "남성", "es-ES-Chirp3-HD-Schedar": "남성", "es-ES-Chirp3-HD-Umbriel": "남성",
            "es-ES-Chirp3-HD-Zubenelgenubi": "남성",
        },
        "Edge-Neural (무료)": {
            "es-ES-ElviraNeural": "여성", "es-MX-DaliaNeural": "여성",
            "es-ES-AlvaroNeural": "남성", "es-MX-JorgeNeural": "남성",
        },
        "Chirp-HD": { "es-ES-Chirp-HD-F": "여성", "es-ES-Chirp-HD-O": "여성", "es-ES-Chirp-HD-D": "남성", },
        "Neural2": { "es-ES-Neural2-A": "여성", "es-ES-Neural2-E": "여성", "es-ES-Neural2-H": "여성", "es-ES-Neural2-F": "남성", "es-ES-Neural2-G": "남성" },
        "WaveNet": { "es-ES-Wavenet-F": "여성", "es-ES-Wavenet-H": "여성", "es-ES-Wavenet-E": "남성", "es-ES-Wavenet-G": "남성" },
        "Standard": { "es-ES-Standard-F": "여성", "es-ES-Standard-H": "여성", "es-ES-Standard-E": "남성", "es-ES-Standard-G": "남성" },
        "Studio": { "es-ES-Studio-C": "여성", "es-ES-Studio-F": "남성" },
        "Polyglot": { "es-ES-Polyglot-1": "남성" },
    },
    "中文": {
        "Edge-Neural (무료)": {
            "zh-CN-XiaoxiaoNeural": "여성", "zh-CN-XiaoyiNeural": "여성", "zh-TW-HsiaoChenNeural": "여성",
            "zh-CN-YunxiNeural": "남성", "zh-CN-YunjianNeural": "남성", "zh-CN-YunyangNeural": "남성", "zh-TW-YunJheNeural": "남성",
        },
    }
}

