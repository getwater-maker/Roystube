// ============================================
// Roystube - 통합 영상 디자인 스튜디오
// ============================================

console.log('[StudioDesign] 통합 영상 디자인 모듈 로드 시작...');

// 전역 상태 관리
const studioDesign = {
    sentences: [],
    characters: [],
    currentProject: null,
    previewPlayer: null,
    scriptFileName: '', // 대본 파일명 저장
    scriptFolderPath: '', // 대본 폴더 경로 저장
    settings: {
        bgPath: '',
        scriptPath: '',
        bgmEnabled: false,
        bgmPath: '',
        bgmVolume: 30,
        bgmLoop: true,
        resolution: '1920x1080',
        fps: 30,
        quality: 'high',
        outputFolder: ''
    }
};

// 전역 음성 목록 캐시 (voices_config.json에서 로드)
let cachedVoicesList = [];

// 되돌리기(Undo) 히스토리 관리
const undoHistory = {
    stack: [],
    maxSize: 50,  // 최대 히스토리 개수

    // 현재 상태 저장
    save() {
        const state = {
            sentences: JSON.parse(JSON.stringify(studioDesign.sentences)),
            characters: JSON.parse(JSON.stringify(studioDesign.characters)),
            timestamp: Date.now()
        };
        this.stack.push(state);

        // 최대 개수 초과 시 오래된 것 제거
        if (this.stack.length > this.maxSize) {
            this.stack.shift();
        }
        console.log(`[StudioDesign] Undo 히스토리 저장 (${this.stack.length}개)`);
    },

    // 이전 상태로 복원
    undo() {
        if (this.stack.length === 0) {
            addLog('되돌릴 작업이 없습니다', 'warning');
            return false;
        }

        const state = this.stack.pop();
        studioDesign.sentences = state.sentences;
        studioDesign.characters = state.characters;

        // UI 갱신
        renderSentences();
        renderCharacters();

        addLog('되돌리기 완료', 'success');
        console.log(`[StudioDesign] Undo 실행 (남은 히스토리: ${this.stack.length}개)`);
        return true;
    },

    // 히스토리 초기화
    clear() {
        this.stack = [];
    }
};

// 음성 목록 로드 함수
async function loadVoicesConfig() {
    if (typeof eel !== 'undefined') {
        try {
            const result = await eel.get_voices_config()();
            if (result && result.success) {
                cachedVoicesList = result.voices;
                console.log(`[StudioDesign] 음성 목록 로드 완료: ${cachedVoicesList.length}개`);
            } else {
                console.warn('[StudioDesign] 음성 목록 로드 실패, 기본값 사용');
                cachedVoicesList = getDefaultVoices();
            }
        } catch (e) {
            console.error('[StudioDesign] 음성 목록 로드 오류:', e);
            cachedVoicesList = getDefaultVoices();
        }
    } else {
        cachedVoicesList = getDefaultVoices();
    }
}

// 기본 음성 목록 (fallback)
function getDefaultVoices() {
    return [
        {value: 'ko-KR-Standard-A', label: 'Standard-A', gender: '여성', model: 'Standard'},
        {value: 'ko-KR-Standard-D', label: 'Standard-D', gender: '남성', model: 'Standard'}
    ];
}

// ============================================
// 미리보기 관련
// ============================================

function openPreviewPopup() {
    console.log('[StudioDesign] 미리보기 팝업 열기');

    const modal = document.getElementById('video-preview-modal');
    if (!modal) {
        alert('미리보기 팝업을 찾을 수 없습니다.');
        return;
    }

    // 배경 이미지 설정
    const previewBg = document.getElementById('preview-background');
    if (previewBg) {
        if (studioDesign.settings.bgPath) {
            previewBg.style.backgroundImage = `url('file:///${studioDesign.settings.bgPath.replace(/\\/g, '/')}')`;
            previewBg.style.backgroundSize = 'cover';
            previewBg.style.backgroundPosition = 'center';
        } else {
            previewBg.style.backgroundImage = '';
            previewBg.style.backgroundColor = '#1a1a2e';
        }
    }

    // 자막 초기화
    const subtitle = document.getElementById('preview-subtitle');
    if (subtitle) {
        subtitle.textContent = '';
    }

    // 진행 상태 초기화
    updatePreviewProgress(0, 0);
    updatePreviewClipInfo(0, studioDesign.sentences.length);

    // 모달 표시
    modal.style.display = 'flex';
}

function closePreviewPopup() {
    const modal = document.getElementById('video-preview-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    // 재생 중지
    stopPreviewPlayback();
}

// 미리보기 재생 상태
const previewPlayback = {
    isPlaying: false,
    currentClipIndex: 0,
    currentAudio: null,
    clips: []
};

function togglePreviewPlay() {
    if (previewPlayback.isPlaying) {
        stopPreviewPlayback();
    } else {
        startPreviewPlayback();
    }
}

function startPreviewPlayback() {
    if (studioDesign.sentences.length === 0) {
        alert('재생할 클립이 없습니다.');
        return;
    }

    // DOM 텍스트 동기화
    syncAllSentenceTexts();

    previewPlayback.isPlaying = true;
    previewPlayback.currentClipIndex = 0;
    previewPlayback.clips = [...studioDesign.sentences];

    // 버튼 텍스트 변경
    const playBtn = document.getElementById('preview-play-btn');
    if (playBtn) playBtn.textContent = '⏸ 일시정지';

    playPreviewClip();
}

function stopPreviewPlayback() {
    previewPlayback.isPlaying = false;

    if (previewPlayback.currentAudio) {
        previewPlayback.currentAudio.pause();
        previewPlayback.currentAudio = null;
    }

    // 버튼 텍스트 변경
    const playBtn = document.getElementById('preview-play-btn');
    if (playBtn) playBtn.textContent = '▶ 재생';

    // 자막 초기화
    const subtitle = document.getElementById('preview-subtitle');
    if (subtitle) subtitle.textContent = '';
}

function playPreviewClip() {
    if (!previewPlayback.isPlaying) return;

    if (previewPlayback.currentClipIndex >= previewPlayback.clips.length) {
        // 재생 완료
        stopPreviewPlayback();
        previewPlayback.currentClipIndex = 0;
        updatePreviewClipInfo(0, previewPlayback.clips.length);
        return;
    }

    const clip = previewPlayback.clips[previewPlayback.currentClipIndex];
    const character = studioDesign.characters.find(c => c.name === clip.character);

    // 클립 정보 업데이트
    updatePreviewClipInfo(previewPlayback.currentClipIndex + 1, previewPlayback.clips.length);

    // 자막 표시
    const subtitle = document.getElementById('preview-subtitle');
    if (subtitle) {
        subtitle.textContent = clip.text;
    }

    // 그룹이 있으면 그룹 전체 텍스트로 TTS
    let ttsText = clip.text;
    if (clip.groupId) {
        const groupClips = previewPlayback.clips.filter(c => c.groupId === clip.groupId);
        const clipIndexInGroup = groupClips.findIndex(c => c.id === clip.id);

        // 그룹의 첫 번째 클립일 때만 TTS 요청
        if (clipIndexInGroup === 0 && groupClips.length > 1) {
            ttsText = groupClips.map(c => c.text).join('');
        } else if (clipIndexInGroup > 0) {
            // 그룹 내 이후 클립은 이미 재생된 오디오의 일부이므로 자막만 표시하고 대기
            // 실제로는 타임코드 기반으로 자막 전환해야 하지만, 간단히 글자수 비율로 대기
            const prevClipsText = groupClips.slice(0, clipIndexInGroup).map(c => c.text).join('');
            const totalText = groupClips.map(c => c.text).join('');
            // 이 클립은 스킵하고 다음으로
            previewPlayback.currentClipIndex++;
            setTimeout(playPreviewClip, 100);
            return;
        }
    }

    if (!character) {
        // 캐릭터 없으면 2초 후 다음 클립
        setTimeout(() => {
            previewPlayback.currentClipIndex++;
            playPreviewClip();
        }, 2000);
        return;
    }

    // TTS 요청
    const sentenceData = { text: ttsText };
    const characterData = {
        voice: character.voice,
        speed: character.speed,
        pitch: character.pitch
    };

    if (typeof eel !== 'undefined') {
        eel.studio_preview_sentence(sentenceData, characterData)(function(result) {
            if (result && result.success && previewPlayback.isPlaying) {
                playPreviewAudio(result.audioData);
            } else {
                // 실패 시 2초 후 다음
                setTimeout(() => {
                    previewPlayback.currentClipIndex++;
                    playPreviewClip();
                }, 2000);
            }
        });
    } else {
        // 테스트용: 2초 후 다음
        setTimeout(() => {
            previewPlayback.currentClipIndex++;
            playPreviewClip();
        }, 2000);
    }
}

function playPreviewAudio(audioData) {
    try {
        const byteCharacters = atob(audioData);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);

        previewPlayback.currentAudio = new Audio(url);
        previewPlayback.currentAudio.onended = function() {
            URL.revokeObjectURL(url);
            if (previewPlayback.isPlaying) {
                previewPlayback.currentClipIndex++;
                playPreviewClip();
            }
        };
        previewPlayback.currentAudio.onerror = function() {
            URL.revokeObjectURL(url);
            previewPlayback.currentClipIndex++;
            playPreviewClip();
        };
        previewPlayback.currentAudio.play();
    } catch (e) {
        console.error('미리보기 오디오 재생 오류:', e);
        previewPlayback.currentClipIndex++;
        playPreviewClip();
    }
}

function updatePreviewProgress(current, total) {
    const progressBar = document.getElementById('preview-progress');
    const timeDisplay = document.getElementById('preview-time');

    if (progressBar) {
        const percent = total > 0 ? (current / total) * 100 : 0;
        progressBar.style.width = percent + '%';
    }

    if (timeDisplay) {
        timeDisplay.textContent = `${formatTime(current)} / ${formatTime(total)}`;
    }
}

