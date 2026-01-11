# -*- coding: utf-8 -*-
"""
빠른 TTS 변환 기능
대본을 MP3와 SRT 파일로 간단하게 변환
"""

import os
import tempfile
from google.cloud import texttospeech
from pydub import AudioSegment
import datetime


def generate_quick_tts(text, voice_name):
    """
    Google TTS로 텍스트를 음성으로 변환

    Args:
        text: 변환할 텍스트
        voice_name: 음성 모델 이름 (예: 'ko-KR-Wavenet-A')

    Returns:
        dict: {
            'success': bool,
            'file_path': str,
            'duration': float
        }
    """
    try:
        client = texttospeech.TextToSpeechClient()

        synthesis_input = texttospeech.SynthesisInput(text=text)

        voice = texttospeech.VoiceSelectionParams(
            language_code=voice_name[:5],  # 'ko-KR'
            name=voice_name
        )

        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3
        )

        response = client.synthesize_speech(
            input=synthesis_input,
            voice=voice,
            audio_config=audio_config
        )

        # 임시 파일로 저장
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.mp3')
        temp_file.write(response.audio_content)
        temp_file.close()

        # 오디오 길이 계산
        audio = AudioSegment.from_mp3(temp_file.name)
        duration = len(audio) / 1000.0  # 밀리초를 초로 변환

        return {
            'success': True,
            'file_path': temp_file.name,
            'duration': duration
        }

    except Exception as e:
        print(f'[QuickTTS] TTS 생성 오류: {e}')
        return {
            'success': False,
            'error': str(e)
        }


def combine_audio_files_only(audio_segments, output_path):
    """
    여러 오디오 파일을 하나의 MP3로 결합

    Args:
        audio_segments: [{'file': str, 'duration': float}, ...]
        output_path: 출력 MP3 파일 경로

    Returns:
        dict: {'success': bool, 'mp3_path': str}
    """
    try:
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
        combined.export(output_path, format='mp3')

        return {
            'success': True,
            'mp3_path': output_path
        }

    except Exception as e:
        print(f'[QuickTTS] 오디오 결합 오류: {e}')
        return {
            'success': False,
            'error': str(e)
        }


def combine_audio_and_generate_srt(audio_segments, base_path):
    """
    오디오 파일 결합 + SRT 자막 파일 생성

    Args:
        audio_segments: [{
            'file': str,
            'duration': float,
            'start': float,
            'end': float,
            'text': str
        }, ...]
        base_path: 출력 파일 기본 경로 (확장자 제외)

    Returns:
        dict: {
            'success': bool,
            'mp3_path': str,
            'srt_path': str
        }
    """
    try:
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
        combined.export(mp3_path, format='mp3')

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

        return {
            'success': True,
            'mp3_path': mp3_path,
            'srt_path': srt_path
        }

    except Exception as e:
        print(f'[QuickTTS] MP3/SRT 생성 오류: {e}')
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
