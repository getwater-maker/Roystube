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
    alert('미리보기 팝업 기능은 추후 구현 예정입니다.');
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
                // 파일명과 폴더 경로 저장 (경로 구분자 정규화)
                const normalizedPath = path.replace(/\//g, '\\'); // / -> \\ 변환
                const pathParts = normalizedPath.split('\\');
                const fileName = pathParts.pop();
                studioDesign.scriptFileName = fileName.replace(/\.(txt|docx)$/i, '');
                studioDesign.scriptFolderPath = pathParts.join('\\');
                studioDesign.settings.scriptPath = normalizedPath;
                studioDesign.settings.outputFolder = studioDesign.scriptFolderPath; // 출력 폴더 자동 설정

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
        // 테스트용 더미 데이터
        studioDesign.scriptFileName = '테스트대본';
        studioDesign.scriptFolderPath = 'C:\\test';
        studioDesign.settings.outputFolder = 'C:\\test';

        studioDesign.sentences = [
            { id: 1, text: '첫 번째 문장입니다.', character: '나레이션', startTime: '00:00:00', endTime: '00:00:03' },
            { id: 2, text: '두 번째 문장입니다.', character: '나레이션', startTime: '00:00:03', endTime: '00:00:06' }
        ];
        renderSentences();
        addLog('테스트 대본 분석 완료', 'info');
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

function updateProgress(percent) {
    const progressBar = document.getElementById('studio-progress-bar');
    if (progressBar) {
        progressBar.style.width = percent + '%';
    }
}

// ============================================
// 문장 관리
// ============================================

function addSentence() {
    console.log('[StudioDesign] 문장 추가');

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
        studioDesign.sentences.splice(index, 1);
        renderSentences();
        addLog('문장 삭제됨', 'info');
    }
}

function previewSentence(id) {
    const sentence = studioDesign.sentences.find(s => s.id === id);
    if (!sentence) return;

    const character = studioDesign.characters.find(c => c.name === sentence.character);
    if (!character) {
        addLog('캐릭터를 찾을 수 없습니다', 'error');
        return;
    }

    addLog(`문장 미리듣기 중...`, 'info');

    const sentenceData = {
        text: sentence.text
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

function editSentence(id) {
    addLog(`문장 #${id} 편집`, 'info');
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

        return `
            <div class="sentence-item" data-id="${sentence.id}">
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

        // 새로운 캐릭터 추가
        const newCharacter = {
            id: Date.now() + index,
            name: characterName,
            voice: savedSettings ? savedSettings.voice : 'ko-KR-Standard-D',
            speed: savedSettings ? savedSettings.speed : 1.0,
            pitch: savedSettings ? savedSettings.pitch : 0,
            postSpeed: savedSettings ? (savedSettings.postSpeed || 1.0) : 1.0,  // MP3 후처리 속도 (Chirp3-HD용)
            volume: 100,  // 항상 100%
            color: savedSettings?.color || getRandomColor(),  // DB에 색상 있으면 사용, 없으면 랜덤
            isNew: isNew  // 신규 캐릭터 표시용
        };

        studioDesign.characters.push(newCharacter);
        existingNames.push(characterName);
    });

    renderCharacters();
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
    }

    const models = [
        { value: 'Wavenet', label: 'Wavenet (고품질)' },
        { value: 'Neural2', label: 'Neural2 (자연스러움)' },
        { value: 'Chirp3-HD', label: 'Chirp3-HD (최신)' },
        { value: 'Standard', label: 'Standard (기본)' }
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

function getCharacterColor(characterName) {
    // 캐릭터 목록에서 해당 이름의 캐릭터 찾기
    const character = studioDesign.characters.find(c => c.name === characterName);
    if (character) {
        return character.color;
    }

    // 캐릭터를 찾을 수 없으면 새로 생성하고 색상 할당
    console.warn(`[StudioDesign] 캐릭터 '${characterName}' 색상을 찾을 수 없어 새로 생성합니다.`);
    const newColor = getRandomColor();

    // 캐릭터 배열에 추가 (이미 존재하지 않는 경우에만)
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
    renderCharacters(); // 캐릭터 목록 업데이트

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
    // 진행바 업데이트 (여러 가능한 선택자 시도)
    const progressBar = document.getElementById('studio-progress-bar') ||
                        document.querySelector('.progress-bar');
    const progressText = document.getElementById('studio-progress-text') ||
                         document.querySelector('.progress-text');

    if (progressBar) {
        progressBar.style.width = percent + '%';
    }

    if (progressText && message) {
        progressText.textContent = message;
    }

    // 콘솔에도 출력
    console.log(`[StudioDesign] 진행률: ${percent}% - ${message}`);
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

document.addEventListener('DOMContentLoaded', async function() {
    console.log('[StudioDesign] DOM 로드 완료');

    // 음성 목록 먼저 로드
    await loadVoicesConfig();

    addLog('통합 영상 디자인 스튜디오 준비 완료', 'success');
    renderCharacters();
});

console.log('[StudioDesign] 통합 영상 디자인 모듈 로드 완료');