function updatePreviewClipInfo(current, total) {
    const clipInfo = document.getElementById('preview-clip-number');
    if (clipInfo) {
        clipInfo.textContent = `클립: ${current}/${total}`;
    }
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 초기화 함수
function resetStudioDesign() {
    console.log('[StudioDesign] 초기화');

    if (!confirm('모든 내용을 초기화하시겠습니까?\n(대본, 배경, 캐릭터 설정이 모두 삭제됩니다)')) {
        return;
    }

    // 상태 초기화
    studioDesign.sentences = [];
    studioDesign.characters = [];
    studioDesign.currentProject = null;
    studioDesign.scriptFileName = '';
    studioDesign.scriptFolderPath = '';
    studioDesign.settings = {
        bgPath: '',
        scriptPath: '',
        bgmEnabled: false,
        bgmPath: '',
        bgmVolume: 30,
        bgmLoop: true,
        resolution: '1920x1080',
        fps: 30,
        quality: 'high',
        outputFolder: ''
    };

    // UI 초기화 - 문장 목록
    const sentenceList = document.getElementById('studio-sentence-list');
    if (sentenceList) {
        sentenceList.innerHTML = '<div class="empty-state">대본을 추가해주세요</div>';
    }

    // 타임라인 타이틀 초기화
    updateTimelineTitle();

    // UI 초기화 - 캐릭터 목록
    const characterList = document.getElementById('studio-character-list');
    if (characterList) {
        characterList.innerHTML = '<div class="empty-state">캐릭터가 없습니다</div>';
    }

    // UI 초기화 - 미리보기 캔버스
    const canvas = document.getElementById('studio-preview-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#666';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('미리보기', canvas.width / 2, canvas.height / 2);
    }

    // UI 초기화 - 해상도 선택
    const resolutionSelect = document.getElementById('studio-resolution');
    if (resolutionSelect) {
        resolutionSelect.value = '1920x1080';
    }

    addLog('초기화 완료', 'info');
}

// ============================================
// 배경 관련
// ============================================

function selectAndAddBackground() {
    console.log('[StudioDesign] 배경 추가');
    if (typeof eel !== 'undefined') {
        eel.select_file('이미지 파일 (*.jpg;*.png;*.jpeg;*.bmp;*.gif)|영상 파일 (*.mp4;*.avi;*.mov)')(function(path) {
            if (path && typeof path === 'string') {
                studioDesign.settings.bgPath = path;
                const fileName = path.split('\\').pop().split('/').pop();
                addLog('배경 추가: ' + fileName, 'success');

                // 미리보기에 이미지 표시
                updatePreviewWithBackground(path);
            }
        });
    }
}

function updatePreviewWithBackground(filePath) {
    const canvas = document.getElementById('studio-preview-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const img = new Image();

    // 파일 경로를 data URL로 변환하기 위해 eel 사용
    if (typeof eel !== 'undefined') {
        eel.get_file_as_base64(filePath)(function(result) {
            if (result && result.success) {
                img.onload = function() {
                    // 캔버스 크기에 맞춰 이미지 그리기
                    ctx.clearRect(0, 0, canvas.width, canvas.height);

                    // 이미지 비율 유지하면서 캔버스에 맞추기
                    const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
                    const x = (canvas.width / 2) - (img.width / 2) * scale;
                    const y = (canvas.height / 2) - (img.height / 2) * scale;

                    ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
                };
                img.src = 'data:image/png;base64,' + result.data;
            }
        });
    }
}

// ============================================
// 대본 관련
// ============================================

function selectAndAnalyzeScript() {
    console.log('[StudioDesign] 대본 추가 및 분석');

    if (typeof eel !== 'undefined') {
        eel.select_file('텍스트 파일 (*.txt)|Word 문서 (*.docx)')(function(path) {
            if (path && typeof path === 'string') {
                // 기존 데이터 초기화
                resetStudioData();

                // 파일명과 폴더 경로 저장 (경로 구분자 정규화)
                const normalizedPath = path.replace(/\//g, '\\'); // / -> \\ 변환
                const pathParts = normalizedPath.split('\\');
                const fileName = pathParts.pop();
                studioDesign.scriptFileName = fileName.replace(/\.(txt|docx)$/i, '');
                studioDesign.scriptFolderPath = pathParts.join('\\');
                studioDesign.settings.scriptPath = normalizedPath;
                studioDesign.settings.outputFolder = studioDesign.scriptFolderPath; // 출력 폴더 자동 설정

                // 타임라인 타이틀에 파일명 표시
                updateTimelineTitle();

                // 대본 분석 시작
                addLog('대본 분석 중...', 'info');

                eel.load_script_for_studio(path)(function(result) {
                    if (result && result.success) {
                        studioDesign.sentences = result.sentences || [];

                        // 발견된 캐릭터 확인 및 처리
                        if (result.detectedCharacters && result.detectedCharacters.length > 0) {
                            processDetectedCharacters(result.detectedCharacters);
                        }

                        renderSentences();
                        addLog(`대본 분석 완료: ${studioDesign.sentences.length}개 문장`, 'success');
                    } else {
                        addLog('대본 분석 실패: ' + (result ? result.error : '알 수 없는 오류'), 'error');
                    }
                });
            }
        });
    } else {
        // 기존 데이터 초기화
        resetStudioData();

        // 테스트용 더미 데이터
        studioDesign.scriptFileName = '테스트대본';
        studioDesign.scriptFolderPath = 'C:\\test';
        studioDesign.settings.outputFolder = 'C:\\test';

        // 타임라인 타이틀에 파일명 표시
        updateTimelineTitle();

        studioDesign.sentences = [
            { id: 1, text: '첫 번째 문장입니다.', character: '나레이션', startTime: '00:00:00', endTime: '00:00:03' },
            { id: 2, text: '두 번째 문장입니다.', character: '나레이션', startTime: '00:00:03', endTime: '00:00:06' }
        ];
        renderSentences();
        addLog('테스트 대본 분석 완료', 'info');
    }
}

// 스튜디오 데이터 초기화
function resetStudioData() {
    // 문장 데이터 초기화
    studioDesign.sentences = [];

    // 되돌리기 히스토리 초기화
    if (typeof undoHistory !== 'undefined') {
        undoHistory.clear();
    }

    // 선택 미리듣기 중지
    if (typeof selectedPreview !== 'undefined' && selectedPreview.isPlaying) {
        stopSelectedPreview();
    }

    // 파일 정보 초기화
    studioDesign.scriptFileName = '';
    studioDesign.scriptFolderPath = '';
    studioDesign.settings.scriptPath = '';

    addLog('기존 데이터 초기화됨', 'info');
}

// 타임라인 타이틀에 대본 파일명 표시
function updateTimelineTitle() {
    const titleSpan = document.getElementById('timeline-script-name');
    if (titleSpan) {
        if (studioDesign.scriptFileName) {
            titleSpan.textContent = '| ' + studioDesign.scriptFileName;
        } else {
            titleSpan.textContent = '';
        }
    }
}

// ============================================
// BGM 관련
// ============================================

function toggleBGMSettings(enabled) {
    const bgmSettings = document.getElementById('studio-bgm-settings');
    if (bgmSettings) {
        bgmSettings.style.display = enabled ? 'block' : 'none';
        studioDesign.settings.bgmEnabled = enabled;
        addLog('배경음악: ' + (enabled ? 'ON' : 'OFF'), 'info');
    }
}

function selectBGM() {
    console.log('[StudioDesign] BGM 파일 선택');
    if (typeof eel !== 'undefined') {
        eel.select_file(['음악 파일 (*.mp3;*.wav;*.m4a)'])(function(path) {
            if (path) {
                document.getElementById('studio-bgm-path').value = path;
                studioDesign.settings.bgmPath = path;
                const fileName = path.split('\\').pop().split('/').pop();
                addLog('BGM 선택: ' + fileName, 'success');
            }
        });
    }
}

// BGM 볼륨 슬라이더 업데이트
document.addEventListener('DOMContentLoaded', function() {
    const bgmVolumeSlider = document.getElementById('studio-bgm-volume');
    if (bgmVolumeSlider) {
        bgmVolumeSlider.addEventListener('input', function() {
            const value = this.value;
            studioDesign.settings.bgmVolume = parseInt(value);
            const sliderValue = this.parentElement.querySelector('.slider-value');
            if (sliderValue) {
                sliderValue.textContent = value + '%';
            }
        });
    }
});

// ============================================
// 프로젝트 관리
// ============================================

function saveProject() {
    console.log('[StudioDesign] 프로젝트 저장');

    const projectData = {
        sentences: studioDesign.sentences,
        characters: studioDesign.characters,
        settings: studioDesign.settings,
        version: '1.0'
    };

    if (typeof eel !== 'undefined') {
        eel.save_project_file(projectData)(function(result) {
            if (result.success) {
                addLog('프로젝트 저장 완료: ' + result.path, 'success');
            } else {
                addLog('프로젝트 저장 실패', 'error');
            }
        });
    } else {
        console.log('Project data:', projectData);
        addLog('프로젝트 저장 (테스트 모드)', 'info');
    }
}

function loadProject() {
    console.log('[StudioDesign] 프로젝트 불러오기');

    if (typeof eel !== 'undefined') {
        eel.load_project_file()(function(result) {
            if (result.success) {
                studioDesign.sentences = result.data.sentences || [];
                studioDesign.characters = result.data.characters || [];
                studioDesign.settings = result.data.settings || studioDesign.settings;

                renderSentences();
                renderCharacters();
                addLog('프로젝트 로드 완료', 'success');
            } else {
                addLog('프로젝트 로드 실패', 'error');
            }
        });
    }
}

function resetAll() {
    if (!confirm('모든 내용을 초기화하시겠습니까?')) {
        return;
    }

    studioDesign.sentences = [];
    studioDesign.characters = [];
    studioDesign.settings = {
        bgType: 'color',
        bgPath: '',
        scriptPath: '',
        bgmPath: '',
        bgmVolume: 30,
        bgmLoop: true,
        resolution: '1920x1080',
        fps: 30,
        quality: 'high',
        outputFolder: ''
    };

    renderSentences();
    renderCharacters();
    addLog('초기화 완료', 'info');
}

// ============================================
// 출력 폴더 선택
// ============================================

function selectOutputFolder() {
    console.log('[StudioDesign] 출력 폴더 선택');
    if (typeof eel !== 'undefined') {
        eel.select_folder()(function(path) {
            if (path) {
                document.getElementById('studio-output-folder').value = path;
                studioDesign.settings.outputFolder = path;
                addLog('출력 폴더 선택: ' + path, 'info');
            }
        });
    }
}

// ============================================
// 출력 관련
// ============================================

// MP3 → SRT 변환 함수
function convertMP3toSRT() {
    console.log('[StudioDesign] MP3 → SRT 변환');

    if (typeof eel !== 'undefined') {
        // MP3 파일 선택
        eel.select_mp3_file()(function(mp3Path) {
            if (!mp3Path) {
                return;
            }

            addLog('MP3 파일 선택: ' + mp3Path.split('\\').pop(), 'info');
            addLog('Whisper 분석 시작...', 'info');
            showProgress();

            // 백엔드에서 MP3 분석 및 SRT 생성
            eel.convert_mp3_to_srt(mp3Path)(function(result) {
                hideProgress();

                if (result && result.success) {
                    addLog('✅ SRT 생성 완료: ' + result.srtFileName, 'success');
                    addLog(`   총 ${result.segmentCount}개 자막, ${formatDuration(result.duration)}`, 'info');

                    // 완료 알림
                    alert(`SRT 파일이 생성되었습니다!\n\n파일: ${result.srtFileName}\n자막 수: ${result.segmentCount}개\n길이: ${formatDuration(result.duration)}`);
                } else {
                    addLog('❌ SRT 생성 실패: ' + (result?.error || '알 수 없는 오류'), 'error');
                    alert('SRT 생성 실패: ' + (result?.error || '알 수 없는 오류'));
                }
            });
        });
    } else {
        alert('백엔드 연결이 필요합니다.');
    }
}

function calculateTimecodeAndGenerateMP3() {
    console.log('[StudioDesign] 타임코드 계산 및 MP3 생성');

    if (!studioDesign.scriptFileName) {
        alert('먼저 대본을 추가해주세요.');
        return;
    }

    if (studioDesign.sentences.length === 0) {
        alert('대본 분석이 완료되지 않았습니다.');
        return;
    }

    const outputFileName = 'MP3_' + studioDesign.scriptFileName + '.mp3';
    const outputPath = studioDesign.settings.outputFolder + '\\' + outputFileName;

    addLog('타임코드 계산 및 MP3 생성 시작...', 'info');
    addLog('1단계: 각 문장 TTS 생성 중...', 'info');
    showProgress();

    const generateData = {
        sentences: studioDesign.sentences,
        characters: studioDesign.characters,
        settings: studioDesign.settings,
        outputPath: outputPath
    };

    if (typeof eel !== 'undefined') {
        eel.calculate_timecode_and_generate_mp3(generateData)(function(result) {
            hideProgress();
            if (result && result.success) {
                // 타임코드가 업데이트된 문장 데이터 받기
                if (result.sentences) {
                    studioDesign.sentences = result.sentences;
                    renderSentences();
                }
                addLog(`타임코드 계산 완료: 총 ${formatDuration(result.totalDuration)}`, 'success');
                addLog('✅ MP3 생성 완료: ' + outputFileName, 'success');

                // SRT 파일 생성 완료 메시지
                if (result.srtPath) {
                    const srtFileName = result.srtPath.split('\\').pop();
                    addLog('✅ SRT 자막 생성 완료: ' + srtFileName, 'success');
                }

                addLog('🎉 모든 파일 생성 완료!', 'success');
            } else {
                addLog('처리 실패: ' + (result ? result.error : '알 수 없는 오류'), 'error');
            }
        });
    } else {
        // 테스트 모드: 더미 타임코드 생성
        let currentTime = 0;
        studioDesign.sentences.forEach((sentence, index) => {
            const duration = 2 + (sentence.text.length / 10); // 간단한 예상 시간
            sentence.startTime = formatTime(currentTime);
            sentence.endTime = formatTime(currentTime + duration);
            sentence.duration = duration;
            currentTime += duration;
        });

        setTimeout(() => {
            hideProgress();
            renderSentences();
            addLog('타임코드 계산 완료 (테스트 모드)', 'success');
            addLog('MP3 생성 완료: ' + outputFileName + ' (테스트 모드)', 'success');
        }, 2000);
    }
}

// 시간을 HH:MM:SS 형식으로 변환
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 시간을 읽기 쉬운 형식으로 변환
function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m > 0) {
        return `${m}분 ${s}초`;
    }
    return `${s}초`;
}

function generateVideo() {
    console.log('[StudioDesign] 영상 생성');

    if (!studioDesign.scriptFileName) {
        alert('먼저 대본을 추가해주세요.');
        return;
    }

    if (studioDesign.sentences.length === 0) {
        alert('대본 분석이 완료되지 않았습니다.');
        return;
    }

    const outputFileName = '영상_' + studioDesign.scriptFileName + '.mp4';
    const outputPath = studioDesign.settings.outputFolder + '\\' + outputFileName;

    addLog('영상 생성 시작: ' + outputFileName, 'info');
    showProgress();

    const generateData = {
        sentences: studioDesign.sentences,
        characters: studioDesign.characters,
        settings: studioDesign.settings,
        outputPath: outputPath
    };

    if (typeof eel !== 'undefined') {
        eel.generate_video_studio(generateData)(function(result) {
            hideProgress();
            if (result.success) {
                addLog('영상 생성 완료: ' + outputFileName, 'success');
            } else {
                addLog('영상 생성 실패: ' + result.error, 'error');
            }
        });
    } else {
        setTimeout(() => {
            hideProgress();
            addLog('영상 생성 완료: ' + outputFileName + ' (테스트 모드)', 'success');
        }, 3000);
    }
}

function generateEQ() {
    console.log('[StudioDesign] EQ 생성');

    if (!studioDesign.scriptFileName) {
        alert('먼저 대본을 추가해주세요.');
        return;
    }

    if (studioDesign.sentences.length === 0) {
        alert('대본 분석이 완료되지 않았습니다.');
        return;
    }

    const outputFileName = 'EQ_' + studioDesign.scriptFileName + '.mov';
    const outputPath = studioDesign.settings.outputFolder + '\\' + outputFileName;

    addLog('EQ 생성 시작: ' + outputFileName, 'info');
    showProgress();

    const generateData = {
        sentences: studioDesign.sentences,
        characters: studioDesign.characters,
        settings: studioDesign.settings,
        outputPath: outputPath
    };

    if (typeof eel !== 'undefined') {
        eel.generate_eq_studio(generateData)(function(result) {
            hideProgress();
            if (result.success) {
                addLog('EQ 생성 완료: ' + outputFileName, 'success');
            } else {
                addLog('EQ 생성 실패: ' + result.error, 'error');
            }
        });
    } else {
        setTimeout(() => {
            hideProgress();
            addLog('EQ 생성 완료: ' + outputFileName + ' (테스트 모드)', 'success');
        }, 3000);
    }
}

// ============================================
// 진행 상황 표시
// ============================================

function showProgress() {
    const progressEl = document.getElementById('studio-progress');
    if (progressEl) {
        progressEl.style.display = 'block';
    }
}

function hideProgress() {
    const progressEl = document.getElementById('studio-progress');
    if (progressEl) {
        progressEl.style.display = 'none';
    }
}

// updateProgress는 아래 eel용 함수 사용

// ============================================
// 문장 관리
// ============================================

function addSentence() {
    console.log('[StudioDesign] 문장 추가');

    // 되돌리기를 위해 현재 상태 저장
    undoHistory.save();

    const newSentence = {
        id: Date.now(),
        text: '새 문장을 입력하세요...',
        character: '나레이션',
        startTime: '00:00:00',
        endTime: '00:00:03'
    };

    studioDesign.sentences.push(newSentence);
    renderSentences();
    addLog('문장 추가됨', 'info');
}

function selectAllSentences() {
    const checkboxes = document.querySelectorAll('.sentence-checkbox');
    checkboxes.forEach(cb => cb.checked = true);
}

function deleteSelectedSentences() {
    const checkboxes = document.querySelectorAll('.sentence-checkbox:checked');
    if (checkboxes.length === 0) {
        alert('삭제할 문장을 선택해주세요.');
        return;
    }

    if (!confirm(`${checkboxes.length}개 문장을 삭제하시겠습니까?`)) {
        return;
    }

    // 되돌리기를 위해 현재 상태 저장
    undoHistory.save();

    checkboxes.forEach(cb => {
        const id = parseInt(cb.closest('.sentence-item').dataset.id);
        const index = studioDesign.sentences.findIndex(s => s.id === id);
        if (index > -1) {
            studioDesign.sentences.splice(index, 1);
        }
    });

    renderSentences();
    addLog(`${checkboxes.length}개 문장 삭제됨`, 'info');
}

function playSentence() {
    addLog('문장 재생 (추후 구현)', 'info');
}

function stopSentence() {
    addLog('재생 정지', 'info');
}

function mergeSentences() {
    addLog('문장 병합 (추후 구현)', 'info');
}

function splitSentence() {
    addLog('문장 분할 (추후 구현)', 'info');
}

function moveUp() {
    addLog('위로 이동 (추후 구현)', 'info');
}

function moveDown() {
    addLog('아래로 이동 (추후 구현)', 'info');
}

function deleteSentence(id) {
    const index = studioDesign.sentences.findIndex(s => s.id === id);
    if (index > -1) {
        // 되돌리기를 위해 현재 상태 저장
        undoHistory.save();

        studioDesign.sentences.splice(index, 1);
        renderSentences();
        addLog('문장 삭제됨', 'info');
    }
}

function previewSentence(id) {
    // 미리듣기 전에 DOM 텍스트를 데이터에 동기화
    syncAllSentenceTexts();

    const sentence = studioDesign.sentences.find(s => s.id === id);
    if (!sentence) return;

    const character = studioDesign.characters.find(c => c.name === sentence.character);
    if (!character) {
        addLog('캐릭터를 찾을 수 없습니다', 'error');
        return;
    }

    // 그룹이 있으면 그룹 전체 텍스트로 TTS 변환
    let ttsText = sentence.text;
    if (sentence.groupId) {
        const groupClips = studioDesign.sentences.filter(s => s.groupId === sentence.groupId);
        if (groupClips.length > 1) {
            ttsText = groupClips.map(s => s.text).join('');
            addLog(`그룹 문장 미리듣기 중... (${groupClips.length}개 클립)`, 'info');
        } else {
            addLog(`문장 미리듣기 중...`, 'info');
        }
    } else {
        addLog(`문장 미리듣기 중...`, 'info');
    }

    const sentenceData = {
        text: ttsText
    };

    const characterData = {
        voice: character.voice,
        speed: character.speed,
        pitch: character.pitch
    };

    if (typeof eel !== 'undefined') {
        eel.studio_preview_sentence(sentenceData, characterData)(function(result) {
            if (result && result.success) {
                playAudioFile(result.audioData);
                addLog('문장 재생 중', 'success');
            } else {
                addLog('미리듣기 실패: ' + (result ? result.error : '알 수 없는 오류'), 'error');
            }
        });
    } else {
        addLog('미리듣기 실패: 백엔드 연결 없음', 'error');
    }
}

// 선택한 클립들만 순차적으로 미리듣기
const selectedPreview = {
    queue: [],
    isPlaying: false,
    currentIndex: 0,
    currentAudio: null
};

function previewSelectedSentences() {
    const checkboxes = document.querySelectorAll('.sentence-checkbox:checked');
    if (checkboxes.length === 0) {
        alert('미리듣기할 클립을 선택해주세요.');
        return;
    }

    // 이미 재생 중이면 중지
    if (selectedPreview.isPlaying) {
        stopSelectedPreview();
        return;
    }

    // 미리듣기 전에 DOM 텍스트를 데이터에 동기화
    syncAllSentenceTexts();

    // 선택된 클립들의 ID 수집 (순서대로)
    selectedPreview.queue = [];
    checkboxes.forEach(cb => {
        const id = parseInt(cb.closest('.sentence-item').dataset.id);
        selectedPreview.queue.push(id);
    });

    selectedPreview.currentIndex = 0;
    selectedPreview.isPlaying = true;

    addLog(`선택한 ${selectedPreview.queue.length}개 클립 미리듣기 시작`, 'info');
    playNextSelectedClip();
}

function playNextSelectedClip() {
    if (!selectedPreview.isPlaying || selectedPreview.currentIndex >= selectedPreview.queue.length) {
        stopSelectedPreview();
        addLog('선택 클립 미리듣기 완료', 'success');
        return;
    }

    const sentenceId = selectedPreview.queue[selectedPreview.currentIndex];
    const sentence = studioDesign.sentences.find(s => s.id === sentenceId);
    if (!sentence) {
        selectedPreview.currentIndex++;
        playNextSelectedClip();
        return;
    }

    const character = studioDesign.characters.find(c => c.name === sentence.character);
    if (!character) {
        selectedPreview.currentIndex++;
        playNextSelectedClip();
        return;
    }

    // 현재 재생 중인 클립 하이라이트
    highlightPlayingClip(sentenceId);

    const sentenceData = { text: sentence.text };
    const characterData = {
        voice: character.voice,
        speed: character.speed,
        pitch: character.pitch
    };

    if (typeof eel !== 'undefined') {
        eel.studio_preview_sentence(sentenceData, characterData)(function(result) {
            if (result && result.success && selectedPreview.isPlaying) {
                playAudioForSelectedPreview(result.audioData);
            } else {
                // 실패 시 다음 클립으로
                selectedPreview.currentIndex++;
                playNextSelectedClip();
            }
        });
    }
}

function playAudioForSelectedPreview(audioData) {
    try {
        const byteCharacters = atob(audioData);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);

        selectedPreview.currentAudio = new Audio(url);
        selectedPreview.currentAudio.onended = function() {
            URL.revokeObjectURL(url);
            clearPlayingHighlight();
            selectedPreview.currentIndex++;
            playNextSelectedClip();
        };
        selectedPreview.currentAudio.onerror = function() {
            URL.revokeObjectURL(url);
            clearPlayingHighlight();
            selectedPreview.currentIndex++;
            playNextSelectedClip();
        };
        selectedPreview.currentAudio.play();
    } catch (e) {
        console.error('오디오 재생 오류:', e);
        selectedPreview.currentIndex++;
        playNextSelectedClip();
    }
}

