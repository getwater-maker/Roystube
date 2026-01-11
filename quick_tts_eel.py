# -*- coding: utf-8 -*-
"""
빠른 TTS 변환 - Eel 바인딩
"""

import eel
from quick_tts import (
    generate_quick_tts,
    combine_audio_files_only,
    combine_audio_and_generate_srt
)


@eel.expose
def generate_quick_tts_eel(text, voice_name):
    """
    JavaScript에서 호출할 수 있는 TTS 생성 함수
    """
    return generate_quick_tts(text, voice_name)


@eel.expose
def combine_audio_files_only_eel(audio_segments, output_path):
    """
    JavaScript에서 호출할 수 있는 오디오 결합 함수
    """
    return combine_audio_files_only(audio_segments, output_path)


@eel.expose
def combine_audio_and_generate_srt_eel(audio_segments, base_path):
    """
    JavaScript에서 호출할 수 있는 MP3+SRT 생성 함수
    """
    return combine_audio_and_generate_srt(audio_segments, base_path)
