# tab_black_screen.py
# 이 파일은 검은 화면(또는 단색 배경) 영상 제작 탭의 UI와 기능을 담당합니다.
import tkinter as tk
from tkinter import filedialog, messagebox, ttk, colorchooser
import threading
import math
from moviepy.video.VideoClip import ColorClip, VideoClip
from moviepy.video.compositing.CompositeVideoClip import CompositeVideoClip
from moviepy.video.VideoClip import TextClip

# ✅ moviepy 3.x 이상 호환 import
from moviepy.video.VideoClip import ColorClip, VideoClip, TextClip
from moviepy.video.compositing.CompositeVideoClip import CompositeVideoClip


from PIL import Image, ImageDraw, ImageFont
import numpy as np
import os
import time

# UI 다이얼로그 모듈 (RoyYoutubeSearch 통합 시 사용하지 않음)
try:
    from ui_dialogs import CompletionDialog
    from ui_previews import EQPreviewDialog
except ImportError:
    CompletionDialog = None
    EQPreviewDialog = None
import studio_utils as utils

class BlackScreenTab:
    def __init__(self, parent, app):
        self.parent = parent
        self.app = app
        self.root = app.root
        
        self._create_widgets()

    def _create_widgets(self):
        # UI 변수 초기화
        self.bs_color_var = tk.StringVar(value='#000000')
        self.bs_duration_var = tk.StringVar(value='00:10:00')
        self.bs_res_var = tk.StringVar(value="1920x1080")
        self.bs_add_timer_var = tk.BooleanVar(value=False)
        self.bs_timer_type_var = tk.StringVar(value='digital')
        self.bs_timer_style_var = tk.StringVar(value='기본 (HH:MM:SS.ms)')
        
        self.bs_timer_x_pct = tk.DoubleVar(value=50.0)
        self.bs_timer_y_pct = tk.DoubleVar(value=50.0)
        self.bs_timer_w_pct = tk.DoubleVar(value=40.0)

        # 메인 프레임
        main_frame = ttk.Frame(self.parent, padding=20)
        main_frame.pack(fill=tk.X)
        
        # 기본 설정
        settings_frame = ttk.LabelFrame(main_frame, text="기본 설정", padding=10)
        settings_frame.pack(fill=tk.X, pady=5)
        settings_frame.grid_columnconfigure(1, weight=1)

        # 배경색
        ttk.Label(settings_frame, text="배경색:").grid(row=0, column=0, sticky='w', pady=5, padx=5)
        self.bs_color_swatch = tk.Label(settings_frame, text='      ', bg=self.bs_color_var.get(), relief='sunken', borderwidth=1)
        self.bs_color_swatch.grid(row=0, column=1, sticky='w', pady=5, padx=5)
        ttk.Button(settings_frame, text="색상 선택", command=self._select_bs_color).grid(row=0, column=2, sticky='w', pady=5)

        # 시간
        ttk.Label(settings_frame, text="시간 (HH:MM:SS):").grid(row=1, column=0, sticky='w', pady=5, padx=5)
        ttk.Entry(settings_frame, textvariable=self.bs_duration_var).grid(row=1, column=1, columnspan=2, sticky='ew', pady=5, padx=5)
        
        # 해상도
        ttk.Label(settings_frame, text="해상도:").grid(row=2, column=0, sticky='w', pady=5, padx=5)
        ttk.Combobox(settings_frame, textvariable=self.bs_res_var, values=["1920x1080","1280x720","3840x2160","1080x1920 (세로)"], state="readonly").grid(row=2, column=1, columnspan=2, sticky='ew', pady=5, padx=5)

        # 타이머 옵션
        timer_frame = ttk.LabelFrame(main_frame, text="타이머 추가 (옵션)", padding=10)
        timer_frame.pack(fill=tk.X, pady=5)
        
        self.timer_checkbutton = ttk.Checkbutton(timer_frame, text="타이머 사용", variable=self.bs_add_timer_var, command=self._toggle_timer_options)
        self.timer_checkbutton.pack(anchor='w')

        self.timer_options_frame = ttk.Frame(timer_frame)
        self.timer_options_frame.pack(fill=tk.X, pady=5)
        
        timer_type_frame = ttk.Frame(self.timer_options_frame)
        timer_type_frame.pack(fill=tk.X)
        ttk.Radiobutton(timer_type_frame, text="디지털 시계", variable=self.bs_timer_type_var, value='digital', command=self._update_timer_styles).pack(side='left', padx=5)
        ttk.Radiobutton(timer_type_frame, text="아날로그 시계", variable=self.bs_timer_type_var, value='analog', command=self._update_timer_styles).pack(side='left', padx=5)

        timer_style_frame = ttk.Frame(self.timer_options_frame)
        timer_style_frame.pack(fill=tk.X, pady=(5,0))
        ttk.Label(timer_style_frame, text="스타일:").pack(side='left', padx=5)
        self.timer_style_combo = ttk.Combobox(timer_style_frame, textvariable=self.bs_timer_style_var, state="readonly")
        self.timer_style_combo.pack(side='left', fill='x', expand=True)

        timer_pos_frame = ttk.LabelFrame(self.timer_options_frame, text="타이머 위치/크기 (%)", padding=10)
        timer_pos_frame.pack(fill=tk.X, pady=5, expand=True)
        timer_pos_frame.grid_columnconfigure(0, weight=1)
        
        self.app.video_maker_tab._create_adjustable_entry_control(timer_pos_frame, "X 위치:", self.bs_timer_x_pct, 0, 100, 1).grid(row=0, column=0, sticky='ew')
        self.app.video_maker_tab._create_adjustable_entry_control(timer_pos_frame, "Y 위치:", self.bs_timer_y_pct, 0, 100, 1).grid(row=1, column=0, sticky='ew')
        self.app.video_maker_tab._create_adjustable_entry_control(timer_pos_frame, "크기:", self.bs_timer_w_pct, 1, 100, 1).grid(row=2, column=0, sticky='ew')
        ttk.Button(timer_pos_frame, text="타이머 위치 미리보기", command=self.open_timer_preview).grid(row=3, column=0, columnspan=2, sticky='ew', pady=(5,0))

        # 제작 버튼 및 프로그레스 바
        prod_frame = ttk.LabelFrame(main_frame, text="제작", padding=10)
        prod_frame.pack(fill=tk.X, pady=5)

        self.bs_start_btn = tk.Button(prod_frame, text="단색 배경 영상 제작 시작", command=self.start_bs_production, height=2, font=("",12,"bold"), bg="#4CAF50", fg="white")
        self.bs_start_btn.pack(fill=tk.X, expand=True, padx=5, pady=5)
        
        self.bs_progress_text_var = tk.StringVar(value="대기 중...")
        tk.Label(prod_frame, textvariable=self.bs_progress_text_var, anchor="w").pack(side='left', padx=5)
        
        self.bs_progress_bar = ttk.Progressbar(prod_frame, orient="horizontal", mode="determinate")
        self.bs_progress_bar.pack(fill=tk.X, padx=5, pady=5)
        
        self._update_timer_styles()
        self._toggle_timer_options()

    def _select_bs_color(self):
        color_code = colorchooser.askcolor(title="배경색 선택", initialcolor=self.bs_color_var.get())
        if color_code and color_code[1]:
            self.bs_color_var.set(color_code[1])
            self.bs_color_swatch.config(bg=color_code[1])

    def _set_widget_state_recursive(self, parent_widget, state):
        for child in parent_widget.winfo_children():
            # 위젯 유형에 따라 'state' 옵션을 지원하는지 확인
            if isinstance(child, (ttk.Button, ttk.Checkbutton, ttk.Radiobutton, ttk.Entry, ttk.Combobox, ttk.Scale, ttk.Spinbox)):
                child.configure(state=state)
            # 컨테이너 위젯(Frame, LabelFrame)의 경우 재귀적으로 탐색
            if isinstance(child, (ttk.Frame, ttk.LabelFrame, tk.Frame)):
                self._set_widget_state_recursive(child, state)

    def _toggle_timer_options(self):
        state = 'normal' if self.bs_add_timer_var.get() else 'disabled'
        self._set_widget_state_recursive(self.timer_options_frame, state)

    def _update_timer_styles(self):
        timer_type = self.bs_timer_type_var.get()
        if timer_type == 'digital':
            styles = ['기본 (HH:MM:SS.ms)', '초 생략 (HH:MM)', '밀리초 생략 (HH:MM:SS)']
        else: # analog
            styles = ['기본 (선)', '심플 (점)', '모던 (눈금)']
        self.timer_style_combo['values'] = styles
        self.bs_timer_style_var.set(styles[0])

    def open_timer_preview(self):
        settings = {
            'x': self.bs_timer_x_pct.get(),
            'y': self.bs_timer_y_pct.get(),
            'w': self.bs_timer_w_pct.get(),
            'h': self.bs_timer_w_pct.get() # 너비를 높이로도 사용 (정사각형 가정)
        }
        EQPreviewDialog(self.root, None, settings, self.update_timer_from_preview, bg_color=self.bs_color_var.get())

    def update_timer_from_preview(self, settings, final=False):
        self.bs_timer_x_pct.set(round(settings['x'], 2))
        self.bs_timer_y_pct.set(round(settings['y'], 2))
        self.bs_timer_w_pct.set(round(settings['w'], 2))

    def start_bs_production(self):
        if self.app.processing_thread and self.app.processing_thread.is_alive():
            messagebox.showinfo("정보","이미 다른 작업이 진행 중입니다."); return

        save_path = filedialog.asksaveasfilename( defaultextension=".mp4", filetypes=[("MP4 Video","*.mp4")], title="단색 배경 영상 저장")
        if not save_path: return
        
        self.app.cancel_event.clear()
        self.bs_start_btn.config(state=tk.DISABLED)
        self.app.processing_thread = threading.Thread(target=self._run_bs_thread, args=(save_path,), daemon=True)
        self.app.processing_thread.start()

    def _run_bs_thread(self, save_path):
        try:
            color_hex = self.bs_color_var.get()
            color_rgb = tuple(int(color_hex.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
            
            h, m, s = map(int, self.bs_duration_var.get().split(':'))
            duration = h * 3600 + m * 60 + s
            if duration <= 0: raise ValueError("시간은 0보다 커야 합니다.")

            width, height = map(int, self.bs_res_var.get().split('x')[0:2])
            size = (width, height)
            
            base_clip = ColorClip(size=size, color=color_rgb, duration=duration)
            clips_to_compose = [base_clip]

            if self.bs_add_timer_var.get():
                timer_w_px = int(width * (self.bs_timer_w_pct.get() / 100.0))
                
                def make_timer_frame(t):
                    # 프레임마다 호출될 함수
                    if self.app.cancel_event.is_set():
                        raise StopIteration("작업이 취소되었습니다.")
                    
                    if self.bs_timer_type_var.get() == 'digital':
                        # 디지털 시계 스타일 분기
                        style = self.bs_timer_style_var.get()
                        ms = int((t - int(t)) * 100)
                        m_int, s_int = divmod(int(t), 60)
                        h_int, m_int = divmod(m_int, 60)
                        if style == '초 생략 (HH:MM)':
                            time_str = f"{h_int:02d}:{m_int:02d}"
                        elif style == '밀리초 생략 (HH:MM:SS)':
                            time_str = f"{h_int:02d}:{m_int:02d}:{s_int:02d}"
                        else: # 기본
                            time_str = f"{h_int:02d}:{m_int:02d}:{s_int:02d}.{ms:02d}"
                        
                        txt_clip = TextClip(time_str, fontsize=int(timer_w_px / 5), color='white', font='Arial-Bold')
                        return txt_clip.get_frame(t)

                    else: # 아날로그 시계
                        side = max(timer_w_px, int(height * (self.bs_timer_w_pct.get() / 100.0) * 0.9))
                        img = Image.new('RGBA', (side, side), (0, 0, 0, 0))
                        draw = ImageDraw.Draw(img)
                        center_x, center_y = side / 2, side / 2
                        radius = side / 2 * 0.9
                        style = self.bs_timer_style_var.get()

                        if style == '기본 (선)':
                            draw.ellipse((center_x-radius, center_y-radius, center_x+radius, center_y+radius), outline='white', width=max(2, int(side/100)))
                        elif style == '심플 (점)':
                            for i in range(12):
                                angle = math.radians(-60 + i * 30)
                                x = center_x + radius * math.cos(angle)
                                y = center_y + radius * math.sin(angle)
                                draw.ellipse((x-side/100, y-side/100, x+side/100, y+side/100), fill='white')
                        elif style == '모던 (눈금)':
                            draw.ellipse((center_x - radius, center_y - radius, center_x + radius, center_y + radius), outline='white', width=max(1, int(side/200)))
                            for i in range(60):
                                angle = math.radians(-90 + i * 6)
                                len_factor = 0.9 if i % 5 == 0 else 0.95
                                x1 = center_x + radius * len_factor * math.cos(angle)
                                y1 = center_y + radius * len_factor * math.sin(angle)
                                x2 = center_x + radius * math.cos(angle)
                                y2 = center_y + radius * math.sin(angle)
                                draw.line((x1, y1, x2, y2), fill='white', width=max(1, int(side/200)))

                        s_angle = math.radians(270 + (t % 60) * 6)
                        s_len = radius * 0.85
                        draw.line((center_x, center_y, center_x + s_len*math.cos(s_angle), center_y + s_len*math.sin(s_angle)), fill='red', width=max(1, int(side/200)))
                        
                        m_angle = math.radians(270 + ((t/60) % 60) * 6)
                        m_len = radius * 0.75
                        draw.line((center_x, center_y, center_x + m_len*math.cos(m_angle), center_y + m_len*math.sin(m_angle)), fill='white', width=max(2, int(side/100)))

                        h_angle = math.radians(270 + ((t/3600) % 12) * 30)
                        h_len = radius * 0.5
                        draw.line((center_x, center_y, center_x + h_len*math.cos(h_angle), center_y + h_len*math.sin(h_angle)), fill='white', width=max(3, int(side/80)))
                        
                        return np.array(img)
                
                timer_clip = VideoClip(make_frame=make_timer_frame, duration=duration, ismask=self.bs_timer_type_var.get() == 'analog')
                
                pos_x_center = self.bs_timer_x_pct.get() / 100.0
                pos_y_center = self.bs_timer_y_pct.get() / 100.0
                timer_clip = timer_clip.with_position((pos_x_center, pos_y_center), relative=True)
                clips_to_compose.append(timer_clip)
            
            final_clip = CompositeVideoClip(clips_to_compose, size=size)

            class MoviePyLogger:
                def __init__(self, callback, duration): self.callback = callback; self.duration = duration
                def __call__(self, prog_bar):
                    for name, value in prog_bar.items():
                        if name == "t": self.callback("bar", (value/self.duration)*100, "")

            self.root.after(0, self.bs_progress_text_var.set, "영상 인코딩 시작...")
            final_clip.write_videofile(save_path, codec="libx264", audio_codec="aac", threads=os.cpu_count() or 1, fps=30, logger=MoviePyLogger(self.update_bs_progress, duration))
            
            if not self.app.cancel_event.is_set():
                self.root.after(0, lambda: CompletionDialog(self.root, "제작 완료", save_path))
        
        except StopIteration:
            self.app.log_message("검은 화면 제작이 사용자에 의해 중지되었습니다.")
            if os.path.exists(save_path): os.remove(save_path) # 불완전한 파일 삭제
        except Exception as e:
            self.app.log_message(f"검은 화면 제작 중 오류: {e}")
            self.root.after(0, lambda e=e: messagebox.showerror("오류", f"제작 중 오류가 발생했습니다: {e}"))
        finally:
            self.root.after(0, self.bs_start_btn.config, {'state': tk.NORMAL})
            self.root.after(0, self.bs_progress_bar.config, {'value': 0})
            self.root.after(0, self.bs_progress_text_var.set, "대기 중...")
            self.app.processing_thread = None

    def update_bs_progress(self, progress_type, percent, message):
        if progress_type == "bar":
            self.root.after(0, self.bs_progress_bar.config, {'value': percent})
            self.root.after(0, self.bs_progress_text_var.set, f"인코딩 중... {int(percent)}%")