function stopSelectedPreview() {
    selectedPreview.isPlaying = false;
    if (selectedPreview.currentAudio) {
        selectedPreview.currentAudio.pause();
        selectedPreview.currentAudio = null;
    }
    clearPlayingHighlight();
}

function highlightPlayingClip(sentenceId) {
    clearPlayingHighlight();
    const item = document.querySelector(`.sentence-item[data-id="${sentenceId}"]`);
    if (item) {
        item.classList.add('playing');
    }
}

function clearPlayingHighlight() {
    document.querySelectorAll('.sentence-item.playing').forEach(el => {
        el.classList.remove('playing');
    });
}

function editSentence(id) {
    addLog(`문장 #${id} 편집`, 'info');
}

// DOM에서 편집 중인 모든 텍스트를 studioDesign.sentences에 동기화
function syncAllSentenceTexts() {
    const sentenceItems = document.querySelectorAll('.sentence-item');
    sentenceItems.forEach(item => {
        const id = parseInt(item.dataset.id);
        const textEl = item.querySelector('.sentence-text');
        if (textEl) {
            const sentence = studioDesign.sentences.find(s => s.id === id);
            if (sentence) {
                const currentText = textEl.innerText.trim();
                if (sentence.text !== currentText) {
                    sentence.text = currentText;
                }
            }
        }
    });
}

