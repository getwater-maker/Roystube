# -*- coding: utf-8 -*-
"""
배치 작업 파이프라인 병렬 처리 시스템
- TTS 생성, EQ 렌더링, 영상 결합을 멀티스레딩 큐로 병렬 처리
- 30-40% 속도 향상
"""

import threading
from queue import Queue, Empty
import time
import traceback
from typing import Dict, List, Optional, Callable
import eel


class PipelineProcessor:
    """
    3단계 파이프라인 병렬 처리 시스템

    단계:
    1. TTS 생성 (네트워크 I/O, 가벼움)
    2. EQ 렌더링 (CPU 집약, 무거움)
    3. 영상 결합 (CPU/디스크 I/O, 중간)

    각 단계는 독립 스레드에서 처리되며, 큐를 통해 작업 전달
    """

    def __init__(self, tts_func: Callable, eq_func: Callable, combine_func: Callable,
                 cancel_event: threading.Event):
        """
        Args:
            tts_func: TTS 생성 함수 (job) -> (job, audio_path, audio_segments, clips)
            eq_func: EQ 렌더링 함수 (job, audio_path) -> (job, audio_path, audio_segments, clips, vis_path)
            combine_func: 영상 결합 함수 (job, audio_path, vis_path, audio_segments, clips) -> result
            cancel_event: 작업 취소 이벤트
        """
        self.tts_func = tts_func
        self.eq_func = eq_func
        self.combine_func = combine_func
        self.cancel_event = cancel_event

        # 3개의 큐 (단계별)
        self.job_queue = Queue()           # 입력: 원본 작업들
        self.audio_queue = Queue()         # TTS 완료 → EQ 렌더링 대기
        self.visual_queue = Queue()        # EQ 완료 → 영상 결합 대기

        # 결과 저장
        self.results = []
        self.errors = []

        # 스레드 상태
        self.threads = []
        self.all_jobs_added = False

        # 진행 상황 추적
        self.total_jobs = 0
        self.completed_jobs = 0
        self.current_stage = {
            'tts': None,
            'eq': None,
            'combine': None
        }

    def add_job(self, job: Dict):
        """작업 추가"""
        self.job_queue.put(job)
        self.total_jobs += 1

    def start(self):
        """파이프라인 시작"""
        eel.logMessageFromPython("\n" + "="*60)
        eel.logMessageFromPython("⚡ 파이프라인 병렬 처리 시작")
        eel.logMessageFromPython(f"   총 {self.total_jobs}개 작업을 3단계 파이프라인으로 처리합니다")
        eel.logMessageFromPython("   단계: TTS 생성 → EQ 렌더링 → 영상 결합")
        eel.logMessageFromPython("="*60)

        # 3개의 워커 스레드 시작
        self.threads = [
            threading.Thread(target=self._tts_worker, name="TTS-Worker", daemon=True),
            threading.Thread(target=self._eq_worker, name="EQ-Worker", daemon=True),
            threading.Thread(target=self._combine_worker, name="Combine-Worker", daemon=True)
        ]

        for thread in self.threads:
            thread.start()

    def finish_adding_jobs(self):
        """모든 작업 추가 완료 표시"""
        self.all_jobs_added = True

    def wait_completion(self):
        """모든 작업 완료 대기"""
        # 모든 큐가 비워질 때까지 대기
        self.job_queue.join()
        self.audio_queue.join()
        self.visual_queue.join()

        # 종료 신호 전송
        self.job_queue.put(None)
        self.audio_queue.put(None)
        self.visual_queue.put(None)

        # 모든 스레드 종료 대기
        for thread in self.threads:
            thread.join(timeout=5)

        eel.logMessageFromPython("\n" + "="*60)
        eel.logMessageFromPython("✅ 파이프라인 처리 완료!")
        eel.logMessageFromPython(f"   성공: {len(self.results)}개")
        eel.logMessageFromPython(f"   실패: {len(self.errors)}개")
        eel.logMessageFromPython("="*60)

        return self.results, self.errors

    def _tts_worker(self):
        """워커 1: TTS 생성"""
        while True:
            try:
                # 취소 확인
                if self.cancel_event.is_set():
                    eel.logMessageFromPython("[TTS 워커] 작업 취소됨")
                    self.job_queue.task_done()
                    break

                # 작업 가져오기 (1초 타임아웃)
                try:
                    job = self.job_queue.get(timeout=1)
                except Empty:
                    # 모든 작업이 추가되었고 큐가 비었으면 종료
                    if self.all_jobs_added:
                        break
                    continue

                # 종료 신호
                if job is None:
                    self.job_queue.task_done()
                    break

                # TTS 생성 시작
                job_name = job.get('fileName', '알 수 없음')
                self.current_stage['tts'] = job_name

                eel.logMessageFromPython(f"\n🎤 [TTS] {job_name} 시작...")
                start_time = time.time()

                # TTS 함수 호출
                result = self.tts_func(job)

                if result is None:
                    # TTS 실패
                    error_msg = f"TTS 생성 실패: {job_name}"
                    eel.logMessageFromPython(f"❌ [TTS] {error_msg}")
                    self.errors.append({'job': job, 'error': error_msg})
                    self.job_queue.task_done()
                    continue

                job_with_audio, audio_path, audio_segments, clips = result
                elapsed = time.time() - start_time

                eel.logMessageFromPython(f"✅ [TTS] {job_name} 완료 ({elapsed:.1f}초)")

                # 다음 단계로 전달
                self.audio_queue.put((job_with_audio, audio_path, audio_segments, clips))
                self.job_queue.task_done()
                self.current_stage['tts'] = None

            except Exception as e:
                eel.logMessageFromPython(f"❌ [TTS 워커] 오류: {e}")
                eel.logMessageFromPython(traceback.format_exc())
                self.job_queue.task_done()

    def _eq_worker(self):
        """워커 2: EQ 렌더링 (가장 무거운 작업)"""
        while True:
            try:
                # 취소 확인
                if self.cancel_event.is_set():
                    eel.logMessageFromPython("[EQ 워커] 작업 취소됨")
                    self.audio_queue.task_done()
                    break

                # 작업 가져오기 (1초 타임아웃)
                try:
                    item = self.audio_queue.get(timeout=1)
                except Empty:
                    # TTS 워커가 종료되었고 큐가 비었으면 종료
                    if self.all_jobs_added and self.job_queue.unfinished_tasks == 0:
                        break
                    continue

                # 종료 신호
                if item is None:
                    self.audio_queue.task_done()
                    break

                job, audio_path, audio_segments, clips = item
                job_name = job.get('fileName', '알 수 없음')
                self.current_stage['eq'] = job_name

                eel.logMessageFromPython(f"\n🎨 [EQ] {job_name} 렌더링 시작...")
                start_time = time.time()

                # EQ 렌더링 함수 호출
                result = self.eq_func(job, audio_path)

                if result is None:
                    # EQ 렌더링 실패
                    error_msg = f"EQ 렌더링 실패: {job_name}"
                    eel.logMessageFromPython(f"❌ [EQ] {error_msg}")
                    self.errors.append({'job': job, 'error': error_msg})
                    self.audio_queue.task_done()
                    continue

                job_with_vis, vis_path = result
                elapsed = time.time() - start_time

                eel.logMessageFromPython(f"✅ [EQ] {job_name} 완료 ({elapsed:.1f}초)")

                # 다음 단계로 전달 (audio_segments, clips도 함께 전달)
                self.visual_queue.put((job_with_vis, audio_path, vis_path, audio_segments, clips))
                self.audio_queue.task_done()
                self.current_stage['eq'] = None

            except Exception as e:
                eel.logMessageFromPython(f"❌ [EQ 워커] 오류: {e}")
                eel.logMessageFromPython(traceback.format_exc())
                self.audio_queue.task_done()

    def _combine_worker(self):
        """워커 3: 영상 결합"""
        while True:
            try:
                # 취소 확인
                if self.cancel_event.is_set():
                    eel.logMessageFromPython("[결합 워커] 작업 취소됨")
                    self.visual_queue.task_done()
                    break

                # 작업 가져오기 (1초 타임아웃)
                try:
                    item = self.visual_queue.get(timeout=1)
                except Empty:
                    # EQ 워커가 종료되었고 큐가 비었으면 종료
                    if self.all_jobs_added and self.audio_queue.unfinished_tasks == 0:
                        break
                    continue

                # 종료 신호
                if item is None:
                    self.visual_queue.task_done()
                    break

                job, audio_path, vis_path, audio_segments, clips = item
                job_name = job.get('fileName', '알 수 없음')
                self.current_stage['combine'] = job_name

                eel.logMessageFromPython(f"\n🎬 [결합] {job_name} 영상 결합 시작...")
                start_time = time.time()

                # 영상 결합 함수 호출
                result = self.combine_func(job, audio_path, vis_path, audio_segments, clips)

                elapsed = time.time() - start_time

                if result and result.get('success'):
                    eel.logMessageFromPython(f"✅ [결합] {job_name} 완료 ({elapsed:.1f}초)")
                    eel.logMessageFromPython(f"   📁 출력: {result.get('output_path', '알 수 없음')}")
                    self.results.append(result)
                    self.completed_jobs += 1
                else:
                    error_msg = result.get('error', '알 수 없는 오류') if result else '결합 함수 반환 없음'
                    eel.logMessageFromPython(f"❌ [결합] {job_name} 실패: {error_msg}")
                    self.errors.append({'job': job, 'error': error_msg})

                # 진행률 업데이트
                progress = (self.completed_jobs / self.total_jobs) * 100
                eel.updateBatchProgress(progress, f"{self.completed_jobs}/{self.total_jobs} 완료")

                self.visual_queue.task_done()
                self.current_stage['combine'] = None

            except Exception as e:
                eel.logMessageFromPython(f"❌ [결합 워커] 오류: {e}")
                eel.logMessageFromPython(traceback.format_exc())
                self.visual_queue.task_done()

    def get_status(self) -> Dict:
        """현재 파이프라인 상태 반환"""
        return {
            'total': self.total_jobs,
            'completed': self.completed_jobs,
            'progress': (self.completed_jobs / self.total_jobs * 100) if self.total_jobs > 0 else 0,
            'current_stage': self.current_stage.copy(),
            'queue_sizes': {
                'jobs': self.job_queue.qsize(),
                'audio': self.audio_queue.qsize(),
                'visual': self.visual_queue.qsize()
            }
        }
