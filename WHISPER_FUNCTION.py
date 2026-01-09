# ============================================================================
# RoyStudio Whisper 자막 생성 함수
# ============================================================================
# 이 파일의 generate_srt_with_whisper() 함수를 RoyYoutubeSearch의 main.py에 복사
# 위치: @eel.expose 함수들이 있는 구간에 복사
#
# 필수 조건:
# - format_timestamp() 함수가 정의되어 있어야 함
# - normalize_text_for_comparison() 함수가 정의되어 있어야 함
# - global whisper_model, whisper_model_name, whisper_cancel_event 선언
# ============================================================================


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


# ============================================================================
# 🎯 핵심 함수: Whisper 기반 자막 생성
# ============================================================================

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

        # 진행률 표시를 위한 스레드
        import threading
        import time

        progress_stop = threading.Event()
        current_progress = [20]  # mutable object for thread sharing

        def update_progress_periodically():
            """Whisper 처리 중 진행률을 주기적으로 업데이트"""
            while not progress_stop.is_set() and current_progress[0] < 65:
                time.sleep(2)  # 2초마다 업데이트
                if not progress_stop.is_set():
                    current_progress[0] = min(current_progress[0] + 3, 65)
                    try:
                        eel.updateSubtitleProgress(f"음성 인식 중... {current_progress[0]}%", current_progress[0])
                    except:
                        pass

        progress_thread = threading.Thread(target=update_progress_periodically, daemon=True)
        progress_thread.start()

        try:
            # Whisper 트랜스크립션 (단어별 타이밍 포함)
            result = whisper_model.transcribe(
                mp3_path,
                language=language,
                word_timestamps=True,
                verbose=False
            )
        finally:
            # 진행률 업데이트 스레드 종료
            progress_stop.set()
            progress_thread.join(timeout=1)

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