function renderSentences() {
    const container = document.getElementById('studio-sentence-list');
    if (!container) return;

    if (studioDesign.sentences.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📝</div>
                <div class="empty-message">문장이 없습니다</div>
                <div class="empty-description">대본을 불러오거나 문장을 추가해주세요</div>
            </div>
        `;
        return;
    }

    container.innerHTML = studioDesign.sentences.map((sentence, index) => {
        // 타임코드: 시작점과 끝점 분리
        const startTime = sentence.startTime || '--:--:--';
        const endTime = sentence.endTime || '--:--:--';

        // \n을 <br> 태그로 변환하여 2줄 표시
        const displayText = sentence.text.replace(/\n/g, '<br>');
        const charCount = sentence.text.length;
        const overLimitClass = charCount > 22 ? 'over-limit' : '';

        // 그룹 관련 클래스 및 표시
        let groupClass = '';
        let groupIndicator = '';
        if (sentence.groupId) {
            // 같은 그룹의 클립들 찾기
            const groupClips = studioDesign.sentences.filter(s => s.groupId === sentence.groupId);
            const groupIndex = groupClips.findIndex(s => s.id === sentence.id);
            const isFirst = groupIndex === 0;
            const isLast = groupIndex === groupClips.length - 1;

            if (groupClips.length > 1) {
                groupClass = 'grouped';
                if (isFirst) groupClass += ' group-first';
                else if (isLast) groupClass += ' group-last';
                else groupClass += ' group-middle';

                // 그룹 연결 표시
                groupIndicator = `<div class="group-indicator" title="그룹: ${groupClips.length}개 클립 연결됨"></div>`;
            }
        }

        return `
            <div class="sentence-item ${overLimitClass} ${groupClass}" data-id="${sentence.id}" data-group="${sentence.groupId || ''}">
                ${groupIndicator}
                <input type="checkbox" class="sentence-checkbox">
                <div class="sentence-char-badge" style="background: ${getCharacterColor(sentence.character)}">
                    ${sentence.character}
                </div>
                <div class="sentence-number">${index + 1}</div>
                <div class="sentence-time-column">
                    <div class="sentence-time-start">${startTime}</div>
                    <div class="sentence-time-end">${endTime}</div>
                </div>
                <div class="sentence-content">
                    <div class="sentence-text" contenteditable="true">${displayText}</div>
                </div>
                <span class="sentence-char-count" title="글자 수">${charCount}자</span>
                <button class="btn-icon-sm" onclick="previewSentence(${sentence.id})" title="미리듣기">▶</button>
                <button class="btn-icon-sm" onclick="deleteSentence(${sentence.id})" title="삭제" style="color: var(--error);">🗑️</button>
            </div>
        `;
    }).join('');
}

// ============================================
// 캐릭터 관리
// ============================================

function addCharacter() {
    console.log('[StudioDesign] 캐릭터 추가');

    const newCharacter = {
        id: Date.now(),
        name: '새 캐릭터',
        voice: 'ko-KR-Standard-D',
        speed: 1.0,
        pitch: 0,
        volume: 100,  // 항상 100%
        color: getRandomColor()
    };

    studioDesign.characters.push(newCharacter);
    renderCharacters();
    addLog('캐릭터 추가됨', 'info');
}

function processDetectedCharacters(detectedCharacters) {
    console.log('[StudioDesign] 발견된 캐릭터 처리:', detectedCharacters);

    if (typeof eel !== 'undefined') {
        // 백엔드에서 신규/기존 캐릭터 확인
        eel.studio_check_new_characters(detectedCharacters)(function(result) {
            if (result && result.success) {
                const newChars = result.newCharacters || [];
                const existingChars = result.existingCharacters || {};
                const voiceGroups = result.voiceGroups || {};

                // 신규 캐릭터 알림
                if (newChars.length > 0) {
                    addLog(`🆕 신규 캐릭터 발견: ${newChars.join(', ')}`, 'warning');
                    addLog('💡 캐릭터 설정 후 저장 버튼을 눌러 데이터베이스에 저장하세요', 'info');
                }

                // 기존 캐릭터 알림
                if (Object.keys(existingChars).length > 0) {
                    addLog(`✅ 기존 캐릭터 자동 적용: ${Object.keys(existingChars).join(', ')}`, 'success');
                }

                // 동일 음성 그룹 알림
                if (Object.keys(voiceGroups).length > 0) {
                    for (const [voiceKey, characters] of Object.entries(voiceGroups)) {
                        addLog(`🔊 동일 음성 설정: ${characters.join(', ')}`, 'info');
                    }
                }

                // 캐릭터 목록에 추가
                autoAddCharactersFromScript(detectedCharacters, existingChars);
            }
        });
    } else {
        // 테스트 모드: 모두 신규로 간주
        autoAddCharactersFromScript(detectedCharacters, {});
    }
}

function autoAddCharactersFromScript(detectedCharacters, existingCharactersData) {
    console.log('[StudioDesign] 대본에서 캐릭터 자동 추가:', detectedCharacters);

    // 기존 캐릭터 이름 목록
    const existingNames = studioDesign.characters.map(c => c.name);

    detectedCharacters.forEach((characterName, index) => {
        // 이미 존재하는 캐릭터면 추가하지 않음
        if (existingNames.includes(characterName)) {
            return;
        }

        // 데이터베이스에서 가져온 설정이 있으면 사용, 없으면 기본값
        const savedSettings = existingCharactersData[characterName] || null;
        const isNew = !savedSettings;

        // 캐싱된 임시 색상 사용 (문장 목록과 일관성 유지)
        const cachedColor = tempCharacterColors.get(characterName) || getRandomColor();
        
        // 새로운 캐릭터 추가
        const newCharacter = {
            id: Date.now() + index,
            name: characterName,
            voice: savedSettings ? savedSettings.voice : 'ko-KR-Standard-D',
            speed: savedSettings ? savedSettings.speed : 1.0,
            pitch: savedSettings ? savedSettings.pitch : 0,
            postSpeed: savedSettings ? (savedSettings.postSpeed || 1.0) : 1.0,  // MP3 후처리 속도 (Chirp3-HD용)
            volume: 100,  // 항상 100%
            color: savedSettings?.color || cachedColor,  // DB에 색상 있으면 사용, 없으면 캐싱된 색상
            isNew: isNew  // 신규 캐릭터 표시용
        };
        
        // 캐시 정리 (캐릭터가 추가되었으므로)
        tempCharacterColors.delete(characterName);

        studioDesign.characters.push(newCharacter);
        existingNames.push(characterName);
    });

    renderCharacters();
    // 문장 목록도 다시 렌더링 (캐릭터 색상 동기화)
    renderSentences();
}

function saveCharacterToDB(id) {
    const character = studioDesign.characters.find(c => c.id === id);
    if (!character) return;

    const characterData = {
        name: character.name,
        voice: character.voice,
        speed: character.speed,
        pitch: character.pitch,
        postSpeed: character.postSpeed || 1.0,
        volume: 100,  // 항상 100%
        color: character.color  // 색상도 저장
    };

    if (typeof eel !== 'undefined') {
        eel.studio_save_character_to_db(characterData)(function(result) {
            if (result && result.success) {
                addLog(`💾 캐릭터 '${character.name}' 저장 완료`, 'success');
                // isNew 플래그 제거
                character.isNew = false;
                renderCharacters();
            } else {
                addLog(`캐릭터 저장 실패: ${result.error}`, 'error');
            }
        });
    } else {
        addLog(`💾 캐릭터 '${character.name}' 저장 완료 (테스트 모드)`, 'success');
        character.isNew = false;
        renderCharacters();
    }
}

function deleteCharacter(id) {
    const index = studioDesign.characters.findIndex(c => c.id === id);
    if (index > -1) {
        const character = studioDesign.characters[index];
        studioDesign.characters.splice(index, 1);
        renderCharacters();
        addLog(`캐릭터 '${character.name}' 삭제됨`, 'info');
    }
}

function previewCharacterVoice(id) {
    const character = studioDesign.characters.find(c => c.id === id);
    if (!character) return;

    addLog(`'${character.name}' 음성 미리듣기 중...`, 'info');

    const characterData = {
        voice: character.voice,
        speed: character.speed,
        pitch: character.pitch
    };

    if (typeof eel !== 'undefined') {
        eel.studio_preview_character_voice(characterData)(function(result) {
            if (result && result.success) {
                playAudioFile(result.audioData);
                addLog(`'${character.name}' 음성 재생`, 'success');
            } else {
                addLog('미리듣기 실패: ' + (result ? result.error : '알 수 없는 오류'), 'error');
            }
        });
    } else {
        addLog('미리듣기 실패: 백엔드 연결 없음', 'error');
    }
}

function playAudioFile(audioData) {
    // Base64 오디오 데이터를 브라우저에서 직접 재생
    const audio = new Audio('data:audio/mp3;base64,' + audioData);
    audio.play().catch(error => {
        console.error('[StudioDesign] 오디오 재생 오류:', error);
        addLog('오디오 재생 실패', 'error');
    });
}

function renderCharacters() {
    const container = document.getElementById('studio-character-list');
    if (!container) return;

    if (studioDesign.characters.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🎤</div>
                <div class="empty-message">캐릭터가 없습니다</div>
                <div class="empty-description">대본을 불러오면 자동으로 추가됩니다</div>
            </div>
        `;
        return;
    }

    // 대본에 등장하는 캐릭터만 필터링
    const charactersInScript = new Set(
        studioDesign.sentences.map(sentence => {
            // '나레이터'를 '나레이션'으로 통일
            return sentence.character === '나레이터' ? '나레이션' : sentence.character;
        })
    );

    const filteredCharacters = studioDesign.characters.filter(character => {
        // '나레이터'는 제외, '나레이션'만 표시
        if (character.name === '나레이터') return false;
        return charactersInScript.has(character.name);
    });

    if (filteredCharacters.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🎤</div>
                <div class="empty-message">대본에 등장하는 캐릭터가 없습니다</div>
                <div class="empty-description">대본을 불러오거나 문장을 추가하세요</div>
            </div>
        `;
        return;
    }

    // 캐릭터 정렬: 신규(isNew) > 나레이션 > 나머지
    const sortedCharacters = [...filteredCharacters].sort((a, b) => {
        if (a.isNew && !b.isNew) return -1;
        if (!a.isNew && b.isNew) return 1;
        if (a.name === '나레이션' && b.name !== '나레이션') return -1;
        if (a.name !== '나레이션' && b.name === '나레이션') return 1;
        return 0;
    });

    container.innerHTML = sortedCharacters.map(character => `
        <div class="character-item ${character.isNew ? 'character-new' : ''}" data-id="${character.id}">
            <div class="character-header">
                <div class="character-name">
                    <div class="sentence-char-badge" style="background: ${character.color}; cursor: pointer;"
                         onclick="editCharacterName(${character.id})" title="이름 수정하려면 클릭">
                        ${character.name}
                    </div>
                    ${character.isNew ? '<span class="badge-new">🆕 신규</span>' : '<span class="badge-existing">✅ 저장됨</span>'}
                </div>
                <button class="btn-icon-sm" onclick="previewCharacterVoice(${character.id})" title="미리듣기">🔊</button>
                ${character.isNew ? '<button class="btn-icon-sm" onclick="saveCharacterToDB(' + character.id + ')" title="DB에 저장" style="color: var(--success);">💾</button>' : ''}
                <button class="btn-icon-sm" onclick="deleteCharacter(${character.id})" title="삭제" style="color: var(--error);">🗑️</button>
            </div>
            <div class="character-settings">
                <div class="form-row">
                    <label>모델</label>
                    <select class="character-model-select" onchange="updateCharacterModel(${character.id}, this.value)">
                        ${getVoiceModelOptions(character.voice)}
                    </select>
                </div>
                <div class="form-row">
                    <label>음성</label>
                    <select class="character-voice-select" onchange="updateCharacterVoice(${character.id}, this.value)">
                        ${getVoiceOptions(character.voice)}
                    </select>
                </div>
                <div class="slider-row ${!voiceSupportsSpeedPitch(character.voice) ? 'params-disabled' : ''}">
                    <label>속도</label>
                    <button class="btn-icon-sm" onclick="decreaseCharacterSpeed(${character.id})" ${!voiceSupportsSpeedPitch(character.voice) ? 'disabled' : ''}>−</button>
                    <span class="slider-value">${character.speed.toFixed(2)}x</span>
                    <button class="btn-icon-sm" onclick="increaseCharacterSpeed(${character.id})" ${!voiceSupportsSpeedPitch(character.voice) ? 'disabled' : ''}>+</button>
                    <label style="margin-left: 12px;">피치</label>
                    <button class="btn-icon-sm" onclick="decreaseCharacterPitch(${character.id})" ${!voiceSupportsSpeedPitch(character.voice) ? 'disabled' : ''}>−</button>
                    <span class="slider-value">${character.pitch}</span>
                    <button class="btn-icon-sm" onclick="increaseCharacterPitch(${character.id})" ${!voiceSupportsSpeedPitch(character.voice) ? 'disabled' : ''}>+</button>
                </div>
                ${!voiceSupportsSpeedPitch(character.voice) ? `
                <div class="slider-row postspeed-row">
                    <label>MP3속도</label>
                    <button class="btn-icon-sm" onclick="decreaseCharacterPostSpeed(${character.id})">−</button>
                    <span class="slider-value">${(character.postSpeed || 1.0).toFixed(2)}x</span>
                    <button class="btn-icon-sm" onclick="increaseCharacterPostSpeed(${character.id})">+</button>
                    <span class="postspeed-hint" title="FFmpeg로 MP3 속도 후처리">🔧</span>
                </div>
                ` : ''}
            </div>
        </div>
    `).join('');
}

// 캐릭터 속성 업데이트 함수들
function updateCharacterName(id, value) {
    const character = studioDesign.characters.find(c => c.id === id);
    if (character) character.name = value;
}

function editCharacterName(id) {
    const character = studioDesign.characters.find(c => c.id === id);
    if (!character) return;

    const newName = prompt('캐릭터 이름을 입력하세요:', character.name);
    if (newName && newName.trim()) {
        character.name = newName.trim();
        renderCharacters();
        renderSentences();  // 문장 목록도 업데이트
        addLog(`캐릭터 이름이 '${newName.trim()}'로 변경됨`, 'info');
    }
}

function updateCharacterVoice(id, value) {
    const character = studioDesign.characters.find(c => c.id === id);
    if (character) {
        character.voice = value;
        renderCharacters(); // 음성 변경 시 속도/피치 활성화 상태 업데이트
    }
}

function increaseCharacterSpeed(id) {
    const character = studioDesign.characters.find(c => c.id === id);
    if (!character) return;

    if (character.speed < 4.0) {
        character.speed = Math.min(4.0, Math.round((character.speed + 0.05) * 100) / 100);
        renderCharacters();
    }
}

function decreaseCharacterSpeed(id) {
    const character = studioDesign.characters.find(c => c.id === id);
    if (!character) return;

    if (character.speed > 0.25) {
        character.speed = Math.max(0.25, Math.round((character.speed - 0.05) * 100) / 100);
        renderCharacters();
    }
}

function increaseCharacterPitch(id) {
    const character = studioDesign.characters.find(c => c.id === id);
    if (!character) return;

    if (character.pitch < 20) {
        character.pitch = Math.min(20, Math.round((character.pitch + 1) * 10) / 10);
        renderCharacters();
    }
}

function decreaseCharacterPitch(id) {
    const character = studioDesign.characters.find(c => c.id === id);
    if (!character) return;

    if (character.pitch > -20) {
        character.pitch = Math.max(-20, Math.round((character.pitch - 1) * 10) / 10);
        renderCharacters();
    }
}

// MP3 후처리 속도 조절 (Chirp3-HD용)
function increaseCharacterPostSpeed(id) {
    const character = studioDesign.characters.find(c => c.id === id);
    if (!character) return;

    if (!character.postSpeed) character.postSpeed = 1.0;

    if (character.postSpeed < 2.0) {
        character.postSpeed = Math.min(2.0, Math.round((character.postSpeed + 0.05) * 100) / 100);
        renderCharacters();
    }
}

function decreaseCharacterPostSpeed(id) {
    const character = studioDesign.characters.find(c => c.id === id);
    if (!character) return;

    if (!character.postSpeed) character.postSpeed = 1.0;

    if (character.postSpeed > 0.5) {
        character.postSpeed = Math.max(0.5, Math.round((character.postSpeed - 0.05) * 100) / 100);
        renderCharacters();
    }
}

function updateCharacterModel(id, modelType) {
    const character = studioDesign.characters.find(c => c.id === id);
    if (!character) return;

    // 모델 변경 시 해당 모델의 첫 번째 음성으로 자동 설정 (캐시된 목록에서)
    const modelVoices = cachedVoicesList.filter(v => v.model === modelType);
    if (modelVoices.length > 0) {
        character.voice = modelVoices[0].value;
        renderCharacters();
    }
}

// ============================================
// 음성 모델 및 음성 옵션 생성
// ============================================

// 음성이 속도/피치 조절을 지원하는지 확인
function voiceSupportsSpeedPitch(voiceId) {
    // Chirp3-HD 모델은 속도/피치 조절 불가
    return !voiceId.includes('Chirp3-HD');
}

function getVoiceModelOptions(currentVoice) {
    // 현재 음성에서 모델 타입 추출
    let currentModel = 'Wavenet';
    if (currentVoice.includes('Standard')) {
        currentModel = 'Standard';
    } else if (currentVoice.includes('Neural2')) {
        currentModel = 'Neural2';
    } else if (currentVoice.includes('Chirp3')) {
        currentModel = 'Chirp3-HD';
    } else if (currentVoice.endsWith('Neural') && !currentVoice.includes('Neural2')) {
        currentModel = 'Edge-TTS';
    }

    const models = [
        { value: 'Wavenet', label: 'Wavenet (고품질)' },
        { value: 'Neural2', label: 'Neural2 (자연스러움)' },
        { value: 'Chirp3-HD', label: 'Chirp3-HD (최신)' },
        { value: 'Standard', label: 'Standard (기본)' },
        { value: 'Edge-TTS', label: 'Edge-TTS (무료)' }
    ];

    return models.map(model =>
        `<option value="${model.value}" ${currentModel === model.value ? 'selected' : ''}>${model.label}</option>`
    ).join('');
}

function getVoiceOptions(currentVoice) {
    // 현재 음성에서 모델 타입 추출
    let modelType = 'Wavenet';
    if (currentVoice && currentVoice.includes('Standard')) {
        modelType = 'Standard';
    } else if (currentVoice && currentVoice.includes('Neural2')) {
        modelType = 'Neural2';
    } else if (currentVoice && currentVoice.includes('Chirp3')) {
        modelType = 'Chirp3-HD';
    } else if (currentVoice && currentVoice.endsWith('Neural') && !currentVoice.includes('Neural2')) {
        modelType = 'Edge-TTS';
    }

    // 캐시된 음성 목록에서 해당 모델만 필터링
    const voices = cachedVoicesList.length > 0
        ? cachedVoicesList.filter(v => v.model === modelType)
        : getDefaultVoices().filter(v => v.model === modelType);

    // 음성이 없으면 전체 목록 반환
    if (voices.length === 0) {
        const allVoices = cachedVoicesList.length > 0 ? cachedVoicesList : getDefaultVoices();
        return allVoices.map(voice =>
            `<option value="${voice.value}" ${currentVoice === voice.value ? 'selected' : ''}>${voice.label} (${voice.gender})</option>`
        ).join('');
    }

    return voices.map(voice =>
        `<option value="${voice.value}" ${currentVoice === voice.value ? 'selected' : ''}>${voice.label} (${voice.gender})</option>`
    ).join('');
}

// ============================================
// 유틸리티 함수
// ============================================

// DB 조회 중인 캐릭터 추적 (중복 호출 방지)
const pendingCharacterLookups = new Set();
// 캐릭터별 임시 색상 캐시 (같은 이름은 같은 색상 유지)
const tempCharacterColors = new Map();

function getCharacterColor(characterName) {
    // 캐릭터 목록에서 해당 이름의 캐릭터 찾기
    const character = studioDesign.characters.find(c => c.name === characterName);
    if (character) {
        return character.color;
    }

    // 이미 캐싱된 임시 색상이 있으면 반환
    if (tempCharacterColors.has(characterName)) {
        return tempCharacterColors.get(characterName);
    }

    // 새 임시 색상 생성 및 캐싱
    const newColor = getRandomColor();
    tempCharacterColors.set(characterName, newColor);

    // 이미 조회 중인 캐릭터면 캐싱된 색상만 반환
    if (pendingCharacterLookups.has(characterName)) {
        return newColor;
    }

    // 캐릭터를 찾을 수 없으면 DB에서 조회 후 생성
    console.warn(`[StudioDesign] 캐릭터 '${characterName}' 색상을 찾을 수 없어 DB 조회 후 생성합니다.`);

    if (typeof eel !== 'undefined') {
        // 조회 중 표시
        pendingCharacterLookups.add(characterName);

        // DB에서 캐릭터 정보 조회
        eel.studio_check_new_characters([characterName])(function(result) {
            // 조회 완료 표시
            pendingCharacterLookups.delete(characterName);

            // 이미 다른 곳에서 추가되었는지 다시 확인
            if (studioDesign.characters.find(c => c.name === characterName)) {
                return;
            }

            const savedSettings = result?.existingCharacters?.[characterName] || null;
            const isNew = !savedSettings;

            // 캐싱된 임시 색상 사용 (일관성 유지)
            const cachedColor = tempCharacterColors.get(characterName) || newColor;
            const newCharacter = {
                id: Date.now() + Math.random(),
                name: characterName,
                voice: savedSettings ? savedSettings.voice : 'ko-KR-Standard-D',
                speed: savedSettings ? savedSettings.speed : 1.0,
                pitch: savedSettings ? savedSettings.pitch : 0,
                postSpeed: savedSettings ? (savedSettings.postSpeed || 1.0) : 1.0,
                volume: 100,
                color: savedSettings?.color || cachedColor,
                isNew: isNew
            };

            studioDesign.characters.push(newCharacter);
            // 임시 색상 캐시 정리
            tempCharacterColors.delete(characterName);
            renderCharacters();
            // 문장 목록도 다시 렌더링 (색상 통일)
            renderSentences();
        });
    } else {
        // 테스트 모드: 기본값으로 생성
        const newCharacter = {
            id: Date.now() + Math.random(),
            name: characterName,
            voice: 'ko-KR-Standard-D',
            speed: 1.0,
            pitch: 0,
            volume: 100,
            color: newColor,
            isNew: true
        };
        studioDesign.characters.push(newCharacter);
        renderCharacters();
    }

    return newColor;
}

function getRandomColor() {
    const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function addLog(message, type = 'info') {
    const logContainer = document.getElementById('studio-log');
    if (!logContainer) return;

    const timestamp = new Date().toLocaleTimeString('ko-KR');
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${timestamp}] ${message}`;

    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// ============================================
// 진행률 업데이트 (백엔드에서 호출)
// ============================================

// eel에서 호출할 수 있도록 전역 함수로 등록
function updateProgress(percent, message) {
    // 진행바 자동 표시
    const progressEl = document.getElementById('studio-progress');
    if (progressEl && progressEl.style.display === 'none') {
        progressEl.style.display = 'block';
    }

    // 진행바 업데이트
    const progressBar = document.getElementById('studio-progress-bar');
    const progressText = document.getElementById('studio-progress-text');

    if (progressBar) {
        progressBar.style.width = percent + '%';
    }

    if (progressText && message) {
        progressText.textContent = message;
    }

    // 작업로그에도 진행 상황 표시 (10% 단위로)
    if (message && (percent % 10 === 0 || percent >= 100)) {
        addLog(`[${percent}%] ${message}`, 'info');
    }

    // 완료 시 진행바 숨기기
    if (percent >= 100) {
        setTimeout(() => {
            if (progressEl) progressEl.style.display = 'none';
        }, 1000);
    }
}

// eel에 함수 노출
if (typeof eel !== 'undefined') {
    eel.expose(updateProgress, 'updateProgress');
}

// ============================================
// 전체 캐릭터 관리 모달
// ============================================

let allCharactersData = {};  // DB에서 불러온 전체 캐릭터 데이터

function openAllCharactersModal() {
    const modal = document.getElementById('all-characters-modal');
    if (!modal) return;

    // DB에서 전체 캐릭터 불러오기
    if (typeof eel !== 'undefined') {
        eel.studio_get_all_characters()(function(result) {
            if (result && result.success) {
                allCharactersData = result.characters || {};
                renderAllCharacters();
                modal.style.display = 'flex';
            } else {
                addLog('캐릭터 목록 불러오기 실패', 'error');
            }
        });
    } else {
        // 테스트 모드
        allCharactersData = {};
        renderAllCharacters();
        modal.style.display = 'flex';
    }
}

function closeAllCharactersModal() {
    const modal = document.getElementById('all-characters-modal');
    if (modal) modal.style.display = 'none';
}

function renderAllCharacters() {
    const container = document.getElementById('all-characters-list');
    if (!container) return;

    const names = Object.keys(allCharactersData);

    if (names.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
                <div style="font-size: 48px; margin-bottom: 16px;">📭</div>
                <div>저장된 캐릭터가 없습니다</div>
            </div>
        `;
        return;
    }

    container.innerHTML = names.map(name => {
        const char = allCharactersData[name];
        const color = char.color || '#6495ED';
        const voice = char.voice || 'ko-KR-Standard-D';
        const speed = char.speed || 1.0;
        const pitch = char.pitch || 0;
        const postSpeed = char.postSpeed || 1.0;

        return `
            <div class="all-char-card" data-name="${name}">
                <div class="all-char-card-header">
                    <div class="all-char-name">
                        <input type="color" class="all-char-color" value="${color}"
                               onchange="updateAllCharColor('${name}', this.value)"
                               title="색상 변경">
                        <span>${name}</span>
                    </div>
                    <div class="all-char-actions">
                        <button class="btn-icon-sm" onclick="previewAllCharVoice('${name}')" title="미리듣기">🔊</button>
                        <button class="btn-icon-sm" onclick="saveAllChar('${name}')" title="저장">💾</button>
                        <button class="btn-icon-sm danger" onclick="deleteAllChar('${name}')" title="삭제">🗑️</button>
                    </div>
                </div>
                <div class="all-char-row">
                    <label>음성</label>
                    <select onchange="updateAllCharVoice('${name}', this.value)">
                        ${getAllVoiceOptions(voice)}
                    </select>
                </div>
                <div class="all-char-row">
                    <label>속도</label>
                    <div class="value-control">
                        <button class="btn-icon-sm" onclick="adjustAllCharValue('${name}', 'speed', -0.05)">-</button>
                        <span class="value-display" id="all-char-speed-${name}">${speed.toFixed(2)}</span>
                        <button class="btn-icon-sm" onclick="adjustAllCharValue('${name}', 'speed', 0.05)">+</button>
                    </div>
                </div>
                <div class="all-char-row">
                    <label>피치</label>
                    <div class="value-control">
                        <button class="btn-icon-sm" onclick="adjustAllCharValue('${name}', 'pitch', -1)">-</button>
                        <span class="value-display" id="all-char-pitch-${name}">${pitch}</span>
                        <button class="btn-icon-sm" onclick="adjustAllCharValue('${name}', 'pitch', 1)">+</button>
                    </div>
                </div>
                <div class="all-char-row">
                    <label>후처리속도</label>
                    <div class="value-control">
                        <button class="btn-icon-sm" onclick="adjustAllCharValue('${name}', 'postSpeed', -0.05)">-</button>
                        <span class="value-display" id="all-char-postSpeed-${name}">${postSpeed.toFixed(2)}</span>
                        <button class="btn-icon-sm" onclick="adjustAllCharValue('${name}', 'postSpeed', 0.05)">+</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function getAllVoiceOptions(selectedVoice) {
    // 캐시된 전체 음성 목록 사용 (voices_config.json에서 로드)
    const voices = cachedVoicesList.length > 0 ? cachedVoicesList : getDefaultVoices();

    return voices.map(v =>
        `<option value="${v.value}" ${v.value === selectedVoice ? 'selected' : ''}>${v.label} (${v.gender})</option>`
    ).join('');
}

function updateAllCharColor(name, color) {
    if (allCharactersData[name]) {
        allCharactersData[name].color = color;
    }
}

function updateAllCharVoice(name, voice) {
    if (allCharactersData[name]) {
        allCharactersData[name].voice = voice;
    }
}

function adjustAllCharValue(name, field, delta) {
    if (!allCharactersData[name]) return;

    let value = allCharactersData[name][field] || (field === 'pitch' ? 0 : 1.0);
    value += delta;

    // 범위 제한
    if (field === 'speed') {
        value = Math.max(0.25, Math.min(4.0, value));
        value = Math.round(value * 100) / 100;
    } else if (field === 'pitch') {
        value = Math.max(-20, Math.min(20, Math.round(value)));
    } else if (field === 'postSpeed') {
        value = Math.max(0.5, Math.min(2.0, value));
        value = Math.round(value * 100) / 100;
    }

    allCharactersData[name][field] = value;

    // UI 업데이트
    const display = document.getElementById(`all-char-${field}-${name}`);
    if (display) {
        display.textContent = field === 'pitch' ? value : value.toFixed(2);
    }
}

function previewAllCharVoice(name) {
    const char = allCharactersData[name];
    if (!char) return;

    addLog(`'${name}' 음성 미리듣기 중...`, 'info');

    if (typeof eel !== 'undefined') {
        eel.studio_preview_character_voice({
            voice: char.voice,
            speed: char.speed,
            pitch: char.pitch
        })(function(result) {
            if (result && result.success) {
                playAudioFile(result.audioData);
            } else {
                addLog('미리듣기 실패', 'error');
            }
        });
    }
}

function saveAllChar(name) {
    const char = allCharactersData[name];
    if (!char) return;

    const characterData = {
        name: name,
        voice: char.voice,
        speed: char.speed,
        pitch: char.pitch,
        postSpeed: char.postSpeed || 1.0,
        volume: 100,
        color: char.color
    };

    if (typeof eel !== 'undefined') {
        eel.studio_save_character_to_db(characterData)(function(result) {
            if (result && result.success) {
                addLog(`'${name}' 저장 완료`, 'success');
            } else {
                addLog(`'${name}' 저장 실패`, 'error');
            }
        });
    }
}

function deleteAllChar(name) {
    if (!confirm(`'${name}' 캐릭터를 삭제하시겠습니까?`)) return;

    if (typeof eel !== 'undefined') {
        eel.studio_delete_character_from_db(name)(function(result) {
            if (result && result.success) {
                delete allCharactersData[name];
                renderAllCharacters();
                addLog(`'${name}' 삭제 완료`, 'success');
            } else {
                addLog(`'${name}' 삭제 실패`, 'error');
            }
        });
    }
}

// 모달 외부 클릭 시 닫기
document.addEventListener('click', function(e) {
    const modal = document.getElementById('all-characters-modal');
    if (modal && e.target === modal) {
        closeAllCharactersModal();
    }
});

// ============================================
// 초기화
// ============================================

// ============================================
// 로그 복사 기능
// ============================================

function copyStudioLog() {
    const logContainer = document.getElementById('studio-log');
    if (!logContainer) return;

    const logEntries = logContainer.querySelectorAll('.log-entry');
    const logText = Array.from(logEntries).map(entry => entry.textContent).join('\n');

    navigator.clipboard.writeText(logText).then(() => {
        addLog('로그가 클립보드에 복사되었습니다', 'success');
    }).catch(err => {
        // clipboard API 실패 시 대안
        const textarea = document.createElement('textarea');
        textarea.value = logText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        addLog('로그가 클립보드에 복사되었습니다', 'success');
    });
}

// ============================================
// 콘솔 에러 통합 (console.error -> 작업로그)
// 백엔드 로그는 receiveBackendLog로 수신하므로 중복 방지
// ============================================

(function() {
    const originalConsoleError = console.error;

    function formatMessage(args) {
        let message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
        return message;
    }

    // console.error만 작업로그에 추가 (에러는 항상 표시)
    console.error = function(...args) {
        originalConsoleError.apply(console, args);
        addLog('[JS Error] ' + formatMessage(args), 'error');
    };
})();

// ============================================
// 백엔드 로그 수신 (eel에서 호출)
// ============================================

function receiveBackendLog(message, type = 'info') {
    addLog(message, type);
}

// eel에 함수 노출
if (typeof eel !== 'undefined') {
    eel.expose(receiveBackendLog, 'receiveBackendLog');
}

document.addEventListener('DOMContentLoaded', async function() {
    console.log('[StudioDesign] DOM 로드 완료');

    // 음성 목록 먼저 로드
    await loadVoicesConfig();

    addLog('통합 영상 디자인 스튜디오 준비 완료', 'success');
    renderCharacters();

    // 타임라인 클립 분리 및 방향키 이동 이벤트 설정
    setupSentenceListEvents();

    // Ctrl+Z 되돌리기 전역 이벤트
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            undoHistory.undo();
        }
    });
});

// ============================================
// 타임라인 클립 분리 및 방향키 이동
// ============================================

function setupSentenceListEvents() {
    const container = document.getElementById('studio-sentence-list');
    if (!container) return;

    // 이벤트 위임으로 keydown 처리
    container.addEventListener('keydown', function(e) {
        const target = e.target;
        if (!target.classList.contains('sentence-text')) return;

        const sentenceItem = target.closest('.sentence-item');
        if (!sentenceItem) return;

        const sentenceId = parseInt(sentenceItem.dataset.id);

        // Enter 키: 클립 분리
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            splitSentenceAtCursor(target, sentenceId);
            return;
        }

        // 위쪽 방향키: 이전 클립으로 이동
        if (e.key === 'ArrowUp') {
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);

            // 커서가 첫 줄에 있을 때만 이전 클립으로 이동
            if (isAtFirstLine(target, range)) {
                e.preventDefault();
                moveToPreviousSentence(sentenceItem);
            }
            return;
        }

        // 아래쪽 방향키: 다음 클립으로 이동
        if (e.key === 'ArrowDown') {
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);

            // 커서가 마지막 줄에 있을 때만 다음 클립으로 이동
            if (isAtLastLine(target, range)) {
                e.preventDefault();
                moveToNextSentence(sentenceItem);
            }
            return;
        }

        // Backspace 키: 맨 앞에서 누르면 이전 클립과 병합
        if (e.key === 'Backspace') {
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);

            // 커서가 맨 앞에 있는지 확인
            if (isAtStart(target, range)) {
                e.preventDefault();
                mergeWithPreviousSentence(sentenceItem, sentenceId);
            }
            return;
        }

        // Delete 키: 맨 끝에서 누르면 다음 클립과 병합
        if (e.key === 'Delete') {
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);

            // 커서가 맨 끝에 있는지 확인
            if (isAtEnd(target, range)) {
                e.preventDefault();
                mergeWithNextSentence(sentenceItem, sentenceId);
            }
            return;
        }

        // 왼쪽 방향키: 맨 앞에서 누르면 이전 클립 끝으로 이동
        if (e.key === 'ArrowLeft') {
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);

            if (isAtStart(target, range)) {
                e.preventDefault();
                moveToPreviousSentence(sentenceItem);
            }
            return;
        }

        // 오른쪽 방향키: 맨 끝에서 누르면 다음 클립 앞으로 이동
        if (e.key === 'ArrowRight') {
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);

            if (isAtEnd(target, range)) {
                e.preventDefault();
                moveToNextSentence(sentenceItem);
            }
            return;
        }
    });

    // blur 이벤트: 편집 내용 저장
    container.addEventListener('blur', function(e) {
        const target = e.target;
        if (!target.classList.contains('sentence-text')) return;

        const sentenceItem = target.closest('.sentence-item');
        if (!sentenceItem) return;

        const sentenceId = parseInt(sentenceItem.dataset.id);
        const newText = target.innerText.trim();

        // studioDesign.sentences에서 해당 문장 업데이트
        const sentence = studioDesign.sentences.find(s => s.id === sentenceId);
        if (sentence && sentence.text !== newText) {
            // 되돌리기를 위해 현재 상태 저장 (변경 전)
            undoHistory.save();

            sentence.text = newText;
            addLog(`클립 #${studioDesign.sentences.indexOf(sentence) + 1} 수정됨`, 'info');
        }
    }, true);

    // input 이벤트: 실시간 글자수 업데이트 및 22자 초과 경고
    container.addEventListener('input', function(e) {
        const target = e.target;
        if (!target.classList.contains('sentence-text')) return;

        const sentenceItem = target.closest('.sentence-item');
        if (!sentenceItem) return;

        const currentText = target.innerText;
        const charCount = currentText.length;

        // 글자수 표시 요소 찾기 및 업데이트
        const charCountEl = sentenceItem.querySelector('.sentence-char-count');
        if (charCountEl) {
            charCountEl.textContent = `${charCount}자`;
        }

        // 22자 초과 경고
        if (charCount > 22) {
            sentenceItem.classList.add('over-limit');
        } else {
            sentenceItem.classList.remove('over-limit');
        }
    });
}

