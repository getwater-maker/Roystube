/**
 * RoyStudio 통합 JavaScript
 * RoyYoutubeSearch에 통합된 로이스튜디오 기능
 */

// ========== 로그 수집기 (가장 먼저 초기화) ==========
const logCollector = {
    logs: [],
    maxLogs: 2000,  // 최대 로그 수

    // 로그 추가
    add: function(type, ...args) {
        const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false });
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        this.logs.push({
            time: timestamp,
            type: type,
            message: message
        });

        // 최대 로그 수 초과 시 오래된 로그 삭제
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
    },

    // 전체 로그 포맷팅
    format: function() {
        const now = new Date().toLocaleString('ko-KR');
        let output = '=== Roystube 로그 ===\n';
        output += `복사 시간: ${now}\n`;
        output += `로그 수: ${this.logs.length}개\n`;
        output += '========================\n\n';

        this.logs.forEach(log => {
            output += `[${log.time}] [${log.type}] ${log.message}\n`;
        });

        return output;
    },

    // 로그 초기화
    clear: function() {
        this.logs = [];
    }
};

// 백엔드 로그 저장소
let backendLogs = [];

// 원본 console 메서드 백업 및 가로채기
(function() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalInfo = console.info;
    const originalDebug = console.debug;

    console.log = function(...args) {
        logCollector.add('LOG', ...args);
        originalLog.apply(console, args);
    };

    console.warn = function(...args) {
        logCollector.add('WARN', ...args);
        originalWarn.apply(console, args);
    };

    console.error = function(...args) {
        logCollector.add('ERROR', ...args);
        originalError.apply(console, args);
    };

    console.info = function(...args) {
        logCollector.add('INFO', ...args);
        originalInfo.apply(console, args);
    };

    console.debug = function(...args) {
        logCollector.add('DEBUG', ...args);
        originalDebug.apply(console, args);
    };
})();

// 로그 복사 함수
async function copyAllLogs() {
    try {
        // 백엔드 로그 가져오기
        let backendLogText = '';
        try {
            const result = await eel.get_backend_logs()();
            if (result && result.logs) {
                backendLogText = '\n=== 백엔드 로그 ===\n';
                backendLogText += result.logs.join('\n');
                backendLogText += '\n========================\n';
            }
        } catch (e) {
            backendLogText = '\n=== 백엔드 로그 ===\n(백엔드 로그를 가져올 수 없습니다)\n';
        }

        // 프론트엔드 로그 + 백엔드 로그 합치기
        const fullLog = logCollector.format() + backendLogText;

        // 클립보드에 복사
        await navigator.clipboard.writeText(fullLog);

        alert(`로그가 클립보드에 복사되었습니다!\n\n` +
              `프론트엔드 로그: ${logCollector.logs.length}개\n` +
              `문제 발생 시 이 로그를 붙여넣어 주세요.`);

    } catch (error) {
        console.error('[로그 복사 실패]', error);
        alert('로그 복사에 실패했습니다: ' + error.message);
    }
}

console.log('[Roystube] 로그 수집기 초기화 완료');

// ========== 전역 변수 ==========
let studioCurrentTab = 'studio-production';
let studioBatchQueue = [];
let studioSelectedJobId = null;
let studioIsProcessing = false;
let studioCurrentPresetData = null;
let studioCurrentPresetOriginalName = null;  // 프리셋 이름 변경용 원본 이름
let studioCurrentScriptPath = null;

// 검은화면 생성 관련
let studioIsBlackscreenProcessing = false;
let studioBlackscreenElapsedTimer = null;
let studioBlackscreenStartTime = null;
let studioBlackscreenPreviewTimer = null;
let studioBlackscreenPreviewTime = 0;

// 영상제작 경과 시간 타이머
let studioProductionElapsedTimer = null;
let studioProductionStartTime = null;

// 캐릭터별 음성 설정 (영상 탭)
let studioCharacterVoiceSettings = {};
let studioAnalyzedClips = [];

// 캐릭터별 음성 설정 (배치 탭 - 영상 탭과 독립적으로 관리)
let batchCharacterVoiceSettings = {};

// 자막 관련
let studioSubtitles = [];
let studioCurrentSubtitleIndex = 0;

// 대본 파일명 추출 헬퍼 함수
function studioGetScriptBaseName() {
    if (!studioCurrentScriptPath) {
        return null;
    }
    // 경로에서 파일명만 추출 (확장자 제거)
    const pathParts = studioCurrentScriptPath.replace(/\\/g, '/').split('/');
    const fileName = pathParts[pathParts.length - 1];
    const baseName = fileName.replace(/\.[^/.]+$/, '');  // 확장자 제거
    return baseName;
}

// ========== 초기화 ==========
document.addEventListener('DOMContentLoaded', () => {
    studioInitialize();
    initTabSwitching();
});

// ========== 탭 전환 기능 ==========
function initTabSwitching() {
    // 모든 탭 버튼에 클릭 이벤트 리스너 추가
    const tabButtons = document.querySelectorAll('.tab-btn');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            if (targetTab) {
                switchTab(targetTab);
            }
        });
    });

    // 초기 탭 표시 (active 클래스가 있는 탭 또는 첫 번째 탭)
    const activeButton = document.querySelector('.tab-btn.active');
    if (activeButton) {
        const initialTab = activeButton.getAttribute('data-tab');
        if (initialTab) {
            switchTab(initialTab);
        }
    } else if (tabButtons.length > 0) {
        const firstTab = tabButtons[0].getAttribute('data-tab');
        if (firstTab) {
            tabButtons[0].classList.add('active');
            switchTab(firstTab);
        }
    }
}

function switchTab(tabName) {
    // 모든 탭 숨기기
    const allTabs = document.querySelectorAll('.tab-pane');
    allTabs.forEach(tab => {
        tab.classList.remove('active');
        tab.style.display = 'none';
    });

    // 모든 탭 버튼의 active 클래스 제거
    const allButtons = document.querySelectorAll('.tab-btn');
    allButtons.forEach(btn => {
        btn.classList.remove('active');
    });

    // 선택된 탭 표시
    const targetTab = document.getElementById(`tab-${tabName}`);
    if (targetTab) {
        targetTab.classList.add('active');
        targetTab.style.display = 'block';
    }

    // 선택된 버튼에 active 클래스 추가
    const targetButton = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (targetButton) {
        targetButton.classList.add('active');
    }

    // 현재 탭 저장
    studioCurrentTab = tabName;

    console.log(`[RoyStudio] 탭 전환: ${tabName}`);
}

async function studioInitialize() {
    console.log('[RoyStudio] 초기화 시작...');

    try {
        // 프로필 목록 로드
        await studioUpdateProfileLists();

        // 언어/음성 드롭다운 초기화
        await studioInitVoiceSelectors();

        // 프리셋 목록 로드
        await studioLoadPresetList();

        // 검은화면 탭 초기화
        studioInitBlackscreenTab();

        // STEP1 TTS 사용량 정보 로드
        studioUpdateStep1Usage();

        console.log('[RoyStudio] 초기화 완료');
    } catch (error) {
        console.error('[RoyStudio] 초기화 오류:', error);
    }
}

// ========== 음성 선택 시스템 ==========
let studioLanguages = [];
let studioCurrentLanguage = 'ko-KR';
let studioCurrentVoiceGroup = 'Wavenet';

async function studioInitVoiceSelectors() {
    try {
        // 언어 목록 로드
        studioLanguages = await eel.studio_get_languages()();
        console.log('[RoyStudio] 언어 목록 로드:', studioLanguages);
    } catch (error) {
        console.error('[RoyStudio] 음성 선택기 초기화 오류:', error);
    }
}

function studioCreateVoiceSelector(characterName, containerId) {
    // 캐릭터별 음성 선택기 생성 (한국어 전용)
    const html = `
        <div class="studio-voice-setting" data-character="${characterName}">
            <div class="voice-setting-header">
                <strong>${characterName}</strong>
                <button onclick="studioPreviewCharacterVoice('${characterName}')" class="btn btn-xs">▶ 미리듣기</button>
            </div>
            <div class="voice-setting-controls">
                <input type="hidden" class="voice-lang" value="ko-KR">
                <select class="voice-group" onchange="studioOnVoiceGroupChange(this, '${characterName}')">
                    <option value="Wavenet">Wavenet</option>
                    <option value="Neural2">Neural2</option>
                    <option value="Standard">Standard</option>
                    <option value="Chirp3-HD">Chirp3-HD</option>
                </select>
                <select class="voice-name">
                    <option value="ko-KR-Wavenet-A">A_여성</option>
                    <option value="ko-KR-Wavenet-B">B_여성</option>
                    <option value="ko-KR-Wavenet-C">C_남성</option>
                    <option value="ko-KR-Wavenet-D">D_남성</option>
                </select>
            </div>
            <div class="voice-setting-params">
                <div class="param-row">
                    <span class="param-label">속도:</span>
                    <button type="button" class="param-btn" onclick="studioAdjustParam(this, 'rate', -0.05)">-</button>
                    <input type="range" class="voice-rate" min="0.25" max="4" step="0.05" value="1.0"
                        oninput="studioSyncParamValue(this, 'rate')">
                    <button type="button" class="param-btn" onclick="studioAdjustParam(this, 'rate', 0.05)">+</button>
                    <input type="number" class="param-input voice-rate-num" min="0.25" max="4" step="0.05" value="1.00"
                        onchange="studioSyncParamSlider(this, 'rate')">
                </div>
                <div class="param-row">
                    <span class="param-label">피치:</span>
                    <button type="button" class="param-btn" onclick="studioAdjustParam(this, 'pitch', -1)">-</button>
                    <input type="range" class="voice-pitch" min="-20" max="20" step="1" value="0"
                        oninput="studioSyncParamValue(this, 'pitch')">
                    <button type="button" class="param-btn" onclick="studioAdjustParam(this, 'pitch', 1)">+</button>
                    <input type="number" class="param-input voice-pitch-num" min="-20" max="20" step="1" value="0"
                        onchange="studioSyncParamSlider(this, 'pitch')">
                </div>
            </div>
        </div>
    `;
    return html;
}

// 속도/피치 조절 헬퍼 함수
function studioAdjustParam(btn, paramType, delta) {
    const row = btn.closest('.param-row');
    const slider = row.querySelector(paramType === 'rate' ? '.voice-rate' : '.voice-pitch');
    const numInput = row.querySelector(paramType === 'rate' ? '.voice-rate-num' : '.voice-pitch-num');

    let newValue = parseFloat(slider.value) + delta;
    newValue = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), newValue));

    slider.value = newValue;
    if (numInput) {
        numInput.value = paramType === 'rate' ? newValue.toFixed(2) : Math.round(newValue);
    }
}

// 슬라이더 → 숫자 입력 동기화
function studioSyncParamValue(slider, paramType) {
    const row = slider.closest('.param-row');
    const numInput = row.querySelector(paramType === 'rate' ? '.voice-rate-num' : '.voice-pitch-num');
    if (numInput) {
        numInput.value = paramType === 'rate' ? parseFloat(slider.value).toFixed(2) : Math.round(slider.value);
    }
}

// 숫자 입력 → 슬라이더 동기화
function studioSyncParamSlider(numInput, paramType) {
    const row = numInput.closest('.param-row');
    const slider = row.querySelector(paramType === 'rate' ? '.voice-rate' : '.voice-pitch');
    if (slider) {
        let value = parseFloat(numInput.value);
        value = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), value));
        slider.value = value;
        numInput.value = paramType === 'rate' ? value.toFixed(2) : Math.round(value);
    }
}

async function studioOnLanguageChange(selectElement, characterName) {
    const languageCode = selectElement.value;
    const container = selectElement.closest('.studio-voice-setting');
    const groupSelect = container.querySelector('.voice-group');
    const nameSelect = container.querySelector('.voice-name');

    try {
        // 해당 언어의 그룹 목록 로드
        const groups = await eel.studio_get_voice_groups(languageCode)();
        groupSelect.innerHTML = groups.map(g => `<option value="${g}">${g}</option>`).join('');

        // 첫 번째 그룹의 음성 목록 로드
        const firstGroup = groups[0] || 'Standard';
        await studioUpdateVoiceNames(nameSelect, languageCode, firstGroup);
    } catch (error) {
        console.error('[RoyStudio] 언어 변경 오류:', error);
    }
}

async function studioOnVoiceGroupChange(selectElement, characterName) {
    const container = selectElement.closest('.studio-voice-setting');
    const langSelect = container.querySelector('.voice-lang');
    const nameSelect = container.querySelector('.voice-name');

    const languageCode = langSelect.value;
    const groupName = selectElement.value;

    await studioUpdateVoiceNames(nameSelect, languageCode, groupName);

    // Chirp3-HD, Chirp-HD, Studio는 속도/피치 조절 불가 - 비활성화
    const supportsRatePitch = !groupName.includes('Chirp') && groupName !== 'Studio';
    studioToggleVoiceParams(container, supportsRatePitch);
}

// 속도/피치 파라미터 활성화/비활성화
function studioToggleVoiceParams(container, enabled) {
    const paramsDiv = container.querySelector('.voice-setting-params-horizontal') || container.querySelector('.voice-setting-params');
    if (!paramsDiv) return;

    const inputs = paramsDiv.querySelectorAll('input, button');
    inputs.forEach(input => {
        input.disabled = !enabled;
    });

    // 비활성화 시 시각적 표시
    if (enabled) {
        paramsDiv.classList.remove('params-disabled');
    } else {
        paramsDiv.classList.add('params-disabled');
        // 기본값으로 리셋
        const rateSlider = paramsDiv.querySelector('.voice-rate');
        const pitchSlider = paramsDiv.querySelector('.voice-pitch');
        const rateNum = paramsDiv.querySelector('.voice-rate-num');
        const pitchNum = paramsDiv.querySelector('.voice-pitch-num');
        if (rateSlider) rateSlider.value = 1.0;
        if (pitchSlider) pitchSlider.value = 0;
        if (rateNum) rateNum.value = '1.00';
        if (pitchNum) pitchNum.value = '0';
    }
}

async function studioUpdateVoiceNames(selectElement, languageCode, groupName) {
    try {
        const voices = await eel.studio_get_voice_names(languageCode, groupName)();
        selectElement.innerHTML = voices.map(v => {
            // 성별 정보 맵
            const genderMap = {
                'Wavenet-A': '여성', 'Wavenet-B': '여성', 'Wavenet-C': '남성', 'Wavenet-D': '남성',
                'Neural2-A': '여성', 'Neural2-B': '여성', 'Neural2-C': '남성',
                'Standard-A': '여성', 'Standard-B': '여성', 'Standard-C': '남성', 'Standard-D': '남성',
                // Chirp3-HD 여성 (14명)
                'Chirp3-HD-Achernar': '여성', 'Chirp3-HD-Aoede': '여성', 'Chirp3-HD-Autonoe': '여성',
                'Chirp3-HD-Callirrhoe': '여성', 'Chirp3-HD-Despina': '여성', 'Chirp3-HD-Erinome': '여성',
                'Chirp3-HD-Gacrux': '여성', 'Chirp3-HD-Kore': '여성', 'Chirp3-HD-Laomedeia': '여성',
                'Chirp3-HD-Leda': '여성', 'Chirp3-HD-Pulcherrima': '여성', 'Chirp3-HD-Sulafat': '여성',
                'Chirp3-HD-Vindemiatrix': '여성', 'Chirp3-HD-Zephyr': '여성',
                // Chirp3-HD 남성 (16명)
                'Chirp3-HD-Achird': '남성', 'Chirp3-HD-Algenib': '남성', 'Chirp3-HD-Algieba': '남성',
                'Chirp3-HD-Alnilam': '남성', 'Chirp3-HD-Charon': '남성', 'Chirp3-HD-Enceladus': '남성',
                'Chirp3-HD-Fenrir': '남성', 'Chirp3-HD-Iapetus': '남성', 'Chirp3-HD-Orus': '남성',
                'Chirp3-HD-Puck': '남성', 'Chirp3-HD-Rasalgethi': '남성', 'Chirp3-HD-Sadachbia': '남성',
                'Chirp3-HD-Sadaltager': '남성', 'Chirp3-HD-Schedar': '남성', 'Chirp3-HD-Umbriel': '남성',
                'Chirp3-HD-Zubenelgenubi': '남성'
            };

            // "ko-KR-" 접두사 제거
            const voiceKey = v.replace(/^ko-KR-/, '');
            // 마지막 부분만 추출 (예: Chirp3-HD-Achernar -> Achernar, Wavenet-A -> A)
            const namePart = voiceKey.split('-').pop();
            const gender = genderMap[voiceKey] || '';
            // 형식: Achernar_여성, A_여성
            const displayName = gender ? `${namePart}_${gender}` : namePart;

            return `<option value="${v}">${displayName}</option>`;
        }).join('');
    } catch (error) {
        console.error('[RoyStudio] 음성 목록 로드 오류:', error);
    }
}

async function studioPreviewCharacterVoice(characterName) {
    const container = document.querySelector(`.studio-voice-setting[data-character="${characterName}"]`);
    if (!container) return;

    const voiceName = container.querySelector('.voice-name').value;
    const rate = parseFloat(container.querySelector('.voice-rate').value);
    const pitch = parseFloat(container.querySelector('.voice-pitch').value);

    // 해당 캐릭터의 첫 번째 대사 찾기
    const clip = studioAnalyzedClips.find(c => c.character === characterName);
    const testText = clip ? clip.text.substring(0, 50) : '안녕하세요. 테스트 음성입니다.';

    studioLog(`미리듣기: ${characterName} - ${voiceName}`);

    try {
        // TTS Quota Manager를 통해 자동으로 API 키 선택
        const result = await eel.studio_test_voice(testText, voiceName, '', rate, pitch)();
        if (!result.success) {
            alert('미리듣기 실패: ' + result.error);
        }
    } catch (error) {
        console.error('[RoyStudio] 미리듣기 오류:', error);
        alert('미리듣기 오류: ' + error);
    }
}

// ========== 프로필 관리 ==========
// TTS API 키는 상단 API키 버튼에서 관리됨
async function studioUpdateProfileLists() {
    try {
        // 프로필 관련 UI가 제거되어 이 함수는 더 이상 프로필 목록을 업데이트하지 않음
        // TTS API 키는 tts_quota_manager를 통해 자동 관리됨
        console.log('[RoyStudio] TTS API 키는 상단 API키 버튼에서 관리됩니다.');
    } catch (error) {
        console.error('[RoyStudio] 초기화 오류:', error);
    }
}

let studioPresetList = [];

async function studioLoadPresetList() {
    try {
        studioPresetList = await eel.studio_get_presets()();
        studioUpdatePresetDropdowns();
        console.log('[RoyStudio] 프리셋 목록 로드:', studioPresetList);
    } catch (error) {
        console.error('[RoyStudio] 프리셋 목록 로드 오류:', error);
    }
}

function studioUpdatePresetDropdowns() {
    // 설정 탭 프리셋 드롭다운
    const settingsPreset = document.getElementById('studio-preset-select');
    if (settingsPreset) {
        settingsPreset.innerHTML = '<option value="">프리셋 선택...</option>';
        studioPresetList.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            settingsPreset.appendChild(option);
        });
    }

    // 자막 탭 프리셋 드롭다운
    const subtitlePreset = document.getElementById('studio-subtitle-preset');
    if (subtitlePreset) {
        subtitlePreset.innerHTML = '<option value="">프리셋 선택...</option>';
        studioPresetList.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            subtitlePreset.appendChild(option);
        });
    }

    // 프리셋 관리 모달 목록
    const presetManagerList = document.getElementById('studio-preset-list');
    if (presetManagerList) {
        presetManagerList.innerHTML = '';
        studioPresetList.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            presetManagerList.appendChild(option);
        });
    }
}

async function studioOnPresetChange() {
    const presetName = document.getElementById('studio-preset-select')?.value;
    if (!presetName) return;

    try {
        const presetData = await eel.studio_load_preset(presetName)();
        if (presetData) {
            studioApplyPreset(presetData);
            studioLog(`프리셋 '${presetName}' 적용됨`);
        }
    } catch (error) {
        console.error('[RoyStudio] 프리셋 로드 오류:', error);
    }
}

function studioApplyPreset(presetData) {
    // 음성 설정 적용
    if (presetData.voiceSettings) {
        studioCharacterVoiceSettings = { ...presetData.voiceSettings };
        // 현재 캐릭터 목록이 있으면 UI 업데이트
        if (studioAnalyzedClips.length > 0) {
            studioUpdateVoiceSettings();
        }
    }

    // EQ 설정 적용
    if (presetData.eqSettings) {
        const eq = presetData.eqSettings;
        const eqEnabled = document.getElementById('studio-eq-enabled');
        const eqStyle = document.getElementById('studio-eq-style');
        const eqColor1 = document.getElementById('studio-eq-color1');
        const eqColor2 = document.getElementById('studio-eq-color2');
        const eqSensitivity = document.getElementById('studio-eq-sensitivity');
        const eqBarCount = document.getElementById('studio-eq-bar-count');

        if (eqEnabled) eqEnabled.checked = eq.enabled ?? true;
        if (eqStyle) eqStyle.value = eq.style || 'bar';
        if (eqColor1) eqColor1.value = eq.colorStart || '#667eea';
        if (eqColor2) eqColor2.value = eq.colorEnd || '#764ba2';
        if (eqSensitivity) eqSensitivity.value = eq.sensitivity || 1.0;
        if (eqBarCount) eqBarCount.value = eq.barCount || 32;
    }

    // 출력 설정 적용
    if (presetData.outputSettings) {
        const output = presetData.outputSettings;
        const resolution = document.getElementById('studio-output-resolution');
        const fps = document.getElementById('studio-output-fps');

        if (resolution) resolution.value = output.resolution || '1920x1080';
        if (fps) fps.value = output.fps || 30;
    }
}

// ========== 프로필 모달 ==========
function studioOpenProfileManager() {
    document.getElementById('studio-profile-modal').style.display = 'flex';
    studioLoadProfileList();
}

function studioCloseProfileManager() {
    document.getElementById('studio-profile-modal').style.display = 'none';
}

async function studioLoadProfileList() {
    try {
        const profiles = await eel.studio_get_profiles()();
        const listElement = document.getElementById('studio-profile-list');
        listElement.innerHTML = '';

        profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile;
            option.textContent = profile;
            listElement.appendChild(option);
        });
    } catch (error) {
        console.error('[RoyStudio] 프로필 목록 로드 오류:', error);
    }
}

async function studioAddProfile() {
    const name = document.getElementById('studio-profile-name-input').value.trim();
    const credential = document.getElementById('studio-profile-credential').value.trim();
    const folder = document.getElementById('studio-profile-folder').value.trim();

    if (!name) {
        alert('계정 이름을 입력하세요.');
        return;
    }

    try {
        const result = await eel.studio_add_profile(name, credential, folder)();
        if (result.success) {
            alert('계정이 추가되었습니다.');
            await studioLoadProfileList();
            await studioUpdateProfileLists();
        } else {
            alert('오류: ' + result.error);
        }
    } catch (error) {
        console.error('[RoyStudio] 계정 추가 오류:', error);
    }
}

async function studioUpdateProfile() {
    const listElement = document.getElementById('studio-profile-list');
    const selected = listElement.value;
    if (!selected) {
        alert('수정할 계정을 선택하세요.');
        return;
    }

    const credential = document.getElementById('studio-profile-credential').value.trim();
    const folder = document.getElementById('studio-profile-folder').value.trim();

    try {
        const result = await eel.studio_update_profile(selected, credential, folder)();
        if (result.success) {
            alert('계정이 수정되었습니다.');
        } else {
            alert('오류: ' + result.error);
        }
    } catch (error) {
        console.error('[RoyStudio] 계정 수정 오류:', error);
    }
}

async function studioDeleteProfile() {
    const listElement = document.getElementById('studio-profile-list');
    const selected = listElement.value;
    if (!selected) {
        alert('삭제할 계정을 선택하세요.');
        return;
    }

    if (!confirm(`'${selected}' 계정을 삭제하시겠습니까?`)) {
        return;
    }

    try {
        const result = await eel.studio_delete_profile(selected)();
        if (result.success) {
            alert('계정이 삭제되었습니다.');
            await studioLoadProfileList();
            await studioUpdateProfileLists();
        } else {
            alert('오류: ' + result.error);
        }
    } catch (error) {
        console.error('[RoyStudio] 계정 삭제 오류:', error);
    }
}

async function studioMoveProfileUp() {
    const listElement = document.getElementById('studio-profile-list');
    const selectedIndex = listElement.selectedIndex;
    if (selectedIndex <= 0) return;

    const options = listElement.options;
    const temp = options[selectedIndex - 1].text;
    options[selectedIndex - 1].text = options[selectedIndex].text;
    options[selectedIndex - 1].value = options[selectedIndex].value;
    options[selectedIndex].text = temp;
    options[selectedIndex].value = temp;
    listElement.selectedIndex = selectedIndex - 1;

    studioLog('프로필 순서 변경됨');
}

async function studioMoveProfileDown() {
    const listElement = document.getElementById('studio-profile-list');
    const selectedIndex = listElement.selectedIndex;
    if (selectedIndex < 0 || selectedIndex >= listElement.options.length - 1) return;

    const options = listElement.options;
    const temp = options[selectedIndex + 1].text;
    options[selectedIndex + 1].text = options[selectedIndex].text;
    options[selectedIndex + 1].value = options[selectedIndex].value;
    options[selectedIndex].text = temp;
    options[selectedIndex].value = temp;
    listElement.selectedIndex = selectedIndex + 1;

    studioLog('프로필 순서 변경됨');
}

async function studioAddSeparator() {
    const listElement = document.getElementById('studio-profile-list');
    const option = document.createElement('option');
    option.value = '---separator---';
    option.textContent = '──────────────';
    option.disabled = true;
    listElement.appendChild(option);
    studioLog('구분자 추가됨');
}

async function studioValidateAPI() {
    const apiKey = document.getElementById('studio-profile-credential').value.trim();
    if (!apiKey) {
        alert('API 키를 입력하세요.');
        return;
    }

    try {
        const result = await eel.studio_validate_api_key(apiKey)();
        if (result.valid) {
            alert('API 키가 유효합니다.');
        } else {
            alert('API 키가 유효하지 않습니다: ' + result.error);
        }
    } catch (error) {
        console.error('[RoyStudio] API 검증 오류:', error);
    }
}

async function studioSelectProfileFolder() {
    try {
        const folder = await eel.studio_select_folder()();
        if (folder) {
            document.getElementById('studio-profile-folder').value = folder;
        }
    } catch (error) {
        console.error('[RoyStudio] 폴더 선택 오류:', error);
    }
}

async function studioExportProfiles() {
    try {
        const profiles = await eel.studio_get_profiles()();
        const profilesData = {};

        for (const name of profiles) {
            profilesData[name] = await eel.studio_get_profile_info(name)();
        }

        // JSON 파일로 다운로드
        const dataStr = JSON.stringify(profilesData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'studio_profiles.json';
        a.click();

        URL.revokeObjectURL(url);
        studioLog('프로필 내보내기 완료');
    } catch (error) {
        console.error('[RoyStudio] 프로필 내보내기 오류:', error);
    }
}

function studioImportProfiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const profiles = JSON.parse(text);

            for (const [name, data] of Object.entries(profiles)) {
                await eel.studio_add_profile(name, data.credential || '', data.folder || '')();
            }

            await studioLoadProfileList();
            await studioUpdateProfileLists();
            studioLog(`${Object.keys(profiles).length}개 프로필 가져오기 완료`);
            alert('프로필 가져오기가 완료되었습니다.');
        } catch (error) {
            console.error('[RoyStudio] 프로필 가져오기 오류:', error);
            alert('프로필 파일을 읽는 중 오류가 발생했습니다.');
        }
    };
    input.click();
}

// ========== 프리셋 모달 ==========
function studioLog(message) {
    const logOutput = document.getElementById('studio-log-output');
    if (logOutput) {
        const time = new Date().toLocaleTimeString();
        logOutput.innerHTML += `[${time}] ${message}<br>`;
        logOutput.scrollTop = logOutput.scrollHeight;
    }
    console.log('[RoyStudio]', message);
}

// ========== 설정 탭 (단일 영상 제작) ==========
async function studioLoadProfileDefaults() {
    const profile = document.getElementById('studio-settings-profile')?.value;
    if (!profile) {
        alert('계정을 먼저 선택하세요.');
        return;
    }

    try {
        const defaults = await eel.studio_get_default_settings(profile)();
        if (defaults) {
            // 음성 설정 적용
            if (defaults.voice) {
                const voiceName = document.getElementById('studio-voice-name');
                if (voiceName) voiceName.value = defaults.voice;
            }
            if (defaults.rate) {
                const voiceRate = document.getElementById('studio-voice-rate');
                if (voiceRate) {
                    voiceRate.value = defaults.rate;
                    voiceRate.nextElementSibling.textContent = defaults.rate;
                }
            }
            if (defaults.pitch) {
                const voicePitch = document.getElementById('studio-voice-pitch');
                if (voicePitch) {
                    voicePitch.value = defaults.pitch;
                    voicePitch.nextElementSibling.textContent = defaults.pitch;
                }
            }
            studioLog(`프로필 '${profile}' 기본 설정 로드됨`);
        }
    } catch (error) {
        console.error('[RoyStudio] 프로필 기본값 로드 오류:', error);
    }
}

async function studioSelectImage() {
    try {
        const image = await eel.studio_select_single_image()();
        if (image) {
            document.getElementById('studio-settings-image').value = image;
        }
    } catch (error) {
        console.error('[RoyStudio] 이미지 선택 오류:', error);
    }
}

async function studioLoadScript() {
    try {
        const file = await eel.studio_select_text_file()();
        if (file) {
            const content = await eel.studio_read_text_file(file)();
            document.getElementById('studio-script-text').value = content;
            studioCurrentScriptPath = file;
        }
    } catch (error) {
        console.error('[RoyStudio] 스크립트 로드 오류:', error);
    }
}

async function studioAnalyzeScript() {
    const scriptText = document.getElementById('studio-script-text').value;
    if (!scriptText.trim()) {
        alert('대본을 입력하세요.');
        return;
    }

    try {
        // 문장 단위로 분리 (마침표, 물음표, 느낌표 기준)
        const lines = scriptText.split('\n').filter(line => line.trim());
        studioAnalyzedClips = [];
        let clipIndex = 1;
        let currentCharacter = '나레이션';

        for (const line of lines) {
            // [캐릭터명] 형식 체크
            const charMatch = line.match(/^\[(.+?)\]\s*(.*)$/);
            if (charMatch) {
                currentCharacter = charMatch[1];
                const text = charMatch[2].trim();
                if (text) {
                    // 문장 단위로 분리 (마침표, 물음표, 느낌표, 따옴표+마침표 기준)
                    const sentences = text.match(/[^.?!。]+[.?!。"'」』]+|[^.?!。]+$/g) || [text];
                    for (const sentence of sentences) {
                        const trimmed = sentence.trim();
                        if (trimmed) {
                            studioAnalyzedClips.push({
                                index: clipIndex++,
                                character: currentCharacter,
                                text: trimmed,
                                checked: true
                            });
                        }
                    }
                }
            } else {
                // 캐릭터 지정 없이 텍스트만 있는 경우
                const sentences = line.match(/[^.?!。]+[.?!。"'」』]+|[^.?!。]+$/g) || [line];
                for (const sentence of sentences) {
                    const trimmed = sentence.trim();
                    if (trimmed) {
                        studioAnalyzedClips.push({
                            index: clipIndex++,
                            character: currentCharacter,
                            text: trimmed,
                            checked: true
                        });
                    }
                }
            }
        }

        studioUpdateClipsTable();
        studioUpdateVoiceSettings();

        studioLog('대본 분석 완료: ' + studioAnalyzedClips.length + '개 문장');
    } catch (error) {
        console.error('[RoyStudio] 대본 분석 오류:', error);
    }
}

function studioClearScript() {
    document.getElementById('studio-script-text').value = '';
    document.getElementById('studio-settings-image').value = '';
    studioAnalyzedClips = [];
    studioCharacterVoiceSettings = {};  // 스텝3 음성 설정 초기화
    studioUpdateClipsTable();
    studioUpdateVoiceSettings();  // 스텝3 UI 초기화
}

function studioUpdateClipsTable() {
    const tbody = document.getElementById('studio-clips-tbody');
    if (!tbody) return;

    if (studioAnalyzedClips.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="5">STEP 1에서 대본을 먼저 분석해주세요.</td></tr>';
        return;
    }

    tbody.innerHTML = studioAnalyzedClips.map(clip => `
        <tr>
            <td><input type="checkbox" ${clip.checked ? 'checked' : ''} onchange="studioToggleClip(${clip.index})"></td>
            <td>${clip.index}</td>
            <td>${clip.character}</td>
            <td class="clip-text-cell" ondblclick="studioEditClip(${clip.index}, this)" title="더블클릭하여 편집">${clip.text}</td>
            <td><button onclick="studioPreviewClip(${clip.index})" class="btn btn-xs">재생</button></td>
        </tr>
    `).join('');
}

function studioToggleClip(index) {
    const clip = studioAnalyzedClips.find(c => c.index === index);
    if (clip) clip.checked = !clip.checked;
}

function studioEditClip(index, tdElement) {
    const clip = studioAnalyzedClips.find(c => c.index === index);
    if (!clip) return;

    // 이미 편집 중인 경우 무시
    if (tdElement.querySelector('input')) return;

    const originalText = clip.text;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = originalText;
    input.className = 'clip-inline-edit';
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.style.padding = '4px 8px';
    input.style.border = '2px solid #667eea';
    input.style.borderRadius = '4px';
    input.style.fontSize = 'inherit';

    // 기존 텍스트를 input으로 교체
    tdElement.textContent = '';
    tdElement.appendChild(input);
    input.focus();
    input.select();

    // 저장 함수
    const saveEdit = () => {
        const newText = input.value.trim();
        if (newText && newText !== originalText) {
            clip.text = newText;
        }
        studioUpdateClipsTable();
    };

    // Enter 키로 저장
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            studioUpdateClipsTable(); // 취소 시 원래대로
        }
    });

    // 포커스를 잃으면 저장
    input.addEventListener('blur', saveEdit);
}

async function studioPreviewClip(index) {
    const clip = studioAnalyzedClips.find(c => c.index === index);
    if (!clip) return;

    // 해당 캐릭터의 음성 설정 가져오기
    studioSaveCharacterVoiceSettings(clip.character);
    const voiceSetting = studioCharacterVoiceSettings[clip.character] || {
        voice: 'ko-KR-Standard-A',
        rate: 1.0,
        pitch: 0
    };

    studioLog(`미리듣기: [${clip.character}] ${clip.text.substring(0, 30)}...`);

    try {
        // TTS Quota Manager를 통해 자동으로 API 키 선택
        const result = await eel.studio_test_voice(
            clip.text,
            voiceSetting.voice,
            '',
            voiceSetting.rate,
            voiceSetting.pitch
        )();

        if (!result.success) {
            studioLog('미리듣기 실패: ' + result.error);
        }
    } catch (error) {
        console.error('[RoyStudio] 클립 미리듣기 오류:', error);
        studioLog('미리듣기 오류: ' + error);
    }
}

function studioUpdateVoiceSettings() {
    const container = document.getElementById('studio-voice-settings-container');
    if (!container) return;

    // 캐릭터 목록 추출
    const characters = [...new Set(studioAnalyzedClips.map(c => c.character))];

    // 기본 음성 설정 초기화
    characters.forEach(char => {
        if (!studioCharacterVoiceSettings[char]) {
            studioCharacterVoiceSettings[char] = {
                language: 'ko-KR',
                group: 'Standard',
                voice: 'ko-KR-Standard-A',
                rate: 1.0,
                pitch: 0
            };
        }
    });

    // 각 캐릭터별 음성 선택기 생성
    container.innerHTML = characters.map(char => studioCreateVoiceSelector(char, 'studio-voice-settings-container')).join('');

    // 초기 음성 목록 로드
    characters.forEach(async (char) => {
        const setting = studioCharacterVoiceSettings[char];
        const voiceContainer = document.querySelector(`.studio-voice-setting[data-character="${char}"]`);
        if (voiceContainer) {
            const langSelect = voiceContainer.querySelector('.voice-lang');
            const groupSelect = voiceContainer.querySelector('.voice-group');
            const nameSelect = voiceContainer.querySelector('.voice-name');
            const rateInput = voiceContainer.querySelector('.voice-rate');
            const pitchInput = voiceContainer.querySelector('.voice-pitch');

            // 저장된 값 적용
            if (langSelect) langSelect.value = setting.language;
            if (groupSelect) groupSelect.value = setting.group;
            if (rateInput) {
                rateInput.value = setting.rate;
                rateInput.nextElementSibling.textContent = setting.rate;
            }
            if (pitchInput) {
                pitchInput.value = setting.pitch;
                pitchInput.nextElementSibling.textContent = setting.pitch;
            }

            // 음성 목록 업데이트
            await studioUpdateVoiceNames(nameSelect, setting.language, setting.group);
            if (nameSelect) nameSelect.value = setting.voice;
        }
    });
}

// 캐릭터 음성 설정 저장
function studioSaveCharacterVoiceSettings(characterName) {
    const container = document.querySelector(`.studio-voice-setting[data-character="${characterName}"]`);
    if (!container) return;

    const langSelect = container.querySelector('.voice-lang');
    const groupSelect = container.querySelector('.voice-group');
    const nameSelect = container.querySelector('.voice-name');
    const rateInput = container.querySelector('.voice-rate');
    const pitchInput = container.querySelector('.voice-pitch');

    studioCharacterVoiceSettings[characterName] = {
        language: langSelect?.value || 'ko-KR',
        group: groupSelect?.value || 'Standard',
        voice: nameSelect?.value || 'ko-KR-Standard-A',
        rate: parseFloat(rateInput?.value) || 1.0,
        pitch: parseFloat(pitchInput?.value) || 0
    };
}

// 모든 캐릭터 음성 설정 가져오기
function studioGetAllCharacterVoiceSettings() {
    const characters = [...new Set(studioAnalyzedClips.map(c => c.character))];
    characters.forEach(char => studioSaveCharacterVoiceSettings(char));
    return studioCharacterVoiceSettings;
}

async function studioSavePreset() {
    const name = document.getElementById('studio-preset-name').value.trim();
    if (!name) {
        alert('프리셋 이름을 입력하세요.');
        return;
    }

    // 현재 설정 수집
    const presetData = {
        name: name,
        createdAt: new Date().toISOString(),
        voiceSettings: studioGetAllCharacterVoiceSettings(),
        eqSettings: {
            enabled: document.getElementById('studio-eq-enabled')?.checked ?? true,
            style: document.getElementById('studio-eq-style')?.value || 'bar',
            colorStart: document.getElementById('studio-eq-color1')?.value || '#667eea',
            colorEnd: document.getElementById('studio-eq-color2')?.value || '#764ba2',
            sensitivity: parseFloat(document.getElementById('studio-eq-sensitivity')?.value) || 1.0,
            barCount: parseInt(document.getElementById('studio-eq-bar-count')?.value) || 32
        },
        outputSettings: {
            resolution: document.getElementById('studio-output-resolution')?.value || '1920x1080',
            fps: parseInt(document.getElementById('studio-output-fps')?.value) || 30
        }
    };

    try {
        const result = await eel.studio_save_preset(name, presetData)();
        if (result.success) {
            studioLog(`프리셋 '${name}' 저장됨`);
            await studioLoadPresetList();
            alert('프리셋이 저장되었습니다.');
        } else {
            alert('프리셋 저장 실패: ' + result.error);
        }
    } catch (error) {
        console.error('[RoyStudio] 프리셋 저장 오류:', error);
        alert('프리셋 저장 오류: ' + error);
    }
}

function studioManagePresets() {
    studioOpenPresetManager();
}

function studioOnEQStyleChange() {
    const style = document.getElementById('studio-eq-style')?.value;
    studioLog(`EQ 스타일 변경: ${style}`);

    // 스타일에 따른 기본 설정 적용
    const stylePresets = {
        'bar': { barCount: 32, colorStart: '#667eea', colorEnd: '#764ba2' },
        'wave': { barCount: 64, colorStart: '#00f5ff', colorEnd: '#ff00e4' },
        'circle': { barCount: 48, colorStart: '#ff6b6b', colorEnd: '#feca57' },
        'spectrum': { barCount: 128, colorStart: '#a8e6cf', colorEnd: '#dfe6e9' }
    };

    const preset = stylePresets[style];
    if (preset) {
        const barCount = document.getElementById('studio-eq-bar-count');
        const color1 = document.getElementById('studio-eq-color1');
        const color2 = document.getElementById('studio-eq-color2');

        if (barCount) barCount.value = preset.barCount;
        if (color1) color1.value = preset.colorStart;
        if (color2) color2.value = preset.colorEnd;
    }

    studioUpdateEQPreviewCanvas();
}

let studioEQPreviewAnimationId = null;
let studioEQPreviewDragging = false;
let studioEQPreviewResizing = false;
let studioEQPreviewDragStart = { x: 0, y: 0 };
let studioEQPreviewScale = 1;
let studioEQBackgroundImage = null;

function studioPreviewEQ() {
    const modal = document.getElementById('studio-eq-preview-modal');
    modal.style.display = 'flex';

    // 스텝1에서 등록한 이미지 경로
    const imagePath = document.getElementById('studio-settings-image')?.value;

    // 해상도 가져오기
    const resolution = document.getElementById('studio-resolution')?.value || '1920x1080';
    const [width, height] = resolution.split('x').map(Number);

    // 캔버스와 컨테이너 설정
    const canvas = document.getElementById('studio-eq-preview-canvas');
    const container = document.getElementById('studio-eq-preview-container');
    const eqBox = document.getElementById('studio-eq-preview-box');
    const infoBox = document.getElementById('studio-eq-preview-info');

    // 미리보기 스케일 계산 (최대 800px 너비)
    const maxDisplayWidth = 800;
    studioEQPreviewScale = Math.min(maxDisplayWidth / width, 1);
    const displayWidth = width * studioEQPreviewScale;
    const displayHeight = height * studioEQPreviewScale;

    canvas.width = displayWidth;
    canvas.height = displayHeight;
    container.style.width = displayWidth + 'px';
    container.style.height = displayHeight + 'px';

    // EQ 위치/크기 가져오기
    const eqX = parseInt(document.getElementById('studio-eq-x')?.value) || 960;
    const eqY = parseInt(document.getElementById('studio-eq-y')?.value) || 540;
    const eqW = parseInt(document.getElementById('studio-eq-w')?.value) || 800;
    const eqH = parseInt(document.getElementById('studio-eq-h')?.value) || 200;

    // 스케일 적용된 EQ 박스 위치
    eqBox.style.left = (eqX - eqW / 2) * studioEQPreviewScale + 'px';
    eqBox.style.top = (eqY - eqH / 2) * studioEQPreviewScale + 'px';
    eqBox.style.width = eqW * studioEQPreviewScale + 'px';
    eqBox.style.height = eqH * studioEQPreviewScale + 'px';
    eqBox.style.cursor = 'move';

    // 정보 표시
    infoBox.innerHTML = `EQ 위치: (${eqX}, ${eqY})<br>EQ 크기: ${eqW} x ${eqH}<br><small>드래그하여 이동, 모서리 드래그하여 크기 조절</small>`;

    // 배경 이미지 로드
    if (imagePath) {
        studioLoadEQPreviewBackground(canvas, imagePath);
    } else {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, displayWidth, displayHeight);
        ctx.fillStyle = '#333';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('배경 이미지가 없습니다', displayWidth / 2, displayHeight / 2);
    }

    // EQ 박스 드래그/리사이즈 이벤트 설정
    studioSetupEQBoxInteraction(eqBox, infoBox);
    studioStartEQPreviewAnimation();
}

async function studioLoadEQPreviewBackground(canvas, imagePath) {
    const ctx = canvas.getContext('2d');

    try {
        // 백엔드를 통해 이미지를 Base64로 변환하여 로드
        const result = await eel.studio_get_image_base64(imagePath)();

        if (result.success) {
            const img = new Image();

            img.onload = () => {
                studioEQBackgroundImage = img;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                studioLog('EQ 미리보기 배경 이미지 로드 완료');
            };

            img.onerror = () => {
                console.log('[RoyStudio] 이미지 디코딩 실패');
                studioDrawNoImageBackground(ctx, canvas);
            };

            img.src = result.data_url;
        } else {
            console.log('[RoyStudio] 이미지 로드 실패:', result.error);
            studioDrawNoImageBackground(ctx, canvas);
        }
    } catch (error) {
        console.error('[RoyStudio] 이미지 로드 오류:', error);
        studioDrawNoImageBackground(ctx, canvas);
    }
}

function studioDrawNoImageBackground(ctx, canvas) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#555';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('이미지를 불러올 수 없습니다', canvas.width / 2, canvas.height / 2);
}

function studioSetupEQBoxInteraction(eqBox, infoBox) {
    let isDragging = false;
    let isResizing = false;
    let startX, startY, startLeft, startTop, startWidth, startHeight;

    // 리사이즈 핸들 추가
    const resizeHandle = document.createElement('div');
    resizeHandle.style.cssText = 'position:absolute;right:-5px;bottom:-5px;width:15px;height:15px;background:#667eea;cursor:se-resize;border-radius:3px;';
    eqBox.appendChild(resizeHandle);

    // 마우스 다운 - 드래그 시작
    eqBox.onmousedown = (e) => {
        if (e.target === resizeHandle) {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = eqBox.offsetWidth;
            startHeight = eqBox.offsetHeight;
        } else {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = eqBox.offsetLeft;
            startTop = eqBox.offsetTop;
        }
        e.preventDefault();
    };

    // 마우스 이동
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            eqBox.style.left = (startLeft + dx) + 'px';
            eqBox.style.top = (startTop + dy) + 'px';
            studioUpdateEQValues(eqBox, infoBox);
        } else if (isResizing) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            eqBox.style.width = Math.max(50, startWidth + dx) + 'px';
            eqBox.style.height = Math.max(30, startHeight + dy) + 'px';
            studioUpdateEQValues(eqBox, infoBox);
        }
    });

    // 마우스 업 - 드래그/리사이즈 종료
    document.addEventListener('mouseup', () => {
        isDragging = false;
        isResizing = false;
    });
}

function studioUpdateEQValues(eqBox, infoBox) {
    // 스케일 역적용하여 실제 값 계산
    const boxWidth = eqBox.offsetWidth / studioEQPreviewScale;
    const boxHeight = eqBox.offsetHeight / studioEQPreviewScale;
    const centerX = Math.round((eqBox.offsetLeft / studioEQPreviewScale) + boxWidth / 2);
    const centerY = Math.round((eqBox.offsetTop / studioEQPreviewScale) + boxHeight / 2);
    const width = Math.round(boxWidth);
    const height = Math.round(boxHeight);

    // 입력 필드 업데이트
    document.getElementById('studio-eq-x').value = centerX;
    document.getElementById('studio-eq-y').value = centerY;
    document.getElementById('studio-eq-w').value = width;
    document.getElementById('studio-eq-h').value = height;

    // 정보 표시 업데이트
    infoBox.innerHTML = `EQ 위치: (${centerX}, ${centerY})<br>EQ 크기: ${width} x ${height}<br><small>드래그하여 이동, 모서리 드래그하여 크기 조절</small>`;
}

function studioCloseEQPreview() {
    document.getElementById('studio-eq-preview-modal').style.display = 'none';
    studioStopEQPreviewAnimation();
    studioEQBackgroundImage = null;
}

function studioStartEQPreviewAnimation() {
    const canvas = document.getElementById('studio-eq-preview-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const style = document.getElementById('studio-eq-style')?.value || '막대형';
    const barCount = parseInt(document.getElementById('studio-eq-bar-count')?.value) || 128;
    // 색상 설정에서 가져오기
    const colorStart = document.getElementById('studio-eq-color1')?.value || '#667eea';
    const colorEnd = document.getElementById('studio-eq-color2')?.value || '#764ba2';
    const sensitivity = 1.0;

    // 가상 오디오 데이터 생성
    function getRandomBars() {
        const bars = [];
        for (let i = 0; i < barCount; i++) {
            bars.push(Math.random() * sensitivity);
        }
        return bars;
    }

    // 색상 보간
    function interpolateColor(color1, color2, factor) {
        const c1 = parseInt(color1.slice(1), 16);
        const c2 = parseInt(color2.slice(1), 16);

        const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff;
        const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff;

        const r = Math.round(r1 + (r2 - r1) * factor);
        const g = Math.round(g1 + (g2 - g1) * factor);
        const b = Math.round(b1 + (b2 - b1) * factor);

        return `rgb(${r}, ${g}, ${b})`;
    }

    let bars = getRandomBars();
    let targetBars = getRandomBars();
    let frame = 0;

    function animate() {
        // 배경 이미지가 있으면 그리기, 없으면 검정 배경
        if (studioEQBackgroundImage) {
            ctx.drawImage(studioEQBackgroundImage, 0, 0, canvas.width, canvas.height);
        } else {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // 부드러운 전환
        for (let i = 0; i < bars.length; i++) {
            bars[i] += (targetBars[i] - bars[i]) * 0.1;
        }

        if (frame % 15 === 0) {
            targetBars = getRandomBars();
        }

        // EQ 박스 위치/크기 가져오기
        const eqBox = document.getElementById('studio-eq-preview-box');
        if (!eqBox) return;
        const eqLeft = eqBox.offsetLeft;
        const eqTop = eqBox.offsetTop;
        const eqWidth = eqBox.offsetWidth;
        const eqHeight = eqBox.offsetHeight;

        // EQ 스타일별 그리기
        if (style === '막대형') {
            // 기본 막대형 (아래에서 위로)
            const barWidth = eqWidth / barCount - 1;
            for (let i = 0; i < barCount; i++) {
                const height = bars[i] * eqHeight * 0.8;
                const x = eqLeft + i * (barWidth + 1);
                const y = eqTop + eqHeight - height;

                const gradient = ctx.createLinearGradient(x, y, x, eqTop + eqHeight);
                gradient.addColorStop(0, colorEnd);
                gradient.addColorStop(1, colorStart);

                ctx.fillStyle = gradient;
                ctx.fillRect(x, y, barWidth, height);
            }
        } else if (style === '미러막대형') {
            // 미러 막대형 (상하 대칭)
            const barWidth = eqWidth / barCount - 1;
            for (let i = 0; i < barCount; i++) {
                const height = bars[i] * eqHeight * 0.4;
                const x = eqLeft + i * (barWidth + 1);
                const centerY = eqTop + eqHeight / 2;

                const gradient = ctx.createLinearGradient(x, centerY - height, x, centerY + height);
                gradient.addColorStop(0, colorEnd);
                gradient.addColorStop(0.5, colorStart);
                gradient.addColorStop(1, colorEnd);

                ctx.fillStyle = gradient;
                ctx.fillRect(x, centerY - height, barWidth, height * 2);
            }
        } else if (style === '원형막대형') {
            // 원형 막대형 (방사형)
            const centerX = eqLeft + eqWidth / 2;
            const centerY = eqTop + eqHeight / 2;
            const innerRadius = Math.min(eqWidth, eqHeight) * 0.2;
            const maxBarLength = Math.min(eqWidth, eqHeight) * 0.3;

            for (let i = 0; i < barCount; i++) {
                const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
                const barLength = bars[i] * maxBarLength;

                const x1 = centerX + Math.cos(angle) * innerRadius;
                const y1 = centerY + Math.sin(angle) * innerRadius;
                const x2 = centerX + Math.cos(angle) * (innerRadius + barLength);
                const y2 = centerY + Math.sin(angle) * (innerRadius + barLength);

                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.strokeStyle = interpolateColor(colorStart, colorEnd, i / barCount);
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        } else if (style === '스펙트럼') {
            // 스펙트럼 (중앙에서 상하로)
            for (let i = 0; i < barCount; i++) {
                const x = eqLeft + (i / barCount) * eqWidth;
                const height = bars[i] * eqHeight * 0.8;
                const y = eqTop + (eqHeight - height) / 2;

                ctx.fillStyle = interpolateColor(colorStart, colorEnd, i / barCount);
                ctx.fillRect(x, y, eqWidth / barCount - 1, height);
            }
        } else if (style === '원형') {
            // 원형 점
            const centerX = eqLeft + eqWidth / 2;
            const centerY = eqTop + eqHeight / 2;
            const maxRadius = Math.min(eqWidth, eqHeight) * 0.4;

            for (let i = 0; i < barCount; i++) {
                const angle = (i / barCount) * Math.PI * 2;
                const radius = maxRadius * 0.5 + bars[i] * maxRadius * 0.5;
                const x = centerX + Math.cos(angle) * radius;
                const y = centerY + Math.sin(angle) * radius;

                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fillStyle = interpolateColor(colorStart, colorEnd, i / barCount);
                ctx.fill();
            }
        } else if (style === '반원형') {
            // 반원형 (하단 180도)
            const centerX = eqLeft + eqWidth / 2;
            const centerY = eqTop + eqHeight * 0.8;
            const maxRadius = Math.min(eqWidth / 2, eqHeight * 0.7);

            for (let i = 0; i < barCount; i++) {
                const angle = Math.PI + (i / barCount) * Math.PI;
                const radius = maxRadius * 0.3 + bars[i] * maxRadius * 0.7;
                const x = centerX + Math.cos(angle) * radius;
                const y = centerY + Math.sin(angle) * radius;

                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = interpolateColor(colorStart, colorEnd, i / barCount);
                ctx.fill();
            }
        } else if (style === '파형') {
            // 파형 (사인파)
            ctx.beginPath();
            ctx.moveTo(eqLeft, eqTop + eqHeight / 2);

            for (let i = 0; i < barCount; i++) {
                const x = eqLeft + (i / barCount) * eqWidth;
                const y = eqTop + eqHeight / 2 + bars[i] * eqHeight * 0.4 * Math.sin(i * 0.3 + frame * 0.1);
                ctx.lineTo(x, y);
            }

            ctx.strokeStyle = colorStart;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.stroke();
        } else if (style === '점') {
            // 점 스타일
            const cols = Math.ceil(Math.sqrt(barCount));
            const rows = Math.ceil(barCount / cols);
            const dotSize = Math.min(eqWidth / cols, eqHeight / rows) * 0.4;

            for (let i = 0; i < barCount; i++) {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const x = eqLeft + (col + 0.5) * (eqWidth / cols);
                const y = eqTop + (row + 0.5) * (eqHeight / rows);
                const size = dotSize * (0.3 + bars[i] * 0.7);

                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fillStyle = interpolateColor(colorStart, colorEnd, bars[i]);
                ctx.fill();
            }
        } else if (style === '라인웨이브') {
            // 라인 웨이브 (연결된 선)
            ctx.beginPath();
            for (let i = 0; i < barCount; i++) {
                const x = eqLeft + (i / (barCount - 1)) * eqWidth;
                const y = eqTop + eqHeight / 2 + (bars[i] - 0.5) * eqHeight * 0.8;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }

            const gradient = ctx.createLinearGradient(eqLeft, eqTop, eqLeft + eqWidth, eqTop);
            gradient.addColorStop(0, colorStart);
            gradient.addColorStop(1, colorEnd);

            ctx.strokeStyle = gradient;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
        }

        frame++;
        studioEQPreviewAnimationId = requestAnimationFrame(animate);
    }

    animate();
}

function studioStopEQPreviewAnimation() {
    if (studioEQPreviewAnimationId) {
        cancelAnimationFrame(studioEQPreviewAnimationId);
        studioEQPreviewAnimationId = null;
    }
}

function studioUpdateEQPreviewCanvas() {
    // 모달이 열려있으면 애니메이션 재시작
    const modal = document.getElementById('studio-eq-preview-modal');
    if (modal && modal.style.display === 'flex') {
        studioStopEQPreviewAnimation();
        studioStartEQPreviewAnimation();
    }
}

async function studioSelectOutputPath() {
    try {
        const folder = await eel.studio_select_folder()();
        if (folder) {
            document.getElementById('studio-output-path').value = folder;
        }
    } catch (error) {
        console.error('[RoyStudio] 출력 경로 선택 오류:', error);
    }
}

async function studioStartSingleProduction() {
    studioLog('단일 영상 제작 시작...');

    // 필수 입력값 검증 (계정 선택 불필요 - TTS Quota Manager 자동 사용)
    const scriptText = document.getElementById('studio-script-text')?.value;
    if (!scriptText || !scriptText.trim()) {
        alert('대본을 입력하세요.');
        return;
    }

    // 대본 분석이 되어 있는지 확인
    if (studioAnalyzedClips.length === 0) {
        alert('먼저 대본을 분석해주세요.');
        return;
    }

    const imagePath = document.getElementById('studio-settings-image')?.value || '';
    let outputPath = document.getElementById('studio-output-path')?.value;

    // 출력 경로가 없으면 대본 파일 폴더 사용 (대본 > 이미지 순서)
    if (!outputPath && studioCurrentScriptPath) {
        const lastSlash = Math.max(studioCurrentScriptPath.lastIndexOf('/'), studioCurrentScriptPath.lastIndexOf('\\'));
        outputPath = lastSlash > 0 ? studioCurrentScriptPath.substring(0, lastSlash) : '';
    }
    // 대본 경로도 없으면 이미지 폴더 사용
    if (!outputPath && imagePath) {
        const lastSlash = Math.max(imagePath.lastIndexOf('/'), imagePath.lastIndexOf('\\'));
        outputPath = lastSlash > 0 ? imagePath.substring(0, lastSlash) : '';
    }

    if (!outputPath) {
        alert('출력 경로를 선택하세요.');
        return;
    }

    // 캐릭터별 음성 설정 저장
    const characters = [...new Set(studioAnalyzedClips.map(c => c.character))];
    characters.forEach(char => {
        studioSaveCharacterVoiceSettings(char);
    });

    // clips 데이터 생성 (캐릭터별 음성 설정 포함)
    const clips = studioAnalyzedClips.map(clip => {
        const voiceSetting = studioCharacterVoiceSettings[clip.character] || {
            voice: 'ko-KR-Standard-A',
            rate: 1.0,
            pitch: 0
        };
        return {
            index: clip.index,
            character: clip.character,
            text: clip.text,
            voice: voiceSetting.voice,
            rate: voiceSetting.rate,
            pitch: voiceSetting.pitch
        };
    });

    // 해상도 파싱
    const resolutionStr = document.getElementById('studio-resolution')?.value || '1920x1080';
    const [vidW, vidH] = resolutionStr.split('x').map(Number);

    // EQ 설정 수집 (미리보기 편집의 designEQSettings 우선 사용)
    const eqSettings = {
        enabled: designEQSettings?.enabled ?? (document.getElementById('studio-eq-enabled')?.checked ?? true),
        style: designEQSettings?.style || (document.getElementById('studio-eq-style')?.value || '막대형'),
        x: designEQSettings?.x ?? (parseInt(document.getElementById('studio-eq-x')?.value) || 960),
        y: designEQSettings?.y ?? (parseInt(document.getElementById('studio-eq-y')?.value) || 540),
        w: designEQSettings?.w ?? (parseInt(document.getElementById('studio-eq-w')?.value) || 800),
        h: designEQSettings?.h ?? (parseInt(document.getElementById('studio-eq-h')?.value) || 200),
        // 캔버스 크기는 영상 해상도로 설정 (백엔드 호환성)
        width: vidW,
        height: vidH,
        barCount: parseInt(document.getElementById('studio-eq-bar-count')?.value) || 128,
        brightness: parseInt(document.getElementById('studio-brightness')?.value) || 100,
        fps: parseInt(document.getElementById('studio-fps')?.value) || 20,
        resolution: resolutionStr,
        color1: designEQSettings?.color1 || document.getElementById('studio-eq-color1')?.value || '#667eea',
        color2: designEQSettings?.color2 || document.getElementById('studio-eq-color2')?.value || '#764ba2'
    };

    // 호환성을 위해 키 추가 (backend가 eqX 등을 기대할 수 있음)
    eqSettings.eqX = eqSettings.x;
    eqSettings.eqY = eqSettings.y;
    eqSettings.eqW = eqSettings.width;
    eqSettings.eqH = eqSettings.height;

    // 파일명 결정: 대본파일명 우선, 없으면 입력된 파일명, 그것도 없으면 'output'
    const scriptBaseName = studioGetScriptBaseName();
    const inputFileName = document.getElementById('studio-output-filename')?.value;
    const finalFileName = scriptBaseName || inputFileName || 'output';

    // 작업 데이터 수집 (profile은 빈 문자열 - TTS Quota Manager 자동 사용)
    const jobData = {
        profile: '',
        script: scriptText,
        scriptPath: studioCurrentScriptPath || '',
        imagePath: imagePath,
        clips: clips,
        fileName: finalFileName,
        eqSettings: eqSettings,
        eqEnabled: eqSettings.enabled
    };

    studioIsProcessing = true;
    document.getElementById('studio-settings-start')?.setAttribute('disabled', 'true');
    document.getElementById('studio-settings-stop')?.removeAttribute('disabled');

    studioShowProgress();
    studioStartElapsedTimer();

    try {
        const result = await eel.studio_start_production(jobData, outputPath)();

        if (!result.success) {
            studioLog('영상 제작 시작 실패: ' + result.error);
            alert('영상 제작 시작 실패: ' + result.error);
            studioIsProcessing = false;
            studioStopElapsedTimer();
            document.getElementById('studio-settings-start')?.removeAttribute('disabled');
            document.getElementById('studio-settings-stop')?.setAttribute('disabled', 'true');
        }
        // 성공 시에는 studioProductionComplete 콜백에서 처리
    } catch (error) {
        console.error('[RoyStudio] 영상 제작 오류:', error);
        studioLog('영상 제작 오류: ' + error);
        studioIsProcessing = false;
        studioStopElapsedTimer();
        document.getElementById('studio-settings-start')?.removeAttribute('disabled');
        document.getElementById('studio-settings-stop')?.setAttribute('disabled', 'true');
    }
}

function studioStopSingleProduction() {
    studioLog('단일 영상 제작 중단');
    eel.studio_cancel_production()();
}

function studioToggleAllClips() {
    const allChecked = studioAnalyzedClips.every(c => c.checked);
    studioAnalyzedClips.forEach(c => c.checked = !allChecked);
    studioUpdateClipsTable();
}

async function studioExportMP3() {
    // 선택된 클립 또는 전체 클립
    const clipsToExport = studioAnalyzedClips.filter(c => c.checked);
    const targetClips = clipsToExport.length > 0 ? clipsToExport : studioAnalyzedClips;

    if (targetClips.length === 0) {
        alert('내보낼 문장이 없습니다. 먼저 대본을 분석해주세요.');
        return;
    }

    // 저장 폴더 선택
    const outputFolder = await eel.studio_select_folder()();
    if (!outputFolder) {
        studioLog('MP3 저장 취소됨');
        return;
    }

    studioLog(`MP3 내보내기 시작: ${targetClips.length}개 문장을 1개 파일로 합치기`);

    // 캐릭터별 음성 설정 저장
    const characters = [...new Set(targetClips.map(c => c.character))];
    characters.forEach(char => {
        studioSaveCharacterVoiceSettings(char);
    });

    // 클립 데이터 준비
    const clipsData = targetClips.map(clip => {
        const voiceSetting = studioCharacterVoiceSettings[clip.character] || {
            voice: 'ko-KR-Standard-A',
            rate: 1.0,
            pitch: 0
        };
        return {
            text: clip.text,
            voice: voiceSetting.voice,
            rate: voiceSetting.rate,
            pitch: voiceSetting.pitch
        };
    });

    try {
        studioLog('TTS 생성 및 합치기 진행 중...');

        // 파일명 생성: MP3_대본파일명.mp3
        const scriptBaseName = studioGetScriptBaseName();
        const mp3FileName = scriptBaseName ? `MP3_${scriptBaseName}` : null;

        const result = await eel.studio_generate_tts_and_merge(clipsData, outputFolder, mp3FileName)();

        if (result.success) {
            studioLog(`MP3 저장 완료: ${result.filename} (${result.clip_count}개 문장, ${result.duration.toFixed(1)}초)`);
            alert(`MP3 저장 완료!\n파일명: ${result.filename}\n문장 수: ${result.clip_count}개\n총 길이: ${result.duration.toFixed(1)}초\n저장 위치: ${outputFolder}`);

            // 폴더 열기
            await eel.studio_open_folder(outputFolder)();
        } else {
            studioLog(`MP3 저장 실패: ${result.error}`);
            alert(`MP3 저장 실패: ${result.error}`);
        }
    } catch (error) {
        studioLog(`MP3 저장 오류: ${error}`);
        alert(`MP3 저장 오류: ${error}`);
    }
}

async function studioExportTransparentEQ() {
    // 선택된 클립 또는 전체 클립
    const clipsToExport = studioAnalyzedClips.filter(c => c.checked);
    const targetClips = clipsToExport.length > 0 ? clipsToExport : studioAnalyzedClips;

    if (targetClips.length === 0) {
        alert('내보낼 문장이 없습니다. 먼저 대본을 분석해주세요.');
        return;
    }

    // 저장 폴더 선택
    const outputFolder = await eel.studio_select_folder()();
    if (!outputFolder) {
        studioLog('투명 EQ 영상 저장 취소됨');
        return;
    }

    studioLog(`투명 EQ 영상 생성 시작: ${targetClips.length}개 문장`);

    // 캐릭터별 음성 설정 저장
    const characters = [...new Set(targetClips.map(c => c.character))];
    characters.forEach(char => {
        studioSaveCharacterVoiceSettings(char);
    });

    // 클립 데이터 준비
    const clipsData = targetClips.map(clip => {
        const voiceSetting = studioCharacterVoiceSettings[clip.character] || {
            voice: 'ko-KR-Standard-A',
            rate: 1.0,
            pitch: 0
        };
        return {
            text: clip.text,
            voice: voiceSetting.voice,
            rate: voiceSetting.rate,
            pitch: voiceSetting.pitch
        };
    });

    // 해상도 파싱
    const resolution = document.getElementById('studio-resolution')?.value || '1920x1080';
    const [width, height] = resolution.split('x').map(Number);

    const eqSettings = {
        width: width,
        height: height,
        fps: parseInt(document.getElementById('studio-fps')?.value) || 30,
        barCount: parseInt(document.getElementById('studio-eq-bar-count')?.value) || 64,
        style: document.getElementById('studio-eq-style')?.value || '막대형',
        eqX: parseInt(document.getElementById('studio-eq-x')?.value) || width / 2,
        eqY: parseInt(document.getElementById('studio-eq-y')?.value) || height / 2,
        eqW: parseInt(document.getElementById('studio-eq-w')?.value) || 800,
        eqH: parseInt(document.getElementById('studio-eq-h')?.value) || 200,
        color1: document.getElementById('studio-eq-color1')?.value || '#667eea',
        color2: document.getElementById('studio-eq-color2')?.value || '#764ba2'
    };

    try {
        studioLog('TTS 생성 및 투명 EQ 영상 + MP3 생성 중...');

        // 파일명 생성: EQ_대본파일명.mov, MP3_대본파일명.mp3
        const scriptBaseName = studioGetScriptBaseName();

        const result = await eel.studio_generate_transparent_eq_only(clipsData, outputFolder, eqSettings, scriptBaseName)();

        if (result.success) {
            studioLog(`투명 EQ 영상 + MP3 생성 완료`);
            studioLog(`  - MOV: ${result.output_path}`);
            studioLog(`  - MP3: ${result.mp3_path}`);
            alert(`투명 EQ 영상 + MP3 생성 완료!\n\n영상 길이: ${result.duration.toFixed(1)}초\n프레임 수: ${result.frames}개\n\n생성된 파일:\n- MOV (투명 EQ 영상)\n- MP3 (음성 파일)\n\n저장 위치: ${outputFolder}`);

            // 폴더 열기
            await eel.studio_open_folder(outputFolder)();
        } else {
            studioLog(`투명 EQ 영상 생성 실패: ${result.error}`);
            alert(`투명 EQ 영상 생성 실패: ${result.error}`);
        }

    } catch (error) {
        studioLog(`투명 EQ 영상 생성 오류: ${error}`);
        alert(`투명 EQ 영상 생성 오류: ${error}`);
    }
}

function studioDeleteSelectedClips() {
    studioAnalyzedClips = studioAnalyzedClips.filter(c => !c.checked);
    studioUpdateClipsTable();
}

// ========== 자막 탭 ==========
async function studioInitBlackscreenTab() {
    studioUpdateBlackscreenPreview();
    // 타이머 애니메이션 시작
    studioStartBlackscreenPreviewTimer();
    // 기본 저장 경로 설정 (다운로드 폴더)
    await studioSetDefaultBlackscreenPath();
    // 파일명 자동 업데이트
    studioUpdateBlackscreenFilename();
}

function studioStartBlackscreenPreviewTimer() {
    if (studioBlackscreenPreviewTimer) return;

    studioBlackscreenPreviewTimer = setInterval(() => {
        studioBlackscreenPreviewTime += 0.1;
        studioUpdateBlackscreenPreview();
    }, 100);
}

function studioStopBlackscreenPreviewTimer() {
    if (studioBlackscreenPreviewTimer) {
        clearInterval(studioBlackscreenPreviewTimer);
        studioBlackscreenPreviewTimer = null;
    }
}

function studioUpdateBlackscreenPreview() {
    const canvas = document.getElementById('studio-blackscreen-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const bgColor = document.getElementById('studio-bg-color')?.value || '#000000';
    const resolution = document.getElementById('studio-blackscreen-resolution')?.value || '1920x1080';
    const [width, height] = resolution.split('x').map(Number);

    // 색상 hex 표시 업데이트
    const bgColorHex = document.getElementById('studio-bg-color-hex');
    if (bgColorHex) bgColorHex.textContent = bgColor.toUpperCase();

    const timerColorHex = document.getElementById('studio-timer-color-hex');
    const timerColorVal = document.getElementById('studio-timer-color')?.value || '#ffffff';
    if (timerColorHex) timerColorHex.textContent = timerColorVal.toUpperCase();

    // 해상도 표시 업데이트
    const resolutionEl = document.getElementById('blackscreen-preview-resolution');
    if (resolutionEl) resolutionEl.textContent = `${width} x ${height}`;

    // 캔버스 크기 조정 (비율 유지)
    const maxWidth = 480;
    const scale = maxWidth / width;
    canvas.width = maxWidth;
    canvas.height = height * scale;

    // 배경 그리기
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 타이머 표시
    const showTimer = document.getElementById('studio-show-timer')?.checked;
    if (showTimer) {
        const timerColor = document.getElementById('studio-timer-color')?.value || '#ffffff';
        const timerSizePercent = parseFloat(document.getElementById('studio-timer-size')?.value) || 15;
        const fontStyle = document.getElementById('studio-digital-font-style')?.value || 'default';

        // 위치 계산
        const position = document.getElementById('studio-timer-position')?.value || 'center';
        let timerX = 50, timerY = 50;
        switch (position) {
            case 'center': timerX = 50; timerY = 50; break;
            case 'top-center': timerX = 50; timerY = 15; break;
            case 'bottom-center': timerX = 50; timerY = 85; break;
            case 'top-left': timerX = 15; timerY = 15; break;
            case 'top-right': timerX = 85; timerY = 15; break;
            case 'bottom-left': timerX = 15; timerY = 85; break;
            case 'bottom-right': timerX = 85; timerY = 85; break;
        }

        const posX = (timerX / 100) * canvas.width;
        const posY = (timerY / 100) * canvas.height;
        // %를 캔버스 기준 크기로 변환 (높이 기준)
        const sizeScale = (timerSizePercent / 100) * (canvas.height / 60);

        // 비디오 길이에서 시간 가져오기 (미리보기용)
        const hours = parseInt(document.getElementById('studio-video-hours')?.value) || 0;
        const minutes = parseInt(document.getElementById('studio-video-minutes')?.value) || 0;
        const seconds = parseInt(document.getElementById('studio-video-seconds')?.value) || 0;

        // 시간 표시 형식 자동 결정
        let timeStr;
        const totalSeconds = hours * 3600 + minutes * 60 + seconds;
        if (hours >= 1) {
            // 시가 1 이상이면 시:분:초
            timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else if (minutes >= 1) {
            // 시가 0이고 분이 1 이상이면 분:초
            timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else if (totalSeconds >= 10) {
            // 10초 이상이면 두 자리
            timeStr = `${String(seconds).padStart(2, '0')}`;
        } else {
            // 10초 미만이면 한 자리
            timeStr = `${seconds}`;
        }

        // 폰트 스타일 적용
        let fontFamily = 'Arial';
        let fontWeight = 'bold';
        let shadowBlur = 0;
        let shadowColor = timerColor;

        switch (fontStyle) {
            case 'default':
                fontFamily = 'Arial';
                fontWeight = 'normal';
                break;
            case 'bold':
                fontFamily = 'Arial';
                fontWeight = 'bold';
                break;
            case 'thin':
                fontFamily = 'Arial';
                fontWeight = '300';
                break;
            case 'mono':
                fontFamily = 'Consolas, monospace';
                fontWeight = 'normal';
                break;
            case 'digital':
                fontFamily = 'Consolas, "Courier New", monospace';
                fontWeight = 'bold';
                break;
            case 'neon':
                fontFamily = 'Arial';
                fontWeight = 'bold';
                shadowBlur = 20;
                shadowColor = timerColor;
                break;
        }

        const fontSize = 60 * scale * sizeScale;
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 네온 효과
        if (fontStyle === 'neon') {
            ctx.shadowBlur = shadowBlur;
            ctx.shadowColor = shadowColor;
            // 여러 번 그려서 글로우 효과
            ctx.fillStyle = timerColor;
            for (let i = 0; i < 3; i++) {
                ctx.fillText(timeStr, posX, posY);
            }
            ctx.shadowBlur = 0;
        } else {
            ctx.fillStyle = timerColor;
            ctx.fillText(timeStr, posX, posY);
        }
    }
}

// 시간 입력 포맷팅 (포커스 아웃 시) - 두 자리로 표시
function studioFormatTimeInput(inputEl) {
    let val = parseInt(inputEl.value) || 0;
    if (val < 0) val = 0;
    inputEl.value = String(val).padStart(2, '0');
}

function studioNormalizeTime() {
    // 시, 분, 초 값 가져오기
    const hoursEl = document.getElementById('studio-video-hours');
    const minutesEl = document.getElementById('studio-video-minutes');
    const secondsEl = document.getElementById('studio-video-seconds');

    let hours = parseInt(hoursEl.value) || 0;
    let minutes = parseInt(minutesEl.value) || 0;
    let seconds = parseInt(secondsEl.value) || 0;

    // 정규화
    if (seconds >= 60) {
        minutes += Math.floor(seconds / 60);
        seconds = seconds % 60;
    }
    if (minutes >= 60) {
        hours += Math.floor(minutes / 60);
        minutes = minutes % 60;
    }

    // 값 설정 (두 자리로)
    hoursEl.value = String(hours).padStart(2, '0');
    minutesEl.value = String(minutes).padStart(2, '0');
    secondsEl.value = String(seconds).padStart(2, '0');

    // 미리보기 정보 업데이트
    const durationEl = document.getElementById('blackscreen-preview-duration');
    if (durationEl) {
        durationEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    // 파일명 자동 업데이트
    studioUpdateBlackscreenFilename();

    studioUpdateBlackscreenPreview();
}

function studioToggleTimer() {
    const showTimer = document.getElementById('studio-show-timer').checked;
    document.getElementById('studio-timer-options').style.display = showTimer ? 'block' : 'none';
    studioUpdateBlackscreenPreview();
}

// 타이머 형태 전환 (디지털/아날로그)
function studioSetTimerFormat(format) {
    const digitalOptions = document.getElementById('digital-timer-options');
    const analogOptions = document.getElementById('analog-timer-options');

    if (format === 'digital') {
        if (digitalOptions) digitalOptions.style.display = 'block';
        if (analogOptions) analogOptions.style.display = 'none';
    } else {
        if (digitalOptions) digitalOptions.style.display = 'none';
        if (analogOptions) analogOptions.style.display = 'block';
    }

    studioUpdateBlackscreenPreview();
}

function studioUpdateTimerSize() {
    const size = document.getElementById('studio-timer-size').value;
    document.getElementById('studio-timer-size-value').textContent = size + '%';
    studioUpdateBlackscreenPreview();
}

// 타이머 크기 +/- 버튼 핸들러
function studioAdjustTimerSize(delta) {
    const sizeInput = document.getElementById('studio-timer-size');
    if (!sizeInput) return;

    let currentSize = parseInt(sizeInput.value) || 15;
    currentSize += delta;

    // 범위 제한 (5% ~ 50%)
    currentSize = Math.max(5, Math.min(50, currentSize));

    sizeInput.value = currentSize;
    studioUpdateTimerSize();
}

// 기본 저장 경로 설정 (다운로드 폴더)
async function studioSetDefaultBlackscreenPath() {
    try {
        const downloadPath = await eel.studio_get_downloads_folder()();
        if (downloadPath) {
            studioUpdateBlackscreenFilename();
        }
    } catch (error) {
        console.error('[RoyStudio] 다운로드 폴더 경로 가져오기 오류:', error);
    }
}

// 검은화면 파일명 자동 생성
function studioUpdateBlackscreenFilename() {
    const hours = parseInt(document.getElementById('studio-video-hours')?.value) || 0;
    const minutes = parseInt(document.getElementById('studio-video-minutes')?.value) || 0;
    const seconds = parseInt(document.getElementById('studio-video-seconds')?.value) || 0;

    // 파일명 생성: 00으로 되어 있는 부분은 제거
    let durationParts = [];
    if (hours > 0) {
        durationParts.push(`${hours}시`);
    }
    if (minutes > 0) {
        durationParts.push(`${minutes}분`);
    }
    if (seconds > 0 || durationParts.length === 0) {
        // 초가 있거나, 시분이 모두 0인 경우 초 표시
        durationParts.push(`${seconds}초`);
    }

    const durationStr = durationParts.join('');
    const filename = `${durationStr}_화면.mp4`;

    // 다운로드 폴더 경로와 결합
    studioSetBlackscreenOutputPath(filename);
}

// 다운로드 폴더에 파일명 설정
async function studioSetBlackscreenOutputPath(filename) {
    try {
        const element = document.getElementById('studio-blackscreen-output');
        if (!element) return; // 요소가 없으면 조기 종료

        const downloadPath = await eel.studio_get_downloads_folder()();
        if (downloadPath) {
            const separator = downloadPath.includes('\\') ? '\\' : '/';
            const fullPath = downloadPath + separator + filename;
            element.value = fullPath;
        }
    } catch (error) {
        console.error('[RoyStudio] 파일 경로 설정 오류:', error);
    }
}

async function studioSelectBlackscreenOutput() {
    try {
        const path = await eel.studio_select_save_path()();
        if (path) {
            document.getElementById('studio-blackscreen-output').value = path;
        }
    } catch (error) {
        console.error('[RoyStudio] 저장 경로 선택 오류:', error);
    }
}

async function studioGenerateBlackscreen() {
    const outputPath = document.getElementById('studio-blackscreen-output').value;
    if (!outputPath) {
        alert('저장 경로를 선택하세요.');
        return;
    }

    studioIsBlackscreenProcessing = true;
    document.getElementById('studio-blackscreen-start').disabled = true;
    document.getElementById('studio-blackscreen-stop').disabled = false;

    const bgColor = document.getElementById('studio-bg-color').value;
    const hours = parseInt(document.getElementById('studio-video-hours').value) || 0;
    const minutes = parseInt(document.getElementById('studio-video-minutes').value) || 0;
    const seconds = parseInt(document.getElementById('studio-video-seconds').value) || 0;
    const duration = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    const resolution = document.getElementById('studio-blackscreen-resolution').value;

    const showTimer = document.getElementById('studio-show-timer')?.checked || false;
    const timerType = document.getElementById('studio-timer-type')?.value || 'countdown';
    const digitalFontStyle = document.getElementById('studio-digital-font-style')?.value || 'default';
    const timerPosition = document.getElementById('studio-timer-position')?.value || 'center';
    const timerSizePercent = parseFloat(document.getElementById('studio-timer-size')?.value) || 15;
    const timerColor = document.getElementById('studio-timer-color')?.value || '#ffffff';

    try {
        document.getElementById('studio-blackscreen-progress').style.display = 'block';

        // 비동기 호출 - 결과는 studioBlackscreenComplete 콜백으로 받음
        const result = await eel.studio_generate_black_screen(
            outputPath, bgColor, duration, resolution,
            showTimer, timerType, digitalFontStyle,
            timerPosition, timerSizePercent, timerColor
        )();

        if (!result.success) {
            alert('생성 시작 실패: ' + result.error);
            studioIsBlackscreenProcessing = false;
            document.getElementById('studio-blackscreen-start').disabled = false;
            document.getElementById('studio-blackscreen-stop').disabled = true;
            document.getElementById('studio-blackscreen-progress').style.display = 'none';
        }
        // 성공 시에는 studioBlackscreenComplete 콜백에서 처리
    } catch (error) {
        console.error('[RoyStudio] 검은 화면 생성 오류:', error);
        studioIsBlackscreenProcessing = false;
        document.getElementById('studio-blackscreen-start').disabled = false;
        document.getElementById('studio-blackscreen-stop').disabled = true;
        document.getElementById('studio-blackscreen-progress').style.display = 'none';
    }
}

function studioStopBlackscreen() {
    studioIsBlackscreenProcessing = false;
    eel.studio_cancel_blackscreen_generation()();
}

// ========== 완료 모달 ==========
function studioShowCompleteModal() {
    document.getElementById('studio-complete-modal').style.display = 'flex';
}

function studioCloseCompleteModal() {
    document.getElementById('studio-complete-modal').style.display = 'none';
}

async function studioOpenOutputFolder() {
    // 마지막 출력 경로 우선 사용, 없으면 입력 필드에서 찾기
    let outputPath = studioLastOutputPath ||
                     document.getElementById('studio-output-path')?.value ||
                     document.getElementById('studio-batch-output-path')?.value ||
                     document.getElementById('studio-subtitle-output')?.value ||
                     document.getElementById('studio-blackscreen-output')?.value;

    if (!outputPath) {
        alert('출력 경로가 설정되지 않았습니다.');
        return;
    }

    // 파일 경로인 경우 폴더 경로로 변환
    if (outputPath.endsWith('.mp4') || outputPath.endsWith('.mp3') || outputPath.endsWith('.mov')) {
        const lastSlash = Math.max(outputPath.lastIndexOf('\\'), outputPath.lastIndexOf('/'));
        outputPath = lastSlash > 0 ? outputPath.substring(0, lastSlash) : outputPath;
    }

    try {
        const result = await eel.studio_open_folder(outputPath)();
        if (!result.success) {
            console.error('[RoyStudio] 폴더 열기 실패:', result.error);
        }
    } catch (error) {
        console.error('[RoyStudio] 폴더 열기 오류:', error);
    }
}

function studioGoToSubtitle() {
    studioCloseCompleteModal();
    // 자막 탭으로 이동
    const subtitleTab = document.querySelector('[data-tab="studio-subtitle"]');
    if (subtitleTab) subtitleTab.click();
}

// ========== Python 콜백 함수 (eel에서 호출) ==========
eel.expose(studioUpdateProgressFromPython);
function studioUpdateProgressFromPython(percent, label, detail) {
    // 디자인 탭이 활성화되어 있으면 디자인 탭 진행률 업데이트
    const designTab = document.getElementById('tab-studio-tts-design');
    if (designTab && designTab.classList.contains('active')) {
        designUpdateProgress(percent, label);
        return;
    }

    // TTS설정 탭용 기존 처리
    studioUpdateProgress(percent, label);
    // label을 detail로도 표시 (더 자세한 정보 제공)
    const detailEl = document.getElementById('studio-progress-detail');
    if (detailEl) {
        detailEl.textContent = detail || label || '';
    }
}

eel.expose(studioLogFromPython);
function studioLogFromPython(message) {
    studioLog(message);
}

eel.expose(studioBlackscreenProgressFromPython);
function studioBlackscreenProgressFromPython(percent, label) {
    const progressBar = document.getElementById('studio-blackscreen-progress-bar');
    const progressLabel = document.getElementById('studio-blackscreen-progress-label');
    const progressPercent = document.getElementById('studio-blackscreen-progress-percent');

    if (progressBar) progressBar.style.width = percent + '%';
    if (progressLabel) progressLabel.textContent = label;
    if (progressPercent) progressPercent.textContent = Math.round(percent) + '%';
}

eel.expose(studioBlackscreenComplete);
function studioBlackscreenComplete(result) {
    studioIsBlackscreenProcessing = false;
    document.getElementById('studio-blackscreen-start').disabled = false;
    document.getElementById('studio-blackscreen-stop').disabled = true;
    document.getElementById('studio-blackscreen-progress').style.display = 'none';

    if (result.success) {
        alert('검은 화면 비디오가 생성되었습니다.\n' + result.output_path);
    } else {
        alert('생성 실패: ' + result.error);
    }
}

// 마지막으로 완료된 출력 경로 저장
let studioLastOutputPath = null;

eel.expose(studioProductionComplete);
function studioProductionComplete(result) {
    // 디자인 탭이 활성화되어 있는지 확인
    const designTab = document.getElementById('tab-studio-tts-design');
    if (designTab && designTab.classList.contains('active')) {
        // 디자인 탭용 완료 처리
        designProductionCompleteHandler(result);
        return;
    }

    // TTS설정 탭용 기존 처리
    studioIsProcessing = false;
    studioStopElapsedTimer();
    document.getElementById('studio-stop-btn').disabled = true;
    document.getElementById('studio-start-btn').disabled = false;

    // STEP 5 버튼 활성화
    const startBtn = document.getElementById('studio-settings-start');
    if (startBtn) startBtn.disabled = false;

    if (result.success) {
        // 진행률 100%로 설정
        studioUpdateProgress(100, '완료!');
        document.getElementById('studio-progress-detail').textContent = '영상 제작이 완료되었습니다.';

        studioLog('영상 제작 완료: ' + result.output_path);
        // 출력 경로 저장 (폴더 열기에 사용)
        studioLastOutputPath = result.output_path;
        studioShowCompleteModal();
    } else {
        studioLog('영상 제작 실패: ' + result.error);
        studioUpdateProgress(0, '실패');
        document.getElementById('studio-progress-detail').textContent = result.error;
        alert('영상 제작 실패: ' + result.error);
    }
}

eel.expose(studioUpdateBatchProgress);
function studioUpdateBatchProgress(percent, label) {
    studioUpdateProgress(percent, label);
}

eel.expose(studioBatchComplete);
function studioBatchComplete(result) {
    studioIsProcessing = false;
    studioStopElapsedTimer();
    document.getElementById('studio-stop-btn').disabled = true;
    document.getElementById('studio-start-btn').disabled = false;

    studioLog(`배치 작업 완료: 성공 ${result.completed}개, 실패 ${result.failed}개`);

    if (result.success) {
        studioShowCompleteModal();
    }
}

// ========== 모듈 상태 확인 ==========
async function studioCheckModulesLoaded() {
    try {
        const result = await eel.studio_is_modules_loaded()();
        if (!result.loaded) {
            console.warn('[RoyStudio] 핵심 모듈이 로드되지 않았습니다.');
            studioLog('⚠️ 일부 기능이 제한될 수 있습니다.');
        } else {
            console.log('[RoyStudio] 핵심 모듈 로드 확인');
        }
    } catch (error) {
        console.error('[RoyStudio] 모듈 상태 확인 실패:', error);
    }
}

// 초기화 시 모듈 상태 확인
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(studioCheckModulesLoaded, 1000);
});

// ========== TTS API 키 관리 ==========

// TTS 키 관리 모달 열기
async function studioOpenTTSKeyManager() {
    document.getElementById('studio-tts-keys-modal').style.display = 'flex';
    await studioRefreshTTSKeyList();
}

// TTS 키 관리 모달 닫기
function studioCloseTTSKeyManager() {
    const modal = document.getElementById('studio-tts-keys-modal');
    if (modal) {
        modal.style.display = 'none';
        console.log('[TTS Keys] 모달 닫힘');
    }
}

// TTS 키 목록 새로고침
async function studioRefreshTTSKeyList() {
    try {
        const result = await eel.studio_get_tts_usage_summary()();
        const select = document.getElementById('studio-tts-keys-list');
        select.innerHTML = '';

        if (!result.success) {
            console.error('[TTS Keys] 목록 로드 실패:', result.error);
            studioLog('TTS API 키 목록 로드 실패: ' + (result.error || ''));
            return;
        }

        const summary = result.summary || [];

        summary.forEach((keyInfo, idx) => {
            const option = document.createElement('option');
            option.value = keyInfo.key_id;

            // 가장 높은 사용률 계산
            let maxRatio = 0;
            keyInfo.models.forEach(m => {
                if (m.ratio > maxRatio) maxRatio = m.ratio;
            });

            // 상태 표시
            let status = '';
            if (!keyInfo.active) {
                status = ' [비활성]';
                option.className = 'key-inactive';
            } else if (maxRatio >= 1.0) {
                status = ' [한도초과]';
                option.className = 'key-exhausted';
            } else if (maxRatio >= 0.8) {
                status = ` [${Math.round(maxRatio * 100)}%]`;
                option.className = 'key-warning';
            }

            option.textContent = `${idx + 1}. ${keyInfo.name}${status}`;
            select.appendChild(option);
        });

        // 상태 업데이트
        const now = new Date();
        document.getElementById('studio-tts-current-month').textContent =
            `${now.getFullYear()}년 ${now.getMonth() + 1}월`;
        document.getElementById('studio-tts-total-keys').textContent =
            `등록된 키: ${summary.length}개`;

        // 첫 번째 항목 자동 선택 및 상세 정보 로드
        if (select.options.length > 0) {
            select.selectedIndex = 0;
            studioLoadTTSKeyDetails();
        } else {
            // 키가 없으면 안내 메시지 표시
            document.getElementById('studio-tts-usage-info').innerHTML =
                '<p class="studio-empty-notice">등록된 API 키가 없습니다. 키를 추가해주세요.</p>';
        }

        // STEP1 사용량도 함께 업데이트
        studioUpdateStep1Usage();

    } catch (error) {
        console.error('[TTS Keys] 목록 로드 실패:', error);
        studioLog('TTS API 키 목록 로드 실패');
    }
}

// TTS 키 상세 정보 로드
async function studioLoadTTSKeyDetails() {
    const select = document.getElementById('studio-tts-keys-list');
    if (select.selectedIndex < 0) return;

    const keyId = parseInt(select.value);

    try {
        const result = await eel.studio_get_tts_usage_summary()();
        if (!result.success) return;

        const summary = result.summary || [];
        const keyInfo = summary.find(k => k.key_id === keyId);

        if (!keyInfo) return;

        const container = document.getElementById('studio-tts-usage-info');

        let html = `<div class="studio-tts-key-name">${keyInfo.name}</div>`;
        html += '<div class="studio-tts-usage-header"><span>모델</span><span>사용량 / 무료한도 (80% 기준)</span></div>';

        const modelLabels = {
            'standard': 'Standard',
            'wavenet': 'Wavenet',
            'neural2': 'Neural2',
            'chirp3': 'Chirp3-HD'
        };

        // Studio, Polyglot은 한국어 미지원으로 제외
        const filteredModels = keyInfo.models.filter(m => !['studio', 'polyglot'].includes(m.model));

        filteredModels.forEach(model => {
            const usageClass = model.ratio < 0.5 ? 'usage-low' :
                              model.ratio < 0.8 ? 'usage-medium' : 'usage-high';
            const widthPercent = Math.min(model.ratio * 100, 100);

            html += `
                <div class="studio-tts-usage-item">
                    <span class="studio-tts-usage-model">${modelLabels[model.model] || model.model}</span>
                    <div class="studio-tts-usage-bar">
                        <div class="studio-tts-usage-bar-fill ${usageClass}" style="width: ${widthPercent}%"></div>
                        <div class="studio-tts-usage-bar-threshold" style="left: 80%"></div>
                    </div>
                    <span class="studio-tts-usage-text">${formatCharCount(model.used)} / ${formatCharCount(model.limit)}</span>
                </div>
            `;
        });

        if (keyInfo.last_updated) {
            const lastDate = new Date(keyInfo.last_updated);
            html += `<div style="margin-top: 10px; font-size: 0.8rem; color: #666; text-align: right;">
                마지막 업데이트: ${lastDate.toLocaleString('ko-KR')}
            </div>`;
        }

        container.innerHTML = html;

    } catch (error) {
        console.error('[TTS Keys] 상세 정보 로드 실패:', error);
    }
}

// 문자 수 포맷팅
function formatCharCount(count) {
    if (count >= 1000000) {
        return (count / 1000000).toFixed(1) + 'M';
    } else if (count >= 1000) {
        return (count / 1000).toFixed(1) + 'K';
    }
    return count.toString();
}

// STEP1 사용량 정보 업데이트 (간략 1줄 표시)
async function studioUpdateStep1Usage() {
    const container = document.getElementById('studio-step1-usage-info');
    if (!container) return;

    try {
        const result = await eel.studio_get_tts_usage_summary()();
        if (!result.success || !result.summary || result.summary.length === 0) {
            container.innerHTML = '<span class="step1-usage-compact">API 키를 등록하면 사용량이 표시됩니다.</span>';
            return;
        }

        // 첫 번째 활성화된 키 사용
        const keyInfo = result.summary.find(k => k.active) || result.summary[0];

        const modelLabels = {
            'standard': 'Std',
            'wavenet': 'Wave',
            'neural2': 'N2',
            'chirp3': 'Chirp'
        };

        // Studio, Polyglot은 한국어 미지원으로 제외
        const filteredModels = keyInfo.models.filter(m => !['studio', 'polyglot'].includes(m.model));

        // 각 모델 사용률을 간단히 표시
        const usageParts = filteredModels.map(model => {
            const percent = Math.round(model.ratio * 100);
            const colorClass = model.ratio < 0.5 ? 'usage-low' : model.ratio < 0.8 ? 'usage-medium' : 'usage-high';
            return `<span class="step1-model-usage ${colorClass}">${modelLabels[model.model] || model.model}: ${percent}%</span>`;
        });

        container.innerHTML = `<span class="step1-usage-compact">🔑 ${keyInfo.name} | ${usageParts.join(' · ')}</span>`;

    } catch (error) {
        console.error('[STEP1 Usage] 로드 실패:', error);
        container.innerHTML = '<span class="step1-usage-compact">사용량 정보를 불러올 수 없습니다.</span>';
    }
}

// TTS API 키 추가 (중복 클릭 방지)
let _ttsAddingKey = false;

async function studioAddTTSKey() {
    if (_ttsAddingKey) {
        console.log('[TTS Keys] 이미 처리 중입니다.');
        return;
    }

    const apiKey = document.getElementById('studio-tts-key-input').value.trim();
    const name = document.getElementById('studio-tts-key-name').value.trim();

    if (!apiKey) {
        alert('API 키를 입력해주세요.');
        return;
    }

    // API 키 형식 기본 검증
    if (apiKey.length < 20) {
        alert('API 키가 너무 짧습니다. Google Cloud API 키를 확인해주세요.');
        return;
    }

    _ttsAddingKey = true;
    const addBtn = document.querySelector('#studio-tts-keys-modal .btn-primary');
    if (addBtn) {
        addBtn.disabled = true;
        addBtn.textContent = '추가 중...';
    }

    try {
        studioLog('API 키 추가 중...');
        console.log('[TTS Keys] API 키 추가:', apiKey.substring(0, 10) + '...');

        // 바로 키 추가 (검증 스킵 - 실제 사용 시 검증됨)
        const result = await eel.studio_add_tts_api_key(apiKey, name)();
        console.log('[TTS Keys] 추가 결과:', result);

        if (result.success) {
            studioLog('TTS API 키 추가 완료');
            alert('API 키가 추가되었습니다.\n실제 TTS 사용 시 키가 검증됩니다.');
            document.getElementById('studio-tts-key-input').value = '';
            document.getElementById('studio-tts-key-name').value = '';
            await studioRefreshTTSKeyList();
        } else {
            alert('API 키 추가 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[TTS Keys] 키 추가 실패:', error);
        alert('API 키 추가 중 오류가 발생했습니다:\n' + error.message);
    } finally {
        _ttsAddingKey = false;
        if (addBtn) {
            addBtn.disabled = false;
            addBtn.textContent = '➕ API 키 추가';
        }
    }
}

// TTS API 키 삭제
async function studioDeleteTTSKey() {
    const select = document.getElementById('studio-tts-keys-list');
    if (select.selectedIndex < 0) {
        alert('삭제할 API 키를 선택해주세요.');
        return;
    }

    const keyId = parseInt(select.value);
    const keyName = select.options[select.selectedIndex].textContent;

    if (!confirm(`"${keyName}" 키를 삭제하시겠습니까?\n사용량 기록도 함께 삭제됩니다.`)) {
        return;
    }

    try {
        const result = await eel.studio_remove_tts_api_key(keyId)();

        if (result.success) {
            studioLog('TTS API 키 삭제 완료');
            await studioRefreshTTSKeyList();
        } else {
            alert('삭제 실패');
        }
    } catch (error) {
        console.error('[TTS Keys] 키 삭제 실패:', error);
    }
}

// TTS API 키 순서 위로
async function studioMoveTTSKeyUp() {
    const select = document.getElementById('studio-tts-keys-list');
    if (select.selectedIndex <= 0) return;

    await studioReorderTTSKeys(-1);
}

// TTS API 키 순서 아래로
async function studioMoveTTSKeyDown() {
    const select = document.getElementById('studio-tts-keys-list');
    if (select.selectedIndex < 0 || select.selectedIndex >= select.options.length - 1) return;

    await studioReorderTTSKeys(1);
}

// TTS API 키 순서 변경
async function studioReorderTTSKeys(direction) {
    const select = document.getElementById('studio-tts-keys-list');
    const currentIdx = select.selectedIndex;
    const newIdx = currentIdx + direction;

    // 모든 키 ID 수집
    const keyIds = [];
    for (let i = 0; i < select.options.length; i++) {
        keyIds.push(parseInt(select.options[i].value));
    }

    // 순서 변경
    const temp = keyIds[currentIdx];
    keyIds[currentIdx] = keyIds[newIdx];
    keyIds[newIdx] = temp;

    try {
        const result = await eel.studio_reorder_tts_api_keys(keyIds)();

        if (result.success) {
            await studioRefreshTTSKeyList();
            select.selectedIndex = newIdx;
            studioLoadTTSKeyDetails();
        }
    } catch (error) {
        console.error('[TTS Keys] 순서 변경 실패:', error);
    }
}

// TTS 사용량 새로고침
async function studioRefreshTTSUsage() {
    await studioRefreshTTSKeyList();
    studioLog('TTS 사용량 정보 새로고침 완료');
}

// ========== 디자인안 탭 기능 구현 ==========

// 디자인안 전역 변수
let designCurrentTab = 'char';  // char, subtitle, eq
let designAnalyzedClips = [];
// designCharacterSettings 삭제됨 - studioCharacterVoiceSettings 사용
let designSubtitles = [];
let designCurrentSubtitleIndex = 0;

// Undo/Redo 히스토리 (최대 30단계)
const DESIGN_HISTORY_MAX = 30;
let designUndoHistory = [];
let designRedoHistory = [];
let designCurrentScriptPath = null;
let designCurrentScriptContent = '';  // 대본 내용 저장
let designEQSettings = {
    enabled: false,  // 기본값: EQ 비활성화
    style: '막대형',
    color1: '#667eea',
    color2: '#764ba2',
    x: 50,
    y: 50,          // 중앙 기준 (요소의 중앙점)
    height: 100,    // 바 세로 최대 높이 (px) - 사용자 설정
    barWidth: 20,   // 바 1개 가로 (px)
    barGap: 3,      // 바 간격 (px)
    barCount: 24    // 바 갯수 - EQ 전체 가로 = (barWidth + barGap) * barCount
};
let designOutputSettings = {
    backgroundPath: null,
    backgroundDataUrl: null,
    outputFolder: null,
    resolution: '1920x1080',
    encoder: 'auto',              // 인코더: auto(자동), libx264(CPU), h264_nvenc(NVIDIA), h264_qsv(Intel), h264_amf(AMD)
    encodingPreset: 'ultrafast',  // 인코딩 속도: ultrafast(빠름), fast(보통), medium(고품질) - CPU 인코더만 적용
    video: false,       // 영상 (MP4)
    noSubtitle: false,  // 자막제거 (체크하면 자막 없는 영상)
    mp3: true,          // MP3
    transparentEQ: false // 투명EQ (MOV)
};

// 인코더 정보 캐시
let detectedEncoders = null;
let bestEncoder = 'libx264';

// 인코더 감지 (자동 설정용 - UI 없음)
async function detectEncoders() {
    try {
        const result = await eel.get_available_encoders()();
        if (result && result.success) {
            detectedEncoders = result.encoders;
            bestEncoder = result.best;
            console.log('[Encoder] 감지 완료:', result.bestName);
        }
    } catch (error) {
        console.error('[Encoder] 감지 오류:', error);
    }
}

// 디자인안 탭 초기화
function designInitialize() {
    console.log('[Design] 디자인안 탭 초기화');

    // 하드웨어 인코더 감지 (백그라운드)
    detectEncoders();

    // 탭 전환 이벤트 바인딩
    document.querySelectorAll('.tts-tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const tab = this.dataset.tab;
            designSwitchTab(tab);
        });
    });

    // 문장 목록 아이템 선택 이벤트
    document.querySelectorAll('#tab-studio-tts-design .tts-sentence-item').forEach(item => {
        item.addEventListener('click', function() {
            designSelectSentence(this);
        });
    });

    // YouTube 자동 업로드 토글 이벤트
    const designYoutubeToggle = document.getElementById('design-youtube-auto-upload');
    if (designYoutubeToggle) {
        designYoutubeToggle.addEventListener('change', function() {
            const accountRow = document.getElementById('design-youtube-account-row');
            if (accountRow) {
                accountRow.style.display = this.checked ? 'flex' : 'none';
            }
            // YouTube 계정 목록 로드
            if (this.checked) {
                designLoadYoutubeAccounts();
            }
        });
    }

    // EQ 드래그 기능 초기화
    designInitEQDrag();

    // 메인 미리보기 비율 초기화 (현재 해상도에 맞게)
    const resolution = designOutputSettings.resolution || '1920x1080';
    const screen = document.querySelector('#tab-studio-tts-design .tts-preview-screen');
    if (screen) {
        const [width, height] = resolution.split('x').map(Number);
        screen.style.aspectRatio = `${width} / ${height}`;
    }

    // 메인 미리보기 EQ/자막 위치 초기화 (중앙 기준점)
    designInitMainPreviewPositions();

    // DOM 렌더링 완료 후 EQ/자막 스케일 적용 (레이아웃 안정화 대기)
    setTimeout(() => {
        designUpdateEQPreview();
        designApplySubtitleStyle();
    }, 100);

    // API 상태 업데이트
    designUpdateAPIStatus();
}

// YouTube 계정 목록 로드 (영상 탭용)
async function designLoadYoutubeAccounts() {
    const select = document.getElementById('design-youtube-account');
    if (!select) return;

    try {
        const accounts = await eel.youtube_get_accounts()();
        select.innerHTML = '<option value="">-- 계정 선택 --</option>';

        if (accounts && accounts.length > 0) {
            accounts.forEach(account => {
                const option = document.createElement('option');
                option.value = account.email;
                option.textContent = account.channel_title || account.email;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('[Design] YouTube 계정 로드 오류:', error);
    }
}

// 메인 미리보기 EQ/자막 위치 초기화
function designInitMainPreviewPositions() {
    // EQ 위치 (중앙 기준점)
    const mainEQ = document.querySelector('#tab-studio-tts-design .tts-preview-screen .tts-layer-eq');
    if (mainEQ) {
        mainEQ.style.left = `${designEQSettings.x}%`;
        mainEQ.style.top = `${designEQSettings.y}%`;
        mainEQ.style.transform = 'translate(-50%, -50%)';
        mainEQ.style.bottom = 'auto';
    }

    // 자막 위치 (중앙 기준점)
    const mainSub = document.querySelector('#tab-studio-tts-design .tts-preview-screen .tts-layer-subtitle');
    if (mainSub) {
        mainSub.style.left = `${designSubtitlePosition.x}%`;
        mainSub.style.top = `${designSubtitlePosition.y}%`;
        mainSub.style.transform = 'translate(-50%, -50%)';
        mainSub.style.bottom = 'auto';
        // 초기 표시 상태 적용 (designSubtitleVisible 기본값에 따라)
        mainSub.style.display = designSubtitleVisible ? 'block' : 'none';
    }
}

// ========== 헤더 버튼 기능 ==========

// API 키 관리 모달 열기
function designOpenAPIKeyModal() {
    // 기존 TTS 키 관리 모달 사용
    const modal = document.getElementById('studio-tts-keys-modal');
    if (modal) {
        modal.style.display = 'flex';
        studioRefreshTTSKeyList();
    } else {
        alert('API 키 관리 기능을 불러올 수 없습니다.');
    }
}

// 설정 모달 열기
function designOpenSettingsModal() {
    alert('설정 기능은 준비 중입니다.\n\n현재 사용 가능한 설정:\n- 출력 해상도: 출력 섹션에서 변경\n- EQ 스타일/색상: 미리보기 편집에서 변경');
}

// API 상태 업데이트
async function designUpdateAPIStatus() {
    const statusContainer = document.getElementById('design-api-status');
    if (!statusContainer) return;

    const statusDot = statusContainer.querySelector('.status-dot');
    const statusText = statusContainer.querySelector('.api-status-text');

    try {
        const result = await eel.studio_get_tts_usage_summary()();

        if (!result.success || !result.summary || result.summary.length === 0) {
            if (statusDot) statusDot.classList.remove('active');
            if (statusText) statusText.textContent = 'API 키 없음 - 🔑 버튼을 눌러 등록하세요';
            return;
        }

        // 첫 번째 활성화된 키 사용
        const keyInfo = result.summary.find(k => k.active) || result.summary[0];

        if (statusDot) statusDot.classList.add('active');

        // 무료 한도 정보 (Google Cloud TTS 기준)
        const freeQuotas = {
            'standard': 4000000,   // 400만 문자
            'wavenet': 1000000,    // 100만 문자
            'neural2': 1000000,    // 100만 문자 (예상)
            'chirp3': 500000       // 50만 문자 (예상)
        };

        const modelLabels = {
            'standard': 'Std',
            'wavenet': 'Wave',
            'neural2': 'N2',
            'chirp3': 'Chirp'
        };

        // Studio, Polyglot은 한국어 미지원으로 제외
        const filteredModels = keyInfo.models.filter(m => !['studio', 'polyglot'].includes(m.model));

        // 문자수 포맷팅 함수
        const formatChars = (chars) => {
            if (chars >= 1000000) return Math.round(chars / 10000) + '만';
            if (chars >= 10000) return Math.round(chars / 10000) + '만';
            if (chars >= 1000) return Math.round(chars / 1000) + 'K';
            return chars;
        };

        // 각 모델 정보 생성
        const usageParts = filteredModels.map(model => {
            const percent = Math.round(model.ratio * 100);
            const freeQuota = freeQuotas[model.model] || 1000000;
            const freeQuotaFormatted = formatChars(freeQuota);
            const label = modelLabels[model.model] || model.model;

            // 색상 클래스
            let colorClass = '';
            if (model.ratio >= 0.8) colorClass = 'usage-high';
            else if (model.ratio >= 0.5) colorClass = 'usage-medium';

            return `<span class="${colorClass}">${label}: ${freeQuotaFormatted} · ${percent}%</span>`;
        });

        if (statusText) {
            statusText.innerHTML = `${keyInfo.name} | ${usageParts.join(' | ')} |`;
        }

    } catch (error) {
        console.error('[Design] API 상태 로드 실패:', error);
        if (statusDot) statusDot.classList.remove('active');
        if (statusText) statusText.textContent = 'API 상태 확인 실패';
    }
}

// EQ 드래그 기능 - 작은 미리보기에서는 비활성화, 팝업에서만 조절 가능
function designInitEQDrag() {
    // 작은 미리보기의 EQ 레이어는 클릭 시 팝업 열기만 지원
    const eqLayer = document.querySelector('#tab-studio-tts-design .tts-layer-eq');
    if (eqLayer) {
        eqLayer.style.cursor = 'pointer';
        eqLayer.title = '클릭하여 EQ 편집 (팝업에서 조절 가능)';

        // 기존 이벤트 제거를 위해 새 이벤트 리스너로 교체
        eqLayer.onclick = (e) => {
            e.stopPropagation();
            designOpenPreviewPopup();
        };
    }
}

// EQ 입력 필드 업데이트
function updateEQInputFields() {
    const xInput = document.querySelector('#tab-studio-tts-design .tts-eq-position input:first-of-type');
    const yInput = document.querySelector('#tab-studio-tts-design .tts-eq-position input:last-of-type');
    const wInput = document.querySelector('#tab-studio-tts-design .tts-eq-size input:first-of-type');
    const hInput = document.querySelector('#tab-studio-tts-design .tts-eq-size input:last-of-type');

    if (xInput) xInput.value = designEQSettings.x;
    if (yInput) yInput.value = designEQSettings.y;
    if (wInput) wInput.value = designEQSettings.width;
    if (hInput) hInput.value = designEQSettings.height;
}

// 탭 전환
function designSwitchTab(tabName) {
    console.log('[Design] 탭 전환:', tabName);
    designCurrentTab = tabName;

    // 탭 버튼 활성화
    document.querySelectorAll('#tab-studio-tts-design .tts-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // 탭 컨텐츠 활성화
    document.querySelectorAll('#tab-studio-tts-design .tts-tab-content').forEach(content => {
        const isActive = content.id === `tts-tab-${tabName}`;
        content.classList.toggle('active', isActive);
    });
}

// 대본 파일 열기 (designLoadAndAnalyzeScript로 대체)
async function designOpenScriptFile() {
    // designLoadAndAnalyzeScript로 통합
    await designLoadAndAnalyzeScript();
}

// 대본 열기 및 자동 분석 (미리보기 버튼용)
async function designLoadAndAnalyzeScript() {
    try {
        const path = await eel.studio_select_text_file()();
        if (path) {
            designCurrentScriptPath = path;
            const content = await eel.studio_read_text_file(path)();
            designCurrentScriptContent = content;  // 대본 내용 저장
            console.log('[Design] 대본 파일 로드:', path);

            // 자막 설정 타이틀 업데이트
            designUpdateSubtitleTitle();

            // 배경 이미지 자동 감지 (대본과 같은 폴더에서 같은 이름의 이미지 찾기)
            await designAutoDetectBackgroundImage();

            // 자동으로 분석 실행
            if (content.trim()) {
                await designAnalyzeScript();
            }
        }
    } catch (error) {
        console.error('[Design] 대본 파일 열기 및 분석 오류:', error);
        alert('대본 파일을 열 수 없습니다: ' + error.message);
    }
}

// 자막 설정 타이틀 업데이트 (대본 파일명 표시)
function designUpdateSubtitleTitle() {
    const titleEl = document.getElementById('design-subtitle-title');
    if (!titleEl) return;

    if (designCurrentScriptPath) {
        // 파일명 추출 (확장자 제거)
        const lastSlash = Math.max(designCurrentScriptPath.lastIndexOf('/'), designCurrentScriptPath.lastIndexOf('\\'));
        const fileName = designCurrentScriptPath.substring(lastSlash + 1);
        const baseName = fileName.replace(/\.[^/.]+$/, '');
        titleEl.textContent = `📋 자막 설정 | ${baseName}`;
    } else {
        titleEl.textContent = '📋 자막 설정';
    }
}

// 대본 초기화
function designClearScript() {
    // 상태 초기화
    designAnalyzedClips = [];
    designSubtitles = [];
    designCurrentSubtitleIndex = 0;
    designCurrentScriptPath = null;
    designCurrentScriptContent = '';  // 대본 내용 초기화
    // studioCharacterVoiceSettings는 공유 변수이므로 여기서 초기화하지 않음

    // 자막 설정 타이틀 초기화
    designUpdateSubtitleTitle();

    // UI 초기화
    const sentencesList = document.querySelector('#tab-studio-tts-design .tts-sentences-list');
    if (sentencesList) {
        sentencesList.innerHTML = '<div class="tts-empty-message">대본을 분석해주세요.</div>';
    }

    const charGrid = document.querySelector('#tab-studio-tts-design .tts-characters-grid.compact');
    if (charGrid) {
        charGrid.innerHTML = '<div class="tts-empty-message">대본을 분석하면 캐릭터가 표시됩니다.</div>';
    }

    const subtitleList = document.querySelector('#tab-studio-tts-design .tts-subtitle-list');
    if (subtitleList) {
        subtitleList.innerHTML = '<div class="tts-empty-message">대본을 분석하면 자막이 생성됩니다.</div>';
    }

    // 미리보기 초기화
    const idxDisplay = document.querySelector('#tab-studio-tts-design .tts-preview-idx');
    if (idxDisplay) {
        idxDisplay.textContent = '0 / 0';
    }

    const subtitleLayer = document.querySelector('#tab-studio-tts-design .tts-layer-subtitle');
    if (subtitleLayer) {
        subtitleLayer.textContent = '';
    }

    // 대본 정보 초기화
    const infoContainer = document.querySelector('#tab-studio-tts-design .tts-script-info');
    if (infoContainer) {
        infoContainer.innerHTML = `
            <span>문장: 0개</span>
            <span>글자: 0자</span>
            <span>예상: 0:00</span>
        `;
    }

    console.log('[Design] 대본 초기화 완료');
}

// 대본 정보 업데이트
function designUpdateScriptInfo(content) {
    const lines = content.split('\n').filter(line => line.trim());
    const chars = content.replace(/\s/g, '').length;
    const estimatedSeconds = Math.round(chars / 5);  // 초당 5글자 기준
    const minutes = Math.floor(estimatedSeconds / 60);
    const seconds = estimatedSeconds % 60;

    const infoContainer = document.querySelector('#tab-studio-tts-design .tts-script-info');
    if (infoContainer) {
        infoContainer.innerHTML = `
            <span>문장: ${lines.length}개</span>
            <span>글자: ${chars}자</span>
            <span>예상: ${minutes}:${seconds.toString().padStart(2, '0')}</span>
        `;
    }
}

// 대본 분석 (TTS설정 탭과 동일한 방식 - 문장 단위 분리)
async function designAnalyzeScript() {
    const content = designCurrentScriptContent;

    if (!content.trim()) {
        alert('대본 파일을 불러와 주세요. (📂 버튼 클릭)');
        return;
    }

    try {
        console.log('[Design] 대본 분석 시작...');

        // TTS설정 탭과 동일한 로직 - 문장 단위로 분리
        const lines = content.split('\n').filter(line => line.trim());
        const clips = [];
        let currentCharacter = '나레이션';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // [캐릭터명] 패턴 체크
            const charMatch = trimmed.match(/^\[([^\]]+)\]\s*(.*)/);
            if (charMatch) {
                currentCharacter = charMatch[1];
                const text = charMatch[2].trim();
                if (text) {
                    // 문장 단위로 분리 (마침표, 물음표, 느낌표, 따옴표+마침표 기준)
                    const sentences = text.match(/[^.?!。]+[.?!。"'」』]+|[^.?!。]+$/g) || [text];
                    for (const sentence of sentences) {
                        const sentenceTrimmed = sentence.trim();
                        if (sentenceTrimmed) {
                            clips.push({ character: currentCharacter, text: sentenceTrimmed });
                        }
                    }
                }
            } else {
                // 캐릭터 지정 없이 텍스트만 있는 경우
                const sentences = trimmed.match(/[^.?!。]+[.?!。"'」』]+|[^.?!。]+$/g) || [trimmed];
                for (const sentence of sentences) {
                    const sentenceTrimmed = sentence.trim();
                    if (sentenceTrimmed) {
                        clips.push({ character: currentCharacter, text: sentenceTrimmed });
                    }
                }
            }
        }

        designAnalyzedClips = clips;
        designClearHistory();  // 히스토리 초기화
        designGenerateSubtitles();  // 자막 먼저 생성
        designRenderSentenceList();  // 그 다음 렌더링
        designExtractCharacters();

        // 첫 번째 문장 선택 및 미리보기 업데이트
        if (clips.length > 0) {
            designCurrentSubtitleIndex = 0;
            designUpdatePreview();
        }

        // 키보드 이벤트 초기화
        designInitKeyboardNavigation();

        console.log('[Design] 분석 완료:', clips.length, '개 문장');

    } catch (error) {
        console.error('[Design] 대본 분석 오류:', error);
        alert('대본 분석 중 오류가 발생했습니다.');
    }
}

// 커서 위치 (워드 사이, 0 = 첫 워드 앞, 1 = 첫 워드 뒤/두번째 워드 앞, ...)
let designCursorPosition = 0;
// 편집 모드 (클립 인라인 수정 중인지)
let designEditingClipIdx = -1;

// ========== Undo/Redo 기능 ==========

// 현재 상태를 히스토리에 저장
function designSaveHistory() {
    // 현재 상태의 깊은 복사본 생성
    const snapshot = {
        clips: JSON.parse(JSON.stringify(designAnalyzedClips)),
        subtitles: JSON.parse(JSON.stringify(designSubtitles)),
        currentIndex: designCurrentSubtitleIndex,
        cursorPosition: designCursorPosition
    };

    // Undo 히스토리에 추가
    designUndoHistory.push(snapshot);

    // 최대 개수 초과 시 오래된 것 제거
    if (designUndoHistory.length > DESIGN_HISTORY_MAX) {
        designUndoHistory.shift();
    }

    // 새 작업 시 Redo 히스토리 초기화
    designRedoHistory = [];

    console.log(`[Design] 히스토리 저장 (Undo: ${designUndoHistory.length}, Redo: ${designRedoHistory.length})`);
}

// 되돌리기 (Undo)
function designUndo() {
    if (designUndoHistory.length === 0) {
        console.log('[Design] 되돌릴 작업이 없습니다.');
        return false;
    }

    // 현재 상태를 Redo 히스토리에 저장
    const currentSnapshot = {
        clips: JSON.parse(JSON.stringify(designAnalyzedClips)),
        subtitles: JSON.parse(JSON.stringify(designSubtitles)),
        currentIndex: designCurrentSubtitleIndex,
        cursorPosition: designCursorPosition
    };
    designRedoHistory.push(currentSnapshot);

    // Undo 히스토리에서 이전 상태 복원
    const prevSnapshot = designUndoHistory.pop();
    designAnalyzedClips = prevSnapshot.clips;
    designSubtitles = prevSnapshot.subtitles;
    designCurrentSubtitleIndex = prevSnapshot.currentIndex;
    designCursorPosition = prevSnapshot.cursorPosition;

    // UI 업데이트
    designRenderSentenceList();
    designExtractCharacters();
    designUpdatePreview();

    console.log(`[Design] Undo 실행 (Undo: ${designUndoHistory.length}, Redo: ${designRedoHistory.length})`);
    return true;
}

// 다시 실행 (Redo)
function designRedo() {
    if (designRedoHistory.length === 0) {
        console.log('[Design] 다시 실행할 작업이 없습니다.');
        return false;
    }

    // 현재 상태를 Undo 히스토리에 저장
    const currentSnapshot = {
        clips: JSON.parse(JSON.stringify(designAnalyzedClips)),
        subtitles: JSON.parse(JSON.stringify(designSubtitles)),
        currentIndex: designCurrentSubtitleIndex,
        cursorPosition: designCursorPosition
    };
    designUndoHistory.push(currentSnapshot);

    // Redo 히스토리에서 다음 상태 복원
    const nextSnapshot = designRedoHistory.pop();
    designAnalyzedClips = nextSnapshot.clips;
    designSubtitles = nextSnapshot.subtitles;
    designCurrentSubtitleIndex = nextSnapshot.currentIndex;
    designCursorPosition = nextSnapshot.cursorPosition;

    // UI 업데이트
    designRenderSentenceList();
    designExtractCharacters();
    designUpdatePreview();

    console.log(`[Design] Redo 실행 (Undo: ${designUndoHistory.length}, Redo: ${designRedoHistory.length})`);
    return true;
}

// 히스토리 초기화 (새 대본 분석 시)
function designClearHistory() {
    designUndoHistory = [];
    designRedoHistory = [];
    console.log('[Design] 히스토리 초기화');
}

// HTML attribute escape 함수
function designEscapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
}

// 문장 목록 렌더링 (커서 기반 편집)
function designRenderSentenceList() {
    const container = document.querySelector('#tab-studio-tts-design .tts-sentences-list');
    if (!container) {
        console.error('[Design] 자막 목록 컨테이너를 찾을 수 없음!');
        return;
    }
    console.log('[Design] designRenderSentenceList 실행, designSubtitles:', designSubtitles.length, '개');

    const colors = ['#667eea', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#3498db'];
    const charColors = {};
    let colorIdx = 0;

    let html = '';
    designAnalyzedClips.forEach((clip, idx) => {
        if (!charColors[clip.character]) {
            charColors[clip.character] = colors[colorIdx % colors.length];
            colorIdx++;
        }
        const color = charColors[clip.character];
        const selected = idx === designCurrentSubtitleIndex ? 'selected' : '';

        // 자막이 없으면 클립 텍스트로 생성 (타임코드는 타임코드 버튼 클릭 시 설정)
        if (!designSubtitles[idx]) {
            designSubtitles[idx] = { start: null, end: null, text: clip.text, character: clip.character };
        }
        const subtitle = designSubtitles[idx];
        // 자막 텍스트를 항상 클립 텍스트와 동기화 (편집하지 않은 경우)
        // 자막이 비어있거나, 클립 텍스트가 변경되었을 수 있으므로 항상 동기화
        if (!subtitle.text || subtitle.text.trim() === '' || subtitle.text === '자막 텍스트') {
            subtitle.text = clip.text;
        }

        // 타임코드가 설정되지 않은 경우 빈 문자열 표시
        const startTimeStr = subtitle.start !== null ? designFormatTimeSimple(subtitle.start) : '';
        const endTimeStr = subtitle.end !== null ? designFormatTimeSimple(subtitle.end) : '';

        // TTS 텍스트를 워드 단위로 분리
        const words = clip.text.split(' ').filter(w => w.length > 0);
        let wordsHtml = '';

        // 편집 모드인 경우 입력창 표시
        if (designEditingClipIdx === idx) {
            wordsHtml = `<input type="text" class="tts-clip-edit-input" value="${designEscapeHtml(clip.text)}"
                         onblur="designFinishEditClip(${idx}, this.value)"
                         onkeydown="designHandleEditKeydown(event, ${idx}, this)"
                         autofocus>`;
        } else {
            // 커서와 워드 렌더링
            words.forEach((word, wordIdx) => {
                // 커서 표시 (선택된 클립에서만)
                if (idx === designCurrentSubtitleIndex && wordIdx === designCursorPosition) {
                    wordsHtml += `<span class="tts-cursor">|</span>`;
                }
                wordsHtml += `<span class="tts-word" data-clip="${idx}" data-word="${wordIdx}"
                              onclick="designSetCursor(${idx}, ${wordIdx}, event)">${word}</span>`;
            });
            // 마지막 워드 뒤 커서
            if (idx === designCurrentSubtitleIndex && designCursorPosition === words.length) {
                wordsHtml += `<span class="tts-cursor">|</span>`;
            }
        }

        html += `
            <div class="tts-sentence-item ${selected}" data-index="${idx}" data-idx="${idx}">
                <div class="tts-sentence-main" onclick="designClickClip(${idx}, event)">
                    <input type="checkbox" checked onclick="event.stopPropagation()">
                    <span class="tts-char-badge" style="background: ${color};">${clip.character}</span>
                    <div class="tts-words-container" tabindex="0" data-clip="${idx}"
                         onkeydown="designHandleWordKeydown(event)">
                        ${wordsHtml}
                    </div>
                    <button class="tts-edit-btn" onclick="event.stopPropagation(); designStartEditClip(${idx})" title="문장 수정">✏️</button>
                    <button class="tts-play-btn" onclick="event.stopPropagation(); designPreviewSentence(${idx})">▶</button>
                </div>
                <div class="tts-sentence-sub" onclick="event.stopPropagation()">
                    <input type="text" class="tts-time-input-sm" value="${startTimeStr}"
                           onchange="designUpdateSubtitleTime(${idx}, 'start', this.value)" placeholder="시작">
                    <span class="tts-time-arrow">→</span>
                    <input type="text" class="tts-time-input-sm" value="${endTimeStr}"
                           onchange="designUpdateSubtitleTime(${idx}, 'end', this.value)" placeholder="종료">
                    <input type="text" class="tts-sub-text-sm" value="${designEscapeHtml(subtitle.text)}"
                           onchange="designUpdateSubtitleText(${idx}, this.value)"
                           onkeydown="designHandleSubtitleKeydown(event, ${idx}, this)"
                           placeholder="자막 텍스트">
                </div>
            </div>
        `;
    });

    container.innerHTML = html || '<div class="tts-empty-message">대본을 분석해주세요.</div>';

    // 자막 개수 업데이트
    const countEl = document.getElementById('design-sub-count');
    if (countEl) countEl.textContent = designSubtitles.length;

    // 편집 모드면 입력창에 포커스, 아니면 워드 컨테이너에 포커스
    setTimeout(() => {
        if (designEditingClipIdx >= 0) {
            const editInput = container.querySelector('.tts-clip-edit-input');
            if (editInput) {
                editInput.focus();
                editInput.select();
            }
        } else {
            const selectedContainer = container.querySelector('.tts-sentence-item.selected .tts-words-container');
            if (selectedContainer) {
                selectedContainer.focus();
            }
        }
    }, 10);
}

// 클립 클릭 핸들러 (아무 곳이나 클릭 시 커서를 첫 워드 앞으로)
function designClickClip(clipIdx, event) {
    event.stopPropagation();

    // 이미 선택된 클립이면 포커스만
    if (designCurrentSubtitleIndex === clipIdx) {
        const container = document.querySelector(`.tts-sentence-item[data-idx="${clipIdx}"] .tts-words-container`);
        if (container) container.focus();
        return;
    }

    // 다른 클립 클릭 시 커서를 첫 워드 앞으로 이동
    designCurrentSubtitleIndex = clipIdx;
    designCursorPosition = 0;
    designRenderSentenceList();
    designUpdatePreview();
}

// 커서 위치 설정 (워드 클릭 시)
function designSetCursor(clipIdx, wordIdx, event) {
    if (event) event.stopPropagation();

    designCurrentSubtitleIndex = clipIdx;
    designCursorPosition = wordIdx;
    designRenderSentenceList();
    designUpdatePreview();

    // 워드 컨테이너에 포커스
    setTimeout(() => {
        const container = document.querySelector(`.tts-sentence-item[data-idx="${clipIdx}"] .tts-words-container`);
        if (container) container.focus();
    }, 10);
}

// 클립 인라인 수정 시작
function designStartEditClip(clipIdx) {
    designEditingClipIdx = clipIdx;
    designRenderSentenceList();

    // 편집 입력창에 포커스를 주고 커서를 적절한 위치로 이동
    setTimeout(() => {
        const input = document.querySelector('.tts-clip-edit-input');
        if (input) {
            input.focus();
            // 커서 위치에 해당하는 문자열 위치 계산
            const clip = designAnalyzedClips[clipIdx];
            if (clip) {
                const words = clip.text.split(' ').filter(w => w.length > 0);
                if (designCursorPosition > 0 && designCursorPosition <= words.length) {
                    // 커서 앞의 워드들을 합친 길이 + 공백 개수
                    const beforeCursor = words.slice(0, designCursorPosition).join(' ');
                    input.setSelectionRange(beforeCursor.length, beforeCursor.length);
                } else if (designCursorPosition === 0) {
                    input.setSelectionRange(0, 0);
                } else {
                    // 맨 끝
                    input.setSelectionRange(input.value.length, input.value.length);
                }
            }
        }
    }, 50);
}

// 클립 인라인 수정 완료
function designFinishEditClip(clipIdx, newText) {
    designEditingClipIdx = -1;

    if (newText && newText.trim()) {
        const clip = designAnalyzedClips[clipIdx];
        if (clip && clip.text !== newText.trim()) {
            // 변경이 있을 때만 히스토리 저장
            designSaveHistory();
            clip.text = newText.trim();
            if (designSubtitles[clipIdx]) {
                designSubtitles[clipIdx].text = newText.trim();
            }
        }
    }

    designRenderSentenceList();
    designUpdatePreview();
}

// 편집 모드 키보드 핸들러
function designHandleEditKeydown(e, clipIdx, inputEl) {
    // 편집 모드에서는 Enter와 Escape만 특별 처리, 나머지는 기본 텍스트 편집 동작
    if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();

        // 커서 위치에서 클립 나누기
        const cursorPos = inputEl.selectionStart;
        const text = inputEl.value;

        // 커서가 맨 앞이나 맨 뒤에 있으면 나누지 않고 편집 완료
        if (cursorPos === 0 || cursorPos >= text.length) {
            designFinishEditClip(clipIdx, text);
            return;
        }

        // 커서 위치에서 텍스트 분할
        const textBefore = text.substring(0, cursorPos).trim();
        const textAfter = text.substring(cursorPos).trim();

        // 둘 중 하나라도 비어있으면 나누지 않음
        if (!textBefore || !textAfter) {
            designFinishEditClip(clipIdx, text);
            return;
        }

        // 클립 나누기 실행
        designSplitClipAtPosition(clipIdx, textBefore, textAfter);
        return;
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        designEditingClipIdx = -1;
        designRenderSentenceList();
        return;
    }
    // 편집 모드에서는 모든 키 이벤트 전파 중단 (텍스트 입력창 내에서만 동작)
    e.stopPropagation();
}

// 클립 나누기 (커서 위치에서 분할)
function designSplitClipAtPosition(clipIdx, textBefore, textAfter) {
    const clip = designAnalyzedClips[clipIdx];
    if (!clip) return;

    // 히스토리 저장
    designSaveHistory();

    // 원본 클립 복제해서 새 클립 생성
    const newClip = {
        ...clip,
        text: textAfter,
        // 타임코드는 원본 클립의 비율로 계산 (대략적)
        start: clip.start + (clip.end - clip.start) / 2,
    };

    // 원본 클립 텍스트 수정 및 종료시간 조정
    clip.text = textBefore;
    clip.end = newClip.start;

    // 새 클립을 현재 클립 다음에 삽입
    designAnalyzedClips.splice(clipIdx + 1, 0, newClip);

    // 자막도 동기화
    if (designSubtitles[clipIdx]) {
        const newSubtitle = {
            ...designSubtitles[clipIdx],
            text: textAfter,
            start: newClip.start,
        };
        designSubtitles[clipIdx].text = textBefore;
        designSubtitles[clipIdx].end = newClip.start;
        designSubtitles.splice(clipIdx + 1, 0, newSubtitle);
    }

    // 편집 모드 해제 및 새 클립으로 이동
    designEditingClipIdx = -1;
    designCurrentSubtitleIndex = clipIdx + 1;
    designCursorPosition = 0;

    designRenderSentenceList();
    designUpdatePreview();

    console.log(`[Design] 클립 ${clipIdx} 분할: "${textBefore}" / "${textAfter}"`);
}

// 워드 키보드 이벤트 핸들러 (커서 기반)
function designHandleWordKeydown(e) {
    // 항상 현재 선택된 클립 인덱스 사용
    const currentIdx = designCurrentSubtitleIndex;
    const clip = designAnalyzedClips[currentIdx];
    if (!clip) return;

    const words = clip.text.split(' ').filter(w => w.length > 0);
    const totalClips = designAnalyzedClips.length;
    const cursorPos = designCursorPosition;

    // 좌우 방향키: 커서 이동
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        if (cursorPos > 0) {
            // 같은 클립 내 이전 위치로
            designCursorPosition = cursorPos - 1;
            designRenderSentenceList();
        } else if (currentIdx > 0) {
            // 이전 클립의 마지막 위치로
            const prevClip = designAnalyzedClips[currentIdx - 1];
            const prevWords = prevClip.text.split(' ').filter(w => w.length > 0);
            designCurrentSubtitleIndex = currentIdx - 1;
            designCursorPosition = prevWords.length;
            designRenderSentenceList();
            designUpdatePreview();
        }
        return;
    }

    if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        if (cursorPos < words.length) {
            // 같은 클립 내 다음 위치로
            designCursorPosition = cursorPos + 1;
            designRenderSentenceList();
        } else if (currentIdx < totalClips - 1) {
            // 다음 클립의 첫 위치로
            designCurrentSubtitleIndex = currentIdx + 1;
            designCursorPosition = 0;
            designRenderSentenceList();
            designUpdatePreview();
        }
        return;
    }

    // 상하 방향키: 클립 단위 이동
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (currentIdx > 0) {
            designCurrentSubtitleIndex = currentIdx - 1;
            designCursorPosition = 0;
            designRenderSentenceList();
            designUpdatePreview();
        }
        return;
    }

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        if (currentIdx < totalClips - 1) {
            designCurrentSubtitleIndex = currentIdx + 1;
            designCursorPosition = 0;
            designRenderSentenceList();
            designUpdatePreview();
        }
        return;
    }

    // Enter: 커서 위치에서 클립 분리 (커서가 중간에 있을 때만)
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (cursorPos > 0 && cursorPos < words.length) {
            designSplitClipAtWord(currentIdx, cursorPos);
        }
        return;
    }

    // Backspace: 커서 앞의 워드 삭제 또는 이전 클립과 합치기
    if (e.key === 'Backspace') {
        e.preventDefault();
        if (cursorPos > 0) {
            // 커서 앞의 워드 삭제
            designDeleteWordAt(currentIdx, cursorPos - 1);
        } else if (currentIdx > 0) {
            // 클립 맨 앞에서 Backspace → 이전 클립과 합치기
            designMergeClips(currentIdx - 1, currentIdx);
        }
        return;
    }

    // Delete: 커서 뒤의 워드 삭제 또는 다음 클립과 합치기
    if (e.key === 'Delete') {
        e.preventDefault();
        if (cursorPos < words.length) {
            // 커서 뒤의 워드 삭제
            designDeleteWordAt(currentIdx, cursorPos);
        } else if (currentIdx < totalClips - 1) {
            // 클립 맨 뒤에서 Delete → 다음 클립과 합치기
            designMergeClips(currentIdx, currentIdx + 1);
        }
        return;
    }

    // 일반 문자 입력 (한글, 영문, 숫자 등)
    if (e.key.length === 1 || e.key === 'Process') {
        // 한글 입력 중(IME)이거나 일반 문자
        // 편집 모드로 전환
        e.preventDefault();
        designStartEditClip(currentIdx);
        return;
    }

    // Space: 편집 모드로 전환
    if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        designStartEditClip(currentIdx);
        return;
    }
}

// 워드 삭제
function designDeleteWordAt(clipIdx, wordIdx) {
    const clip = designAnalyzedClips[clipIdx];
    if (!clip) return;

    const words = clip.text.split(' ').filter(w => w.length > 0);

    if (wordIdx < 0 || wordIdx >= words.length) return;

    // 히스토리 저장
    designSaveHistory();

    // 워드가 1개만 남으면 클립 전체 삭제
    if (words.length <= 1) {
        if (confirm('마지막 워드입니다. 클립을 삭제하시겠습니까?')) {
            designAnalyzedClips.splice(clipIdx, 1);
            designSubtitles.splice(clipIdx, 1);
            designSubtitles.forEach((sub, i) => sub.index = i + 1);

            if (designCurrentSubtitleIndex >= designAnalyzedClips.length) {
                designCurrentSubtitleIndex = Math.max(0, designAnalyzedClips.length - 1);
            }
            designCursorPosition = 0;

            designRenderSentenceList();
            designExtractCharacters();
            designUpdatePreview();
        }
        return;
    }

    // 워드 삭제
    words.splice(wordIdx, 1);
    clip.text = words.join(' ');

    if (designSubtitles[clipIdx]) {
        designSubtitles[clipIdx].text = clip.text;
    }

    // 커서 위치 조정
    if (designCursorPosition > words.length) {
        designCursorPosition = words.length;
    }

    designRenderSentenceList();
    designUpdatePreview();

    console.log('[Design] 워드 삭제:', words);
}

// 워드 위치에서 클립 분리
function designSplitClipAtWord(clipIdx, wordIdx) {
    if (clipIdx < 0 || clipIdx >= designAnalyzedClips.length) return;

    const clip = designAnalyzedClips[clipIdx];
    const words = clip.text.split(' ').filter(w => w.length > 0);

    if (wordIdx <= 0 || wordIdx >= words.length) return;

    const firstPart = words.slice(0, wordIdx).join(' ');
    const secondPart = words.slice(wordIdx).join(' ');

    if (!firstPart || !secondPart) return;

    // 클립 분리
    clip.text = firstPart;
    const newClip = {
        character: clip.character,
        text: secondPart
    };
    designAnalyzedClips.splice(clipIdx + 1, 0, newClip);

    // 자막 분리
    const subtitle = designSubtitles[clipIdx];
    if (subtitle) {
        const duration = subtitle.end - subtitle.start;
        const ratio = firstPart.length / (firstPart.length + secondPart.length);
        const splitTime = subtitle.start + duration * ratio;

        subtitle.text = firstPart;
        const originalEnd = subtitle.end;
        subtitle.end = splitTime;

        const newSubtitle = {
            index: clipIdx + 2,
            start: splitTime,
            end: originalEnd,
            text: secondPart,
            character: clip.character
        };
        designSubtitles.splice(clipIdx + 1, 0, newSubtitle);
    }

    // 인덱스 재정렬
    designSubtitles.forEach((sub, i) => sub.index = i + 1);

    // 새 클립의 첫 워드 선택
    designCurrentSubtitleIndex = clipIdx + 1;
    designCurrentWordIndex = 0;

    designRenderSentenceList();
    designExtractCharacters();
    designUpdatePreview();

    console.log('[Design] 클립 분리:', firstPart, '|', secondPart);
}

// 클립 합치기
function designMergeClips(clipIdx1, clipIdx2) {
    if (clipIdx1 < 0 || clipIdx2 >= designAnalyzedClips.length || clipIdx1 >= clipIdx2) return;

    const clip1 = designAnalyzedClips[clipIdx1];
    const clip2 = designAnalyzedClips[clipIdx2];

    if (!clip1 || !clip2) return;

    // 합치기 전 첫 번째 클립의 워드 수 저장 (커서 위치용)
    const clip1Words = clip1.text.split(' ').filter(w => w.length > 0);
    const cursorWordIdx = clip1Words.length;

    // 텍스트 합치기
    const mergedText = clip1.text + ' ' + clip2.text;
    clip1.text = mergedText;

    // 자막 합치기
    const subtitle1 = designSubtitles[clipIdx1];
    const subtitle2 = designSubtitles[clipIdx2];
    if (subtitle1 && subtitle2) {
        subtitle1.text = mergedText;
        subtitle1.end = subtitle2.end;
    }

    // 두 번째 클립/자막 제거
    designAnalyzedClips.splice(clipIdx2, 1);
    designSubtitles.splice(clipIdx2, 1);

    // 인덱스 재정렬
    designSubtitles.forEach((sub, i) => sub.index = i + 1);

    // 합쳐진 위치의 워드 선택
    designCurrentSubtitleIndex = clipIdx1;
    designCurrentWordIndex = cursorWordIdx;

    designRenderSentenceList();
    designExtractCharacters();
    designUpdatePreview();

    console.log('[Design] 클립 합치기:', mergedText);
}

// 워드 분리자 클릭시 클립 분리
function designSplitAtWordSeparator(clipIdx, charPos) {
    if (clipIdx < 0 || clipIdx >= designAnalyzedClips.length) return;

    const clip = designAnalyzedClips[clipIdx];
    const text = clip.text;

    if (charPos <= 0 || charPos >= text.length) return;

    // 분리 위치에서 텍스트 나누기
    const firstPart = text.substring(0, charPos).trim();
    const secondPart = text.substring(charPos).trim();

    if (!firstPart || !secondPart) return;

    designSplitSubtitleDirect(clipIdx, text, charPos);
}

// 워드 선택 (추후 워드 단위 편집용)
function designSelectWord(clipIdx, wordIdx) {
    // 클립 선택
    designSelectSentenceByIndex(clipIdx);
    console.log('[Design] 워드 선택:', clipIdx, wordIdx);
}

// 시간 포맷 (초 → HH:MM:SS,mmm) - 밀리초 포함
function designFormatTimeSimple(seconds) {
    if (typeof seconds !== 'number') seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

// 시간 파싱 (HH:MM:SS,mmm → 초) - 밀리초 포함
function designParseTimeSimple(timeStr) {
    // 밀리초 분리 (콤마 또는 점으로 구분)
    const [timePart, msPart] = timeStr.split(/[,\.]/);
    const ms = msPart ? parseInt(msPart.padEnd(3, '0').substring(0, 3)) / 1000 : 0;

    const parts = timePart.split(':').map(Number);
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2] + ms;
    } else if (parts.length === 2) {
        return parts[0] * 60 + parts[1] + ms;
    }
    return parseFloat(timeStr) || 0;
}

// 자막 시간 업데이트
function designUpdateSubtitleTime(idx, type, value) {
    if (designSubtitles[idx]) {
        designSubtitles[idx][type] = designParseTimeSimple(value);
        console.log('[Design] 자막 시간 업데이트:', idx, type, designSubtitles[idx][type]);
    }
}

// 자막 텍스트 업데이트
function designUpdateSubtitleText(idx, value) {
    if (designSubtitles[idx]) {
        designSubtitles[idx].text = value;
        if (idx === designCurrentSubtitleIndex) {
            const subtitleLayer = document.querySelector('#tab-studio-tts-design .tts-layer-subtitle');
            if (subtitleLayer) subtitleLayer.textContent = value;
        }
        console.log('[Design] 자막 텍스트 업데이트:', idx, value);
    }
}

// 문장 선택 (DOM 요소에서 호출)
function designSelectSentence(element) {
    const idx = parseInt(element.dataset.idx);
    if (!isNaN(idx)) {
        designSelectSentenceByIndex(idx);
    }
}

// 문장 선택 (인덱스로 호출)
function designSelectSentenceByIndex(idx) {
    // 이미 선택된 인덱스면 무시
    if (designCurrentSubtitleIndex === idx) return;

    designCurrentSubtitleIndex = idx;
    designCursorPosition = 0;  // 커서를 첫 워드 앞으로

    // 전체 다시 렌더링 (커서 위치 반영)
    designRenderSentenceList();

    // 미리보기 업데이트
    designUpdatePreview();
}

// 캐릭터 추출 및 설정 패널 생성
function designExtractCharacters() {
    console.log('[Design] designExtractCharacters 호출, clips:', designAnalyzedClips.length);
    const characters = [...new Set(designAnalyzedClips.map(c => c.character))];
    console.log('[Design] 추출된 캐릭터:', characters);

    // 고정 프리셋에서 캐릭터 음성 불러오기
    const PRESET_NAME = 'character_voices';
    const preset = videoPresets[PRESET_NAME];

    // 새 캐릭터 감지
    const newCharacters = [];
    characters.forEach((char) => {
        // 프리셋에 저장된 캐릭터가 아니면 새 캐릭터
        const isNewCharacter = !preset || !preset.characters || !preset.characters[char];

        if (isNewCharacter) {
            newCharacters.push(char);
        }

        // 프리셋에 저장된 설정이 있으면 불러오기
        if (preset && preset.characters && preset.characters[char]) {
            const savedSettings = preset.characters[char];
            studioCharacterVoiceSettings[char] = {
                language: 'ko-KR',
                group: savedSettings.group || 'Standard',
                voice: savedSettings.voice || 'ko-KR-Standard-A',
                rate: savedSettings.rate || 1.0,
                pitch: savedSettings.pitch || 0
            };
            console.log(`[Design] 캐릭터 "${char}" 음성 프리셋에서 불러옴:`, savedSettings.voice);
        }
        // 기존 설정이 없으면 기본값 생성
        else if (!studioCharacterVoiceSettings[char]) {
            studioCharacterVoiceSettings[char] = {
                language: 'ko-KR',
                group: 'Standard',
                voice: 'ko-KR-Standard-A',
                rate: 1.0,
                pitch: 0
            };
        }
    });

    designRenderCharacterCards(characters, newCharacters);
}

// 캐릭터 카드 렌더링 (영상 탭과 배치 탭 분리)
async function designRenderCharacterCards(characters, newCharacters = [], isBatchTab = false) {
    console.log('[Design] designRenderCharacterCards 호출, characters:', characters);
    console.log('[Design] 새 캐릭터:', newCharacters);
    console.log('[Design] isBatchTab:', isBatchTab);

    // 탭에 따라 컨테이너와 설정 객체 선택
    const container = isBatchTab
        ? document.getElementById('batch-voice-settings-container')
        : document.getElementById('design-voice-settings-container');

    const voiceSettings = isBatchTab
        ? batchCharacterVoiceSettings
        : studioCharacterVoiceSettings;

    if (!container) {
        console.error('[Design] 캐릭터 음성 컨테이너를 찾을 수 없습니다!');
        return;
    }

    let html = '';
    characters.forEach((char) => {
        const settings = voiceSettings[char] || {};
        const group = settings.group || 'Standard';
        const rate = settings.rate || 1.0;
        const pitch = settings.pitch || 0;
        const isChirp = group.includes('Chirp') || group === 'Studio';
        const isNew = newCharacters.includes(char);

        html += `
            <div class="studio-voice-setting ${isNew ? 'new-character' : ''}" data-character="${char}" onclick="designSelectCharacter('${char}', event)">
                <div class="voice-setting-header">
                    <strong>${char}${isNew ? '<span class="new-character-badge">NEW</span>' : ''}</strong>
                    <button onclick="designPreviewCharacter('${char}'); event.stopPropagation();" class="btn btn-xs">▶ 미리듣기</button>
                </div>
                <div class="voice-setting-controls">
                    <select class="voice-group" onchange="designOnModelChange(this, '${char}')">
                        <option value="Wavenet" ${group === 'Wavenet' ? 'selected' : ''}>Wavenet</option>
                        <option value="Neural2" ${group === 'Neural2' ? 'selected' : ''}>Neural2</option>
                        <option value="Standard" ${group === 'Standard' ? 'selected' : ''}>Standard</option>
                        <option value="Chirp3-HD" ${group === 'Chirp3-HD' ? 'selected' : ''}>Chirp3-HD</option>
                    </select>
                    <select class="voice-name" onchange="designOnVoiceChange(this, '${char}')">
                        <option value="">로딩중...</option>
                    </select>
                </div>
                <div class="voice-setting-params-horizontal">
                    <div class="param-col ${isChirp ? 'disabled' : ''}">
                        <div class="param-col-label">속도</div>
                        <div class="param-col-controls">
                            <button class="param-btn" onclick="designAdjustParam('${char}', 'rate', -0.05)" ${isChirp ? 'disabled' : ''}>−</button>
                            <input type="number" class="param-input voice-rate-num" min="0.25" max="4" step="0.05" value="${isChirp ? '1.00' : rate.toFixed(2)}" ${isChirp ? 'disabled' : ''}
                                onchange="designUpdateParamValue(this, '${char}', 'rate')">
                            <button class="param-btn" onclick="designAdjustParam('${char}', 'rate', 0.05)" ${isChirp ? 'disabled' : ''}>+</button>
                        </div>
                    </div>
                    <div class="param-col ${isChirp ? 'disabled' : ''}">
                        <div class="param-col-label">피치</div>
                        <div class="param-col-controls">
                            <button class="param-btn" onclick="designAdjustParam('${char}', 'pitch', -1)" ${isChirp ? 'disabled' : ''}>−</button>
                            <input type="number" class="param-input voice-pitch-num" min="-20" max="20" step="1" value="${isChirp ? 0 : pitch}" ${isChirp ? 'disabled' : ''}
                                onchange="designUpdateParamValue(this, '${char}', 'pitch')">
                            <button class="param-btn" onclick="designAdjustParam('${char}', 'pitch', 1)" ${isChirp ? 'disabled' : ''}>+</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    // 컨테이너에 렌더링
    const finalHtml = html || '<div class="tts-empty-message">대본을 분석하면 캐릭터가 표시됩니다.</div>';
    container.innerHTML = finalHtml;
    console.log('[Design] 캐릭터 카드 렌더링 완료, container:', container.id, 'innerHTML 길이:', container.innerHTML.length);

    // 타이틀에 카운터 표시
    const titleEl = isBatchTab
        ? document.getElementById('batch-character-title')
        : document.getElementById('design-character-title');

    if (titleEl && newCharacters.length > 0) {
        titleEl.innerHTML = `🎭 캐릭터 음성 <span class="character-counter">신규: ${newCharacters.length}</span>`;
    } else if (titleEl) {
        titleEl.textContent = '🎭 캐릭터 음성';
    }

    // 각 캐릭터별 음성 목록 비동기 로드
    for (const char of characters) {
        const settings = voiceSettings[char] || {};
        const group = settings.group || 'Standard';
        const voice = settings.voice || 'ko-KR-Standard-A';

        const voiceContainer = container.querySelector(`.studio-voice-setting[data-character="${char}"]`);
        if (voiceContainer) {
            const voiceSelect = voiceContainer.querySelector('.voice-name');
            if (voiceSelect) {
                await studioUpdateVoiceNames(voiceSelect, 'ko-KR', group);
                // 저장된 음성 선택
                if (voice && voiceSelect.querySelector(`option[value="${voice}"]`)) {
                    voiceSelect.value = voice;
                } else {
                    // 기본값이 없으면 첫 번째 옵션 선택
                    const firstOption = voiceSelect.querySelector('option[value*="Standard-A"]');
                    if (firstOption) {
                        voiceSelect.value = firstOption.value;
                    }
                }
            }
        }
    }
}

// 현재 활성 탭이 배치 탭인지 확인하는 헬퍼 함수
function isCurrentlyBatchTab() {
    const activeTab = document.querySelector('.tab-btn.active');
    return activeTab && activeTab.getAttribute('data-tab') === 'studio-batch';
}

// 현재 탭에 맞는 설정 객체 가져오기
function getCurrentVoiceSettings() {
    return isCurrentlyBatchTab() ? batchCharacterVoiceSettings : studioCharacterVoiceSettings;
}

// 출력 옵션 가져오기 (영상탭/배치탭 공통)
function getOutputOptions(isBatchTab = false) {
    const prefix = isBatchTab ? 'batch' : 'design';
    const outputOptions = {
        video: document.getElementById(`${prefix}-output-video`)?.checked ?? false,
        mp3: document.getElementById(`${prefix}-output-mp3`)?.checked ?? false,
        transparentEQ: document.getElementById(`${prefix}-output-eq`)?.checked ?? false
    };
    return outputOptions;
}

// 출력 옵션 검증 (영상탭/배치탭 공통)
function validateOutputOptions(outputOptions) {
    if (!outputOptions.video && !outputOptions.mp3 && !outputOptions.transparentEQ) {
        alert('출력 옵션을 최소 하나 이상 선택해주세요.');
        return false;
    }
    return true;
}

// EQ 설정 가져오기 (영상탭/배치탭 공통)
function getEQSettings(isBatchTab = false, resolution = '1920x1080') {
    const prefix = isBatchTab ? 'batch' : 'design';
    const eqEnabled = document.getElementById(`${prefix}-eq-enabled`)?.checked ?? false;
    const eqStyle = document.getElementById(`${prefix}-eq-style`)?.value || '막대형';
    const eqColor1 = document.getElementById(`${prefix}-eq-color1`)?.value || '#667eea';
    const eqColor2 = document.getElementById(`${prefix}-eq-color2`)?.value || '#764ba2';
    const eqPosition = document.getElementById(`${prefix}-eq-position`)?.value || 'bottom-center';

    // 해상도 기반 위치 계산
    const [resW, resH] = resolution.split('x').map(Number);
    let eqX, eqY;

    switch(eqPosition) {
        case 'top-left':
            eqX = Math.round(resW * 0.1);
            eqY = Math.round(resH * 0.1);
            break;
        case 'top-center':
            eqX = Math.round(resW * 0.5);
            eqY = Math.round(resH * 0.1);
            break;
        case 'top-right':
            eqX = Math.round(resW * 0.9);
            eqY = Math.round(resH * 0.1);
            break;
        case 'center':
            eqX = Math.round(resW * 0.5);
            eqY = Math.round(resH * 0.5);
            break;
        case 'bottom-left':
            eqX = Math.round(resW * 0.1);
            eqY = Math.round(resH * 0.85);
            break;
        case 'bottom-center':
            eqX = Math.round(resW * 0.5);
            eqY = Math.round(resH * 0.85);
            break;
        case 'bottom-right':
            eqX = Math.round(resW * 0.9);
            eqY = Math.round(resH * 0.85);
            break;
        default:
            eqX = Math.round(resW * 0.5);
            eqY = Math.round(resH * 0.85);
    }

    return {
        enabled: eqEnabled,
        style: eqStyle,
        x: eqX,
        y: eqY,
        color1: eqColor1,
        color2: eqColor2,
        resolution: resolution
    };
}

// 자막 설정 가져오기 (영상탭/배치탭 공통)
function getSubtitleSettings(isBatchTab = false) {
    const prefix = isBatchTab ? 'batch' : 'design';
    return {
        enabled: document.getElementById(`${prefix}-subtitle-enabled`)?.checked ?? false,
        font: document.getElementById(`${prefix}-subtitle-font`)?.value || 'Noto Sans KR',
        size: parseInt(document.getElementById(`${prefix}-subtitle-size`)?.value) || 24,
        color: document.getElementById(`${prefix}-subtitle-color`)?.value || '#ffffff',
        bgColor: document.getElementById(`${prefix}-subtitle-bg-color`)?.value || '#000000',
        bgOpacity: parseInt(document.getElementById(`${prefix}-subtitle-bg-opacity`)?.value) || 70,
        bgNone: document.getElementById(`${prefix}-subtitle-bg-none`)?.checked ?? false,
        x: parseInt(document.getElementById(`${prefix}-subtitle-x`)?.value) || 50,
        y: parseInt(document.getElementById(`${prefix}-subtitle-y`)?.value) || 90
    };
}

// 속도/피치 조절 헬퍼 함수 (버튼 클릭)
function designAdjustParam(charName, paramType, delta) {
    const isBatch = isCurrentlyBatchTab();
    console.log(`[designAdjustParam] 탭: ${isBatch ? '배치' : '영상'}, 캐릭터: ${charName}, 타입: ${paramType}, 변화량: ${delta}`);

    // 현재 탭의 컨테이너에서만 검색
    const parentContainer = isBatch
        ? document.getElementById('batch-voice-settings-container')
        : document.getElementById('design-voice-settings-container');

    if (!parentContainer) {
        console.warn(`[designAdjustParam] 부모 컨테이너를 찾을 수 없음`);
        return;
    }

    const container = parentContainer.querySelector(`.studio-voice-setting[data-character="${charName}"]`);
    if (!container) {
        console.warn(`[designAdjustParam] 캐릭터 컨테이너를 찾을 수 없음: ${charName}`);
        return;
    }

    const numInput = container.querySelector(paramType === 'rate' ? '.voice-rate-num' : '.voice-pitch-num');
    if (!numInput) {
        console.warn(`[designAdjustParam] 입력 필드를 찾을 수 없음: ${paramType}`);
        return;
    }

    const min = parseFloat(numInput.min);
    const max = parseFloat(numInput.max);
    const oldValue = parseFloat(numInput.value);
    let newValue = oldValue + delta;
    newValue = Math.max(min, Math.min(max, newValue));

    numInput.value = paramType === 'rate' ? newValue.toFixed(2) : Math.round(newValue);

    const voiceSettings = getCurrentVoiceSettings();
    voiceSettings[charName] = voiceSettings[charName] || {};
    voiceSettings[charName][paramType] = newValue;

    console.log(`[designAdjustParam] ${isBatch ? '배치' : '영상'}탭 설정 업데이트: ${charName}.${paramType} = ${oldValue} → ${newValue}`);
    console.log(`[designAdjustParam] 현재 설정 객체:`, isBatch ? 'batchCharacterVoiceSettings' : 'studioCharacterVoiceSettings', voiceSettings[charName]);
}

// 숫자 입력 직접 변경 시 설정 업데이트
function designUpdateParamValue(input, charName, paramType) {
    const isBatch = isCurrentlyBatchTab();
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    let newValue = parseFloat(input.value);

    if (isNaN(newValue)) {
        newValue = paramType === 'rate' ? 1.0 : 0;
    }
    newValue = Math.max(min, Math.min(max, newValue));

    input.value = paramType === 'rate' ? newValue.toFixed(2) : Math.round(newValue);

    const voiceSettings = getCurrentVoiceSettings();
    voiceSettings[charName] = voiceSettings[charName] || {};
    voiceSettings[charName][paramType] = newValue;

    console.log(`[designUpdateParamValue] ${isBatch ? '배치' : '영상'}탭 설정 업데이트: ${charName}.${paramType} = ${newValue}`);
}

// 음성 옵션 생성 (기본 옵션 - 비동기 로드 전 표시용)
function designGetVoiceOptions(model, selectedVoice) {
    // 기본값만 표시 (실제 목록은 비동기로 로드)
    const defaultVoices = {
        'Wavenet': [{ value: 'ko-KR-Wavenet-A', label: 'A_여성' }],
        'Neural2': [{ value: 'ko-KR-Neural2-A', label: 'A_여성' }],
        'Chirp3-HD': [{ value: 'Achernar', label: 'Achernar_여성' }],
        'Standard': [{ value: 'ko-KR-Standard-A', label: 'A_여성' }]
    };
    const list = defaultVoices[model] || defaultVoices['Wavenet'];
    return list.map(v =>
        `<option value="${v.value}" ${v.value === selectedVoice ? 'selected' : ''}>${v.label}</option>`
    ).join('');
}

// 모델 변경 이벤트 (비동기로 음성 목록 로드)
async function designOnModelChange(select, character) {
    const group = select.value;
    const voiceSettings = getCurrentVoiceSettings();

    voiceSettings[character] = voiceSettings[character] || {};
    voiceSettings[character].group = group;

    // 음성 목록 갱신 (서버에서 가져오기)
    const voiceSelect = select.parentElement.querySelector('.voice-name');
    await studioUpdateVoiceNames(voiceSelect, 'ko-KR', group);
    voiceSettings[character].voice = voiceSelect.value;

    // Chirp3-HD, Chirp-HD, Studio는 속도/피치 조절 불가 - 비활성화
    const container = select.closest('.studio-voice-setting');
    const supportsRatePitch = !group.includes('Chirp') && group !== 'Studio';
    designToggleVoiceParams(container, supportsRatePitch);
}

// 디자인 탭 속도/피치 파라미터 활성화/비활성화
function designToggleVoiceParams(container, enabled) {
    const paramsDiv = container.querySelector('.voice-setting-params-horizontal') || container.querySelector('.voice-setting-params');
    if (!paramsDiv) return;

    const inputs = paramsDiv.querySelectorAll('input, button');
    inputs.forEach(input => {
        input.disabled = !enabled;
    });

    // 비활성화 시 시각적 표시 (메시지 오버레이)
    if (enabled) {
        paramsDiv.classList.remove('params-disabled');
    } else {
        paramsDiv.classList.add('params-disabled');
    }

    const paramCols = paramsDiv.querySelectorAll('.param-col, .param-row');
    paramCols.forEach(col => {
        if (enabled) {
            col.classList.remove('disabled');
        } else {
            col.classList.add('disabled');
        }
    });

    // 비활성화 시 기본값으로 리셋
    if (!enabled) {
        const rateSlider = paramsDiv.querySelector('.voice-rate');
        const pitchSlider = paramsDiv.querySelector('.voice-pitch');
        const rateNum = paramsDiv.querySelector('.voice-rate-num');
        const pitchNum = paramsDiv.querySelector('.voice-pitch-num');
        if (rateSlider) rateSlider.value = 1.0;
        if (pitchSlider) pitchSlider.value = 0;
        if (rateNum) rateNum.value = '1.00';
        if (pitchNum) pitchNum.value = '0';

        // 설정값도 초기화
        const charName = container.dataset.character;
        const voiceSettings = getCurrentVoiceSettings();
        if (charName && voiceSettings[charName]) {
            voiceSettings[charName].rate = 1.0;
            voiceSettings[charName].pitch = 0;
        }
    }
}

// 음성 변경
function designOnVoiceChange(select, character) {
    const voiceSettings = getCurrentVoiceSettings();
    voiceSettings[character] = voiceSettings[character] || {};
    voiceSettings[character].voice = select.value;
}

// 속도 변경
function designOnSpeedChange(input, character) {
    const rate = parseFloat(input.value);
    const voiceSettings = getCurrentVoiceSettings();
    voiceSettings[character] = voiceSettings[character] || {};
    voiceSettings[character].rate = rate;
    input.nextElementSibling.textContent = rate.toFixed(1);
}

// 피치 변경
function designOnPitchChange(input, character) {
    const pitch = parseInt(input.value);
    const voiceSettings = getCurrentVoiceSettings();
    voiceSettings[character] = voiceSettings[character] || {};
    voiceSettings[character].pitch = pitch;
    input.nextElementSibling.textContent = pitch > 0 ? `+${pitch}` : pitch;
}

// 캐릭터 음성 설정 저장 (UI에서 값 수집) - 영상탭/배치탭 공통 함수
function designSaveCharacterVoiceSettings(characterName, isBatchTab = false) {
    // 현재 탭의 컨테이너에서만 검색
    const parentContainer = isBatchTab
        ? document.getElementById('batch-voice-settings-container')
        : document.getElementById('design-voice-settings-container');

    if (!parentContainer) {
        console.warn(`[${isBatchTab ? 'Batch' : 'Design'}] 부모 컨테이너를 찾을 수 없습니다.`);
        return;
    }

    const container = parentContainer.querySelector(`.studio-voice-setting[data-character="${characterName}"]`);
    if (!container) {
        console.warn(`[${isBatchTab ? 'Batch' : 'Design'}] 캐릭터 "${characterName}" 컨테이너를 찾을 수 없습니다.`);
        return;
    }

    const groupSelect = container.querySelector('.voice-group');
    const nameSelect = container.querySelector('.voice-name');
    const rateInput = container.querySelector('.voice-rate-num') || container.querySelector('.voice-rate');
    const pitchInput = container.querySelector('.voice-pitch-num') || container.querySelector('.voice-pitch');

    const savedSettings = {
        language: 'ko-KR',
        group: groupSelect?.value || 'Standard',
        voice: nameSelect?.value || 'ko-KR-Standard-A',
        rate: parseFloat(rateInput?.value) || 1.0,
        pitch: parseFloat(pitchInput?.value) || 0
    };

    // 탭에 따라 올바른 설정 객체에 저장
    const targetSettings = isBatchTab ? batchCharacterVoiceSettings : studioCharacterVoiceSettings;
    targetSettings[characterName] = savedSettings;
    console.log(`[${isBatchTab ? 'Batch' : 'Design'}] 캐릭터 "${characterName}" 설정 저장:`, savedSettings);
}

// 모든 캐릭터 음성 설정 가져오기
function designGetAllCharacterVoiceSettings() {
    const characters = [...new Set(designAnalyzedClips.map(c => c.character))];
    characters.forEach(char => designSaveCharacterVoiceSettings(char));
    return studioCharacterVoiceSettings;
}

// 디자인 탭 프리셋 저장 (공유 함수 사용)
async function designSavePreset() {
    const name = document.getElementById('design-preset-name')?.value.trim();
    if (!name) {
        alert('프리셋 이름을 입력하세요.');
        return;
    }

    // 현재 설정 수집 (UI에서)
    const characters = [...new Set(designAnalyzedClips.map(c => c.character))];
    characters.forEach(char => designSaveCharacterVoiceSettings(char));

    const presetData = {
        name: name,
        createdAt: new Date().toISOString(),
        voiceSettings: studioCharacterVoiceSettings
    };

    try {
        const result = await eel.studio_save_preset(name, presetData)();
        if (result.success) {
            console.log(`[Design] 프리셋 '${name}' 저장됨`);
            alert('프리셋이 저장되었습니다.');
        } else {
            alert('프리셋 저장 실패: ' + result.error);
        }
    } catch (error) {
        console.error('[Design] 프리셋 저장 오류:', error);
        alert('프리셋 저장 오류: ' + error);
    }
}

// 디자인 탭 프리셋 불러오기 - 모달 열기
async function designLoadPresetList() {
    designOpenPresetModal();
}

// 프리셋 관리 모달 열기
async function designOpenPresetModal() {
    const modal = document.getElementById('design-preset-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    await designRefreshPresetList();
}

// 프리셋 관리 모달 닫기
function designClosePresetModal() {
    const modal = document.getElementById('design-preset-modal');
    if (modal) modal.style.display = 'none';
}

// 프리셋 목록 새로고침
async function designRefreshPresetList() {
    try {
        const presetNames = await eel.studio_get_presets()();
        const listEl = document.getElementById('design-preset-list');
        const countEl = document.getElementById('design-preset-count');

        if (!listEl) return;

        listEl.innerHTML = '';

        if (!presetNames || presetNames.length === 0) {
            listEl.innerHTML = '<option disabled>저장된 프리셋이 없습니다</option>';
            if (countEl) countEl.textContent = '총 0개';
            designClearPresetDetail();
            return;
        }

        presetNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            listEl.appendChild(option);
        });

        if (countEl) countEl.textContent = `총 ${presetNames.length}개`;

        // 첫 번째 항목 선택
        if (presetNames.length > 0) {
            listEl.selectedIndex = 0;
            await designOnPresetSelect();
        }
    } catch (error) {
        console.error('[Design] 프리셋 목록 로드 오류:', error);
    }
}

// 프리셋 선택 시 상세 정보 표시
async function designOnPresetSelect() {
    const listEl = document.getElementById('design-preset-list');
    const selectedName = listEl?.value;

    if (!selectedName) {
        designClearPresetDetail();
        return;
    }

    try {
        const presetData = await eel.studio_load_preset(selectedName)();
        if (!presetData || Object.keys(presetData).length === 0) {
            designClearPresetDetail();
            return;
        }

        // 상세 정보 표시
        const nameInput = document.getElementById('design-preset-detail-name');
        const dateInput = document.getElementById('design-preset-detail-date');
        const charsDiv = document.getElementById('design-preset-characters');

        if (nameInput) nameInput.value = presetData.name || selectedName;
        if (dateInput) {
            const date = presetData.createdAt ? new Date(presetData.createdAt) : null;
            dateInput.value = date ? date.toLocaleString('ko-KR') : '알 수 없음';
        }

        if (charsDiv && presetData.voiceSettings) {
            const chars = Object.keys(presetData.voiceSettings);
            if (chars.length > 0) {
                charsDiv.innerHTML = chars.map(c => `<span class="char-tag">${c}</span>`).join('');
            } else {
                charsDiv.innerHTML = '<span style="color:#666;">캐릭터 정보 없음</span>';
            }
        }
    } catch (error) {
        console.error('[Design] 프리셋 상세 로드 오류:', error);
        designClearPresetDetail();
    }
}

// 프리셋 상세 정보 초기화
function designClearPresetDetail() {
    const nameInput = document.getElementById('design-preset-detail-name');
    const dateInput = document.getElementById('design-preset-detail-date');
    const charsDiv = document.getElementById('design-preset-characters');

    if (nameInput) nameInput.value = '';
    if (dateInput) dateInput.value = '';
    if (charsDiv) charsDiv.innerHTML = '<span style="color:#666;">프리셋을 선택하세요</span>';
}

// 선택된 프리셋 적용
async function designApplySelectedPreset() {
    const listEl = document.getElementById('design-preset-list');
    const selectedName = listEl?.value;

    if (!selectedName) {
        alert('적용할 프리셋을 선택하세요.');
        return;
    }

    await designApplyPreset(selectedName);
    designClosePresetModal();
}

// 프리셋 적용
async function designApplyPreset(presetName) {
    try {
        const presetData = await eel.studio_load_preset(presetName)();
        if (!presetData || Object.keys(presetData).length === 0) {
            alert('프리셋을 찾을 수 없습니다.');
            return;
        }

        // 음성 설정 적용
        if (presetData.voiceSettings) {
            Object.assign(studioCharacterVoiceSettings, presetData.voiceSettings);

            // UI 갱신
            const characters = [...new Set(designAnalyzedClips.map(c => c.character))];
            designRenderCharacterCards(characters);
        }

        console.log(`[Design] 프리셋 '${presetName}' 적용됨`);
    } catch (error) {
        console.error('[Design] 프리셋 적용 오류:', error);
        alert('프리셋 적용 오류: ' + error);
    }
}

// 선택된 프리셋 삭제
async function designDeleteSelectedPreset() {
    const listEl = document.getElementById('design-preset-list');
    const selectedName = listEl?.value;

    if (!selectedName) {
        alert('삭제할 프리셋을 선택하세요.');
        return;
    }

    if (!confirm(`'${selectedName}' 프리셋을 삭제하시겠습니까?`)) return;

    try {
        const result = await eel.studio_delete_preset(selectedName)();
        if (result.success) {
            console.log(`[Design] 프리셋 '${selectedName}' 삭제됨`);
            await designRefreshPresetList();
        } else {
            alert('프리셋 삭제 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[Design] 프리셋 삭제 오류:', error);
        alert('프리셋 삭제 오류: ' + error);
    }
}

// 모든 프리셋 초기화 (삭제)
async function designClearAllPresets() {
    if (!confirm('모든 프리셋을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;

    try {
        const presetNames = await eel.studio_get_presets()();
        if (!presetNames || presetNames.length === 0) {
            alert('삭제할 프리셋이 없습니다.');
            return;
        }

        for (const name of presetNames) {
            await eel.studio_delete_preset(name)();
        }

        console.log('[Design] 모든 프리셋 삭제됨');
        alert('모든 프리셋이 삭제되었습니다.');
        await designRefreshPresetList();
    } catch (error) {
        console.error('[Design] 프리셋 초기화 오류:', error);
        alert('프리셋 초기화 오류: ' + error);
    }
}

// 프리셋 이름 변경
async function designUpdatePresetName() {
    const listEl = document.getElementById('design-preset-list');
    const nameInput = document.getElementById('design-preset-detail-name');
    const oldName = listEl?.value;
    const newName = nameInput?.value.trim();

    if (!oldName) {
        alert('이름을 변경할 프리셋을 선택하세요.');
        return;
    }

    if (!newName) {
        alert('새 프리셋 이름을 입력하세요.');
        return;
    }

    if (oldName === newName) {
        alert('이름이 동일합니다.');
        return;
    }

    try {
        // 기존 프리셋 데이터 로드
        const presetData = await eel.studio_load_preset(oldName)();
        if (!presetData || Object.keys(presetData).length === 0) {
            alert('프리셋을 찾을 수 없습니다.');
            return;
        }

        // 새 이름으로 저장
        presetData.name = newName;
        const saveResult = await eel.studio_save_preset(newName, presetData)();
        if (!saveResult.success) {
            alert('프리셋 저장 실패: ' + (saveResult.error || '알 수 없는 오류'));
            return;
        }

        // 기존 프리셋 삭제
        await eel.studio_delete_preset(oldName)();

        console.log(`[Design] 프리셋 이름 변경: '${oldName}' → '${newName}'`);
        alert(`프리셋 이름이 '${newName}'(으)로 변경되었습니다.`);
        await designRefreshPresetList();

        // 변경된 프리셋 선택
        if (listEl) {
            for (let i = 0; i < listEl.options.length; i++) {
                if (listEl.options[i].value === newName) {
                    listEl.selectedIndex = i;
                    await designOnPresetSelect();
                    break;
                }
            }
        }
    } catch (error) {
        console.error('[Design] 프리셋 이름 변경 오류:', error);
        alert('프리셋 이름 변경 오류: ' + error);
    }
}

// 캐릭터 미리듣기
async function designPreviewCharacter(character) {
    // 미리듣기 전 설정 저장 (현재 탭 감지)
    const isBatchTab = isCurrentlyBatchTab();
    designSaveCharacterVoiceSettings(character, isBatchTab);

    const voiceSettings = getCurrentVoiceSettings();
    const settings = voiceSettings[character];
    if (!settings) return;

    const sampleText = `안녕하세요, ${character}입니다.`;

    try {
        console.log('[Design] 캐릭터 미리듣기:', character);
        // studio_test_voice(text, voiceName, '', rate, pitch) 사용
        const result = await eel.studio_test_voice(
            sampleText,
            settings.voice,
            '',
            settings.rate || 1.0,
            settings.pitch || 0
        )();

        if (!result.success) {
            alert('미리듣기 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[Design] 미리듣기 오류:', error);
    }
}

// 문장 미리듣기
async function designPreviewSentence(idx) {
    const clip = designAnalyzedClips[idx];
    if (!clip) return;

    const settings = studioCharacterVoiceSettings[clip.character] || {
        voice: 'ko-KR-Standard-A',
        rate: 1.0,
        pitch: 0
    };

    try {
        console.log('[Design] 문장 미리듣기:', idx, clip.text);
        // studio_test_voice(text, voiceName, '', rate, pitch) 사용
        const result = await eel.studio_test_voice(
            clip.text,
            settings.voice,
            '',
            settings.rate || 1.0,
            settings.pitch || 0
        )();

        if (!result.success) {
            console.log('[Design] 미리듣기 실패:', result.error);
        }
    } catch (error) {
        console.error('[Design] 문장 미리듣기 오류:', error);
    }
}

// ========== 자막 기능 ==========

// 자막 생성 (타임코드는 타임코드 버튼 클릭 시 설정)
function designGenerateSubtitles() {
    designSubtitles = [];

    designAnalyzedClips.forEach((clip, idx) => {
        designSubtitles.push({
            index: idx + 1,
            start: null,  // 타임코드는 타임코드 버튼 클릭 시 설정
            end: null,
            text: clip.text,
            character: clip.character
        });
    });

    designRenderSubtitleList();
}

// 자막 목록 렌더링
function designRenderSubtitleList() {
    const container = document.querySelector('#tab-studio-tts-design #tts-tab-subtitle .tts-subtitle-list');
    if (!container) return;

    let html = '';
    designSubtitles.forEach((sub, idx) => {
        const selected = idx === designCurrentSubtitleIndex ? 'selected' : '';
        html += `
            <div class="tts-subtitle-item ${selected}" data-index="${idx}" onclick="designSelectSentenceByIndex(${idx})">
                <div class="tts-sub-num">${sub.index}</div>
                <div class="tts-sub-time">
                    <input type="text" value="${designFormatTime(sub.start)}" class="tts-time-input"
                           onchange="designUpdateSubtitleTime(${idx}, 'start', this.value)">
                    <span>→</span>
                    <input type="text" value="${designFormatTime(sub.end)}" class="tts-time-input"
                           onchange="designUpdateSubtitleTime(${idx}, 'end', this.value)">
                </div>
                <input type="text" class="tts-sub-text" value="${sub.text}"
                       onchange="designUpdateSubtitleText(${idx}, this.value)">
                <button class="tts-sub-del" onclick="event.stopPropagation(); designDeleteSubtitle(${idx})">×</button>
            </div>
        `;
    });

    container.innerHTML = html || '<div class="subtitle-placeholder">대본을 분석해주세요.</div>';

    // 자막 개수 업데이트
    const countEl = document.querySelector('#tab-studio-tts-design .tts-subtitle-count');
    if (countEl) {
        countEl.textContent = `${designSubtitles.length}개`;
    }
}

// 시간 포맷팅
function designFormatTime(seconds) {
    if (seconds === null || seconds === undefined) {
        return '';  // 타임코드가 설정되지 않은 경우 빈 문자열 반환
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

// 시간 파싱
function designParseTime(timeStr) {
    const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (match) {
        return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 1000;
    }
    return 0;
}

// 자막 시간 업데이트
function designUpdateSubtitleTime(idx, field, value) {
    const time = designParseTime(value);
    if (field === 'start') {
        designSubtitles[idx].start = time;
    } else {
        designSubtitles[idx].end = time;
    }
}

// 자막 텍스트 업데이트
function designUpdateSubtitleText(idx, text) {
    designSubtitles[idx].text = text;
    // 분석된 클립도 업데이트
    if (designAnalyzedClips[idx]) {
        designAnalyzedClips[idx].text = text;
        designRenderSentenceList();
    }
    designUpdatePreview();
}

// 자막 삭제
function designDeleteSubtitle(idx) {
    if (confirm('이 자막을 삭제하시겠습니까?')) {
        designSubtitles.splice(idx, 1);
        designAnalyzedClips.splice(idx, 1);
        designRenderSubtitleList();
        designRenderSentenceList();
    }
}

// 자막 추가
function designAddSubtitle() {
    const lastSub = designSubtitles[designSubtitles.length - 1];
    const start = lastSub ? lastSub.end + 0.1 : 0;

    designSubtitles.push({
        index: designSubtitles.length + 1,
        start: start,
        end: start + 2,
        text: '새 자막',
        character: '나레이션'
    });

    designAnalyzedClips.push({
        character: '나레이션',
        text: '새 자막'
    });

    designRenderSubtitleList();
    designRenderSentenceList();
}

// 전체 선택/해제 토글
function designToggleAllClips() {
    const checkboxes = document.querySelectorAll('#tab-studio-tts-design .tts-sentences-list input[type="checkbox"]');
    if (checkboxes.length === 0) return;

    // 모두 선택되어 있으면 해제, 아니면 모두 선택
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);

    console.log('[Design] 전체 선택:', !allChecked);
}

// SRT 저장
async function designSaveSRT() {
    if (designSubtitles.length === 0) {
        alert('저장할 자막이 없습니다.');
        return;
    }

    try {
        // 출력 폴더와 파일명 결정 (대본 파일 기준)
        let outputFolder;
        let srtFileName;

        if (designCurrentScriptPath) {
            // 대본 파일이 있으면 해당 폴더 + 완성_대본파일명 사용 (영상 제작과 동일)
            const pathParts = designCurrentScriptPath.replace(/\\/g, '/').split('/');
            outputFolder = pathParts.slice(0, -1).join('/');
            const fileName = pathParts[pathParts.length - 1];
            const baseName = fileName.replace(/\.[^/.]+$/, '');
            srtFileName = `완성_${baseName}.srt`;
        } else {
            // 대본 파일이 없으면 폴더 선택
            outputFolder = await eel.studio_select_folder()();
            if (!outputFolder) return;
            srtFileName = 'subtitles.srt';
        }

        // SRT 컨텐츠 생성
        let srtContent = '';
        designSubtitles.forEach((sub, idx) => {
            srtContent += `${idx + 1}\n`;
            srtContent += `${designFormatSRTTime(sub.start)} --> ${designFormatSRTTime(sub.end)}\n`;
            srtContent += `${sub.text}\n\n`;
        });

        // 저장
        const result = await eel.studio_save_srt_file(outputFolder, srtFileName, srtContent)();
        if (result.success) {
            alert('SRT 파일이 저장되었습니다.\n' + result.path);
            console.log('[Design] SRT 저장:', result.path);
        } else {
            alert('SRT 저장 실패: ' + result.error);
        }
    } catch (error) {
        console.error('[Design] SRT 저장 오류:', error);
        alert('SRT 저장 중 오류가 발생했습니다.');
    }
}

// ========== 통합 미리보기 ==========

// 미리보기 업데이트
function designUpdatePreview() {
    const clip = designAnalyzedClips[designCurrentSubtitleIndex];
    const subtitle = designSubtitles[designCurrentSubtitleIndex];

    // 자막 레이어 업데이트
    const subtitleLayer = document.querySelector('#tab-studio-tts-design .tts-layer-subtitle');
    if (subtitleLayer && subtitle) {
        subtitleLayer.textContent = subtitle.text;
    }

    // 인덱스 표시 업데이트
    const idxDisplay = document.querySelector('#tab-studio-tts-design .tts-preview-idx');
    if (idxDisplay) {
        idxDisplay.textContent = `${designCurrentSubtitleIndex + 1} / ${designAnalyzedClips.length}`;
    }
}

// 이전 문장
function designPrevSentence() {
    if (designCurrentSubtitleIndex > 0) {
        designSelectSentenceByIndex(designCurrentSubtitleIndex - 1);
    }
}

// 다음 문장
function designNextSentence() {
    if (designCurrentSubtitleIndex < designAnalyzedClips.length - 1) {
        designSelectSentenceByIndex(designCurrentSubtitleIndex + 1);
    }
}

// 현재 문장 미리듣기
async function designPlayCurrentSentence() {
    if (designCurrentSubtitleIndex < 0 || designCurrentSubtitleIndex >= designAnalyzedClips.length) {
        alert('문장을 선택해주세요.');
        return;
    }

    // 기존 designPreviewSentence 함수 호출
    await designPreviewSentence(designCurrentSubtitleIndex);
}

// ========== 키보드 네비게이션 ==========

let designKeyboardInitialized = false;

// 키보드 이벤트 초기화
function designInitKeyboardNavigation() {
    if (designKeyboardInitialized) return;

    document.addEventListener('keydown', designHandleKeydown);
    designKeyboardInitialized = true;
    console.log('[Design] 키보드 네비게이션 초기화 완료');
}

// 키보드 이벤트 핸들러
function designHandleKeydown(e) {
    // 디자인 탭이 활성화되어 있지 않으면 무시
    const designTab = document.getElementById('tab-studio-tts-design');
    if (!designTab || !designTab.classList.contains('active')) return;

    // Ctrl+Z: Undo (텍스트 입력 중에도 작동)
    if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        designUndo();
        return;
    }

    // Ctrl+Shift+Z: Redo (텍스트 입력 중에도 작동)
    if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
        e.preventDefault();
        designRedo();
        return;
    }

    // 입력 필드에 포커스되어 있으면 무시 (textarea, input 등)
    const activeEl = document.activeElement;
    const isTextInput = activeEl && (
        activeEl.tagName === 'TEXTAREA' ||
        (activeEl.tagName === 'INPUT' && activeEl.type === 'text') ||
        activeEl.isContentEditable
    );

    // 텍스트 입력 필드에 포커스되어 있으면 방향키/엔터 무시
    if (isTextInput) return;

    switch (e.key) {
        case 'ArrowUp':
            e.preventDefault();
            designMoveToPrevSentence();
            break;
        case 'ArrowDown':
            e.preventDefault();
            designMoveToNextSentence();
            break;
        case 'Enter':
            // Shift+Enter: 자막 분리
            if (e.shiftKey) {
                e.preventDefault();
                designSplitCurrentSubtitle();
            }
            break;
        case 'Delete':
            // Ctrl+Delete: 현재 자막 삭제
            if (e.ctrlKey) {
                e.preventDefault();
                designDeleteCurrentSubtitle();
            }
            break;
    }
}

// 이전 문장으로 이동
function designMoveToPrevSentence() {
    if (designCurrentSubtitleIndex > 0) {
        designSelectSentenceByIndex(designCurrentSubtitleIndex - 1);
        designScrollToCurrentSentence();
    }
}

// 다음 문장으로 이동
function designMoveToNextSentence() {
    if (designCurrentSubtitleIndex < designAnalyzedClips.length - 1) {
        designSelectSentenceByIndex(designCurrentSubtitleIndex + 1);
        designScrollToCurrentSentence();
    }
}

// 현재 선택된 문장이 보이도록 스크롤
function designScrollToCurrentSentence() {
    const container = document.querySelector('#tab-studio-tts-design .tts-sentences-list');
    const selectedItem = container?.querySelector('.tts-sentence-item.selected');
    if (selectedItem && container) {
        selectedItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// 자막 입력란 키보드 이벤트 핸들러
function designHandleSubtitleKeydown(e, idx, inputEl) {
    // Enter: 커서 위치에서 자막 분리
    if (e.key === 'Enter') {
        e.preventDefault();
        const cursorPos = inputEl.selectionStart;
        const text = inputEl.value;

        // 커서가 맨 앞이나 맨 뒤에 있으면 나누지 않음
        if (cursorPos === 0 || cursorPos >= text.length) {
            return;
        }

        // 커서 위치에서 텍스트 분할
        const textBefore = text.substring(0, cursorPos).trim();
        const textAfter = text.substring(cursorPos).trim();

        // 둘 중 하나라도 비어있으면 나누지 않음
        if (!textBefore || !textAfter) {
            return;
        }

        // 입력값 기준으로 직접 분리
        designSplitSubtitleDirect(idx, text, cursorPos);
        return;
    }

    // Delete 키: 커서가 끝에 있고 다음 항목이 있으면 합치기
    if (e.key === 'Delete') {
        const cursorPos = inputEl.selectionStart;
        const text = inputEl.value;

        // 커서가 텍스트 끝에 있을 때만 합치기
        if (cursorPos === text.length && idx < designAnalyzedClips.length - 1) {
            e.preventDefault();
            designMergeSubtitlesDirect(idx, idx + 1, text);
        }
        return;
    }

    // Backspace 키: 커서가 처음에 있고 이전 항목이 있으면 합치기
    if (e.key === 'Backspace') {
        const cursorPos = inputEl.selectionStart;
        const text = inputEl.value;

        // 커서가 텍스트 처음에 있을 때만 합치기
        if (cursorPos === 0 && idx > 0) {
            e.preventDefault();
            // 이전 항목의 텍스트 길이 저장 (커서 위치 복원용)
            const prevText = designAnalyzedClips[idx - 1]?.text || '';
            designMergeSubtitlesDirect(idx - 1, idx, prevText, text, prevText.length);
        }
        return;
    }
}

// 입력값 기준으로 직접 자막 분리
function designSplitSubtitleDirect(idx, text, cursorPos) {
    if (idx < 0 || idx >= designAnalyzedClips.length) return;

    const clip = designAnalyzedClips[idx];
    const subtitle = designSubtitles[idx];

    const firstPart = text.substring(0, cursorPos).trim();
    const secondPart = text.substring(cursorPos).trim();

    if (!firstPart || !secondPart) {
        alert('분리할 텍스트가 부족합니다.');
        return;
    }

    // 히스토리 저장
    designSaveHistory();

    // 클립 업데이트 및 분리
    clip.text = firstPart;
    const newClip = {
        character: clip.character,
        text: secondPart
    };
    designAnalyzedClips.splice(idx + 1, 0, newClip);

    // 자막 분리 (시간 조정)
    const duration = subtitle.end - subtitle.start;
    const ratio = firstPart.length / (firstPart.length + secondPart.length);
    const splitTime = subtitle.start + duration * ratio;

    subtitle.text = firstPart;
    const originalEnd = subtitle.end;
    subtitle.end = splitTime;

    const newSubtitle = {
        index: idx + 2,
        start: splitTime,
        end: originalEnd,
        text: secondPart,
        character: clip.character
    };
    designSubtitles.splice(idx + 1, 0, newSubtitle);

    // 인덱스 재정렬
    designSubtitles.forEach((sub, i) => sub.index = i + 1);

    // 렌더링
    designRenderSentenceList();
    designExtractCharacters();

    // 분리된 다음 항목 선택
    designSelectSentenceByIndex(idx + 1);

    console.log('[Design] 자막 분리 완료:', firstPart, '|', secondPart);
}

// 직접 자막 합치기 (입력값 기준)
function designMergeSubtitlesDirect(idx1, idx2, text1, text2 = null, cursorPos = -1) {
    if (idx1 < 0 || idx2 >= designAnalyzedClips.length || idx1 >= idx2) return;

    const clip1 = designAnalyzedClips[idx1];
    const clip2 = designAnalyzedClips[idx2];
    const subtitle1 = designSubtitles[idx1];
    const subtitle2 = designSubtitles[idx2];

    if (!clip1 || !clip2 || !subtitle1 || !subtitle2) return;

    // 히스토리 저장
    designSaveHistory();

    // 텍스트 합치기 (입력값 기준) - 공백으로 구분
    const mergedText = text2 !== null ? (text1 + ' ' + text2) : (text1 + ' ' + clip2.text);

    // 첫 번째 클립/자막 업데이트
    clip1.text = mergedText;
    subtitle1.text = mergedText;
    subtitle1.end = subtitle2.end;

    // 두 번째 클립/자막 제거
    designAnalyzedClips.splice(idx2, 1);
    designSubtitles.splice(idx2, 1);

    // 인덱스 재정렬
    designSubtitles.forEach((sub, i) => sub.index = i + 1);

    // 렌더링
    designRenderSentenceList();
    designExtractCharacters();

    // 합쳐진 항목 선택
    designSelectSentenceByIndex(idx1);

    // 커서 위치 복원 (공백 추가로 인해 +1)
    if (cursorPos >= 0) {
        const newCursorPos = cursorPos + 1;  // 공백 위치
        setTimeout(() => {
            const input = document.querySelector(`.tts-sentence-item[data-idx="${idx1}"] .tts-sub-text-sm`);
            if (input) {
                input.focus();
                input.setSelectionRange(newCursorPos, newCursorPos);
            }
        }, 50);
    }

    console.log('[Design] 자막 합치기 완료:', mergedText);
}

// 지정된 위치에서 자막 분리
function designSplitSubtitleAtPosition(idx, splitPoint) {
    if (idx < 0 || idx >= designAnalyzedClips.length) return;

    const clip = designAnalyzedClips[idx];
    const subtitle = designSubtitles[idx];
    const text = clip.text;

    if (splitPoint <= 0 || splitPoint >= text.length) {
        console.log('[Design] 분리할 위치가 유효하지 않습니다.');
        return;
    }

    const firstPart = text.substring(0, splitPoint).trim();
    const secondPart = text.substring(splitPoint).trim();

    if (!firstPart || !secondPart) {
        alert('분리할 텍스트가 부족합니다. 커서를 텍스트 중간에 위치시켜주세요.');
        return;
    }

    // 클립 분리
    clip.text = firstPart;
    const newClip = {
        character: clip.character,
        text: secondPart
    };
    designAnalyzedClips.splice(idx + 1, 0, newClip);

    // 자막 분리 (시간 조정)
    const duration = subtitle.end - subtitle.start;
    const ratio = firstPart.length / (firstPart.length + secondPart.length);
    const splitTime = subtitle.start + duration * ratio;

    subtitle.text = firstPart;
    const originalEnd = subtitle.end;
    subtitle.end = splitTime;

    const newSubtitle = {
        index: idx + 2,
        start: splitTime,
        end: originalEnd,
        text: secondPart,
        character: clip.character
    };
    designSubtitles.splice(idx + 1, 0, newSubtitle);

    // 인덱스 재정렬
    designSubtitles.forEach((sub, i) => sub.index = i + 1);

    // 렌더링
    designRenderSentenceList();
    designExtractCharacters();

    // 분리된 다음 항목 선택
    designSelectSentenceByIndex(idx + 1);

    console.log('[Design] 자막 분리 완료 (커서 위치):', firstPart, '|', secondPart);
}

// 현재 자막 분리 (자동으로 중간 위치 찾기)
function designSplitCurrentSubtitle() {
    const idx = designCurrentSubtitleIndex;
    if (idx < 0 || idx >= designAnalyzedClips.length) return;

    const clip = designAnalyzedClips[idx];
    const subtitle = designSubtitles[idx];

    const text = clip.text;
    const midPoint = Math.floor(text.length / 2);

    // 문장 부호 위치 찾기 (마침표, 쉼표, 공백 등)
    let splitPoint = -1;
    const punctuation = ['. ', ', ', '! ', '? ', '。', '、'];

    // 중간 지점 근처에서 분리점 찾기
    for (let i = midPoint; i < text.length - 1; i++) {
        for (const p of punctuation) {
            if (text.substring(i, i + p.length) === p) {
                splitPoint = i + p.length;
                break;
            }
        }
        if (splitPoint !== -1) break;
    }

    // 분리점을 못 찾으면 공백 기준으로
    if (splitPoint === -1) {
        const spaceAfterMid = text.indexOf(' ', midPoint);
        if (spaceAfterMid !== -1) {
            splitPoint = spaceAfterMid + 1;
        } else {
            splitPoint = midPoint;
        }
    }

    if (splitPoint <= 0 || splitPoint >= text.length) {
        alert('분리할 위치를 찾을 수 없습니다. 텍스트가 너무 짧습니다.');
        return;
    }

    const firstPart = text.substring(0, splitPoint).trim();
    const secondPart = text.substring(splitPoint).trim();

    if (!firstPart || !secondPart) {
        console.log('[Design] 분리 결과가 비어있습니다.');
        return;
    }

    // 클립 분리
    clip.text = firstPart;
    const newClip = {
        character: clip.character,
        text: secondPart
    };
    designAnalyzedClips.splice(idx + 1, 0, newClip);

    // 자막 분리 (시간 조정)
    const duration = subtitle.end - subtitle.start;
    const ratio = firstPart.length / (firstPart.length + secondPart.length);
    const splitTime = subtitle.start + duration * ratio;

    subtitle.text = firstPart;
    subtitle.end = splitTime;

    const newSubtitle = {
        index: idx + 2,
        start: splitTime,
        end: subtitle.start + duration,
        text: secondPart,
        character: clip.character
    };
    designSubtitles.splice(idx + 1, 0, newSubtitle);

    // 인덱스 재정렬
    designSubtitles.forEach((sub, i) => sub.index = i + 1);

    // 렌더링
    designRenderSentenceList();
    designExtractCharacters();

    console.log('[Design] 자막 분리 완료:', firstPart, '|', secondPart);
}

// 두 자막 합치기
function designMergeSubtitles(idx1, idx2, cursorPosAfterMerge = -1) {
    if (idx1 < 0 || idx2 >= designAnalyzedClips.length || idx1 >= idx2) {
        console.log('[Design] 합칠 수 없는 인덱스입니다.');
        return;
    }

    const clip1 = designAnalyzedClips[idx1];
    const clip2 = designAnalyzedClips[idx2];
    const subtitle1 = designSubtitles[idx1];
    const subtitle2 = designSubtitles[idx2];

    if (!clip1 || !clip2 || !subtitle1 || !subtitle2) {
        console.log('[Design] 합칠 클립 또는 자막이 없습니다.');
        return;
    }

    // 텍스트 합치기
    const mergedText = clip1.text + clip2.text;

    // 첫 번째 클립/자막 업데이트
    clip1.text = mergedText;
    subtitle1.text = mergedText;
    subtitle1.end = subtitle2.end;

    // 두 번째 클립/자막 제거
    designAnalyzedClips.splice(idx2, 1);
    designSubtitles.splice(idx2, 1);

    // 인덱스 재정렬
    designSubtitles.forEach((sub, i) => sub.index = i + 1);

    // 렌더링
    designRenderSentenceList();
    designExtractCharacters();

    // 합쳐진 항목 선택
    designSelectSentenceByIndex(idx1);

    // 커서 위치 복원 (Backspace로 합친 경우)
    if (cursorPosAfterMerge >= 0) {
        setTimeout(() => {
            const input = document.querySelector(`.tts-sentence-item[data-idx="${idx1}"] .tts-sentence-subtitle input`);
            if (input) {
                input.focus();
                input.setSelectionRange(cursorPosAfterMerge, cursorPosAfterMerge);
            }
        }, 50);
    }

    console.log('[Design] 자막 합치기 완료:', mergedText);
}

// 현재 자막 삭제
function designDeleteCurrentSubtitle() {
    const idx = designCurrentSubtitleIndex;
    if (idx < 0 || idx >= designAnalyzedClips.length) return;

    if (!confirm('현재 선택된 문장을 삭제하시겠습니까?')) return;

    designAnalyzedClips.splice(idx, 1);
    designSubtitles.splice(idx, 1);

    // 인덱스 재정렬
    designSubtitles.forEach((sub, i) => sub.index = i + 1);

    // 선택 인덱스 조정
    if (designCurrentSubtitleIndex >= designAnalyzedClips.length) {
        designCurrentSubtitleIndex = Math.max(0, designAnalyzedClips.length - 1);
    }

    designRenderSentenceList();
    designExtractCharacters();
    designUpdatePreview();

    console.log('[Design] 자막 삭제 완료');
}

// ========== 자막 설정 ==========

let designSubtitleVisible = false;
let designSubtitlePosition = { x: 50, y: 90 };  // 퍼센트 위치 (중앙 기준점)
let designSubtitleSettings = {
    font: 'Noto Sans KR',
    size: 24,
    color: '#ffffff',
    bgColor: '#000000',
    bgOpacity: 70,
    bgNone: false  // 배경 없음
};

// 자막 표시/숨기기 토글
function designToggleSubtitle() {
    // 토글 후 새 함수 호출
    designToggleSubtitleVisible(!designSubtitleVisible);
    console.log('[Design] 자막 표시:', designSubtitleVisible);
}

// 자막 폰트 변경
function designSetSubtitleFont(font) {
    designSubtitleSettings.font = font;
    designApplySubtitleStyle();
}

// 자막 크기 변경
function designSetSubtitleSize(size) {
    designSubtitleSettings.size = parseInt(size) || 24;
    designApplySubtitleStyle();
}

// 자막 색상 변경
function designSetSubtitleColor(color) {
    designSubtitleSettings.color = color;
    designApplySubtitleStyle();
}

// 자막 배경색 변경
function designSetSubtitleBg(color) {
    designSubtitleSettings.bgColor = color;
    designApplySubtitleStyle();
}

// 자막 배경 투명도 변경
function designSetSubtitleBgOpacity(opacity) {
    designSubtitleSettings.bgOpacity = parseInt(opacity) || 70;
    designApplySubtitleStyle();
}

// 자막 배경 없음 토글
function designToggleSubtitleBgNone(checked) {
    designSubtitleSettings.bgNone = checked;

    // 배경 투명도 컨트롤 활성화/비활성화
    const opacityRow = document.getElementById('popup-sub-bg-opacity-row');
    const bgColorInput = document.getElementById('popup-sub-bg');
    if (opacityRow) {
        opacityRow.style.opacity = checked ? '0.5' : '1';
        opacityRow.style.pointerEvents = checked ? 'none' : 'auto';
    }
    if (bgColorInput) {
        bgColorInput.disabled = checked;
    }

    designApplySubtitleStyle();
}

// 자막 스타일 적용 (실제 영상 비율 반영)
function designApplySubtitleStyle() {
    const { font, size, color, bgColor, bgOpacity, bgNone } = designSubtitleSettings;

    // 출력 해상도 가져오기
    const resolution = designOutputSettings.resolution || '1920x1080';
    const [baseWidth, baseHeight] = resolution.split('x').map(Number);

    // 배경색 rgba 변환 (배경 없음이면 transparent)
    let bgRgba = 'transparent';
    if (!bgNone) {
        const r = parseInt(bgColor.slice(1, 3), 16);
        const g = parseInt(bgColor.slice(3, 5), 16);
        const b = parseInt(bgColor.slice(5, 7), 16);
        bgRgba = `rgba(${r}, ${g}, ${b}, ${bgOpacity / 100})`;
    }

    // 메인 미리보기 자막 (해상도 기준 스케일 적용)
    const mainSub = document.querySelector('#tab-studio-tts-design .tts-layer-subtitle');
    const mainScreen = document.querySelector('#tab-studio-tts-design .tts-preview-screen');
    if (mainSub && mainScreen) {
        // 자막 표시 상태 적용
        mainSub.style.display = designSubtitleVisible ? 'block' : 'none';

        const mainScale = mainScreen.offsetWidth / baseWidth;
        mainSub.style.fontFamily = font;
        mainSub.style.fontSize = Math.max(10, size * mainScale) + 'px';
        mainSub.style.color = color;
        mainSub.style.backgroundColor = bgRgba;
        mainSub.style.padding = bgNone ? '0' : `${8 * mainScale}px ${16 * mainScale}px`;
    }

    // 팝업 자막 (해상도 기준 스케일 적용)
    const popupSub = document.querySelector('#design-preview-popup .popup-subtitle');
    const popupScreen = document.querySelector('#design-preview-popup .design-popup-screen');
    if (popupSub && popupScreen) {
        // 자막 표시 상태 적용
        popupSub.style.display = designSubtitleVisible ? 'block' : 'none';

        const popupScale = popupScreen.offsetWidth / baseWidth;
        popupSub.style.fontFamily = font;
        popupSub.style.fontSize = Math.max(10, size * popupScale) + 'px';
        popupSub.style.color = color;
        popupSub.style.backgroundColor = bgRgba;
        popupSub.style.padding = bgNone ? '0' : `${8 * popupScale}px ${16 * popupScale}px`;
    }
}

// 해상도 변경
function designSetResolution(resolution) {
    designOutputSettings.resolution = resolution;
    const resSelect = document.getElementById('design-resolution');
    if (resSelect) resSelect.value = resolution;

    // 메인 미리보기 비율 업데이트
    const screen = document.querySelector('#tab-studio-tts-design .tts-preview-screen');
    if (screen) {
        const [width, height] = resolution.split('x').map(Number);
        screen.style.aspectRatio = `${width} / ${height}`;
    }

    // 해상도 변경 시 EQ와 자막 스케일 재적용
    designUpdateEQPreview();
    designApplySubtitleStyle();
}

// ========== 미리보기 팝업 ==========

// 팝업 열기
function designOpenPreviewPopup() {
    const popup = document.getElementById('design-preview-popup');
    if (!popup) return;

    popup.style.display = 'flex';

    // 배경 이미지 비율에 맞게 미리보기 화면 크기 조절
    designUpdatePreviewAspectRatio();

    // 해상도에 맞게 미리보기 화면 크기 조절
    designUpdatePopupScreenSize();

    // 현재 배경 이미지 복사
    const mainBgImg = document.querySelector('#tab-studio-tts-design .tts-preview-screen .tts-layer-bg img');
    const popupBgImg = popup.querySelector('.tts-layer-bg img');
    if (mainBgImg && popupBgImg && mainBgImg.src) {
        popupBgImg.src = mainBgImg.src;
        popupBgImg.style.display = mainBgImg.style.display;
    } else if (designOutputSettings.backgroundDataUrl && popupBgImg) {
        // 저장된 배경 이미지 사용
        popupBgImg.src = designOutputSettings.backgroundDataUrl;
        popupBgImg.style.display = 'block';
    }

    // 현재 자막 텍스트 복사
    const mainSubtitle = document.querySelector('#tab-studio-tts-design .tts-preview-screen .tts-layer-subtitle');
    const popupSubtitle = popup.querySelector('.popup-subtitle');
    if (mainSubtitle && popupSubtitle) {
        popupSubtitle.textContent = mainSubtitle.textContent || '자막 텍스트';
    }

    // EQ 설정 값 동기화
    const eqStyleEl = document.getElementById('popup-eq-style');
    if (eqStyleEl && designEQSettings.style) eqStyleEl.value = designEQSettings.style;

    const eqColor1El = document.getElementById('popup-eq-color1');
    const eqColor2El = document.getElementById('popup-eq-color2');
    if (eqColor1El && designEQSettings.color1) eqColor1El.value = designEQSettings.color1;
    if (eqColor2El && designEQSettings.color2) eqColor2El.value = designEQSettings.color2;

    // EQ 컨트롤 값 설정 (새 UI)
    const eqXEl = document.getElementById('popup-eq-x');
    const eqYEl = document.getElementById('popup-eq-y');
    const eqHEl = document.getElementById('popup-eq-h');
    const eqBarsEl = document.getElementById('popup-eq-bars');
    const eqBarWidthEl = document.getElementById('popup-eq-bar-width');
    const eqBarGapEl = document.getElementById('popup-eq-bar-gap');

    if (eqXEl) eqXEl.value = designEQSettings.x || 50;
    if (eqYEl) eqYEl.value = designEQSettings.y || 50;
    if (eqHEl) eqHEl.value = designEQSettings.height || 100;
    if (eqBarsEl) eqBarsEl.value = designEQSettings.barCount || 24;
    if (eqBarWidthEl) eqBarWidthEl.value = designEQSettings.barWidth || 20;
    if (eqBarGapEl) eqBarGapEl.value = designEQSettings.barGap || 3;

    // 자막 컨트롤 값 설정 (새 UI)
    const subXEl = document.getElementById('popup-sub-x');
    const subYEl = document.getElementById('popup-sub-y');
    if (subXEl) subXEl.value = designSubtitlePosition.x;
    if (subYEl) subYEl.value = designSubtitlePosition.y;

    // 표시 토글 동기화
    const eqVisibleEl = document.getElementById('popup-eq-visible');
    const subVisibleEl = document.getElementById('popup-sub-visible');
    if (eqVisibleEl) eqVisibleEl.checked = designEQSettings.enabled !== false;
    if (subVisibleEl) subVisibleEl.checked = designSubtitleVisible !== false;

    // 자막 설정 동기화 (새 UI)
    const subFontEl = document.getElementById('popup-sub-font');
    const subSizeEl = document.getElementById('popup-sub-size');
    const subColorEl = document.getElementById('popup-sub-color');
    const subBgEl = document.getElementById('popup-sub-bg');
    const subBgOpacityEl = document.getElementById('popup-sub-bg-opacity');
    const subBgNoneEl = document.getElementById('popup-sub-bg-none');

    if (subFontEl) subFontEl.value = designSubtitleSettings.font;
    if (subSizeEl) subSizeEl.value = designSubtitleSettings.size;
    if (subColorEl) subColorEl.value = designSubtitleSettings.color;
    if (subBgEl) subBgEl.value = designSubtitleSettings.bgColor;
    if (subBgOpacityEl) subBgOpacityEl.value = designSubtitleSettings.bgOpacity;
    if (subBgNoneEl) subBgNoneEl.checked = designSubtitleSettings.bgNone || false;

    // 배경 없음 상태에 따른 투명도 컨트롤 비활성화
    const opacityRow = document.getElementById('popup-sub-bg-opacity-row');
    if (opacityRow) {
        const isNone = designSubtitleSettings.bgNone || false;
        opacityRow.style.opacity = isNone ? '0.5' : '1';
        opacityRow.style.pointerEvents = isNone ? 'none' : 'auto';
    }

    // 해상도 동기화
    const popupResEl = document.getElementById('popup-resolution');
    if (popupResEl) popupResEl.value = designOutputSettings.resolution || '1920x1080';

    // 위치 적용 및 EQ 미리보기 업데이트
    designUpdatePopupEQ();
    designUpdatePopupSubtitle();

    // DOM 렌더링 완료 후 스케일 적용 (offsetWidth가 정확한 값을 반환하도록)
    requestAnimationFrame(() => {
        designUpdateEQPreview();
        designApplySubtitleStyle();
    });

    // 드래그 초기화
    designInitPopupDrag();
}

// 팝업 닫기
function designClosePreviewPopup() {
    const popup = document.getElementById('design-preview-popup');
    if (popup) {
        popup.style.display = 'none';
    }
    // 메인 미리보기에 설정 반영
    designApplySettingsToMain();
}

// ========== 스피너 및 위치 프리셋 함수 ==========

// 스피너 값 변경 (공통)
function designSpinnerChange(inputId, delta) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    const step = parseFloat(input.step) || 1;
    let value = parseFloat(input.value) || 0;

    value += delta;
    value = Math.max(min, Math.min(max, value));
    value = Math.round(value / step) * step;

    input.value = value;

    // onchange 이벤트 트리거
    input.dispatchEvent(new Event('change'));
}

// 위치 프리셋 값들
const positionPresets = {
    'center': { x: 50, y: 50 },
    'top-center': { x: 50, y: 10 },
    'bottom-center': { x: 50, y: 90 },
    'top-left': { x: 15, y: 10 },
    'top-right': { x: 85, y: 10 },
    'bottom-left': { x: 15, y: 90 },
    'bottom-right': { x: 85, y: 90 }
};

// EQ 위치 프리셋 적용
function designSetEQPositionPreset(preset) {
    if (preset === 'custom') return;

    const pos = positionPresets[preset];
    if (!pos) return;

    document.getElementById('popup-eq-x').value = pos.x;
    document.getElementById('popup-eq-y').value = pos.y;
    designUpdatePopupEQ();
}

// EQ 위치 수동 변경 시 -> '사용자 지정' 으로 전환
function designSetEQPositionCustom() {
    const presetSelect = document.getElementById('popup-eq-position-preset');
    if (presetSelect) presetSelect.value = 'custom';
}

// 자막 위치 프리셋 적용
function designSetSubPositionPreset(preset) {
    if (preset === 'custom') return;

    const pos = positionPresets[preset];
    if (!pos) return;

    document.getElementById('popup-sub-x').value = pos.x;
    document.getElementById('popup-sub-y').value = pos.y;
    designUpdatePopupSubtitle();
}

// 자막 위치 수동 변경 시 -> '사용자 지정' 으로 전환
function designSetSubPositionCustom() {
    const presetSelect = document.getElementById('popup-sub-position-preset');
    if (presetSelect) presetSelect.value = 'custom';
}

// 팝업 미리보기 화면 크기를 해상도 비율에 맞게 조절
function designUpdatePopupScreenSize() {
    const screen = document.getElementById('popup-preview-screen');
    const wrapper = document.querySelector('.design-popup-screen-wrapper');
    if (!screen || !wrapper) return;

    // 출력 해상도 파싱
    const resolution = designOutputSettings.resolution || '1920x1080';
    const [width, height] = resolution.split('x').map(Number);
    const aspectRatio = width / height;

    // 래퍼 크기 가져오기
    const wrapperRect = wrapper.getBoundingClientRect();
    const maxWidth = wrapperRect.width - 20;  // 여백
    const maxHeight = wrapperRect.height - 20;

    let screenWidth, screenHeight;

    // 비율에 맞게 크기 계산
    if (maxWidth / maxHeight > aspectRatio) {
        // 높이 기준
        screenHeight = Math.min(maxHeight, 500);
        screenWidth = screenHeight * aspectRatio;
    } else {
        // 너비 기준
        screenWidth = Math.min(maxWidth, 700);
        screenHeight = screenWidth / aspectRatio;
    }

    screen.style.width = screenWidth + 'px';
    screen.style.height = screenHeight + 'px';

    console.log(`[Design] 팝업 미리보기 크기: ${screenWidth}x${screenHeight} (${resolution})`);
}

// 메인 미리보기 화면 크기를 해상도 비율에 맞게 조절
function designUpdateMainScreenSize() {
    const screen = document.querySelector('#tab-studio-tts-design .tts-preview-screen');
    if (!screen) return;

    // 출력 해상도 파싱
    const resolution = designOutputSettings.resolution || '1920x1080';
    const [width, height] = resolution.split('x').map(Number);
    const aspectRatio = width / height;

    // 부모 컨테이너 크기 가져오기
    const container = screen.parentElement;
    if (!container) return;

    const containerWidth = container.clientWidth;

    // 비율에 맞게 높이 계산
    const screenHeight = containerWidth / aspectRatio;

    screen.style.width = '100%';
    screen.style.height = screenHeight + 'px';
    screen.style.aspectRatio = `${width} / ${height}`;
}

// EQ 위치/크기 업데이트 (팝업)
function designUpdatePopupEQ() {
    const popup = document.getElementById('design-preview-popup');
    if (!popup) return;

    const xEl = document.getElementById('popup-eq-x');
    const yEl = document.getElementById('popup-eq-y');
    const hEl = document.getElementById('popup-eq-h');
    const x = xEl && xEl.value !== '' ? parseInt(xEl.value) : 50;
    const y = yEl && yEl.value !== '' ? parseInt(yEl.value) : 50;
    const h = hEl && hEl.value !== '' ? parseInt(hEl.value) : 100;

    const eqLayer = popup.querySelector('.popup-eq');
    if (eqLayer) {
        eqLayer.style.left = `${x}%`;
        eqLayer.style.top = `${y}%`;
        eqLayer.style.transform = 'translate(-50%, -50%)';
        // height는 designUpdateEQPreview()에서 픽셀 단위로 설정하므로 여기서는 설정하지 않음
    }

    // 설정 저장 (위치만)
    designEQSettings.x = x;
    designEQSettings.y = y;
    designEQSettings.height = h;

    // EQ 크기 재계산
    designUpdateEQPreview();
}

// EQ 표시/숨기기
function designToggleEQVisible(visible) {
    designEQSettings.enabled = visible;

    // 메인 미리보기 EQ
    const mainEQ = document.querySelector('#tab-studio-tts-design .tts-layer-eq');
    if (mainEQ) {
        mainEQ.style.display = visible ? 'flex' : 'none';
    }

    // 팝업 EQ
    const popupEQ = document.querySelector('#design-preview-popup .popup-eq');
    if (popupEQ) {
        popupEQ.style.display = visible ? 'flex' : 'none';
    }
}

// 자막 표시/숨기기
function designToggleSubtitleVisible(visible) {
    designSubtitleVisible = visible;

    // 메인 미리보기 자막
    const mainSub = document.querySelector('#tab-studio-tts-design .tts-layer-subtitle');
    if (mainSub) {
        mainSub.style.display = visible ? 'block' : 'none';
    }

    // 팝업 자막
    const popupSub = document.querySelector('#design-preview-popup .popup-subtitle');
    if (popupSub) {
        popupSub.style.display = visible ? 'block' : 'none';
    }

    // 헤더 버튼 상태 업데이트
    const toggleBtn = document.getElementById('design-subtitle-toggle');
    if (toggleBtn) {
        toggleBtn.textContent = visible ? '💬' : '🚫';
        toggleBtn.title = visible ? '자막 숨기기' : '자막 표시';
    }
}

// 자막 위치 업데이트 (팝업)
function designUpdatePopupSubtitle() {
    const popup = document.getElementById('design-preview-popup');
    if (!popup) return;

    const xEl = document.getElementById('popup-sub-x');
    const yEl = document.getElementById('popup-sub-y');
    const x = xEl && xEl.value !== '' ? parseInt(xEl.value) : 50;
    const y = yEl && yEl.value !== '' ? parseInt(yEl.value) : 90;

    const subLayer = popup.querySelector('.popup-subtitle');
    if (subLayer) {
        subLayer.style.left = `${x}%`;
        subLayer.style.top = `${y}%`;
        subLayer.style.transform = 'translate(-50%, -50%)';
        subLayer.style.bottom = 'auto';
        subLayer.style.whiteSpace = 'nowrap';
        subLayer.style.maxWidth = 'none';
    }

    // 설정 저장
    designSubtitlePosition.x = x;
    designSubtitlePosition.y = y;
}

// 팝업 드래그 초기화
function designInitPopupDrag() {
    const popup = document.getElementById('design-preview-popup');
    if (!popup) return;

    const screen = popup.querySelector('.design-popup-screen');
    const eqLayer = popup.querySelector('.popup-eq');
    const subLayer = popup.querySelector('.popup-subtitle');

    // EQ 드래그
    if (eqLayer) {
        eqLayer.onmousedown = (e) => {
            e.preventDefault();
            const rect = screen.getBoundingClientRect();
            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseFloat(eqLayer.style.left) || 50;
            const startTop = parseFloat(eqLayer.style.top) || 75;

            const onMove = (e) => {
                const dx = ((e.clientX - startX) / rect.width) * 100;
                const dy = ((e.clientY - startY) / rect.height) * 100;
                const newX = Math.max(0, Math.min(100, startLeft + dx));
                const newY = Math.max(0, Math.min(100, startTop + dy));

                eqLayer.style.left = `${newX}%`;
                eqLayer.style.top = `${newY}%`;
                document.getElementById('popup-eq-x').value = Math.round(newX);
                document.getElementById('popup-eq-y').value = Math.round(newY);
                designEQSettings.x = Math.round(newX);
                designEQSettings.y = Math.round(newY);
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    }

    // 자막 드래그
    if (subLayer) {
        subLayer.onmousedown = (e) => {
            e.preventDefault();
            const rect = screen.getBoundingClientRect();
            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseFloat(subLayer.style.left) || 50;
            const startTop = parseFloat(subLayer.style.top) || 92;

            const onMove = (e) => {
                const dx = ((e.clientX - startX) / rect.width) * 100;
                const dy = ((e.clientY - startY) / rect.height) * 100;
                const newX = Math.max(0, Math.min(100, startLeft + dx));
                const newY = Math.max(0, Math.min(100, startTop + dy));

                subLayer.style.left = `${newX}%`;
                subLayer.style.top = `${newY}%`;
                document.getElementById('popup-sub-x').value = Math.round(newX);
                document.getElementById('popup-sub-y').value = Math.round(newY);
                designSubtitlePosition.x = Math.round(newX);
                designSubtitlePosition.y = Math.round(newY);
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    }
}

// 설정을 메인 미리보기에 반영
function designApplySettingsToMain() {
    // EQ 위치 반영
    const mainEQ = document.querySelector('#tab-studio-tts-design .tts-preview-screen .tts-layer-eq');
    if (mainEQ) {
        mainEQ.style.left = `${designEQSettings.x}%`;
        mainEQ.style.top = `${designEQSettings.y}%`;
        mainEQ.style.transform = 'translate(-50%, -50%)';
        mainEQ.style.width = `${designEQSettings.width}%`;
        mainEQ.style.height = `${designEQSettings.height}%`;
        mainEQ.style.bottom = 'auto';
    }

    // 자막 위치 반영
    const mainSub = document.querySelector('#tab-studio-tts-design .tts-preview-screen .tts-layer-subtitle');
    if (mainSub) {
        mainSub.style.left = `${designSubtitlePosition.x}%`;
        mainSub.style.top = `${designSubtitlePosition.y}%`;
        mainSub.style.transform = 'translate(-50%, -50%)';
        mainSub.style.bottom = 'auto';
        mainSub.style.whiteSpace = 'nowrap';
        mainSub.style.maxWidth = 'none';
    }

    // EQ 바 갯수/스타일/색상 반영
    designUpdateEQPreview();

    // 자막 스타일 반영
    designApplySubtitleStyle();
}

// ========== EQ 설정 ==========

// EQ 활성화 토글
function designToggleEQ(enabled) {
    designEQSettings.enabled = enabled;
    const eqLayer = document.querySelector('#tab-studio-tts-design .tts-layer-eq');
    if (eqLayer) {
        eqLayer.style.display = enabled ? 'block' : 'none';
    }
}

// EQ 스타일 변경
function designSetEQStyle(style) {
    designEQSettings.style = style;
    designUpdateEQPreview();
}

// EQ 색상 변경
function designSetEQColor(color1, color2) {
    designEQSettings.color1 = color1;
    designEQSettings.color2 = color2;
    designUpdateEQPreview();
}

// EQ 미리보기 업데이트 (메인 + 팝업)
function designUpdateEQPreview() {
    const {
        style,
        color1 = '#667eea',
        color2 = '#764ba2',
        barCount = 24,
        barWidth = 20,   // 바 1개 가로 (px) - 해상도 기준
        barGap = 3,      // 바 간격 (px) - 해상도 기준
        height = 100,    // 바 세로 최대 높이 (px) - 해상도 기준
        enabled = true
    } = designEQSettings;

    // 출력 해상도 가져오기
    const resolution = designOutputSettings.resolution || '1920x1080';
    const [baseWidth, baseHeight] = resolution.split('x').map(Number);

    // EQ 전체 크기 계산 (해상도 기준 픽셀값)
    const eqTotalWidth = (barWidth + barGap) * barCount;  // 전체 가로
    const eqTotalHeight = height;                          // 전체 세로

    // 메인 미리보기와 팝업 모두 업데이트
    const eqLayers = [
        document.querySelector('#tab-studio-tts-design .tts-preview-screen .tts-layer-eq'),
        document.querySelector('#design-preview-popup .popup-eq')
    ];

    eqLayers.forEach(eqLayer => {
        if (!eqLayer) return;

        // EQ 표시 상태 적용
        eqLayer.style.display = enabled ? 'flex' : 'none';

        // 화면 크기에 따른 스케일 계산
        let scale = 1;
        const isPopup = eqLayer.classList.contains('popup-eq');
        if (!isPopup) {
            // 메인 미리보기
            const screen = eqLayer.closest('.tts-preview-screen');
            if (screen) {
                // offsetWidth가 0이면 DOM이 아직 렌더링되지 않은 것이므로 재시도
                if (screen.offsetWidth === 0) {
                    setTimeout(() => designUpdateEQPreview(), 100);
                    return;
                }
                scale = screen.offsetWidth / baseWidth;
                console.log(`[EQ] 메인 스케일: ${screen.offsetWidth} / ${baseWidth} = ${scale}`);
            }
        } else {
            // 팝업
            const popupScreen = eqLayer.closest('.design-popup-screen');
            if (popupScreen && popupScreen.offsetWidth > 0) {
                scale = popupScreen.offsetWidth / baseWidth;
                console.log(`[EQ] 팝업 스케일: ${popupScreen.offsetWidth} / ${baseWidth} = ${scale}`);
            }
        }

        // EQ 컨테이너 크기 (스케일 적용)
        eqLayer.style.width = `${eqTotalWidth * scale}px`;
        eqLayer.style.height = `${eqTotalHeight * scale}px`;

        const barsContainer = eqLayer.querySelector('.tts-eq-bars');
        if (!barsContainer) return;

        // 스타일별 클래스 적용
        barsContainer.className = 'tts-eq-bars';
        if (style) {
            barsContainer.classList.add(`eq-style-${style.replace(/\s+/g, '-')}`);
        }

        // 스케일 적용된 바 크기
        const scaledBarWidth = barWidth * scale;
        const scaledBarGap = barGap * scale;

        // 바 개수 (최대 128개)
        const count = Math.min(barCount, 128);
        let barsHtml = '';

        if (style === '원형') {
            // 원형 스타일 - 한 줄로 점들 배치 (백엔드와 동일)
            const dotSize = Math.max(6, scaledBarWidth * 0.8) * scale;
            const dotGap = scaledBarGap;
            for (let i = 0; i < count; i++) {
                const intensity = 0.3 + Math.random() * 0.7;
                const size = dotSize * intensity;
                barsHtml += `<div class="eq-bar dot" style="width: ${size}px; height: ${size}px; margin-right: ${dotGap}px; background: radial-gradient(circle, ${color2}, ${color1}); border-radius: 50%;"></div>`;
            }
        } else if (style === '미러막대형') {
            // 미러 막대형 (위아래 대칭)
            for (let i = 0; i < count; i++) {
                const barHeight = 30 + Math.random() * 40;
                barsHtml += `<div class="eq-bar mirror" style="--bar-height: ${barHeight}%; width: ${scaledBarWidth}px; background: linear-gradient(to top, ${color1}, ${color2});"></div>`;
            }
        } else if (style === '파형') {
            // 파형 스타일 - 사인파 형태의 막대 (백엔드와 동일)
            for (let i = 0; i < count; i++) {
                const wave = Math.sin(i * 0.3) * 0.3;  // 기본 파형
                const barHeight = 30 + (wave + 0.5) * 40 + Math.random() * 20;
                barsHtml += `<div class="eq-bar" style="height: ${barHeight}%; width: ${scaledBarWidth}px; margin-right: ${scaledBarGap}px; background: linear-gradient(to top, ${color1}, ${color2}); border-radius: 2px;"></div>`;
            }
        } else {
            // 기본 막대형
            for (let i = 0; i < count; i++) {
                const barHeight = 30 + Math.random() * 60;
                barsHtml += `<div class="eq-bar" style="height: ${barHeight}%; width: ${scaledBarWidth}px; margin-right: ${scaledBarGap}px; background: linear-gradient(to top, ${color1}, ${color2});"></div>`;
            }
        }

        barsContainer.innerHTML = barsHtml;
    });
}

// EQ 바 갯수 변경
function designSetEQBarCount(count) {
    designEQSettings.barCount = parseInt(count) || 60;
    designUpdateEQPreview();
}

// EQ 바 갯수 변경 (최대값 제한)
function designClampAndSetBarCount(input) {
    let value = parseInt(input.value) || 60;
    if (value > 128) {
        value = 128;
        input.value = 128;
    } else if (value < 4) {
        value = 4;
        input.value = 4;
    }
    designSetEQBarCount(value);
}

// EQ 높이 변경 (바 세로 최대 높이)
function designSetEQHeight(height) {
    designEQSettings.height = parseInt(height) || 10;
    designUpdateEQPreview();
}

// EQ 바 가로 변경
function designSetEQBarWidth(width) {
    designEQSettings.barWidth = parseInt(width) || 20;
    designUpdateEQPreview();
}

// EQ 바 간격 변경
function designSetEQBarGap(gap) {
    designEQSettings.barGap = parseInt(gap) || 3;
    designUpdateEQPreview();
}

// ========== 출력 및 제작 ==========

// 배경 이미지 선택
async function designSelectBackground() {
    try {
        const path = await eel.studio_select_single_image()();
        if (path) {
            await designLoadBackgroundImage(path);
        }
    } catch (error) {
        console.error('[Design] 배경 이미지 선택 오류:', error);
    }
}

// 배경 이미지 자동 감지 (대본과 같은 폴더/이름의 이미지 파일)
async function designAutoDetectBackgroundImage() {
    if (!designCurrentScriptPath) return;

    try {
        const lastSlash = Math.max(designCurrentScriptPath.lastIndexOf('/'), designCurrentScriptPath.lastIndexOf('\\'));
        const scriptDir = lastSlash > 0 ? designCurrentScriptPath.substring(0, lastSlash) : '';
        const scriptFileName = designCurrentScriptPath.substring(lastSlash + 1);
        const scriptBaseName = scriptFileName.replace(/\.[^/.]+$/, '');
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'];

        for (const ext of imageExtensions) {
            const separator = scriptDir.includes('/') ? '/' : '\\';
            const imagePath = scriptDir + separator + scriptBaseName + ext;

            // 파일 존재 여부 확인
            const checkResult = await eel.check_file_exists(imagePath)();
            if (checkResult && checkResult.exists) {
                console.log('[Design] 배경 이미지 자동 감지:', imagePath);
                await designLoadBackgroundImage(imagePath);
                break;
            }
        }
    } catch (e) {
        console.error('[Design] 배경 이미지 자동 감지 실패:', e);
    }
}

// 배경 이미지 로드 (선택 또는 자동 감지 시 공통 사용)
async function designLoadBackgroundImage(path) {
    try {
        const fileNameEl = document.getElementById('design-bg-name');
        if (fileNameEl) {
            const fileName = path.split(/[/\\]/).pop();
            fileNameEl.textContent = fileName;
        }

        // 이미지를 base64로 변환하여 표시
        const result = await eel.studio_get_image_base64(path)();
        if (result && result.success) {
            // 이미지 실제 비율 계산을 위해 Image 객체 사용
            const tempImg = new Image();
            tempImg.onload = function() {
                // 실제 이미지 비율 저장
                designOutputSettings.imageWidth = tempImg.naturalWidth;
                designOutputSettings.imageHeight = tempImg.naturalHeight;
                designOutputSettings.imageAspectRatio = tempImg.naturalWidth / tempImg.naturalHeight;

                // 미리보기 화면 비율 업데이트
                designUpdatePreviewAspectRatio();

                console.log(`[Design] 배경 이미지 크기: ${tempImg.naturalWidth}x${tempImg.naturalHeight}, 비율: ${designOutputSettings.imageAspectRatio.toFixed(3)}`);
            };
            tempImg.src = result.data_url;

            // 메인 미리보기에 반영
            const bgLayer = document.querySelector('#tab-studio-tts-design .tts-preview-screen .tts-layer-bg');
            if (bgLayer) {
                const img = bgLayer.querySelector('img');
                const placeholder = bgLayer.querySelector('.tts-bg-placeholder');
                if (img) {
                    img.src = result.data_url;
                    img.style.display = 'block';
                }
                if (placeholder) {
                    placeholder.style.display = 'none';
                }
            }

            // 팝업 미리보기에도 반영
            const popup = document.getElementById('design-preview-popup');
            if (popup && popup.style.display !== 'none') {
                const popupBgImg = popup.querySelector('.tts-layer-bg img');
                if (popupBgImg) {
                    popupBgImg.src = result.data_url;
                    popupBgImg.style.display = 'block';
                }
            }

            // 저장
            designOutputSettings.backgroundDataUrl = result.data_url;
        }

        designOutputSettings.backgroundPath = path;
    } catch (error) {
        console.error('[Design] 배경 이미지 로드 오류:', error);
    }
}

// 출력 폴더 선택
async function designSelectOutputFolder() {
    try {
        const path = await eel.studio_select_folder()();
        if (path) {
            const fileNameEl = document.getElementById('design-output-name');
            if (fileNameEl) {
                const folderName = path.split(/[/\\]/).pop();
                fileNameEl.textContent = folderName;
            }
            designOutputSettings.outputFolder = path;
            console.log('[Design] 출력 폴더 설정:', path);
        }
    } catch (error) {
        console.error('[Design] 출력 폴더 선택 오류:', error);
    }
}

// 미리보기 화면 비율 업데이트 (배경 이미지 비율에 맞춤)
function designUpdatePreviewAspectRatio() {
    const ratio = designOutputSettings.imageAspectRatio;
    if (!ratio) return;

    // 메인 미리보기 화면
    const mainScreen = document.querySelector('#tab-studio-tts-design .tts-preview-screen');
    if (mainScreen) {
        mainScreen.style.aspectRatio = ratio.toString();
    }

    // 팝업 미리보기 화면
    const popupScreen = document.querySelector('#design-preview-popup .design-popup-screen');
    if (popupScreen) {
        popupScreen.style.aspectRatio = ratio.toString();
    }
}

// 타임코드 동기화 (Whisper 기반)
async function designSyncTimecode() {
    if (designAnalyzedClips.length === 0) {
        alert('대본을 먼저 분석해주세요.');
        return;
    }

    // 출력 폴더 결정
    let outputFolder = designOutputSettings.outputFolder;
    let scriptBaseName = null;

    if (designCurrentScriptPath) {
        // 대본 파일이 있으면 해당 폴더 사용
        const pathParts = designCurrentScriptPath.replace(/\\/g, '/').split('/');
        outputFolder = pathParts.slice(0, -1).join('/');
        const fileName = pathParts[pathParts.length - 1];
        scriptBaseName = fileName.replace(/\.[^/.]+$/, '');
    }

    if (!outputFolder) {
        alert('출력 폴더를 먼저 설정해주세요.');
        return;
    }

    // 진행 상태 표시
    const progressSection = document.querySelector('.tts-progress-section');
    const progressHeader = document.querySelector('.tts-progress-header span:first-child');
    const progressPercent = document.querySelector('.tts-progress-header span:last-child');
    const progressFill = document.querySelector('.tts-progress-fill');

    if (progressSection) {
        progressSection.style.display = 'block';
        progressHeader.textContent = 'TTS 생성 및 타임코드 동기화 중...';
        progressPercent.textContent = '0%';
        progressFill.style.width = '0%';
    }

    try {
        // 모든 캐릭터의 현재 음성 설정 저장
        designGetAllCharacterVoiceSettings();

        // 클립 데이터 준비 (음성 설정 포함)
        const clipsData = designAnalyzedClips.map((clip, idx) => {
            const voiceSettings = studioCharacterVoiceSettings[clip.character] || {};
            return {
                index: idx,
                text: clip.text,
                character: clip.character,
                voice: voiceSettings.voice || 'ko-KR-Standard-A',
                rate: voiceSettings.rate || 1.0,
                pitch: voiceSettings.pitch || 0
            };
        });

        console.log('[Design] 타임코드 동기화 시작:', clipsData.length, '개 클립');

        if (progressHeader) {
            progressHeader.textContent = 'TTS 생성 중...';
            progressPercent.textContent = '30%';
            progressFill.style.width = '30%';
        }

        // 백엔드 호출
        const result = await eel.studio_sync_timecode_with_whisper(clipsData, outputFolder, scriptBaseName)();

        if (result.success) {
            console.log('[Design] 타임코드 동기화 완료:', result);
            console.log('[Design] 동기화된 클립들:', result.clips);

            if (progressHeader) {
                progressHeader.textContent = '타임코드 적용 중...';
                progressPercent.textContent = '90%';
                progressFill.style.width = '90%';
            }

            // 클립에 타임코드 적용
            result.clips.forEach(syncedClip => {
                const idx = syncedClip.index;
                console.log(`[Design] 클립 ${idx} 타임코드: ${syncedClip.start} ~ ${syncedClip.end}`);

                if (idx < designAnalyzedClips.length) {
                    designAnalyzedClips[idx].start = syncedClip.start;
                    designAnalyzedClips[idx].end = syncedClip.end;
                    designAnalyzedClips[idx].duration = syncedClip.duration;

                    // designSubtitles도 함께 업데이트 (강제 초기화 후 설정)
                    designSubtitles[idx] = {
                        start: syncedClip.start,
                        end: syncedClip.end,
                        text: designAnalyzedClips[idx].text,
                        character: designAnalyzedClips[idx].character
                    };
                    console.log(`[Design] designSubtitles[${idx}] 업데이트:`, designSubtitles[idx]);
                }
            });

            // MP3 경로 저장 (나중에 제작 시 사용)
            designSyncedMp3Path = result.mp3_path;

            // SRT 파일 자동 생성 (영상 제작과 동일한 경로)
            let srtOutputFolder = outputFolder;
            let srtBaseName = scriptBaseName;

            // 대본 파일 경로 기반으로 설정 (영상 제작과 동일)
            if (designCurrentScriptPath) {
                const pathParts = designCurrentScriptPath.replace(/\\/g, '/').split('/');
                srtOutputFolder = pathParts.slice(0, -1).join('/');
                const fileName = pathParts[pathParts.length - 1];
                srtBaseName = fileName.replace(/\.[^/.]+$/, '');
            }

            await designGenerateSRT(srtOutputFolder, srtBaseName);

            // 자막 목록 UI 업데이트
            console.log('[Design] UI 업데이트 전 designSubtitles:', designSubtitles);
            designRenderSentenceList();
            console.log('[Design] UI 업데이트 완료');

            if (progressHeader) {
                progressHeader.textContent = '타임코드 동기화 완료!';
                progressPercent.textContent = '100%';
                progressFill.style.width = '100%';
            }

            alert(`타임코드 동기화 완료!\n\n` +
                  `- 총 ${result.clip_count}개 클립\n` +
                  `- 전체 길이: ${result.total_duration.toFixed(1)}초\n` +
                  `- MP3 저장: ${result.mp3_path}`);

            // 3초 후 진행 상태 숨기기
            setTimeout(() => {
                if (progressSection) progressSection.style.display = 'none';
            }, 3000);

        } else {
            throw new Error(result.error || '타임코드 동기화 실패');
        }

    } catch (error) {
        console.error('[Design] 타임코드 동기화 오류:', error);
        alert('타임코드 동기화 오류: ' + error);

        if (progressSection) {
            progressHeader.textContent = '오류 발생';
            progressSection.style.display = 'none';
        }
    }
}

// SRT 파일 생성
async function designGenerateSRT(outputFolder, scriptBaseName) {
    if (designSubtitles.length === 0) {
        console.log('[Design] SRT 생성 스킵: 자막 없음');
        return;
    }

    // SRT 형식으로 변환
    let srtContent = '';
    designSubtitles.forEach((subtitle, idx) => {
        if (!subtitle || !subtitle.text) return;

        const startTime = designFormatSRTTime(subtitle.start || 0);
        const endTime = designFormatSRTTime(subtitle.end || 0);

        srtContent += `${idx + 1}\n`;
        srtContent += `${startTime} --> ${endTime}\n`;
        srtContent += `${subtitle.text}\n\n`;
    });

    if (!srtContent.trim()) {
        console.log('[Design] SRT 생성 스킵: 내용 없음');
        return;
    }

    // 파일명: 완성_대본파일명.srt (영상 제작과 동일)
    const srtFileName = scriptBaseName ? `완성_${scriptBaseName}.srt` : 'subtitles.srt';

    try {
        const result = await eel.studio_save_srt_file(outputFolder, srtFileName, srtContent)();
        if (result.success) {
            console.log('[Design] SRT 파일 생성 완료:', result.path);
        } else {
            console.error('[Design] SRT 파일 생성 실패:', result.error);
        }
    } catch (error) {
        console.error('[Design] SRT 파일 생성 오류:', error);
    }
}

// SRT 시간 포맷 (00:00:00,000)
function designFormatSRTTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);

    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

// 동기화된 MP3 경로 저장
let designSyncedMp3Path = null;

// 제작 시 자동 타임코드 동기화 (alert 없이 진행)
async function designSyncTimecodeForProduction() {
    // 출력 폴더 결정
    let outputFolder = designOutputSettings.outputFolder;
    let scriptBaseName = null;

    if (designCurrentScriptPath) {
        const pathParts = designCurrentScriptPath.replace(/\\/g, '/').split('/');
        outputFolder = pathParts.slice(0, -1).join('/');
        const fileName = pathParts[pathParts.length - 1];
        scriptBaseName = fileName.replace(/\.[^/.]+$/, '');
    }

    if (!outputFolder) {
        outputFolder = await eel.studio_select_folder()();
        if (!outputFolder) {
            alert('출력 폴더를 선택해주세요.');
            return false;
        }
        designOutputSettings.outputFolder = outputFolder;
    }

    // 진행 상태 표시
    designShowProgress();
    designUpdateProgress(0, 'TTS 생성 및 타임코드 동기화 중...');
    designStartElapsedTimer();

    try {
        // 모든 캐릭터의 현재 음성 설정 저장
        designGetAllCharacterVoiceSettings();

        // 클립 데이터 준비
        const clipsData = designAnalyzedClips.map((clip, idx) => {
            const voiceSettings = studioCharacterVoiceSettings[clip.character] || {};
            return {
                index: idx,
                text: clip.text,
                character: clip.character,
                voice: voiceSettings.voice || 'ko-KR-Standard-A',
                rate: voiceSettings.rate || 1.0,
                pitch: voiceSettings.pitch || 0
            };
        });

        console.log('[Design] 제작용 타임코드 동기화 시작:', clipsData.length, '개 클립');
        designUpdateProgress(10, 'TTS 음성 생성 중...');

        // 백엔드 호출
        const result = await eel.studio_sync_timecode_with_whisper(clipsData, outputFolder, scriptBaseName)();

        if (result.success) {
            console.log('[Design] 제작용 타임코드 동기화 완료:', result);
            designUpdateProgress(30, 'Whisper 분석 완료, 타임코드 적용 중...');

            // 클립에 타임코드 적용
            result.clips.forEach(syncedClip => {
                const idx = syncedClip.index;
                if (idx < designAnalyzedClips.length) {
                    designAnalyzedClips[idx].start = syncedClip.start;
                    designAnalyzedClips[idx].end = syncedClip.end;
                    designAnalyzedClips[idx].duration = syncedClip.duration;

                    designSubtitles[idx] = {
                        start: syncedClip.start,
                        end: syncedClip.end,
                        text: designAnalyzedClips[idx].text,
                        character: designAnalyzedClips[idx].character
                    };
                }
            });

            // MP3 경로 저장
            designSyncedMp3Path = result.mp3_path;

            // UI 업데이트
            designRenderSentenceList();

            console.log('[Design] 타임코드 동기화 완료 - 영상 제작 계속');
            return true;
        } else {
            throw new Error(result.error || '타임코드 동기화 실패');
        }

    } catch (error) {
        console.error('[Design] 제작용 타임코드 동기화 오류:', error);
        alert('타임코드 동기화 오류: ' + error);
        designStopElapsedTimer();
        designHideProgress();
        return false;
    }
}

// 영상 제작 시작
async function designStartProduction() {
    if (designAnalyzedClips.length === 0) {
        alert('대본을 먼저 분석해주세요.');
        return;
    }

    // 출력 옵션 먼저 확인 (공통 함수 사용)
    const outputOptions = getOutputOptions(false); // false = 영상탭

    // 출력 옵션 검증
    if (!validateOutputOptions(outputOptions)) {
        return;
    }

    // 배경 이미지 체크 (영상 또는 투명EQ 제작 시에만 필요)
    let backgroundImagePath = designOutputSettings.backgroundPath || '';
    const needsBackground = outputOptions.video || outputOptions.transparentEQ;

    if (needsBackground) {
        // 배경 이미지가 없고 대본 파일이 있으면 자동 감지 시도
        if (!backgroundImagePath && designCurrentScriptPath) {
            try {
                const lastSlash = Math.max(designCurrentScriptPath.lastIndexOf('/'), designCurrentScriptPath.lastIndexOf('\\'));
                const scriptDir = lastSlash > 0 ? designCurrentScriptPath.substring(0, lastSlash) : '';
                const scriptFileName = designCurrentScriptPath.substring(lastSlash + 1);
                const scriptBaseName = scriptFileName.replace(/\.[^/.]+$/, '');
                const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'];

                for (const ext of imageExtensions) {
                    const separator = scriptDir.includes('/') ? '/' : '\\';
                    const imagePath = scriptDir + separator + scriptBaseName + ext;

                    // 파일 존재 여부 확인
                    const checkResult = await eel.check_file_exists(imagePath)();
                    if (checkResult && checkResult.exists) {
                        backgroundImagePath = imagePath;
                        console.log('[Design] 배경 이미지 자동 감지:', imagePath);
                        break;
                    }
                }
            } catch (e) {
                console.error('[Design] 배경 이미지 자동 감지 실패:', e);
            }
        }

        // 배경 이미지가 필요한데 없으면 진행 중단
        if (!backgroundImagePath) {
            alert('배경 이미지가 첨부되지 않았습니다.\n\n📷 배경 버튼을 클릭하여 이미지를 선택하거나,\n대본 파일과 같은 폴더에 같은 이름의 이미지 파일을 배치해주세요.');
            return;
        }
    }

    // 타임코드가 없으면 자동으로 Whisper 동기화 수행 (SRT 파일 생성을 위해 필수)
    const hasTimecode = designSubtitles.some(sub => sub.start !== null && sub.end !== null);
    if (!hasTimecode) {
        console.log('[Design] 타임코드 없음 - 자동 동기화 시작');
        const syncResult = await designSyncTimecodeForProduction();
        if (!syncResult) {
            return;  // 동기화 실패 시 제작 중단
        }
    }

    // 출력 폴더 및 파일명 결정
    let outputPath = designOutputSettings.outputFolder;
    let outputFileName = 'design_output';

    // 대본 파일이 첨부된 경우: 대본 폴더 사용 + "완성_파일명" 형태
    if (designCurrentScriptPath) {
        const lastSlash = Math.max(designCurrentScriptPath.lastIndexOf('/'), designCurrentScriptPath.lastIndexOf('\\'));
        const scriptFolder = lastSlash > 0 ? designCurrentScriptPath.substring(0, lastSlash) : '';
        const scriptFileName = designCurrentScriptPath.substring(lastSlash + 1);
        const scriptBaseName = scriptFileName.replace(/\.[^/.]+$/, '');  // 확장자 제거

        if (scriptFolder) {
            outputPath = scriptFolder;
        }
        outputFileName = '영상_' + scriptBaseName;

        console.log('[Design] 대본 파일 기반 출력:', outputPath, outputFileName);
    }

    // 대본 파일이 없으면 폴더 선택 필수
    if (!outputPath) {
        outputPath = await eel.studio_select_folder()();
        if (!outputPath) {
            alert('출력 폴더를 선택해주세요.');
            return;
        }
        designOutputSettings.outputFolder = outputPath;

        // UI 업데이트
        const fileNameEl = document.querySelector('#design-output-folder .file-name');
        if (fileNameEl) {
            const folderName = outputPath.split(/[/\\]/).pop();
            fileNameEl.textContent = folderName;
        }
    }


    // 해상도 가져오기
    const resolutionSelect = document.getElementById('design-resolution');
    const resolution = resolutionSelect ? resolutionSelect.value : '1920x1080';

    // 캐릭터별 음성 설정 저장 (UI에서 최신 값 수집)
    const characters = [...new Set(designAnalyzedClips.map(c => c.character))];
    characters.forEach(char => {
        designSaveCharacterVoiceSettings(char);
    });

    // clips 데이터 생성 (캐릭터별 음성 설정 포함)
    const clips = designAnalyzedClips.map((clip, idx) => {
        const voiceSetting = studioCharacterVoiceSettings[clip.character] || {
            voice: 'ko-KR-Standard-A',
            rate: 1.0,
            pitch: 0
        };
        return {
            index: idx + 1,
            character: clip.character,
            text: clip.text,
            voice: voiceSetting.voice,
            rate: voiceSetting.rate || 1.0,
            pitch: voiceSetting.pitch || 0
        };
    });

    // EQ 설정 수집
    const [resW, resH] = resolution.split('x').map(Number);
    const barWidth = designEQSettings.barWidth || 2;   // 바 1개 가로 (px)
    const barGap = designEQSettings.barGap || 1;       // 바 간격 (px)
    const barCount = designEQSettings.barCount || 60;  // 바 갯수
    const eqTotalWidth = (barWidth + barGap) * barCount;  // EQ 전체 가로 = (2+1) * 바갯수
    const eqHeight = designEQSettings.height || 100;      // 바 세로 최대 높이 (px)

    // 색상을 UI 요소에서 직접 가져오기 (동기화 문제 방지)
    const eqColor1El = document.getElementById('popup-eq-color1');
    const eqColor2El = document.getElementById('popup-eq-color2');
    const eqColor1 = eqColor1El ? eqColor1El.value : (designEQSettings.color1 || '#667eea');
    const eqColor2 = eqColor2El ? eqColor2El.value : (designEQSettings.color2 || '#764ba2');

    const eqSettings = {
        enabled: designEQSettings.enabled,
        style: designEQSettings.style || '막대형',
        x: Math.round((designEQSettings.x / 100) * resW),  // 퍼센트를 픽셀로 변환
        y: Math.round((designEQSettings.y / 100) * resH),
        width: eqTotalWidth,      // EQ 전체 가로 (px)
        height: eqHeight,         // 바 세로 최대 높이 (px)
        barWidth: barWidth,       // 바 1개 가로 (px)
        barGap: barGap,           // 바 간격 (px)
        barCount: barCount,       // 바 갯수
        brightness: 100,
        fps: 20,
        resolution: resolution,
        color1: eqColor1,
        color2: eqColor2
    };

    // 자막 설정 수집
    // 영상 출력 시 자막제거 옵션이 체크되어 있으면 자막 비활성화
    const subtitleSettings = {
        enabled: designSubtitleVisible && !designOutputSettings.noSubtitle,
        font: designSubtitleSettings.font || 'Noto Sans KR',
        size: designSubtitleSettings.size || 24,
        color: designSubtitleSettings.color || '#ffffff',
        bgColor: designSubtitleSettings.bgColor || '#000000',
        bgOpacity: designSubtitleSettings.bgOpacity || 70,
        bgNone: designSubtitleSettings.bgNone || false,
        x: designSubtitlePosition.x || 50,
        y: designSubtitlePosition.y || 90
    };

    // 대본 텍스트 생성
    const scriptText = designAnalyzedClips.map(c => `${c.character}: ${c.text}`).join('\n');

    // 작업 데이터 (인코더는 자동 선택)
    const jobData = {
        profile: '',  // TTS Quota Manager 자동 사용
        script: scriptText,
        scriptPath: designCurrentScriptPath || '',
        imagePath: backgroundImagePath,
        clips: clips,
        fileName: outputFileName,
        eqSettings: eqSettings,
        subtitleSettings: subtitleSettings,
        encoder: 'auto',           // 자동으로 최적 인코더 선택
        encodingPreset: 'ultrafast' // CPU 인코더 사용 시 빠른 속도
    };

    console.log('[Design] 제작 시작:', jobData);
    console.log('[Design] EQ 설정:', eqSettings);
    console.log('[Design] EQ 스타일:', eqSettings.style);
    console.log('[Design] EQ 색상:', eqSettings.color1, eqSettings.color2);

    // 진행 상태 표시
    designShowProgress();
    designUpdateProgress(0, '제작 준비 중...');
    designStartElapsedTimer();

    // 버튼 상태 변경
    const startBtn = document.querySelector('#tab-studio-tts-design .tts-btn-large.primary');
    const previewBtn = document.querySelector('#tab-studio-tts-design .tts-btn-large.secondary');
    if (startBtn) startBtn.disabled = true;
    if (previewBtn) previewBtn.disabled = true;

    // 대본 파일명 추출 (MP3, EQ 파일명에 사용)
    let scriptBaseName = 'output';
    if (designCurrentScriptPath) {
        const lastSlash = Math.max(designCurrentScriptPath.lastIndexOf('/'), designCurrentScriptPath.lastIndexOf('\\'));
        const scriptFileName = designCurrentScriptPath.substring(lastSlash + 1);
        scriptBaseName = scriptFileName.replace(/\.[^/.]+$/, '');
    }

    try {
        // 영상 제작 (MP4)
        if (outputOptions.video) {
            designUpdateProgress(5, 'TTS 음성 생성 중...');

            const result = await eel.studio_start_production(jobData, outputPath)();

            if (!result.success) {
                throw new Error(result.error || '영상 제작 실패');
            }
            // 성공 시 콜백(designProductionComplete)에서 처리
        }

        // 투명EQ (MOV) 생성
        if (outputOptions.transparentEQ) {
            designUpdateProgress(outputOptions.video ? 50 : 5, '투명 EQ 영상 생성 중...');

            const eqFileName = 'EQ_' + scriptBaseName;
            const eqJobData = {
                ...jobData,
                fileName: eqFileName,
                transparentEQ: true  // 투명 EQ만 생성 플래그
            };

            const eqResult = await eel.studio_create_transparent_eq(eqJobData, outputPath)();

            if (eqResult.success) {
                console.log('[Design] 투명 EQ 생성 완료:', eqResult.path);
            } else {
                console.error('[Design] 투명 EQ 생성 실패:', eqResult.error);
            }
        }

        // MP3 생성 (영상 없이 MP3만 선택하거나, 영상과 함께 선택한 경우 모두)
        if (outputOptions.mp3) {
            designUpdateProgress(outputOptions.video ? 80 : 10, 'MP3 생성 중...');

            const mp3FileName = 'MP3_' + scriptBaseName;
            const result = await eel.studio_generate_tts_and_merge(clips, outputPath, mp3FileName)();

            if (result.success) {
                console.log('[Design] MP3 생성 완료:', result.filename);
            } else {
                throw new Error(result.error || 'MP3 생성 실패');
            }
        }

        // SRT 자막 생성 (MP3만 프론트에서 생성, 영상/투명EQ는 백엔드에서 자동 생성)
        if (outputOptions.mp3) {
            designUpdateProgress(90, '자막 파일 생성 중...');

            let srtContent = '';
            designSubtitles.forEach((sub, idx) => {
                srtContent += `${idx + 1}\n`;
                srtContent += `${designFormatTime(sub.start)} --> ${designFormatTime(sub.end)}\n`;
                srtContent += `${sub.text}\n\n`;
            });

            // MP3용 SRT 파일 생성 (영상/투명EQ는 백엔드에서 자동 생성함)
            const srtFileName = 'MP3_' + scriptBaseName + '.srt';
            const srtResult = await eel.studio_save_srt_file(outputPath, srtFileName, srtContent)();
            if (srtResult.success) {
                console.log('[Design] MP3 SRT 저장 완료:', srtResult.path);
            }
        }

        // 영상 없이 MP3/투명EQ만 선택했을 때 완료 처리
        if (!outputOptions.video && (outputOptions.mp3 || outputOptions.transparentEQ)) {
            designUpdateProgress(100, '완료!');
            let message = '생성이 완료되었습니다.\n\n생성된 파일:';
            if (outputOptions.mp3) {
                message += '\n- MP3_' + scriptBaseName + '.mp3';
                message += '\n- MP3_' + scriptBaseName + '.srt';
            }
            if (outputOptions.transparentEQ) {
                message += '\n- EQ_' + scriptBaseName + '.mov';
                message += '\n- EQ_' + scriptBaseName + '.srt';
            }
            alert(message);
            designStopElapsedTimer();
            designHideProgress();

            if (startBtn) startBtn.disabled = false;
            if (previewBtn) previewBtn.disabled = false;

            await eel.studio_open_folder(outputPath)();
        }

    } catch (error) {
        console.error('[Design] 제작 오류:', error);
        alert('제작 중 오류가 발생했습니다: ' + error.message);
        designStopElapsedTimer();
        designHideProgress();

        if (startBtn) startBtn.disabled = false;
        if (previewBtn) previewBtn.disabled = false;
    }
}

// 제작 완료 콜백 (Python에서 호출)
// 디자인 탭용 제작 완료 핸들러 (studioProductionComplete에서 호출됨)
function designProductionCompleteHandler(result) {
    console.log('[Design] 제작 완료:', result);

    designStopElapsedTimer();

    const startBtn = document.querySelector('#tab-studio-tts-design .tts-btn-large.primary');
    const previewBtn = document.querySelector('#tab-studio-tts-design .tts-btn-large.secondary');
    if (startBtn) startBtn.disabled = false;
    if (previewBtn) previewBtn.disabled = false;

    if (result.success) {
        designUpdateProgress(100, '완료!');

        // 파일명 추출
        let scriptBaseName = 'output';
        if (designCurrentScriptPath) {
            const lastSlash = Math.max(designCurrentScriptPath.lastIndexOf('/'), designCurrentScriptPath.lastIndexOf('\\'));
            const scriptFileName = designCurrentScriptPath.substring(lastSlash + 1);
            scriptBaseName = scriptFileName.replace(/\.[^/.]+$/, '');
        }

        alert(`제작이 완료되었습니다!\n저장 위치: ${result.output_path || designOutputSettings.outputFolder}\n\n생성된 파일:\n- 영상_${scriptBaseName}.mp4\n- 영상_${scriptBaseName}.srt`);

        // 폴더 열기
        if (result.output_path || designOutputSettings.outputFolder) {
            eel.studio_open_folder(result.output_path || designOutputSettings.outputFolder)();
        }
    } else {
        designUpdateProgress(0, '실패');
        alert('제작 실패: ' + (result.error || '알 수 없는 오류'));
    }

    setTimeout(() => designHideProgress(), 2000);
}

// 진행 상태 표시/숨기기
function designShowProgress() {
    const progressSection = document.querySelector('#tab-studio-tts-design .tts-progress-section');
    if (progressSection) {
        progressSection.style.display = 'block';
    }
}

function designHideProgress() {
    const progressSection = document.querySelector('#tab-studio-tts-design .tts-progress-section');
    if (progressSection) {
        progressSection.style.display = 'none';
    }
}

// 경과 시간 타이머
let designElapsedInterval = null;
let designElapsedSeconds = 0;

function designStartElapsedTimer() {
    // 기존 타이머가 있으면 먼저 정리 (중복 실행 방지)
    if (designElapsedInterval) {
        clearInterval(designElapsedInterval);
        designElapsedInterval = null;
    }

    designElapsedSeconds = 0;
    designElapsedInterval = setInterval(() => {
        designElapsedSeconds++;
        const elapsed = designFormatElapsedTime(designElapsedSeconds);

        const timeEl = document.querySelector('#tab-studio-tts-design .tts-progress-time');
        if (timeEl) {
            timeEl.textContent = `경과 시간: ${elapsed}`;
        }
    }, 1000);
}

function designStopElapsedTimer() {
    if (designElapsedInterval) {
        clearInterval(designElapsedInterval);
        designElapsedInterval = null;
    }
}

function designFormatElapsedTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}


// 진행 상태 업데이트
function designUpdateProgress(percent, label) {
    const progressBar = document.querySelector('#tab-studio-tts-design .tts-progress-fill');
    const progressHeader = document.querySelector('#tab-studio-tts-design .tts-progress-header');

    if (progressBar) {
        progressBar.style.width = percent + '%';
    }
    if (progressHeader) {
        progressHeader.innerHTML = `<span>${label}</span><span>${Math.round(percent)}%</span>`;
    }
}

// 디자인안 탭 초기화 호출
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(designInitialize, 500);
});

// ========== 영상 프리셋 관리 기능 ==========

let videoPresets = {}; // 저장된 영상 프리셋들
let currentEditingPresetName = null; // 현재 편집 중인 프리셋 이름

// 영상 프리셋 목록 로드
async function loadVideoPresets() {
    try {
        const result = await eel.load_video_presets()();
        if (result && result.success) {
            videoPresets = result.presets || {};
            updateVideoPresetDropdown();
            console.log('[VideoPreset] 프리셋 로드 완료:', Object.keys(videoPresets));
        }
    } catch (error) {
        console.error('[VideoPreset] 프리셋 로드 오류:', error);
    }
}

// 영상 프리셋 드롭다운 업데이트
function updateVideoPresetDropdown() {
    const select = document.getElementById('design-video-preset');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '<option value="">-- 프리셋 선택 --</option>';

    Object.keys(videoPresets).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });

    if (currentValue && videoPresets[currentValue]) {
        select.value = currentValue;
    }
}

// 영상 프리셋 선택 시 (더 이상 사용 안함 - 고정 프리셋 사용)
function designOnVideoPresetChange() {
    // 고정 프리셋 사용으로 이 함수는 더 이상 필요 없음
    console.log('[VideoPreset] 고정 프리셋 사용 중');
}

// 새 영상 프리셋 만들기
async function designCreateVideoPreset() {
    currentEditingPresetName = null;
    document.getElementById('design-preset-popup-title').textContent = '🎬 새 영상 프리셋 만들기';
    const presetNameInput = document.getElementById('preset-name');
    if (presetNameInput) presetNameInput.value = '';

    // API 키 목록 로드
    await loadPresetApiKeys();

    // 현재 설정으로 팝업 초기화
    populatePresetPopupWithCurrentSettings();

    document.getElementById('design-preset-popup').style.display = 'flex';
}

// 영상 프리셋 수정
async function designEditVideoPreset() {
    const select = document.getElementById('design-video-preset');
    const presetName = select.value;

    if (!presetName) {
        alert('수정할 프리셋을 먼저 선택하세요.');
        return;
    }

    currentEditingPresetName = presetName;
    document.getElementById('design-preset-popup-title').textContent = '✏️ 프리셋 수정: ' + presetName;
    const presetNameInput = document.getElementById('preset-name');
    if (presetNameInput) presetNameInput.value = presetName;

    // API 키 목록 로드
    await loadPresetApiKeys();

    // 선택된 프리셋 설정으로 팝업 채우기
    const preset = videoPresets[presetName];
    populatePresetPopupWithSettings(preset);

    document.getElementById('design-preset-popup').style.display = 'flex';
}

// 현재 설정을 프리셋으로 저장
function designSaveCurrentAsPreset() {
    const presetName = prompt('프리셋 이름을 입력하세요:');
    if (!presetName || !presetName.trim()) return;

    const preset = getCurrentSettingsAsPreset();
    saveVideoPreset(presetName.trim(), preset);
}

// 선택된 캐릭터 추적
let designSelectedCharacter = null;

// 캐릭터 카드 선택
function designSelectCharacter(char, event) {
    // 드롭다운이나 버튼 클릭은 무시
    if (event && (event.target.tagName === 'SELECT' || event.target.tagName === 'BUTTON' || event.target.tagName === 'INPUT')) {
        return;
    }

    // 현재 탭의 컨테이너에서만 검색
    const isBatchTab = isCurrentlyBatchTab();
    const parentContainer = isBatchTab
        ? document.getElementById('batch-voice-settings-container')
        : document.getElementById('design-voice-settings-container');

    if (!parentContainer) return;

    // 이전 선택 제거 (현재 탭 내에서만)
    const cards = parentContainer.querySelectorAll('.studio-voice-setting');
    cards.forEach(card => card.classList.remove('selected'));

    // 현재 카드 선택 (현재 탭 내에서만)
    const card = parentContainer.querySelector(`.studio-voice-setting[data-character="${char}"]`);
    if (card) {
        if (designSelectedCharacter === char) {
            // 이미 선택된 경우 선택 해제
            designSelectedCharacter = null;
        } else {
            card.classList.add('selected');
            designSelectedCharacter = char;
        }
    }

    console.log('[Design] 선택된 캐릭터:', designSelectedCharacter);
}

// 선택한 캐릭터 삭제
async function designDeleteSelectedCharacter() {
    if (!designSelectedCharacter) {
        alert('삭제할 캐릭터를 먼저 선택해주세요.');
        return;
    }

    if (!confirm(`"${designSelectedCharacter}" 캐릭터를 프리셋에서 삭제하시겠습니까?`)) {
        return;
    }

    const PRESET_NAME = 'character_voices';
    const preset = videoPresets[PRESET_NAME];

    if (!preset || !preset.characters || !preset.characters[designSelectedCharacter]) {
        alert('프리셋에 저장된 캐릭터가 아닙니다.');
        return;
    }

    // 프리셋에서 캐릭터 제거
    delete preset.characters[designSelectedCharacter];

    // 프리셋 저장
    try {
        const result = await eel.save_video_preset(PRESET_NAME, preset)();
        if (result && result.success) {
            videoPresets[PRESET_NAME] = preset;
            console.log('[Design] 캐릭터 삭제:', designSelectedCharacter);
            alert(`"${designSelectedCharacter}" 캐릭터가 삭제되었습니다.`);

            designSelectedCharacter = null;

            // 캐릭터 카드 다시 렌더링
            if (designAnalyzedClips && designAnalyzedClips.length > 0) {
                designExtractCharacters();
            }
        } else {
            alert('삭제 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[Design] 캐릭터 삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

// 캐릭터 음성을 프리셋에 추가 (하나의 고정 프리셋 사용)
async function designAddCharacterToPreset() {
    const PRESET_NAME = 'character_voices';  // 고정 프리셋 이름

    if (!designAnalyzedClips || designAnalyzedClips.length === 0) {
        alert('대본을 먼저 분석해주세요.');
        return;
    }

    // 현재 캐릭터별 음성 설정 수집
    const characters = [...new Set(designAnalyzedClips.map(c => c.character))];

    // 각 캐릭터의 음성 설정 저장
    characters.forEach(char => {
        designSaveCharacterVoiceSettings(char);
    });

    // 기존 프리셋 로드 또는 새로 생성
    let preset = videoPresets[PRESET_NAME];
    if (!preset) {
        preset = {
            apiProfile: '',
            characters: {}
        };
    }

    // 현재 캐릭터 음성 설정을 프리셋에 추가/업데이트
    characters.forEach(char => {
        const settings = studioCharacterVoiceSettings[char];
        if (settings) {
            preset.characters[char] = {
                group: settings.group || 'Wavenet',
                voice: settings.voice || 'ko-KR-Wavenet-A',
                rate: settings.rate || 1.0,
                pitch: settings.pitch || 0
            };
        }
    });

    // 프리셋 저장
    try {
        const result = await eel.save_video_preset(PRESET_NAME, preset)();
        if (result && result.success) {
            videoPresets[PRESET_NAME] = preset;
            console.log('[Design] 캐릭터 음성 프리셋에 추가:', characters);
            alert(`${characters.length}개 캐릭터의 음성 설정이 저장되었습니다.`);

            // 캐릭터 카드 다시 렌더링 (NEW 뱃지 제거)
            designExtractCharacters();
        } else {
            alert('저장 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[Design] 프리셋 저장 오류:', error);
        alert('저장 중 오류가 발생했습니다.');
    }
}

// 영상 프리셋 삭제
async function designDeleteVideoPreset() {
    const select = document.getElementById('design-video-preset');
    const presetName = select.value;

    if (!presetName) {
        alert('삭제할 프리셋을 먼저 선택하세요.');
        return;
    }

    if (!confirm(`"${presetName}" 프리셋을 삭제하시겠습니까?`)) return;

    try {
        const result = await eel.delete_video_preset(presetName)();
        if (result && result.success) {
            delete videoPresets[presetName];
            updateVideoPresetDropdown();
            console.log('[VideoPreset] 프리셋 삭제:', presetName);
        } else {
            alert('프리셋 삭제 실패: ' + (result?.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[VideoPreset] 프리셋 삭제 오류:', error);
        alert('프리셋 삭제 중 오류가 발생했습니다.');
    }
}

// 프리셋 팝업 닫기
function designClosePresetPopup() {
    document.getElementById('design-preset-popup').style.display = 'none';
    currentEditingPresetName = null;
}

// 프리셋 팝업 저장
async function designSavePresetPopup() {
    const nameInput = document.getElementById('preset-name');
    const presetName = nameInput ? nameInput.value.trim() : '';

    if (!presetName) {
        alert('프리셋 이름을 입력하세요.');
        nameInput.focus();
        return;
    }

    const preset = getPresetFromPopup();
    await saveVideoPreset(presetName, preset);
    designClosePresetPopup();
}

// 별칭 함수 (HTML에서 호출하는 이름)
const designSavePresetFromPopup = designSavePresetPopup;

// 현재 설정을 프리셋 객체로 변환
function getCurrentSettingsAsPreset() {
    // 캐릭터별 음성 설정 수집
    const characters = {};
    const clips = designAnalyzedClips || [];
    clips.forEach(clip => {
        if (!characters[clip.character]) {
            characters[clip.character] = {
                voice: clip.voice,
                rate: clip.rate,
                pitch: clip.pitch
            };
        }
    });

    return {
        apiProfile: '',  // API 키는 팝업에서 직접 선택
        characters: characters
    };
}

// 팝업을 현재 설정으로 채우기
function populatePresetPopupWithCurrentSettings() {
    populatePresetPopupWithSettings(getCurrentSettingsAsPreset());
}

// 팝업을 특정 설정으로 채우기
function populatePresetPopupWithSettings(preset) {
    if (!preset) return;

    // API 키 설정
    const apiSelect = document.getElementById('preset-api-key');
    if (apiSelect && preset.apiProfile) {
        apiSelect.value = preset.apiProfile;
        // API 키가 선택되면 사용량 표시
        presetShowAPIUsage();
    }

    // 캐릭터 음성 설정
    const container = document.getElementById('preset-voices-container');
    if (container && preset.characters) {
        container.innerHTML = '';  // 기존 항목 제거

        Object.entries(preset.characters).forEach(([charName, settings]) => {
            designAddPresetVoice(charName, settings.voice, settings.rate, settings.pitch);
        });

        // 캐릭터가 없으면 기본 하나 추가
        if (Object.keys(preset.characters).length === 0) {
            designAddPresetVoice();
        }
    }
}

// 팝업에서 프리셋 데이터 가져오기
function getPresetFromPopup() {
    // 캐릭터 음성 설정 수집
    const characters = {};
    const voiceItems = document.querySelectorAll('.preset-voice-item');
    voiceItems.forEach(item => {
        const charName = item.querySelector('.preset-char-name')?.value.trim();
        const voice = item.querySelector('.preset-voice-select')?.value;
        const rate = parseFloat(item.querySelector('.preset-voice-rate')?.value) || 1.0;
        const pitch = parseInt(item.querySelector('.preset-voice-pitch')?.value) || 0;

        if (charName) {
            characters[charName] = { voice, rate, pitch };
        }
    });

    return {
        apiProfile: document.getElementById('preset-api-key')?.value || '',
        characters: characters
    };
}

// 영상 프리셋 저장
async function saveVideoPreset(name, preset) {
    try {
        const result = await eel.save_video_preset(name, preset)();
        if (result && result.success) {
            videoPresets[name] = preset;
            updateVideoPresetDropdown();
            document.getElementById('design-video-preset').value = name;
            console.log('[VideoPreset] 프리셋 저장 완료:', name);
        } else {
            alert('프리셋 저장 실패: ' + (result?.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[VideoPreset] 프리셋 저장 오류:', error);
        alert('프리셋 저장 중 오류가 발생했습니다.');
    }
}

// 초기화 시 영상 프리셋 로드
setTimeout(loadVideoPresets, 1000);

// API 키 목록 로드
async function loadPresetApiKeys() {
    const apiSelect = document.getElementById('preset-api-key');

    if (!apiSelect) return;

    // 현재 선택된 값 저장
    const currentValue = apiSelect.value;

    try {
        // 백엔드에서 API 키 목록 가져오기
        const result = await eel.studio_get_tts_usage_summary()();

        if (!result.success) {
            console.error('[Preset] API 키 목록 로드 실패:', result.error);
            return;
        }

        const summary = result.summary || [];

        // 드롭다운 초기화
        apiSelect.innerHTML = '<option value="">-- API 키 선택 --</option>';

        // API 키 목록 추가
        summary.forEach((keyInfo) => {
            if (keyInfo.active) {  // 활성화된 키만 표시
                const option = document.createElement('option');
                option.value = keyInfo.key_id;
                option.textContent = keyInfo.name;
                apiSelect.appendChild(option);
            }
        });

        // 이전 선택값 복원 (있으면)
        if (currentValue) {
            apiSelect.value = currentValue;
        }

        console.log('[Preset] API 키 목록 로드 완료:', summary.length + '개');
    } catch (error) {
        console.error('[Preset] API 키 목록 로드 오류:', error);
    }
}

// API 키 선택 시 사용량 표시
async function presetShowAPIUsage() {
    const apiSelect = document.getElementById('preset-api-key');
    const usageDiv = document.getElementById('preset-api-usage');

    if (!apiSelect || !usageDiv) return;

    const keyId = apiSelect.value;

    // 선택 안 함
    if (!keyId) {
        usageDiv.style.display = 'none';
        return;
    }

    try {
        // 백엔드에서 API 키 사용량 가져오기
        const result = await eel.studio_get_tts_usage_summary()();

        if (!result.success) {
            console.error('[Preset] API 사용량 로드 실패:', result.error);
            usageDiv.style.display = 'none';
            return;
        }

        const summary = result.summary || [];
        const keyInfo = summary.find(k => k.key_id === keyId);

        if (!keyInfo) {
            usageDiv.style.display = 'none';
            return;
        }

        // 사용량 HTML 생성
        let usageHTML = `<span class="preset-api-usage-name">${keyInfo.name}</span>`;

        keyInfo.models.forEach(model => {
            const percent = Math.round(model.ratio * 100);
            let percentClass = 'preset-api-usage-percent';

            if (percent >= 80) {
                percentClass += ' danger';
            } else if (percent >= 50) {
                percentClass += ' warning';
            }

            // 모델명 단축 (예: ko-KR-Standard-A -> Std)
            let modelShort = model.name;
            if (modelShort.includes('Standard')) {
                modelShort = 'Std';
            } else if (modelShort.includes('Wavenet')) {
                modelShort = 'Wave';
            } else if (modelShort.includes('Neural2')) {
                modelShort = 'N2';
            } else if (modelShort.includes('Chirp')) {
                modelShort = 'Chirp';
            }

            // 사용량 포맷 (예: 400만)
            const usedFormatted = model.used >= 10000
                ? Math.round(model.used / 10000) + '만'
                : model.used.toLocaleString();

            usageHTML += `<span class="preset-api-usage-item"><strong>${modelShort}:</strong> ${usedFormatted} · <span class="${percentClass}">${percent}%</span></span> | `;
        });

        // 마지막 | 제거
        usageHTML = usageHTML.replace(/ \| $/, '');

        usageDiv.innerHTML = usageHTML;
        usageDiv.style.display = 'block';

        console.log('[Preset] API 사용량 표시:', keyInfo.name);
    } catch (error) {
        console.error('[Preset] API 사용량 표시 오류:', error);
        usageDiv.style.display = 'none';
    }
}

// 캐릭터 음성 항목 추가
function designAddPresetVoice(charName = '나레이션', voice = 'ko-KR-Wavenet-A', rate = 1.0, pitch = 0) {
    const container = document.getElementById('preset-voices-container');
    if (!container) return;

    const item = document.createElement('div');
    item.className = 'preset-voice-item';
    item.innerHTML = `
        <div class="preset-voice-header">
            <input type="text" class="preset-char-name" value="${charName}" placeholder="캐릭터명">
            <button class="preset-voice-remove" onclick="designRemovePresetVoice(this)" title="삭제">✕</button>
        </div>
        <div class="preset-voice-settings">
            <select class="preset-voice-select">
                <option value="ko-KR-Wavenet-A" ${voice === 'ko-KR-Wavenet-A' ? 'selected' : ''}>ko-KR-Wavenet-A (여성)</option>
                <option value="ko-KR-Wavenet-B" ${voice === 'ko-KR-Wavenet-B' ? 'selected' : ''}>ko-KR-Wavenet-B (여성)</option>
                <option value="ko-KR-Wavenet-C" ${voice === 'ko-KR-Wavenet-C' ? 'selected' : ''}>ko-KR-Wavenet-C (남성)</option>
                <option value="ko-KR-Wavenet-D" ${voice === 'ko-KR-Wavenet-D' ? 'selected' : ''}>ko-KR-Wavenet-D (남성)</option>
                <option value="ko-KR-Neural2-A" ${voice === 'ko-KR-Neural2-A' ? 'selected' : ''}>ko-KR-Neural2-A (여성)</option>
                <option value="ko-KR-Neural2-B" ${voice === 'ko-KR-Neural2-B' ? 'selected' : ''}>ko-KR-Neural2-B (여성)</option>
                <option value="ko-KR-Neural2-C" ${voice === 'ko-KR-Neural2-C' ? 'selected' : ''}>ko-KR-Neural2-C (남성)</option>
            </select>
            <div class="preset-voice-params">
                <label>속도:</label>
                <div class="param-control">
                    <button type="button" class="param-btn" onclick="designAdjustPresetRate(this, -0.1)">−</button>
                    <input type="number" class="preset-voice-rate" value="${rate}" min="0.5" max="2.0" step="0.1">
                    <button type="button" class="param-btn" onclick="designAdjustPresetRate(this, 0.1)">+</button>
                </div>
                <label>피치:</label>
                <div class="param-control">
                    <button type="button" class="param-btn" onclick="designAdjustPresetPitch(this, -1)">−</button>
                    <input type="number" class="preset-voice-pitch" value="${pitch}" min="-20" max="20" step="1">
                    <button type="button" class="param-btn" onclick="designAdjustPresetPitch(this, 1)">+</button>
                </div>
            </div>
        </div>
    `;
    container.appendChild(item);
}

// 캐릭터 음성 항목 제거
function designRemovePresetVoice(btn) {
    const item = btn.closest('.preset-voice-item');
    if (item) item.remove();
}

// 속도 조정
function designAdjustPresetRate(btn, delta) {
    const input = btn.parentElement.querySelector('.preset-voice-rate');
    if (input) {
        let value = parseFloat(input.value) || 1.0;
        value = Math.max(0.5, Math.min(2.0, value + delta));
        input.value = value.toFixed(1);
    }
}

// 피치 조정
function designAdjustPresetPitch(btn, delta) {
    const input = btn.parentElement.querySelector('.preset-voice-pitch');
    if (input) {
        let value = parseInt(input.value) || 0;
        value = Math.max(-20, Math.min(20, value + delta));
        input.value = value;
    }
}


// ========== 배치 탭 기능 ==========

let batchQueue = []; // 배치 작업 대기열
let batchProcessing = false; // 배치 처리 중 여부
let batchElapsedInterval = null; // 경과 시간 타이머
let batchElapsedSeconds = 0;

// 배치 파일 추가
async function batchAddFiles() {
    try {
        const result = await eel.select_script_files()();
        if (result && result.success && result.files) {
            let addedCount = 0;
            let duplicateCount = 0;

            for (const filePath of result.files) {
                const added = await addFileToBatchQueue(filePath);
                if (added) {
                    addedCount++;
                } else {
                    duplicateCount++;
                }
            }

            updateBatchQueueUI();

            // 결과 메시지
            if (duplicateCount > 0) {
                console.log(`[Batch] ${addedCount}개 추가, ${duplicateCount}개 중복 제외`);
            }

            // 모든 파일 추가 후 캐릭터 추출
            if (addedCount > 0) {
                await batchExtractAllCharacters();
            }
        }
    } catch (error) {
        console.error('[Batch] 파일 추가 오류:', error);
    }
}

// 배치 폴더 추가
async function batchAddFolder() {
    try {
        const result = await eel.select_script_folder()();
        if (result && result.success && result.files) {
            let addedCount = 0;
            let duplicateCount = 0;

            for (const filePath of result.files) {
                const added = await addFileToBatchQueue(filePath);
                if (added) {
                    addedCount++;
                } else {
                    duplicateCount++;
                }
            }

            updateBatchQueueUI();

            // 결과 메시지
            if (duplicateCount > 0) {
                console.log(`[Batch] ${addedCount}개 추가, ${duplicateCount}개 중복 제외`);
            }

            // 모든 파일 추가 후 캐릭터 추출
            if (addedCount > 0) {
                await batchExtractAllCharacters();
            }
        }
    } catch (error) {
        console.error('[Batch] 폴더 추가 오류:', error);
    }
}

// 대기열에 파일 추가
async function addFileToBatchQueue(filePath) {
    // 중복 체크
    if (batchQueue.find(item => item.scriptPath === filePath)) {
        return false; // 중복 파일
    }

    const fileName = filePath.split(/[\\/]/).pop().replace(/\.[^/.]+$/, '');

    // 파일 정보 가져오기
    let sentenceCount = '-';
    let estimatedLength = '-';
    try {
        const info = await eel.get_script_file_info(filePath)();
        if (info && info.success) {
            sentenceCount = info.sentenceCount;
            estimatedLength = info.estimatedLength;
        }
    } catch (e) {
        console.error('[Batch] 파일 정보 가져오기 실패:', e);
    }

    // 배경 이미지 자동 감지 (대본과 같은 폴더에서 같은 이름의 이미지 파일 찾기)
    let backgroundImage = null;
    let hasBackgroundImage = false;
    try {
        const scriptDir = filePath.substring(0, filePath.lastIndexOf(/[\\/]/.exec(filePath)[0]));
        const scriptBaseName = fileName;
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.gif'];

        for (const ext of imageExtensions) {
            const imagePath = scriptDir + '\\' + scriptBaseName + ext;
            // 파일 존재 여부 확인 (백엔드에서 확인)
            const checkResult = await eel.check_file_exists(imagePath)();
            if (checkResult && checkResult.exists) {
                backgroundImage = imagePath;
                hasBackgroundImage = true;
                break;
            }
        }
    } catch (e) {
        console.error('[Batch] 배경 이미지 자동 감지 실패:', e);
    }

    batchQueue.push({
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        scriptPath: filePath,
        fileName: fileName,
        backgroundImage: backgroundImage,
        hasBackgroundImage: hasBackgroundImage,
        voicePreset: null, // 개별 음성 프리셋 선택
        youtubeAccount: null, // 개별 YouTube 계정 선택
        status: 'pending', // pending, processing, completed, failed
        error: null,
        sentenceCount: sentenceCount,
        estimatedLength: estimatedLength,
        progress: '-'
    });

    return true; // 파일 추가 성공
}

// 선택된 항목 삭제
function batchRemoveSelected() {
    const checkboxes = document.querySelectorAll('#batch-queue-tbody input[type="checkbox"]:checked');
    const idsToRemove = [];

    checkboxes.forEach(cb => {
        const row = cb.closest('tr');
        if (row && row.dataset.id) {
            idsToRemove.push(row.dataset.id);
        }
    });

    batchQueue = batchQueue.filter(item => !idsToRemove.includes(item.id));
    updateBatchQueueUI();
}

// 전체 삭제
function batchClearAll() {
    if (batchProcessing) {
        alert('배치 작업 중에는 삭제할 수 없습니다.');
        return;
    }

    if (batchQueue.length === 0) return;

    if (!confirm('모든 파일을 삭제하시겠습니까?')) return;

    batchQueue = [];
    updateBatchQueueUI();
}

// 전체 선택/해제
function batchToggleAll() {
    const selectAll = document.getElementById('batch-select-all');
    const checkboxes = document.querySelectorAll('#batch-queue-tbody input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
}

// 배치 대기열 UI 업데이트
function updateBatchQueueUI() {
    const tbody = document.getElementById('batch-queue-tbody');
    if (!tbody) return;

    if (batchQueue.length === 0) {
        tbody.innerHTML = `
            <tr class="batch-empty-row">
                <td colspan="8">
                    <div class="batch-empty-message">
                        <span class="batch-empty-icon">📂</span>
                        <p>대본 파일을 추가하세요</p>
                        <p class="batch-empty-hint">파일 추가 또는 폴더 추가 버튼을 클릭하거나, 파일을 드래그하여 놓으세요</p>
                    </div>
                </td>
            </tr>
        `;
        document.getElementById('batch-total-count').textContent = '0개';
        return;
    }

    const useCommonBg = document.getElementById('batch-use-common-bg')?.checked ?? true;
    const useCommonYoutube = document.getElementById('batch-youtube-auto-upload')?.checked ?? false;

    tbody.innerHTML = batchQueue.map((item, index) => {
        const statusIcon = {
            'pending': '⏳',
            'processing': '🔄',
            'completed': '✅',
            'failed': '❌',
            'skipped': '⏭️'
        }[item.status] || '⏳';

        const statusText = {
            'pending': '대기',
            'processing': '처리 중',
            'completed': '완료',
            'failed': '실패',
            'skipped': '건너뜀'
        }[item.status] || '대기';

        // 문장 수와 진행률
        const sentenceCount = item.sentenceCount || '-';
        const progress = item.progress || '-';

        // 배경 이미지 표시 (개별, 공통, 또는 없음)
        let bgIcon = '';

        if (useCommonBg) {
            // 공통 배경 사용
            bgIcon = '📁';
        } else if (item.hasBackgroundImage) {
            // 개별 배경 이미지 있음
            bgIcon = '✅';
        } else {
            // 배경 이미지 없음
            bgIcon = '❌';
        }

        // YouTube 계정 셀 내용
        let youtubeCell = '';
        if (useCommonYoutube) {
            youtubeCell = '<span style="color: #888; font-size: 0.85rem;">공통 사용</span>';
        } else {
            const accountId = `batch-youtube-account-${item.id}`;
            youtubeCell = `
                <select class="batch-youtube-select" data-item-id="${item.id}" id="${accountId}"
                        ${batchProcessing ? 'disabled' : ''}
                        onchange="batchUpdateItemYoutubeAccount('${item.id}', this.value)"
                        style="width: 100%; padding: 4px; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; color: #ddd; font-size: 0.85rem;">
                    <option value="">-- 선택 --</option>
                </select>
            `;
        }

        return `
            <tr data-id="${item.id}" class="batch-row-${item.status}" onclick="batchSelectScript('${item.id}')">
                <td onclick="event.stopPropagation()"><input type="checkbox" checked ${batchProcessing ? 'disabled' : ''}></td>
                <td>${statusIcon} ${statusText}</td>
                <td>${index + 1}</td>
                <td class="batch-filename" title="${item.scriptPath}">${item.fileName}</td>
                <td class="batch-bg-cell" style="text-align: center;">
                    <span style="font-size: 1.2rem;">${bgIcon}</span>
                </td>
                <td onclick="event.stopPropagation()">${youtubeCell}</td>
                <td>${sentenceCount}</td>
                <td>${progress}</td>
            </tr>
        `;
    }).join('');

    document.getElementById('batch-total-count').textContent = batchQueue.length + '개';

    // YouTube 계정 드롭다운 채우기
    if (!useCommonYoutube) {
        batchFillYoutubeAccountSelects();
    }
}

// 배치 탭에서 대본 선택 시 캐릭터 추출 및 표시
let batchSelectedScriptId = null;

async function batchSelectScript(itemId) {
    batchSelectedScriptId = itemId;
    const item = batchQueue.find(i => i.id === itemId);
    if (!item) return;

    // 배치 탭에서는 개별 대본 선택 시에도 전체 캐릭터 목록을 유지
    // (단일 대본의 캐릭터만 표시하지 않고, 전체 대기열의 모든 캐릭터를 표시)
    console.log('[Batch] 대본 선택:', item.fileName);
}

// 배치 탭에서 모든 대본의 캐릭터 추출 (영상 탭과 동일한 방식)
async function batchExtractAllCharacters() {
    console.log('[Batch] 캐릭터 추출 시작, 대기열:', batchQueue.length, '개 파일');

    const PRESET_NAME = 'character_voices';
    const preset = videoPresets[PRESET_NAME];

    // 모든 대본을 파싱하여 clips 생성 (영상 탭 방식과 동일)
    const allClips = [];

    for (const item of batchQueue) {
        try {
            console.log(`[Batch] 대본 읽기 시도: ${item.fileName}, 경로: ${item.scriptPath}`);
            const content = await eel.studio_read_text_file(item.scriptPath)();
            console.log(`[Batch] 대본 내용 길이: ${content ? content.length : 0}`);

            if (content) {
                const lines = content.split('\n').filter(line => line.trim());
                console.log(`[Batch] 대본 라인 수: ${lines.length}`);
                console.log(`[Batch] 첫 5줄:`, lines.slice(0, 5));

                let currentCharacter = '나레이션';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    // [캐릭터명] 패턴 체크 (영상 탭과 동일)
                    const charMatch = trimmed.match(/^\[([^\]]+)\]\s*(.*)/);
                    if (charMatch) {
                        currentCharacter = charMatch[1].trim();
                        const text = charMatch[2].trim();
                        if (text) {
                            allClips.push({ character: currentCharacter, text: text });
                        }
                    } else {
                        // 캐릭터 지정 없이 텍스트만 있는 경우 - 현재 캐릭터로
                        allClips.push({ character: currentCharacter, text: trimmed });
                    }
                }
            }
        } catch (error) {
            console.error(`[Batch] 대본 읽기 오류 (${item.fileName}):`, error);
        }
    }

    // clips에서 실제로 사용된 캐릭터만 추출 (영상 탭과 동일)
    const allCharacters = [...new Set(allClips.map(c => c.character))];
    const newCharacters = [];

    console.log('[Batch] 추출된 캐릭터 목록:', allCharacters);

    // 각 캐릭터별로 설정 로드
    allCharacters.forEach((char) => {
        // 새 캐릭터인지 확인
        const isNewCharacter = !preset || !preset.characters || !preset.characters[char];
        if (isNewCharacter) {
            newCharacters.push(char);
        }

        // 프리셋에서 불러오기 (영상 탭과 동일한 형식)
        if (preset && preset.characters && preset.characters[char]) {
            const savedSettings = preset.characters[char];
            batchCharacterVoiceSettings[char] = {
                language: 'ko-KR',
                group: savedSettings.group || 'Standard',
                voice: savedSettings.voice || 'ko-KR-Standard-A',
                rate: savedSettings.rate || 1.0,
                pitch: savedSettings.pitch || 0
            };
            console.log(`[Batch] 캐릭터 "${char}" 음성 프리셋에서 불러옴:`, savedSettings.voice);
        }
        // 기존 설정이 없으면 기본값 생성 (영상 탭과 동일)
        else if (!batchCharacterVoiceSettings[char]) {
            batchCharacterVoiceSettings[char] = {
                language: 'ko-KR',
                group: 'Standard',
                voice: 'ko-KR-Standard-A',
                rate: 1.0,
                pitch: 0
            };
        }
    });

    console.log('[Batch] 캐릭터 추출 완료:', allCharacters.length, '개 캐릭터');
    console.log('[Batch] 신규 캐릭터:', newCharacters.length, '개');

    // 캐릭터 카드 렌더링 (배치 탭 전용)
    await designRenderCharacterCards(allCharacters, newCharacters, true);
}

// 배치 탭 캐릭터 추출 (단일 대본)
async function batchExtractCharacters(scriptContent) {
    const PRESET_NAME = 'character_voices';
    const preset = videoPresets[PRESET_NAME];

    const lines = scriptContent.split('\n');
    const characters = [];
    const newCharacters = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0 && colonIdx < 20) {
            const char = trimmed.substring(0, colonIdx).trim();
            if (char && !characters.includes(char)) {
                characters.push(char);

                // 새 캐릭터인지 확인
                const isNewCharacter = !preset || !preset.characters || !preset.characters[char];
                if (isNewCharacter) {
                    newCharacters.push(char);
                }

                // 프리셋에서 불러오기
                if (preset && preset.characters && preset.characters[char]) {
                    studioCharacterVoiceSettings[char] = preset.characters[char];
                } else {
                    // 기본값 설정
                    if (!studioCharacterVoiceSettings[char]) {
                        studioCharacterVoiceSettings[char] = {
                            voice: '',
                            speed: 0,
                            pitch: 0
                        };
                    }
                }
            }
        }
    }

    // 캐릭터 카드 렌더링 (영상 탭과 동일한 함수 재사용)
    await designRenderCharacterCards(characters, newCharacters);
}

// 음성 프리셋 드롭다운 채우기
async function batchFillVoicePresetSelects() {
    try {
        const result = await eel.studio_get_tts_usage_summary()();
        if (!result.success) return;

        const apiKeys = result.summary || [];
        const activeKeys = apiKeys.filter(key => key.active);

        // 모든 음성 프리셋 선택 드롭다운 찾기
        document.querySelectorAll('.batch-voice-select').forEach(select => {
            const itemId = select.dataset.itemId;
            const item = batchQueue.find(i => i.id === itemId);
            const currentValue = item ? item.voicePreset : '';

            select.innerHTML = '<option value="">-- 선택 --</option>' +
                activeKeys.map(key =>
                    `<option value="${key.key_id}" ${key.key_id === currentValue ? 'selected' : ''}>` +
                    `${key.name}</option>`
                ).join('');
        });
    } catch (error) {
        console.error('[Batch] 음성 프리셋 목록 로드 오류:', error);
    }
}

// 개별 항목 음성 프리셋 업데이트
function batchUpdateItemVoicePreset(itemId, presetName) {
    const item = batchQueue.find(i => i.id === itemId);
    if (item) {
        item.voicePreset = presetName;
        console.log(`[Batch] ${item.fileName} -> 음성 프리셋: ${presetName || '미선택'}`);
    }
}

// YouTube 계정 드롭다운 채우기
async function batchFillYoutubeAccountSelects() {
    try {
        const result = await eel.youtube_get_accounts()();
        if (!result.success) return;

        const accounts = result.accounts || [];

        // 모든 YouTube 계정 선택 드롭다운 찾기
        document.querySelectorAll('.batch-youtube-select').forEach(select => {
            const itemId = select.dataset.itemId;
            const item = batchQueue.find(i => i.id === itemId);
            const currentValue = item ? item.youtubeAccount : '';

            select.innerHTML = '<option value="">-- 선택 --</option>' +
                accounts.map(acc =>
                    `<option value="${acc.name}" ${acc.name === currentValue ? 'selected' : ''}>` +
                    `${acc.name}</option>`
                ).join('');
        });
    } catch (error) {
        console.error('[Batch] YouTube 계정 목록 로드 오류:', error);
    }
}

// 개별 항목 YouTube 계정 업데이트
function batchUpdateItemYoutubeAccount(itemId, accountName) {
    const item = batchQueue.find(i => i.id === itemId);
    if (item) {
        item.youtubeAccount = accountName;
        console.log(`[Batch] ${item.fileName} -> YouTube 계정: ${accountName || '미선택'}`);
    }
}

// 배경 이미지 선택 (공통)
async function batchSelectBackground() {
    try {
        const path = await eel.studio_select_single_image()();
        if (path) {
            document.getElementById('batch-bg-image').value = path;
            console.log('[Batch] 공통 배경 이미지 선택:', path);
        }
    } catch (error) {
        console.error('[Batch] 배경 이미지 선택 오류:', error);
    }
}

// 개별 항목 배경 이미지 선택
async function batchSelectItemBackground(itemId) {
    try {
        const path = await eel.studio_select_single_image()();
        if (path) {
            const item = batchQueue.find(i => i.id === itemId);
            if (item) {
                item.backgroundImage = path;
                item.hasBackgroundImage = true;
                updateBatchQueueUI();
                console.log('[Batch] 개별 배경 이미지 선택:', itemId, path);
            }
        }
    } catch (error) {
        console.error('[Batch] 개별 배경 이미지 선택 오류:', error);
    }
}

// 공통 배경 사용 토글
function batchToggleCommonBg() {
    const checkbox = document.getElementById('batch-use-common-bg');
    if (!checkbox) return; // 요소가 없으면 무시

    const useCommon = checkbox.checked;
    const commonBgRow = document.getElementById('batch-common-bg-row');
    const individualBgHint = document.getElementById('batch-individual-bg-hint');

    if (commonBgRow) {
        commonBgRow.style.display = useCommon ? 'flex' : 'none';
    }
    if (individualBgHint) {
        individualBgHint.style.display = useCommon ? 'none' : 'block';
    }
    updateBatchQueueUI();
}

// 공통 배경 이미지 선택
async function batchSelectCommonBg() {
    try {
        const result = await eel.select_background_image()();
        if (result && result.success && result.path) {
            document.getElementById('batch-common-bg').value = result.path;
        }
    } catch (error) {
        console.error('[Batch] 공통 배경 이미지 선택 오류:', error);
    }
}

// EQ 토글
function batchToggleEQ() {
    const checkbox = document.getElementById('batch-eq-enabled');
    const options = document.getElementById('batch-eq-options');
    if (checkbox && options) {
        options.style.display = checkbox.checked ? 'block' : 'none';
    }
}

// 자막 토글
function batchToggleSubtitle() {
    const checkbox = document.getElementById('batch-subtitle-enabled');
    const options = document.getElementById('batch-subtitle-options');
    if (checkbox && options) {
        options.style.display = checkbox.checked ? 'block' : 'none';
    }
}

// 자동 출력 경로 토글
function batchToggleAutoOutput() {
    const autoOutput = document.getElementById('batch-auto-output').checked;
    document.getElementById('batch-output-folder-row').style.display = autoOutput ? 'none' : 'flex';
}

// 출력 폴더 선택
async function batchSelectOutputFolder() {
    try {
        const result = await eel.select_output_folder()();
        if (result && result.success && result.path) {
            document.getElementById('batch-output-folder').value = result.path;
        }
    } catch (error) {
        console.error('[Batch] 출력 폴더 선택 오류:', error);
    }
}

// 음성 프리셋 로드 적용
function batchLoadPreset() {
    const presetName = document.getElementById('batch-voice-preset').value;
    if (!presetName) {
        alert('프리셋을 선택하세요.');
        return;
    }
    // TODO: 프리셋 로드 및 적용 로직
    console.log('[Batch] 프리셋 적용:', presetName);
}

// 배치 음성 속도 조절
function batchAdjustRate(delta) {
    const input = document.getElementById('batch-voice-rate');
    if (!input) return;
    const currentValue = parseFloat(input.value) || 1.0;
    const newValue = Math.max(0.5, Math.min(2.0, currentValue + delta));
    input.value = newValue.toFixed(1);
}

// 배치 음성 피치 조절
function batchAdjustPitch(delta) {
    const input = document.getElementById('batch-voice-pitch');
    if (!input) return;
    const currentValue = parseInt(input.value) || 0;
    const newValue = Math.max(-20, Math.min(20, currentValue + delta));
    input.value = newValue;
}

// 배치 음성 모델 변경 시 음성 옵션 업데이트
function batchUpdateVoiceOptions() {
    const voiceSelect = document.getElementById('batch-default-voice');
    if (!voiceSelect) return;

    // 음성 옵션은 모델에 관계없이 동일 (A, B, C, D)
    // 실제 사용 시 모델과 음성을 조합하여 "ko-KR-{model}-{voice}" 형식으로 사용
    voiceSelect.innerHTML = `
        <option value="A">A_여성</option>
        <option value="B">B_여성</option>
        <option value="C">C_남성</option>
        <option value="D">D_남성</option>
    `;
}

// 배치 제작 시작
async function batchStartProduction() {
    if (batchQueue.length === 0) {
        alert('처리할 파일이 없습니다.');
        return;
    }

    // 출력 옵션 먼저 확인 (공통 함수 사용)
    const outputOptions = getOutputOptions(true); // true = 배치탭
    const outputVideo = outputOptions.video;
    const outputMp3 = outputOptions.mp3;
    const outputTransparentEQ = outputOptions.transparentEQ;

    // 출력 옵션 검증
    if (!validateOutputOptions(outputOptions)) {
        return;
    }

    // 배경 이미지가 필요한지 확인 (영상 또는 투명EQ 제작 시에만 필요)
    const needsBackground = outputVideo || outputTransparentEQ;

    const useCommonBg = document.getElementById('batch-use-common-bg').checked;
    const commonBgImage = document.getElementById('batch-bg-image').value;

    // 배경이 필요한 경우에만 배경 이미지 체크
    if (needsBackground) {
        // 공통 배경 사용 시 확인
        if (useCommonBg && !commonBgImage) {
            alert('공통 배경 이미지를 선택하세요.');
            return;
        }
    }

    // 배치 작업 데이터 준비
    const pendingItems = batchQueue.filter(item => item.status === 'pending' || item.status === 'failed');
    if (pendingItems.length === 0) {
        alert('처리할 대기 중인 파일이 없습니다.');
        return;
    }

    let validItems;

    if (needsBackground) {
        // 배경이 필요한 경우: 개별 배경 모드일 때 배경이 없는 항목은 건너뜀
        if (!useCommonBg) {
            const missingBg = pendingItems.filter(item => !item.hasBackgroundImage);
            if (missingBg.length > 0) {
                const missingNames = missingBg.map(item => item.fileName).join(', ');
                alert(`배경 이미지가 없는 ${missingBg.length}개 항목은 건너뜁니다:\n${missingNames}`);

                // 배경 없는 항목은 pending 목록에서 제외
                missingBg.forEach(item => {
                    item.status = 'skipped';
                    item.progress = '건너뜀';
                });
                updateBatchQueueUI();
            }
        }

        // 실제 처리할 항목만 필터링 (배경이 있거나 공통 배경 사용)
        validItems = pendingItems.filter(item =>
            item.status === 'pending' && (useCommonBg || item.hasBackgroundImage)
        );
    } else {
        // 배경이 필요 없는 경우 (MP3만): 모든 pending 항목 처리
        validItems = pendingItems.filter(item => item.status === 'pending');
    }

    if (validItems.length === 0) {
        alert('처리할 수 있는 항목이 없습니다.');
        return;
    }

    batchProcessing = true;
    updateBatchUIState(true);
    batchStartElapsedTimer();

    // 전체 작업 개수 표시
    const totalCountEl = document.getElementById('batch-total-count');
    if (totalCountEl) {
        totalCountEl.textContent = validItems.length;
    }

    // 로그 초기화 및 시작 로그
    const logOutput = document.getElementById('batch-log-output');
    if (logOutput) {
        logOutput.innerHTML = '';
    }
    batchAddLog(`배치 제작 시작: 총 ${validItems.length}개 파일`, 'info');
    batchAddLog(`출력 옵션: ${outputVideo ? '영상' : ''} ${outputMp3 ? 'MP3' : ''} ${outputTransparentEQ ? '투명EQ' : ''}`.trim(), 'info');

    // 설정 값 수집
    const resolution = document.getElementById('batch-resolution').value;

    // 캐릭터별 음성 설정 저장 (UI에서 최신 값 수집) - 공통 함수 사용
    const allCharacters = [...new Set(Object.keys(batchCharacterVoiceSettings))];
    allCharacters.forEach(char => {
        designSaveCharacterVoiceSettings(char, true); // true = 배치탭
    });

    // 캐릭터 음성 설정 사용 (배치 탭 전용)
    const characterVoices = batchCharacterVoiceSettings;

    // EQ 설정 가져오기 (공통 함수 사용)
    const eqSettings = getEQSettings(true, resolution);  // true = 배치탭

    // 자막 설정 가져오기 (공통 함수 사용)
    const subtitleSettings = getSubtitleSettings(true);  // true = 배치탭

    console.log('[Batch] EQ 설정:', eqSettings);
    console.log('[Batch] 자막 설정:', subtitleSettings);

    // YouTube 설정
    const useCommonYoutube = document.getElementById('batch-youtube-auto-upload')?.checked ?? false;
    const commonYoutubeAccount = document.getElementById('batch-youtube-account')?.value || null;

    const jobsData = validItems.map(item => {
        // 배경 이미지: 공통 배경 사용 시 공통 우선, 아니면 개별 배경
        const imagePath = useCommonBg ? commonBgImage : (item.backgroundImage || null);

        // YouTube 계정: 공통 사용 시 공통 우선, 아니면 개별 계정
        const youtubeAccount = useCommonYoutube ? commonYoutubeAccount : (item.youtubeAccount || null);

        // 출력 경로: 대본 파일과 같은 폴더에 저장
        const itemOutputFolder = item.scriptPath.replace(/[^\\/]+$/, '');

        return {
            scriptPath: item.scriptPath,
            fileName: item.fileName,
            imagePath: imagePath,
            outputFolder: itemOutputFolder,
            resolution: resolution,
            outputVideo: outputVideo,
            outputMp3: outputMp3,
            outputTransparentEQ: outputTransparentEQ,
            characterVoices: characterVoices,
            eqSettings: eqSettings,
            subtitleSettings: subtitleSettings,
            youtubeAccount: youtubeAccount
        };
    });

    try {
        console.log('[Batch] 배치 작업 시작:', jobsData.length, '개 파일');
        const result = await eel.studio_start_batch_production(jobsData, null)();

        if (!result || !result.success) {
            alert('배치 작업 시작 실패: ' + (result?.error || '알 수 없는 오류'));
            batchStopProduction();
        }
    } catch (error) {
        console.error('[Batch] 배치 작업 오류:', error);
        alert('배치 작업 중 오류가 발생했습니다.');
        batchStopProduction();
    }
}

// 배치 제작 중지
async function batchStopProduction() {
    try {
        await eel.studio_cancel_production()();
    } catch (e) {
        console.error('[Batch] 중지 오류:', e);
    }

    batchProcessing = false;
    updateBatchUIState(false);
    batchStopElapsedTimer();
}

// 배치 UI 상태 업데이트
function updateBatchUIState(processing) {
    const startBtn = document.getElementById('batch-start-btn');
    const stopBtn = document.getElementById('batch-stop-btn');
    const progressStats = document.querySelector('.batch-progress-stats');

    if (startBtn) startBtn.disabled = processing;
    if (stopBtn) stopBtn.disabled = !processing;

    // 진행 상태 박스 표시/숨김
    if (progressStats) {
        progressStats.style.display = processing ? 'block' : 'none';
    }

    // 체크박스 비활성화
    document.querySelectorAll('#batch-queue-tbody input[type="checkbox"]').forEach(cb => {
        cb.disabled = processing;
    });
}

// 경과 시간 타이머 시작
function batchStartElapsedTimer() {
    if (batchElapsedInterval) {
        clearInterval(batchElapsedInterval);
    }
    batchElapsedSeconds = 0;
    batchElapsedInterval = setInterval(() => {
        batchElapsedSeconds++;
        const h = Math.floor(batchElapsedSeconds / 3600);
        const m = Math.floor((batchElapsedSeconds % 3600) / 60);
        const s = batchElapsedSeconds % 60;
        document.getElementById('batch-elapsed-time').textContent =
            `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }, 1000);
}

// 경과 시간 타이머 중지
function batchStopElapsedTimer() {
    if (batchElapsedInterval) {
        clearInterval(batchElapsedInterval);
        batchElapsedInterval = null;
    }
}

// 로그 추가 함수
function batchAddLog(message, type = 'info') {
    const logOutput = document.getElementById('batch-log-output');
    if (!logOutput) return;

    const time = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    const logLine = document.createElement('div');
    logLine.className = 'log-line';

    let color = '#e0e0e0';
    if (type === 'success') color = '#4caf50';
    else if (type === 'error') color = '#f44336';
    else if (type === 'warning') color = '#ff9800';
    else if (type === 'info') color = '#2196f3';

    logLine.style.color = color;
    logLine.textContent = `[${time}] ${message}`;

    logOutput.appendChild(logLine);
    logOutput.scrollTop = logOutput.scrollHeight;

    // 첫 로그일 경우 기본 메시지 제거
    const placeholder = logOutput.querySelector('.log-line[style*="color: #888"]');
    if (placeholder && logOutput.children.length > 1) {
        placeholder.remove();
    }
}

// 배치 진행률 업데이트 (백엔드에서 호출)
eel.expose(studioUpdateBatchProgress);
function studioUpdateBatchProgress(progress, message) {
    console.log('[Batch] 진행률 업데이트:', progress, message);

    const progressBar = document.getElementById('batch-progress-bar');
    const progressText = document.getElementById('batch-progress-text');

    if (progressBar) {
        progressBar.style.width = progress + '%';
        console.log('[Batch] 진행 바 업데이트:', progress + '%');
    } else {
        console.error('[Batch] batch-progress-bar 요소를 찾을 수 없습니다');
    }

    if (progressText) {
        progressText.textContent = message || `${Math.round(progress)}%`;
    } else {
        console.error('[Batch] batch-progress-text 요소를 찾을 수 없습니다');
    }

    // 로그 추가
    if (message) {
        batchAddLog(message, 'info');
    }

    // 완료된 항목 수 업데이트
    const parts = message?.match(/(\d+)\/(\d+)/);
    if (parts) {
        const doneEl = document.getElementById('batch-done-count');
        if (doneEl) {
            doneEl.textContent = parts[1] + '개';
        }
    }
}

// 배치 작업 완료 (백엔드에서 호출)
eel.expose(studioBatchComplete);
function studioBatchComplete(result) {
    console.log('[Batch] 배치 작업 완료:', result);

    batchProcessing = false;
    updateBatchUIState(false);
    batchStopElapsedTimer();

    // 결과 업데이트
    document.getElementById('batch-done-count').textContent = (result.completed || 0) + '개';
    document.getElementById('batch-fail-count').textContent = (result.failed || 0) + '개';
    document.getElementById('batch-progress-text').textContent = '완료';
    document.getElementById('batch-progress-bar').style.width = '100%';

    // 완료 로그
    batchAddLog(`배치 작업 완료: 성공 ${result.completed || 0}개, 실패 ${result.failed || 0}개`, 'success');

    // 실패 항목 표시
    if (result.errors && result.errors.length > 0) {
        result.errors.forEach(err => {
            const item = batchQueue.find(q => q.scriptPath === err.job?.scriptPath);
            if (item) {
                item.status = 'failed';
                item.error = err.error;
                batchAddLog(`실패: ${item.fileName} - ${err.error}`, 'error');
            }
        });
    }

    // 성공 항목 표시
    if (result.results && result.results.length > 0) {
        batchQueue.forEach(item => {
            if (item.status !== 'failed') {
                item.status = 'completed';
            }
        });
    }

    updateBatchQueueUI();

    // YouTube 자동 업로드 (비동기)
    batchUploadToYouTube(result.results).then(() => {
        alert(`배치 작업 완료\n성공: ${result.completed || 0}개\n실패: ${result.failed || 0}개`);
    });
}

// 배치 완료 후 YouTube 업로드
async function batchUploadToYouTube(results) {
    if (!results || results.length === 0) return;

    const autoUploadEnabled = document.getElementById('batch-youtube-auto-upload')?.checked;
    if (!autoUploadEnabled) return;

    console.log('[Batch] YouTube 자동 업로드 시작...');

    let uploadedCount = 0;
    let failedCount = 0;

    for (const result of results) {
        if (!result.output_path) continue;

        const title = result.file_name || '배치 제작 영상';
        const description = `배치 제작으로 생성된 영상입니다.\n\n제작 일시: ${new Date().toLocaleString('ko-KR')}`;

        try {
            const uploadResult = await youtubeBatchAutoUpload(result.output_path, title, description);

            if (uploadResult && uploadResult.success) {
                uploadedCount++;
                console.log(`[Batch] YouTube 업로드 성공: ${uploadResult.video_url}`);
            } else if (!uploadResult.skip) {
                failedCount++;
                console.error(`[Batch] YouTube 업로드 실패: ${uploadResult.error}`);
            }
        } catch (error) {
            failedCount++;
            console.error(`[Batch] YouTube 업로드 오류:`, error);
        }
    }

    if (uploadedCount > 0 || failedCount > 0) {
        alert(`YouTube 업로드 완료\n성공: ${uploadedCount}개\n실패: ${failedCount}개`);
    }
}

// 배치 탭 초기화
function initBatchTab() {
    console.log('[Batch] 배치 탭 초기화');

    // 공통 배경 체크박스 초기 상태 설정
    batchToggleCommonBg();

    updateBatchQueueUI();

    // 음성 프리셋 드롭다운 로드
    loadBatchVoicePresets();
}

// 배치 음성 프리셋 로드
async function loadBatchVoicePresets() {
    const select = document.getElementById('batch-voice-preset');
    if (!select) return;

    try {
        const result = await eel.studio_get_tts_usage_summary()();
        if (result && result.success && result.summary) {
            const apiKeys = result.summary || [];
            const activeKeys = apiKeys.filter(key => key.active);

            select.innerHTML = '<option value="">-- 프리셋 선택 --</option>';
            activeKeys.forEach(key => {
                const option = document.createElement('option');
                option.value = key.key_id;
                option.textContent = key.name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('[Batch] 음성 프리셋 로드 오류:', error);
    }
}

// 배치 탭 초기화 (탭 전환 시)
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initBatchTab, 1000);
});

// ========== 배치 탭 초기화 버튼 ==========
function batchResetAll() {
    if (!confirm('배치 탭의 모든 데이터를 초기화하시겠습니까?\n\n- 작업 목록이 모두 삭제됩니다\n- 캐릭터 음성 설정이 초기화됩니다\n\n이 작업은 되돌릴 수 없습니다.')) {
        return;
    }

    // 작업 목록 초기화
    batchQueue = [];
    batchSelectedScriptId = null;

    // 캐릭터 음성 설정 초기화
    batchCharacterVoiceSettings = {};

    // UI 업데이트
    updateBatchQueueUI();

    // 캐릭터 카드 초기화
    const batchContainer = document.getElementById('batch-voice-settings-container');
    if (batchContainer) {
        batchContainer.innerHTML = '<div class="tts-empty-message">대본을 분석하면 캐릭터가 표시됩니다.</div>';
    }

    // 타이틀 초기화
    const batchTitleEl = document.getElementById('batch-character-title');
    if (batchTitleEl) {
        batchTitleEl.textContent = '🎭 캐릭터 음성';
    }

    // 진행률 초기화
    const progressBar = document.getElementById('batch-progress-bar');
    const progressText = document.getElementById('batch-progress-text');
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '대기 중';

    // 경과 시간 초기화
    if (batchElapsedTimer) {
        clearInterval(batchElapsedTimer);
        batchElapsedTimer = null;
    }
    const elapsedEl = document.getElementById('batch-elapsed-time');
    if (elapsedEl) elapsedEl.textContent = '00:00:00';

    console.log('[Batch] 배치 탭 초기화 완료');
    alert('배치 탭이 초기화되었습니다.');
}

// ========== 디자인 탭 초기화 버튼 ==========
function designReset() {
    // 분석 데이터 초기화
    designAnalyzedClips = [];
    designSubtitles = [];
    designCurrentSubtitleIndex = 0;
    designCurrentScriptPath = null;
    designCurrentScriptContent = '';  // 대본 내용도 초기화

    // 히스토리 초기화
    designUndoHistory = [];
    designRedoHistory = [];

    // 배경 이미지 초기화
    designOutputSettings.backgroundPath = null;
    designOutputSettings.backgroundDataUrl = null;

    // 배경 이미지 UI 초기화
    const bgNameEl = document.getElementById('design-bg-name');
    if (bgNameEl) {
        bgNameEl.textContent = '';
    }

    // 미리보기 배경 이미지 초기화
    const bgLayer = document.querySelector('#tab-studio-tts-design .tts-preview-screen .tts-layer-bg');
    if (bgLayer) {
        const img = bgLayer.querySelector('img');
        const placeholder = bgLayer.querySelector('.tts-bg-placeholder');
        if (img) {
            img.src = '';
            img.style.display = 'none';
        }
        if (placeholder) {
            placeholder.style.display = 'flex';
        }
    }

    // 팝업 미리보기 배경 이미지 초기화
    const popup = document.getElementById('design-preview-popup');
    if (popup) {
        const popupBgImg = popup.querySelector('.tts-layer-bg img');
        if (popupBgImg) {
            popupBgImg.src = '';
            popupBgImg.style.display = 'none';
        }
    }

    // 대본 분석 UI 초기화 (자막 설정 문장 목록)
    const sentenceList = document.querySelector('#tab-studio-tts-design .tts-sentences-list');
    if (sentenceList) {
        sentenceList.innerHTML = '<div class="tts-empty-message">대본을 분석해주세요.</div>';
    }

    // 캐릭터 음성 설정 UI 초기화
    const characterContainer = document.getElementById('design-voice-settings-container');
    if (characterContainer) {
        characterContainer.innerHTML = '<div class="studio-empty-notice">대본을 분석하면 캐릭터별 음성 설정이 표시됩니다.</div>';
    }

    // 프리셋 선택 초기화
    const presetSelect = document.getElementById('design-video-preset');
    if (presetSelect) {
        presetSelect.value = '';
    }

    // 진행 상태 숨기기
    const progressSection = document.querySelector('#tab-studio-tts-design .tts-progress-section');
    if (progressSection) {
        progressSection.style.display = 'none';
    }

    // 자막 설정 타이틀 초기화
    designUpdateSubtitleTitle();

    console.log('[Design] 초기화 완료');
}

console.log('[RoyStudio] studio.js 로드 완료');

// ========================================
// 영상 탭 (디자인) - 추가 함수들
// ========================================

/**
 * 대본 폴더 선택
 */
async function designSelectScriptFolder() {
    try {
        const result = await eel.select_folder()();
        if (result && result.path) {
            document.getElementById('design-script-folder').value = result.path;
            console.log('[Design] 대본 폴더 선택:', result.path);
        }
    } catch (error) {
        console.error('[Design] 대본 폴더 선택 실패:', error);
        alert('대본 폴더 선택에 실패했습니다.');
    }
}

/**
 * SRT 파일 가져오기
 */
async function designImportSRT() {
    try {
        const result = await eel.select_file(['srt'])();
        if (result && result.path) {
            // SRT 파일 파싱
            const content = await eel.read_file(result.path)();
            await designParseSRT(content);
            console.log('[Design] SRT 파일 가져오기 완료');
        }
    } catch (error) {
        console.error('[Design] SRT 가져오기 실패:', error);
        alert('SRT 파일 가져오기에 실패했습니다.');
    }
}

/**
 * SRT 내용 파싱
 */
async function designParseSRT(content) {
    try {
        const lines = content.split('\n');
        const clips = [];
        let currentClip = {};

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // 번호 라인
            if (/^\d+$/.test(line)) {
                if (currentClip.text) {
                    clips.push(currentClip);
                }
                currentClip = { index: parseInt(line) };
            }
            // 시간 라인
            else if (line.includes('-->')) {
                const times = line.split('-->').map(t => t.trim());
                currentClip.start = designParseSRTTime(times[0]);
                currentClip.end = designParseSRTTime(times[1]);
            }
            // 텍스트 라인
            else if (line && !currentClip.text) {
                currentClip.text = line;
            }
        }

        if (currentClip.text) {
            clips.push(currentClip);
        }

        // clips를 전역 변수에 저장
        window.designClips = clips;
        designRenderSentenceList();
        designExtractCharacters();

    } catch (error) {
        console.error('[Design] SRT 파싱 실패:', error);
        throw error;
    }
}

/**
 * SRT 시간 형식 파싱 (00:00:00,000)
 */
function designParseSRTTime(timeStr) {
    const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!match) return 0;

    const hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const seconds = parseInt(match[3]);
    const ms = parseInt(match[4]);

    return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

/**
 * 스크립트 불러오기
 */
async function designLoadScript() {
    try {
        const result = await eel.select_file(['txt', 'srt'])();
        if (result && result.path) {
            const content = await eel.read_file(result.path)();

            // 파일 확장자에 따라 처리
            if (result.path.endsWith('.srt')) {
                await designParseSRT(content);
            } else {
                await designLoadAndAnalyzeScript();
            }

            console.log('[Design] 스크립트 로드 완료:', result.path);
        }
    } catch (error) {
        console.error('[Design] 스크립트 로드 실패:', error);
        alert('스크립트 로드에 실패했습니다.');
    }
}

/**
 * 스크립트 저장
 */
async function designSaveScript() {
    try {
        if (!window.designClips || window.designClips.length === 0) {
            alert('저장할 스크립트가 없습니다.');
            return;
        }

        const result = await eel.save_file_dialog('srt')();
        if (result && result.path) {
            // SRT 형식으로 변환
            let srtContent = '';
            window.designClips.forEach((clip, idx) => {
                srtContent += `${idx + 1}\n`;
                srtContent += `${designFormatSRTTime(clip.start)} --> ${designFormatSRTTime(clip.end)}\n`;
                srtContent += `${clip.text}\n\n`;
            });

            await eel.write_file(result.path, srtContent)();
            console.log('[Design] 스크립트 저장 완료:', result.path);
            alert('스크립트가 저장되었습니다.');
        }
    } catch (error) {
        console.error('[Design] 스크립트 저장 실패:', error);
        alert('스크립트 저장에 실패했습니다.');
    }
}

/**
 * 캐릭터 추가
 */
function designAddCharacter() {
    const characterList = document.getElementById('design-character-list');
    if (!characterList) return;

    // 새 캐릭터 색상 생성
    const colors = ['#6495ED', '#FF6B6B', '#4ECDC4', '#FFD93D', '#A8E6CF', '#FF8B94'];
    const existingChars = window.designCharacters || [];
    const color = colors[existingChars.length % colors.length];

    // 새 캐릭터 객체
    const newChar = {
        name: `캐릭터${existingChars.length + 1}`,
        color: color,
        model: 'Wavenet',
        voice: 'ko-KR-Wavenet-A',
        speed: 1.0,
        pitch: 0
    };

    existingChars.push(newChar);
    window.designCharacters = existingChars;

    // 캐릭터 카드 렌더링
    designRenderCharacterCards(existingChars);
}

/**
 * 미리듣기
 */
async function designPreviewPlay() {
    try {
        // 현재 선택된 문장의 TTS 생성 및 재생
        const currentIdx = window.designCurrentSentenceIdx || 0;
        await designPreviewSentence(currentIdx);
    } catch (error) {
        console.error('[Design] 미리듣기 실패:', error);
        alert('미리듣기에 실패했습니다.');
    }
}

/**
 * 제작 시작
 */
async function designGenerate() {
    try {
        // 유효성 검사
        if (!window.designClips || window.designClips.length === 0) {
            alert('제작할 문장이 없습니다.');
            return;
        }

        const scriptFolder = document.getElementById('design-script-folder').value;
        if (!scriptFolder) {
            alert('대본 폴더를 선택해주세요.');
            return;
        }

        // 제작 시작
        await designStartProduction();

    } catch (error) {
        console.error('[Design] 제작 시작 실패:', error);
        alert('제작 시작에 실패했습니다.');
    }
}

/**
 * 프리셋 저장
 */
async function designSavePreset() {
    try {
        const presetName = prompt('프리셋 이름을 입력하세요:');
        if (!presetName) return;

        // 현재 설정 수집
        const settings = {
            characters: window.designCharacters || [],
            resolution: document.getElementById('design-resolution').value,
            outputVideo: document.getElementById('design-output-video').checked,
            outputMp3: document.getElementById('design-output-mp3').checked,
            outputSrt: document.getElementById('design-output-srt').checked,
            transparentEq: document.getElementById('design-transparent-eq').checked
        };

        // 백엔드에 저장
        await eel.save_design_preset(presetName, settings)();

        // 프리셋 목록 새로고침
        await designLoadPresetList();

        console.log('[Design] 프리셋 저장 완료:', presetName);
        alert('프리셋이 저장되었습니다.');

    } catch (error) {
        console.error('[Design] 프리셋 저장 실패:', error);
        alert('프리셋 저장에 실패했습니다.');
    }
}

/**
 * 프리셋 삭제
 */
async function designDeletePreset() {
    try {
        const presetSelect = document.getElementById('design-preset-list');
        const presetName = presetSelect.value;

        if (!presetName) {
            alert('삭제할 프리셋을 선택해주세요.');
            return;
        }

        if (!confirm(`'${presetName}' 프리셋을 삭제하시겠습니까?`)) {
            return;
        }

        await eel.delete_design_preset(presetName)();
        await designLoadPresetList();

        console.log('[Design] 프리셋 삭제 완료:', presetName);

    } catch (error) {
        console.error('[Design] 프리셋 삭제 실패:', error);
        alert('프리셋 삭제에 실패했습니다.');
    }
}

// ========================================
// 배치 탭 - 추가 함수들
// ========================================

/**
 * 작업 추가 팝업 열기
 */
function batchAddJob() {
    const popup = document.getElementById('batch-add-job-popup');
    if (popup) {
        popup.style.display = 'flex';
    }
}

/**
 * 작업 추가 팝업 닫기
 */
function batchCloseAddJob() {
    const popup = document.getElementById('batch-add-job-popup');
    if (popup) {
        popup.style.display = 'none';
    }
}

/**
 * 스크립트 파일 선택
 */
async function batchSelectScript() {
    try {
        const result = await eel.select_file(['txt', 'srt'])();
        if (result && result.path) {
            document.getElementById('batch-add-script').value = result.path;
        }
    } catch (error) {
        console.error('[Batch] 스크립트 선택 실패:', error);
    }
}

/**
 * 작업 추가 확인
 */
function batchConfirmAddJob() {
    const scriptPath = document.getElementById('batch-add-script').value;
    const presetName = document.getElementById('batch-add-preset').value;

    if (!scriptPath) {
        alert('스크립트 파일을 선택해주세요.');
        return;
    }

    // 작업 목록에 추가
    const jobList = document.getElementById('batch-queue-list');
    const row = document.createElement('tr');
    row.innerHTML = `
        <td>대기</td>
        <td>${scriptPath.split('\\').pop()}</td>
        <td>${presetName || '기본'}</td>
        <td>
            <button onclick="batchRemoveJob(this)" class="btn-sm">삭제</button>
        </td>
    `;
    jobList.appendChild(row);

    // 팝업 닫기
    batchCloseAddJob();

    // 입력 초기화
    document.getElementById('batch-add-script').value = '';
    document.getElementById('batch-add-preset').value = '';
}

/**
 * 작업 제거
 */
function batchRemoveJob(btn) {
    const row = btn.closest('tr');
    if (row) {
        row.remove();
    }
}

/**
 * 완료된 작업 삭제
 */
function batchClearCompleted() {
    const jobList = document.getElementById('batch-queue-list');
    const rows = jobList.querySelectorAll('tr');

    rows.forEach(row => {
        const status = row.cells[0].textContent;
        if (status === '완료' || status === '실패') {
            row.remove();
        }
    });
}

/**
 * 배경 타입 변경
 */
function batchOnBgTypeChange() {
    const bgType = document.getElementById('batch-bg-type').value;
    const colorGroup = document.getElementById('batch-bg-color-group');
    const fileGroup = document.getElementById('batch-bg-file-group');

    if (bgType === 'color' || bgType === 'gradient') {
        colorGroup.style.display = 'flex';
        fileGroup.style.display = 'none';
    } else {
        colorGroup.style.display = 'none';
        fileGroup.style.display = 'flex';
    }
}

/**
 * 배경 파일 선택
 */
async function batchSelectBgFile() {
    try {
        const bgType = document.getElementById('batch-bg-type').value;
        const extensions = bgType === 'video' ? ['mp4', 'avi', 'mov'] : ['jpg', 'png', 'jpeg'];

        const result = await eel.select_file(extensions)();
        if (result && result.path) {
            document.getElementById('batch-bg-file').value = result.path;
        }
    } catch (error) {
        console.error('[Batch] 배경 파일 선택 실패:', error);
    }
}

/**
 * 출력 폴더 선택
 */
async function batchSelectOutputFolder() {
    try {
        const result = await eel.select_folder()();
        if (result && result.path) {
            document.getElementById('batch-output-folder').value = result.path;
        }
    } catch (error) {
        console.error('[Batch] 출력 폴더 선택 실패:', error);
    }
}

/**
 * 배치 시작
 */
async function batchStart() {
    try {
        const jobList = document.getElementById('batch-queue-list');
        const rows = jobList.querySelectorAll('tr');

        if (rows.length === 0) {
            alert('작업 큐가 비어있습니다.');
            return;
        }

        const outputFolder = document.getElementById('batch-output-folder').value;
        if (!outputFolder) {
            alert('출력 폴더를 선택해주세요.');
            return;
        }

        // 진행 상태 표시
        const progressContainer = document.getElementById('batch-progress-container');
        if (progressContainer) {
            progressContainer.style.display = 'block';
        }

        // 배치 작업 시작
        await batchStartProduction();

    } catch (error) {
        console.error('[Batch] 배치 시작 실패:', error);
        alert('배치 작업 시작에 실패했습니다.');
    }
}

/**
 * 배치 중지
 */
async function batchStop() {
    try {
        await batchStopProduction();
        console.log('[Batch] 배치 작업 중지');
    } catch (error) {
        console.error('[Batch] 배치 중지 실패:', error);
    }
}

/**
 * 로그 지우기
 */
function batchClearLog() {
    const logPanel = document.getElementById('batch-log');
    if (logPanel) {
        logPanel.innerHTML = '';
    }
}
