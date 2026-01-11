// ============================================
// 배치 제작 모듈
// ============================================

console.log('[BatchProduction] 배치 제작 모듈 로드 시작...');

// 배치 제작 상태 관리
const batchState = {
    scripts: [],        // 추가된 대본 파일 목록
    jobs: [],           // 작업 큐
    isProcessing: false,
    currentJobIndex: -1,
    stats: {
        completed: 0,
        processing: 0,
        pending: 0,
        failed: 0
    }
};

// ============================================
// 대본 파일 관리
// ============================================

// 대본 파일 추가 (파일 선택 다이얼로그)
async function batchAddScripts() {
    console.log('[BatchProduction] 대본 파일 추가');

    if (typeof eel !== 'undefined') {
        try {
            const paths = await eel.batch_select_multiple_files()();
            if (paths && paths.length > 0) {
                paths.forEach(path => addScriptToList(path));
                batchLog(`${paths.length}개 대본 파일 추가됨`, 'success');
                updateJobList();
            }
        } catch (error) {
            console.error('[BatchProduction] 파일 선택 오류:', error);
            batchLog('파일 선택 중 오류 발생', 'error');
        }
    } else {
        // 테스트 모드
        const testFiles = ['테스트대본1.txt', '테스트대본2.txt', '테스트대본3.txt'];
        testFiles.forEach((name, i) => {
            addScriptToList(`C:\\test\\${name}`);
        });
        batchLog(`${testFiles.length}개 테스트 파일 추가됨`, 'info');
        updateJobList();
    }
}

// 대본 파일을 목록에 추가
function addScriptToList(filePath) {
    // 중복 체크
    if (batchState.scripts.some(s => s.path === filePath)) {
        batchLog(`이미 추가된 파일: ${getFileName(filePath)}`, 'warning');
        return;
    }

    const script = {
        id: Date.now() + Math.random(),
        path: filePath,
        name: getFileName(filePath),
        status: 'pending',
        selected: true
    };

    batchState.scripts.push(script);
    renderScriptList();
}

// 파일명 추출
function getFileName(filePath) {
    return filePath.split('\\').pop().split('/').pop();
}

// 대본 목록 렌더링
function renderScriptList() {
    const container = document.getElementById('batch-script-list');
    if (!container) return;

    if (batchState.scripts.length === 0) {
        container.innerHTML = `
            <div class="batch-empty-state">
                <div class="empty-icon">📄</div>
                <div class="empty-message">대본 파일이 없습니다</div>
                <div class="empty-description">위의 영역을 클릭하거나 파일을 드래그하세요</div>
            </div>
        `;
        return;
    }

    container.innerHTML = batchState.scripts.map(script => `
        <div class="batch-script-item ${script.selected ? 'selected' : ''}" data-id="${script.id}">
            <input type="checkbox" class="batch-script-checkbox"
                   ${script.selected ? 'checked' : ''}
                   onchange="batchToggleScript(${script.id})">
            <div class="batch-script-info">
                <div class="batch-script-name" title="${script.path}">${script.name}</div>
                <div class="batch-script-status">${getStatusText(script.status)}</div>
            </div>
            <button class="btn-icon-sm" onclick="batchRemoveScript(${script.id})" title="삭제">🗑️</button>
        </div>
    `).join('');
}

// 상태 텍스트
function getStatusText(status) {
    const statusMap = {
        'pending': '대기 중',
        'processing': '처리 중...',
        'completed': '완료',
        'failed': '실패'
    };
    return statusMap[status] || status;
}

// 대본 선택 토글
function batchToggleScript(id) {
    const script = batchState.scripts.find(s => s.id === id);
    if (script) {
        script.selected = !script.selected;
        renderScriptList();
        updateJobList();
    }
}

// 대본 삭제
function batchRemoveScript(id) {
    const index = batchState.scripts.findIndex(s => s.id === id);
    if (index > -1) {
        const script = batchState.scripts[index];
        batchState.scripts.splice(index, 1);
        batchLog(`파일 제거: ${script.name}`, 'info');
        renderScriptList();
        updateJobList();
    }
}

// 전체 선택
function batchSelectAll() {
    batchState.scripts.forEach(s => s.selected = true);
    renderScriptList();
    updateJobList();
}

// 전체 해제
function batchDeselectAll() {
    batchState.scripts.forEach(s => s.selected = false);
    renderScriptList();
    updateJobList();
}