// 커서 위치에서 클립 분리
function splitSentenceAtCursor(textElement, sentenceId) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);

    // 전체 텍스트 가져오기
    const fullText = textElement.innerText;

    // 커서 위치 계산
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(textElement);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    const cursorPosition = preCaretRange.toString().length;

    // 커서가 맨 앞이나 맨 뒤면 분리하지 않음
    if (cursorPosition === 0 || cursorPosition >= fullText.length) {
        addLog('클립 분리: 커서가 텍스트 중간에 있어야 합니다', 'warning');
        return;
    }

    // 텍스트 분리 (공백 보존)
    const beforeText = fullText.substring(0, cursorPosition);
    const afterText = fullText.substring(cursorPosition);

    if (!beforeText.trim() || !afterText.trim()) {
        addLog('클립 분리: 분리 후 빈 클립이 생성됩니다', 'warning');
        return;
    }

    // 원본 문장 찾기
    const sentenceIndex = studioDesign.sentences.findIndex(s => s.id === sentenceId);
    if (sentenceIndex === -1) return;

    // 렌더링 전에 모든 편집 중인 텍스트를 데이터에 동기화
    syncAllSentenceTexts();

    // 되돌리기를 위해 현재 상태 저장
    undoHistory.save();

    const originalSentence = studioDesign.sentences[sentenceIndex];

    // 그룹 ID 설정: 원본에 그룹이 없으면 새로 생성
    const groupId = originalSentence.groupId || `group_${Date.now()}`;
    originalSentence.groupId = groupId;

    // 원본 문장 텍스트 업데이트
    originalSentence.text = beforeText;

    // 새 문장 생성 (원본의 캐릭터 설정과 그룹 복사)
    const newSentence = {
        id: Date.now(),
        character: originalSentence.character,
        text: afterText,
        startTime: null,
        endTime: null,
        groupId: groupId  // 같은 그룹으로 지정
    };

    // 원본 다음 위치에 삽입
    studioDesign.sentences.splice(sentenceIndex + 1, 0, newSentence);

    // UI 다시 렌더링
    renderSentences();

    // 새로 생성된 클립에 포커스
    setTimeout(() => {
        const newItem = document.querySelector(`.sentence-item[data-id="${newSentence.id}"] .sentence-text`);
        if (newItem) {
            newItem.focus();
            // 커서를 맨 앞으로
            const range = document.createRange();
            range.selectNodeContents(newItem);
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }, 50);

    addLog(`클립 분리 완료: #${sentenceIndex + 1} → #${sentenceIndex + 1}, #${sentenceIndex + 2}`, 'success');
}

// 폴백용 띄어쓰기 기반 분리 (백엔드 연결 실패 시)
function fallbackSplitText(text, maxLength = 22) {
    const result = [];
    let remaining = text;

    while (remaining.length > maxLength) {
        let splitIndex = -1;
        for (let i = maxLength; i >= 0; i--) {
            if (remaining[i] === ' ') {
                splitIndex = i;
                break;
            }
        }

        if (splitIndex === -1) {
            splitIndex = remaining.indexOf(' ', maxLength);
            if (splitIndex === -1) {
                result.push(remaining);
                remaining = '';
                break;
            }
        }

        const part = remaining.substring(0, splitIndex);
        result.push(part);
        remaining = remaining.substring(splitIndex + 1);
    }

    if (remaining.length > 0) {
        result.push(remaining);
    }

    return result;
}

// 선택한 클립을 스마트 자동 분리 (형태소 분석 기반)
async function autoSplitSelectedSentences() {
    const selectedItems = document.querySelectorAll('.sentence-item.selected');

    if (selectedItems.length === 0) {
        addLog('자동 분리할 클립을 선택해주세요', 'warning');
        return;
    }

    // 모든 편집 중인 텍스트를 데이터에 동기화
    syncAllSentenceTexts();

    // 선택된 클립들 중 22자 초과만 수집
    const selectedIds = Array.from(selectedItems).map(item => parseInt(item.dataset.id));
    const sentencesToSplit = [];

    for (const id of selectedIds) {
        const sentence = studioDesign.sentences.find(s => s.id === id);
        if (sentence && sentence.text.trim().length > 22) {
            sentencesToSplit.push({ id: sentence.id, text: sentence.text });
        }
    }

    if (sentencesToSplit.length === 0) {
        addLog('선택한 클립 중 22자를 초과하는 클립이 없습니다', 'info');
        return;
    }

    addLog(`${sentencesToSplit.length}개 클립 스마트 분리 중...`, 'info');

    try {
        // 백엔드 API 호출 (형태소 분석)
        const result = await eel.smart_split_multiple_api(sentencesToSplit, 22)();

        if (!result.success) {
            addLog(`분리 실패: ${result.error}`, 'error');
            return;
        }

        // 되돌리기를 위해 현재 상태 저장
        undoHistory.save();

        let totalSplit = 0;
        const method = result.method === 'kiwi' ? '형태소 분석' : '띄어쓰기 기반';

        // 역순으로 처리 (인덱스 변화 방지)
        for (let i = result.results.length - 1; i >= 0; i--) {
            const splitResult = result.results[i];
            if (!splitResult.split_needed) continue;

            const sentenceIndex = studioDesign.sentences.findIndex(s => s.id === splitResult.id);
            if (sentenceIndex === -1) continue;

            const sentence = studioDesign.sentences[sentenceIndex];
            const parts = splitResult.parts;

            if (parts.length <= 1) continue;

            // 그룹 ID 설정
            const groupId = sentence.groupId || `group_${Date.now()}_${sentence.id}`;

            // 첫 번째 파트는 원본에 유지
            sentence.text = parts[0];
            sentence.groupId = groupId;

            // 나머지 파트들은 새 클립으로 생성
            const newSentences = [];
            for (let j = 1; j < parts.length; j++) {
                newSentences.push({
                    id: Date.now() + i * 100 + j,
                    character: sentence.character,
                    text: parts[j],
                    startTime: null,
                    endTime: null,
                    groupId: groupId
                });
            }

            studioDesign.sentences.splice(sentenceIndex + 1, 0, ...newSentences);
            totalSplit += parts.length - 1;
        }

        renderSentences();
        addLog(`${method}으로 ${sentencesToSplit.length}개 클립에서 ${totalSplit}개의 새 클립 생성`, 'success');

    } catch (error) {
        console.error('스마트 분리 오류:', error);
        addLog('백엔드 연결 실패, 띄어쓰기 기반으로 분리합니다', 'warning');

        // 폴백: 기존 띄어쓰기 기반 분리
        undoHistory.save();
        let totalSplit = 0;

        for (let i = selectedIds.length - 1; i >= 0; i--) {
            const sentenceId = selectedIds[i];
            const sentenceIndex = studioDesign.sentences.findIndex(s => s.id === sentenceId);
            if (sentenceIndex === -1) continue;

            const sentence = studioDesign.sentences[sentenceIndex];
            if (sentence.text.trim().length <= 22) continue;

            const parts = fallbackSplitText(sentence.text.trim());
            if (parts.length <= 1) continue;

            const groupId = sentence.groupId || `group_${Date.now()}_${sentenceId}`;
            sentence.text = parts[0];
            sentence.groupId = groupId;

            const newSentences = parts.slice(1).map((text, j) => ({
                id: Date.now() + i * 100 + j + 1,
                character: sentence.character,
                text: text,
                startTime: null,
                endTime: null,
                groupId: groupId
            }));

            studioDesign.sentences.splice(sentenceIndex + 1, 0, ...newSentences);
            totalSplit += parts.length - 1;
        }

        renderSentences();
        addLog(`띄어쓰기 기반으로 ${totalSplit}개의 새 클립 생성`, 'success');
    }
}