// 선택 삭제
function batchRemoveSelected() {
    const selectedCount = batchState.scripts.filter(s => s.selected).length;
    if (selectedCount === 0) {
        alert('삭제할 파일을 선택해주세요.');
        return;
    }

    if (!confirm(`${selectedCount}개 파일을 삭제하시겠습니까?`)) {
        return;
    }

    batchState.scripts = batchState.scripts.filter(s => !s.selected);
    batchLog(`${selectedCount}개 파일 제거됨`, 'info');
    renderScriptList();
    updateJobList();
}

// ============================================
// 드래그 앤 드롭
// ============================================

function batchHandleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('batch-dropzone').classList.add('drag-over');
}

function batchHandleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('batch-dropzone').classList.remove('drag-over');
}

function batchHandleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('batch-dropzone').classList.remove('drag-over');

    // 웹 환경에서는 드래그앤드롭이 제한적이므로
    // 클릭하여 파일 선택하도록 안내
    batchLog('파일 선택 다이얼로그를 사용해주세요', 'info');
    batchAddScripts();
}

// 드롭존 클릭 시 파일 선택
document.addEventListener('DOMContentLoaded', function() {
    const dropzone = document.getElementById('batch-dropzone');
    if (dropzone) {
        dropzone.addEventListener('click', batchAddScripts);
    }

    // MP4 체크박스 변경 시 영상 설정 표시/숨김
    const videoCheckbox = document.getElementById('batch-output-video');
    if (videoCheckbox) {
        videoCheckbox.addEventListener('change', function() {
            const videoSettings = document.getElementById('batch-video-settings');
            if (videoSettings) {
                videoSettings.style.display = this.checked ? 'block' : 'none';
            }
        });
    }

    // 출력 위치 라디오 버튼 변경 시
    const radioButtons = document.querySelectorAll('input[name="batch-output-location"]');
    radioButtons.forEach(radio => {
        radio.addEventListener('change', function() {
            const customFolderRow = document.getElementById('batch-custom-folder-row');
            if (customFolderRow) {
                customFolderRow.style.display = this.value === 'custom' ? 'flex' : 'none';
            }
        });
    });
});

// ============================================
// 작업 큐 관리
// ============================================

// 작업 목록 업데이트
function updateJobList() {
    const selectedScripts = batchState.scripts.filter(s => s.selected);

    // 작업 큐 생성
    batchState.jobs = selectedScripts.map(script => ({
        id: script.id,
        scriptPath: script.path,
        scriptName: script.name,
        status: 'pending',
        progress: 0,
        sentenceCount: 0,
        characterCount: 0,
        startTime: null,
        endTime: null,
        error: null
    }));

    renderJobList();
    updateStats();
    updateProgressCount();
}