// 모든 22자 초과 클립을 스마트 자동 분리
async function autoSplitAllOverLimit() {
    syncAllSentenceTexts();

    const overLimitSentences = studioDesign.sentences
        .filter(s => s.text.trim().length > 22)
        .map(s => ({ id: s.id, text: s.text }));

    if (overLimitSentences.length === 0) {
        addLog('22자를 초과하는 클립이 없습니다', 'info');
        return;
    }

    addLog(`${overLimitSentences.length}개 클립 스마트 분리 중...`, 'info');

    try {
        const result = await eel.smart_split_multiple_api(overLimitSentences, 22)();

        if (!result.success) {
            addLog(`분리 실패: ${result.error}`, 'error');
            return;
        }

        undoHistory.save();

        let totalSplit = 0;
        const method = result.method === 'kiwi' ? '형태소 분석' : '띄어쓰기 기반';

        // 역순으로 처리
        for (let i = result.results.length - 1; i >= 0; i--) {
            const splitResult = result.results[i];
            if (!splitResult.split_needed) continue;

            const sentenceIndex = studioDesign.sentences.findIndex(s => s.id === splitResult.id);
            if (sentenceIndex === -1) continue;

            const sentence = studioDesign.sentences[sentenceIndex];
            const parts = splitResult.parts;

            if (parts.length <= 1) continue;

            const groupId = sentence.groupId || `group_${Date.now()}_${sentence.id}`;
            sentence.text = parts[0];
            sentence.groupId = groupId;

            const newSentences = parts.slice(1).map((text, j) => ({
                id: Date.now() + sentenceIndex * 100 + j + 1,
                character: sentence.character,
                text: text,
                startTime: null,
                endTime: null,
                groupId: groupId
            }));

            studioDesign.sentences.splice(sentenceIndex + 1, 0, ...newSentences);
            totalSplit += parts.length - 1;
        }

        renderSentences();
        addLog(`${method}으로 ${overLimitSentences.length}개 클립 분리 → ${totalSplit}개 새 클립 생성`, 'success');

    } catch (error) {
        console.error('스마트 분리 오류:', error);
        addLog('백엔드 연결 실패, 띄어쓰기 기반으로 분리합니다', 'warning');

        // 폴백
        undoHistory.save();
        let totalSplit = 0;

        for (let i = studioDesign.sentences.length - 1; i >= 0; i--) {
            const sentence = studioDesign.sentences[i];
            if (sentence.text.trim().length <= 22) continue;

            const parts = fallbackSplitText(sentence.text.trim());
            if (parts.length <= 1) continue;

            const groupId = sentence.groupId || `group_${Date.now()}_${sentence.id}`;
            sentence.text = parts[0];
            sentence.groupId = groupId;

            const newSentences = parts.slice(1).map((text, j) => ({
                id: Date.now() + i * 100 + j + 1,
                character: sentence.character,
                text: text,
                startTime: null,
                endTime: null,
                groupId: groupId
            }));

            studioDesign.sentences.splice(i + 1, 0, ...newSentences);
            totalSplit += parts.length - 1;
        }

        renderSentences();
        addLog(`띄어쓰기 기반으로 ${totalSplit}개의 새 클립 생성`, 'success');
    }
}

// Kiwi 설치 상태 확인
async function checkKiwiStatus() {
    try {
        const result = await eel.check_kiwi_installed()();
        if (result.installed && result.working) {
            addLog('형태소 분석기(Kiwi) 정상 작동 중', 'success');
        } else if (!result.installed) {
            addLog('형태소 분석기 미설치 - pip install kiwipiepy', 'warning');
        } else {
            addLog(`형태소 분석기 오류: ${result.message}`, 'error');
        }
        return result;
    } catch (error) {
        addLog('백엔드 연결 실패', 'error');
        return { installed: false, working: false };
    }
}

// 첫 줄인지 확인
function isAtFirstLine(element, range) {
    const rects = range.getClientRects();
    if (rects.length === 0) {
        // 빈 요소인 경우
        return true;
    }

    const elementRect = element.getBoundingClientRect();
    const cursorRect = rects[0];

    // 커서의 Y 위치가 요소의 상단에서 한 줄 높이 내에 있으면 첫 줄
    const lineHeight = parseInt(window.getComputedStyle(element).lineHeight) || 20;
    return (cursorRect.top - elementRect.top) < lineHeight;
}

// 마지막 줄인지 확인
function isAtLastLine(element, range) {
    const rects = range.getClientRects();
    if (rects.length === 0) {
        return true;
    }

    const elementRect = element.getBoundingClientRect();
    const cursorRect = rects[0];

    const lineHeight = parseInt(window.getComputedStyle(element).lineHeight) || 20;
    return (elementRect.bottom - cursorRect.bottom) < lineHeight;
}

// 커서가 맨 앞에 있는지 확인
function isAtStart(element, range) {
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length === 0;
}

// 커서가 맨 끝에 있는지 확인
function isAtEnd(element, range) {
    const postCaretRange = range.cloneRange();
    postCaretRange.selectNodeContents(element);
    postCaretRange.setStart(range.endContainer, range.endOffset);
    return postCaretRange.toString().length === 0;
}

// 이전 클립과 병합
function mergeWithPreviousSentence(currentItem, sentenceId) {
    const prevItem = currentItem.previousElementSibling;
    if (!prevItem || !prevItem.classList.contains('sentence-item')) {
        addLog('병합할 이전 클립이 없습니다', 'warning');
        return;
    }

    const prevId = parseInt(prevItem.dataset.id);
    const currentIndex = studioDesign.sentences.findIndex(s => s.id === sentenceId);
    const prevIndex = studioDesign.sentences.findIndex(s => s.id === prevId);

    if (currentIndex === -1 || prevIndex === -1) return;

    // 모든 편집 중인 텍스트를 데이터에 동기화
    syncAllSentenceTexts();

    // 되돌리기를 위해 현재 상태 저장
    undoHistory.save();

    const currentSentence = studioDesign.sentences[currentIndex];
    const prevSentence = studioDesign.sentences[prevIndex];

    // 이전 클립 텍스트 끝에 현재 클립 텍스트 추가
    const mergedText = prevSentence.text + currentSentence.text;
    const cursorPosition = prevSentence.text.length; // 병합 지점
    prevSentence.text = mergedText;

    // 현재 클립 삭제
    studioDesign.sentences.splice(currentIndex, 1);

    // UI 다시 렌더링
    renderSentences();

    // 병합된 클립에 포커스하고 커서를 병합 지점에 위치
    setTimeout(() => {
        const mergedItem = document.querySelector(`.sentence-item[data-id="${prevId}"] .sentence-text`);
        if (mergedItem) {
            mergedItem.focus();
            setCursorPosition(mergedItem, cursorPosition);
        }
    }, 50);

    addLog(`클립 병합 완료: #${prevIndex + 1}과 #${currentIndex + 1} → #${prevIndex + 1}`, 'success');
}

// 다음 클립과 병합
function mergeWithNextSentence(currentItem, sentenceId) {
    const nextItem = currentItem.nextElementSibling;
    if (!nextItem || !nextItem.classList.contains('sentence-item')) {
        addLog('병합할 다음 클립이 없습니다', 'warning');
        return;
    }

    const nextId = parseInt(nextItem.dataset.id);
    const currentIndex = studioDesign.sentences.findIndex(s => s.id === sentenceId);
    const nextIndex = studioDesign.sentences.findIndex(s => s.id === nextId);

    if (currentIndex === -1 || nextIndex === -1) return;

    // 모든 편집 중인 텍스트를 데이터에 동기화
    syncAllSentenceTexts();

    // 되돌리기를 위해 현재 상태 저장
    undoHistory.save();

    const currentSentence = studioDesign.sentences[currentIndex];
    const nextSentence = studioDesign.sentences[nextIndex];

    // 현재 클립 텍스트 끝에 다음 클립 텍스트 추가
    const cursorPosition = currentSentence.text.length; // 병합 지점
    const mergedText = currentSentence.text + nextSentence.text;
    currentSentence.text = mergedText;

    // 다음 클립 삭제
    studioDesign.sentences.splice(nextIndex, 1);

    // UI 다시 렌더링
    renderSentences();

    // 병합된 클립에 포커스하고 커서를 병합 지점에 위치
    setTimeout(() => {
        const mergedItem = document.querySelector(`.sentence-item[data-id="${sentenceId}"] .sentence-text`);
        if (mergedItem) {
            mergedItem.focus();
            setCursorPosition(mergedItem, cursorPosition);
        }
    }, 50);

    addLog(`클립 병합 완료: #${currentIndex + 1}과 #${nextIndex + 1} → #${currentIndex + 1}`, 'success');
}

// contenteditable 요소에서 특정 위치에 커서 설정
function setCursorPosition(element, position) {
    const range = document.createRange();
    const sel = window.getSelection();

    let currentPos = 0;
    let found = false;

    function walkNodes(node) {
        if (found) return;

        if (node.nodeType === Node.TEXT_NODE) {
            const nodeLen = node.textContent.length;
            if (currentPos + nodeLen >= position) {
                range.setStart(node, position - currentPos);
                range.collapse(true);
                found = true;
            } else {
                currentPos += nodeLen;
            }
        } else {
            for (let child of node.childNodes) {
                walkNodes(child);
            }
        }
    }

    walkNodes(element);

    if (!found) {
        // 위치를 찾지 못하면 맨 끝으로
        range.selectNodeContents(element);
        range.collapse(false);
    }

    sel.removeAllRanges();
    sel.addRange(range);
}

// 이전 클립으로 이동
function moveToPreviousSentence(currentItem) {
    const prevItem = currentItem.previousElementSibling;
    if (!prevItem || !prevItem.classList.contains('sentence-item')) return;

    const textElement = prevItem.querySelector('.sentence-text');
    if (textElement) {
        textElement.focus();
        // 커서를 맨 끝으로
        const range = document.createRange();
        range.selectNodeContents(textElement);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

// 다음 클립으로 이동
function moveToNextSentence(currentItem) {
    const nextItem = currentItem.nextElementSibling;
    if (!nextItem || !nextItem.classList.contains('sentence-item')) return;

    const textElement = nextItem.querySelector('.sentence-text');
    if (textElement) {
        textElement.focus();
        // 커서를 맨 앞으로
        const range = document.createRange();
        range.selectNodeContents(textElement);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

// ============================================
// 영상 미리보기 팝업
// ============================================

const videoPreview = {
    isPlaying: false,
    currentClipIndex: 0,
    clips: [],
    timecodes: [],
    totalDuration: 0,
    currentTime: 0,
    audioQueue: [],
    updateInterval: null
};

// 영상 미리보기 팝업 열기
function openVideoPreview() {
    console.log('[StudioDesign] 영상 미리보기 열기');

    if (studioDesign.sentences.length === 0) {
        alert('미리보기할 문장이 없습니다. 먼저 대본을 추가해주세요.');
        return;
    }

    // 타임코드가 있는지 확인
    const hasTimecodes = studioDesign.sentences.some(s => s.startTime && s.startTime !== '--:--:--');

    if (!hasTimecodes) {
        addLog('타임코드가 없습니다. 먼저 "타임코드 계산 및 MP3 다운" 버튼을 실행하세요.', 'warning');
        alert('타임코드가 없습니다.\n먼저 "타임코드 계산 및 MP3 다운" 버튼을 실행해주세요.');
        return;
    }

    // 미리보기 데이터 초기화
    videoPreview.clips = studioDesign.sentences.map(s => ({
        text: s.text,
        character: s.character,
        startTime: parseTimeToSeconds(s.startTime),
        endTime: parseTimeToSeconds(s.endTime)
    }));

    // 총 시간 계산
    const lastClip = videoPreview.clips[videoPreview.clips.length - 1];
    videoPreview.totalDuration = lastClip ? lastClip.endTime : 0;
    videoPreview.currentTime = 0;
    videoPreview.currentClipIndex = 0;
    videoPreview.isPlaying = false;

    // 배경 설정
    const previewBg = document.getElementById('preview-background');
    if (studioDesign.settings.bgPath) {
        previewBg.style.backgroundImage = `url('file:///${studioDesign.settings.bgPath.replace(/\\/g, '/')}')`;
    } else {
        previewBg.style.backgroundImage = '';
        previewBg.style.backgroundColor = '#1a1a2e';
    }

    // UI 초기화
    updatePreviewUI();
    document.getElementById('preview-subtitle').classList.remove('visible');
    document.getElementById('preview-subtitle').textContent = '';
    document.getElementById('preview-play-btn').textContent = '▶ 재생';

    // 모달 열기
    document.getElementById('video-preview-modal').style.display = 'flex';
    addLog('영상 미리보기 열림', 'info');
}

// 영상 미리보기 팝업 닫기
function closeVideoPreview() {
    stopPreview();
    document.getElementById('video-preview-modal').style.display = 'none';
}

// 재생/일시정지 토글
function togglePreviewPlay() {
    if (videoPreview.isPlaying) {
        pausePreview();
    } else {
        playPreview();
    }
}

// 미리보기 재생
function playPreview() {
    if (videoPreview.clips.length === 0) return;

    videoPreview.isPlaying = true;
    document.getElementById('preview-play-btn').textContent = '⏸ 일시정지';

    // 현재 위치에서 재생할 클립 찾기
    findCurrentClip();

    // 현재 클립부터 순차 재생
    playCurrentClip();

    // 진행률 업데이트 시작
    videoPreview.updateInterval = setInterval(updatePreviewProgress, 100);
}

// 현재 시간에 해당하는 클립 찾기
function findCurrentClip() {
    for (let i = 0; i < videoPreview.clips.length; i++) {
        const clip = videoPreview.clips[i];
        if (videoPreview.currentTime >= clip.startTime && videoPreview.currentTime < clip.endTime) {
            videoPreview.currentClipIndex = i;
            return;
        }
    }
    // 현재 시간이 어떤 클립에도 속하지 않으면 다음 클립 찾기
    for (let i = 0; i < videoPreview.clips.length; i++) {
        if (videoPreview.clips[i].startTime > videoPreview.currentTime) {
            videoPreview.currentClipIndex = i;
            return;
        }
    }
    videoPreview.currentClipIndex = 0;
}

// 현재 클립 재생
function playCurrentClip() {
    if (!videoPreview.isPlaying) return;
    if (videoPreview.currentClipIndex >= videoPreview.clips.length) {
        // 모든 클립 재생 완료
        stopPreview();
        videoPreview.currentTime = 0;
        videoPreview.currentClipIndex = 0;
        updatePreviewUI();
        return;
    }

    const clip = videoPreview.clips[videoPreview.currentClipIndex];
    const subtitleEl = document.getElementById('preview-subtitle');

    // 자막 표시
    subtitleEl.textContent = clip.text;
    subtitleEl.classList.add('visible');

    // 클립 시작 시간으로 현재 시간 설정
    if (videoPreview.currentTime < clip.startTime) {
        videoPreview.currentTime = clip.startTime;
    }

    // TTS 재생 요청
    const sentence = studioDesign.sentences[videoPreview.currentClipIndex];
    const character = studioDesign.characters.find(c => c.name === clip.character);

    if (typeof eel !== 'undefined' && sentence && character) {
        const sentenceData = {
            text: clip.text,
            character: clip.character
        };
        const characterData = {
            voice: character.voice,
            speed: character.speed,
            pitch: character.pitch
        };

        eel.studio_preview_sentence(sentenceData, characterData)(function(result) {
            if (result && result.success && result.audioData) {
                playPreviewAudio(result.audioData, clip.endTime - clip.startTime);
            } else {
                // 오디오 없이 타이밍만 진행
                const duration = (clip.endTime - clip.startTime) * 1000;
                setTimeout(() => {
                    onClipEnd();
                }, duration);
            }
        });
    } else {
        // 테스트 모드: 타이밍만 진행
        const duration = (clip.endTime - clip.startTime) * 1000;
        setTimeout(() => {
            onClipEnd();
        }, duration);
    }
}

// 미리보기 오디오 재생
function playPreviewAudio(audioData, expectedDuration) {
    const audio = document.getElementById('preview-audio');
    audio.src = 'data:audio/mp3;base64,' + audioData;

    audio.onended = function() {
        onClipEnd();
    };

    audio.onerror = function() {
        console.error('[StudioDesign] 오디오 재생 오류');
        onClipEnd();
    };

    audio.play().catch(err => {
        console.error('[StudioDesign] 오디오 재생 실패:', err);
        // 오디오 재생 실패 시 타이밍만 진행
        setTimeout(() => {
            onClipEnd();
        }, expectedDuration * 1000);
    });
}

// 클립 재생 완료
function onClipEnd() {
    if (!videoPreview.isPlaying) return;

    const currentClip = videoPreview.clips[videoPreview.currentClipIndex];

    // 자막 숨기기
    document.getElementById('preview-subtitle').classList.remove('visible');

    // 현재 시간 업데이트
    videoPreview.currentTime = currentClip.endTime;

    // 다음 클립으로
    videoPreview.currentClipIndex++;

    // 클립 간 간격 (150ms)
    setTimeout(() => {
        playCurrentClip();
    }, 150);
}

// 일시정지
function pausePreview() {
    videoPreview.isPlaying = false;
    document.getElementById('preview-play-btn').textContent = '▶ 재생';

    // 오디오 일시정지
    const audio = document.getElementById('preview-audio');
    audio.pause();

    // 업데이트 중지
    if (videoPreview.updateInterval) {
        clearInterval(videoPreview.updateInterval);
        videoPreview.updateInterval = null;
    }
}

// 정지
function stopPreview() {
    videoPreview.isPlaying = false;
    document.getElementById('preview-play-btn').textContent = '▶ 재생';

    // 오디오 정지
    const audio = document.getElementById('preview-audio');
    audio.pause();
    audio.currentTime = 0;

    // 자막 숨기기
    document.getElementById('preview-subtitle').classList.remove('visible');

    // 업데이트 중지
    if (videoPreview.updateInterval) {
        clearInterval(videoPreview.updateInterval);
        videoPreview.updateInterval = null;
    }
}

// 진행률 업데이트
function updatePreviewProgress() {
    if (!videoPreview.isPlaying) return;

    // 오디오가 재생 중이면 그에 맞춰 시간 업데이트
    const audio = document.getElementById('preview-audio');
    if (!audio.paused && videoPreview.currentClipIndex < videoPreview.clips.length) {
        const clip = videoPreview.clips[videoPreview.currentClipIndex];
        const audioProgress = audio.currentTime / audio.duration;
        const clipDuration = clip.endTime - clip.startTime;
        videoPreview.currentTime = clip.startTime + (clipDuration * audioProgress);
    }

    updatePreviewUI();
}

// UI 업데이트
function updatePreviewUI() {
    // 진행률 바
    const progress = videoPreview.totalDuration > 0
        ? (videoPreview.currentTime / videoPreview.totalDuration) * 100
        : 0;
    document.getElementById('preview-progress').style.width = progress + '%';

    // 시간 표시
    const currentTimeStr = formatPreviewTime(videoPreview.currentTime);
    const totalTimeStr = formatPreviewTime(videoPreview.totalDuration);
    document.getElementById('preview-time').textContent = `${currentTimeStr} / ${totalTimeStr}`;

    // 클립 번호
    document.getElementById('preview-clip-number').textContent =
        `클립: ${videoPreview.currentClipIndex + 1}/${videoPreview.clips.length}`;
}

// 시간을 초에서 "mm:ss" 형식으로 변환
function formatPreviewTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 타임코드 문자열을 초로 변환 (HH:MM:SS 또는 MM:SS)
function parseTimeToSeconds(timeStr) {
    if (!timeStr || timeStr === '--:--:--') return 0;

    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) {
        // HH:MM:SS
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
        // MM:SS
        return parts[0] * 60 + parts[1];
    }
    return 0;
}

// 프로그레스 바 클릭 시 해당 위치로 이동
document.addEventListener('DOMContentLoaded', function() {
    const progressBar = document.getElementById('preview-progress-bar');
    if (progressBar) {
        progressBar.addEventListener('click', function(e) {
            const rect = this.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percent = clickX / rect.width;
            const newTime = percent * videoPreview.totalDuration;

            videoPreview.currentTime = newTime;
            findCurrentClip();
            updatePreviewUI();

            // 재생 중이었으면 해당 위치에서 다시 재생
            if (videoPreview.isPlaying) {
                pausePreview();
                playPreview();
            }
        });
    }
});

console.log('[StudioDesign] 통합 영상 디자인 모듈 로드 완료');