// 작업 목록 렌더링
function renderJobList() {
    const container = document.getElementById('batch-job-list');
    if (!container) return;

    if (batchState.jobs.length === 0) {
        container.innerHTML = `
            <div class="batch-empty-state">
                <div class="empty-icon">📋</div>
                <div class="empty-message">작업이 없습니다</div>
                <div class="empty-description">왼쪽에서 대본 파일을 추가하세요</div>
            </div>
        `;
        return;
    }

    container.innerHTML = batchState.jobs.map(job => {
        const statusIcon = getJobStatusIcon(job.status);
        const statusClass = job.status;
        const elapsed = getElapsedTime(job);
        const detail = job.sentenceCount > 0
            ? `문장 ${job.sentenceCount}개 | 캐릭터 ${job.characterCount}명`
            : '분석 대기';

        return `
            <div class="batch-job-item ${statusClass}" data-id="${job.id}">
                <div class="batch-job-status">${statusIcon}</div>
                <div class="batch-job-info">
                    <div class="batch-job-name" title="${job.scriptPath}">${job.scriptName}</div>
                    <div class="batch-job-detail">${detail}</div>
                </div>
                <div class="batch-job-progress">
                    <div class="batch-job-progress-bar" style="width: ${job.progress}%"></div>
                </div>
                <div class="batch-job-time">${elapsed}</div>
                <div class="batch-job-actions">
                    ${job.status === 'failed' ? `<button class="btn-icon-sm" onclick="batchRetryJob(${job.id})" title="재시도">🔄</button>` : ''}
                    ${job.status === 'completed' ? `<button class="btn-icon-sm" onclick="batchOpenFolder(${job.id})" title="폴더 열기">📂</button>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// 작업 상태 아이콘
function getJobStatusIcon(status) {
    const icons = {
        'pending': '⏳',
        'processing': '🔄',
        'completed': '✅',
        'failed': '❌'
    };
    return icons[status] || '❓';
}

// 경과 시간 계산
function getElapsedTime(job) {
    if (!job.startTime) return '--:--';

    const end = job.endTime || Date.now();
    const elapsed = Math.floor((end - job.startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// 통계 업데이트
function updateStats() {
    const stats = {
        completed: batchState.jobs.filter(j => j.status === 'completed').length,
        processing: batchState.jobs.filter(j => j.status === 'processing').length,
        pending: batchState.jobs.filter(j => j.status === 'pending').length,
        failed: batchState.jobs.filter(j => j.status === 'failed').length
    };

    batchState.stats = stats;

    document.getElementById('batch-stats-completed').textContent = `✅ 완료: ${stats.completed}`;
    document.getElementById('batch-stats-processing').textContent = `🔄 진행: ${stats.processing}`;
    document.getElementById('batch-stats-pending').textContent = `⏳ 대기: ${stats.pending}`;
    document.getElementById('batch-stats-failed').textContent = `❌ 실패: ${stats.failed}`;
}

// 진행률 카운트 업데이트
function updateProgressCount() {
    const total = batchState.jobs.length;
    const completed = batchState.stats.completed;

    document.getElementById('batch-progress-count').textContent = `${completed} / ${total}`;

    const percent = total > 0 ? (completed / total) * 100 : 0;
    document.getElementById('batch-overall-bar').style.width = `${percent}%`;
}

// ============================================
// 배치 처리 실행
// ============================================

// 일괄 시작
async function batchStartAll() {
    if (batchState.isProcessing) {
        batchLog('이미 처리 중입니다', 'warning');
        return;
    }

    const pendingJobs = batchState.jobs.filter(j => j.status === 'pending');
    if (pendingJobs.length === 0) {
        batchLog('처리할 작업이 없습니다', 'warning');
        return;
    }

    batchState.isProcessing = true;
    updateButtonStates();

    batchLog(`배치 처리 시작: ${pendingJobs.length}개 작업`, 'info');

    // 설정 수집
    const settings = getBatchSettings();

    // 순차 처리
    for (let i = 0; i < batchState.jobs.length; i++) {
        if (!batchState.isProcessing) {
            batchLog('사용자에 의해 중지됨', 'warning');
            break;
        }

        const job = batchState.jobs[i];
        if (job.status !== 'pending') continue;

        batchState.currentJobIndex = i;
        await processJob(job, settings);

        updateStats();
        updateProgressCount();
        renderJobList();
    }

    batchState.isProcessing = false;
    batchState.currentJobIndex = -1;
    updateButtonStates();

    // 완료 알림
    if (document.getElementById('batch-notify-complete')?.checked) {
        const stats = batchState.stats;
        batchLog(`배치 처리 완료! 성공: ${stats.completed}, 실패: ${stats.failed}`, 'success');

        // 브라우저 알림 (권한이 있는 경우)
        if (Notification.permission === 'granted') {
            new Notification('배치 제작 완료', {
                body: `성공: ${stats.completed}개, 실패: ${stats.failed}개`
            });
        }
    }
}

// 개별 작업 처리
async function processJob(job, settings) {
    job.status = 'processing';
    job.startTime = Date.now();
    job.progress = 0;
    renderJobList();

    batchLog(`처리 시작: ${job.scriptName}`, 'info');

    try {
        if (typeof eel !== 'undefined') {
            // 백엔드 호출
            const result = await eel.batch_process_script({
                scriptPath: job.scriptPath,
                settings: settings
            })();

            if (result && result.success) {
                job.status = 'completed';
                job.progress = 100;
                job.sentenceCount = result.sentenceCount || 0;
                job.characterCount = result.characterCount || 0;
                batchLog(`완료: ${job.scriptName} (${job.sentenceCount}문장)`, 'success');
            } else {
                throw new Error(result?.error || '알 수 없는 오류');
            }
        } else {
            // 테스트 모드: 시뮬레이션
            await simulateProcessing(job);
        }
    } catch (error) {
        job.status = 'failed';
        job.error = error.message;
        batchLog(`실패: ${job.scriptName} - ${error.message}`, 'error');

        // 자동 재시도
        if (document.getElementById('batch-auto-retry')?.checked) {
            batchLog(`재시도 중: ${job.scriptName}`, 'info');
            job.status = 'pending';
            await processJob(job, settings);
        }
    }

    job.endTime = Date.now();
}

// 테스트용 처리 시뮬레이션
async function simulateProcessing(job) {
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
        await new Promise(resolve => setTimeout(resolve, 300));
        job.progress = (i / steps) * 100;
        renderJobList();

        if (!batchState.isProcessing) {
            throw new Error('사용자 중지');
        }
    }

    job.sentenceCount = Math.floor(Math.random() * 50) + 10;
    job.characterCount = Math.floor(Math.random() * 5) + 1;
    job.status = 'completed';
}

// 중지
function batchStopAll() {
    if (!batchState.isProcessing) return;

    batchState.isProcessing = false;
    batchLog('배치 처리 중지 요청...', 'warning');
}

// 버튼 상태 업데이트
function updateButtonStates() {
    const startBtn = document.getElementById('batch-start-btn');
    const stopBtn = document.getElementById('batch-stop-btn');

    if (startBtn) {
        startBtn.disabled = batchState.isProcessing;
    }
    if (stopBtn) {
        stopBtn.disabled = !batchState.isProcessing;
    }
}

// 설정 수집
function getBatchSettings() {
    return {
        outputMP3: document.getElementById('batch-output-mp3')?.checked ?? true,
        outputSRT: document.getElementById('batch-output-srt')?.checked ?? true,
        outputVideo: document.getElementById('batch-output-video')?.checked ?? false,
        outputLocation: document.querySelector('input[name="batch-output-location"]:checked')?.value ?? 'same',
        customFolder: document.getElementById('batch-output-folder')?.value ?? '',
        defaultVoice: document.getElementById('batch-default-voice')?.value ?? 'ko-KR-Wavenet-D',
        defaultSpeed: parseFloat(document.getElementById('batch-default-speed')?.value ?? '1.0'),
        defaultPitch: parseInt(document.getElementById('batch-default-pitch')?.value ?? '0'),
        // Chirp3-HD MP3 후처리 속도 설정
        defaultPostSpeed: parseFloat(document.getElementById('batch-default-postspeed')?.value ?? '1.0'),
        applyPostSpeedToAll: document.getElementById('batch-apply-postspeed-all')?.checked ?? false,
        resolution: document.getElementById('batch-resolution')?.value ?? '1920x1080',
        background: document.getElementById('batch-background')?.value ?? '',
        useDBCharacters: document.getElementById('batch-use-db-characters')?.checked ?? true,
        autoRetry: document.getElementById('batch-auto-retry')?.checked ?? false,
        notifyComplete: document.getElementById('batch-notify-complete')?.checked ?? true
    };
}

// ============================================
// 유틸리티 함수
// ============================================

// 작업 재시도
function batchRetryJob(id) {
    const job = batchState.jobs.find(j => j.id === id);
    if (job) {
        job.status = 'pending';
        job.progress = 0;
        job.error = null;
        job.startTime = null;
        job.endTime = null;

        renderJobList();
        updateStats();

        batchLog(`재시도 대기: ${job.scriptName}`, 'info');
    }
}

// 출력 폴더 열기
async function batchOpenFolder(id) {
    const job = batchState.jobs.find(j => j.id === id);
    if (!job) return;

    const folderPath = job.scriptPath.substring(0, job.scriptPath.lastIndexOf('\\'));

    if (typeof eel !== 'undefined') {
        await eel.open_folder(folderPath)();
    } else {
        batchLog(`폴더: ${folderPath}`, 'info');
    }
}

// 출력 폴더 선택
async function batchSelectOutputFolder() {
    if (typeof eel !== 'undefined') {
        const path = await eel.select_folder()();
        if (path) {
            document.getElementById('batch-output-folder').value = path;
            batchLog(`출력 폴더 설정: ${path}`, 'info');
        }
    }
}

// 배경 이미지 선택
async function batchSelectBackground() {
    if (typeof eel !== 'undefined') {
        const path = await eel.select_file('이미지 파일 (*.jpg;*.png;*.jpeg)')();
        if (path) {
            document.getElementById('batch-background').value = path;
            batchLog(`배경 이미지 설정: ${getFileName(path)}`, 'info');
        }
    }
}

// 로그 추가
function batchLog(message, type = 'info') {
    const logContainer = document.getElementById('batch-log');
    if (!logContainer) return;

    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${timestamp}] ${message}`;

    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;

    console.log(`[BatchProduction] ${message}`);
}

// ============================================
// 초기화
// ============================================

console.log('[BatchProduction] 배치 제작 모듈 로드 완료');
