// ========== 빠른 변환 기능 (대본 → MP3 + SRT) ==========

let quickScriptPath = null;
let quickOutputFolder = null;

/**
 * 대본 파일 선택
 */
async function quickSelectScript() {
    try {
        const result = await eel.studio_select_text_file()();
        if (result) {
            quickScriptPath = result;
            document.getElementById('quick-script-path').value = result;

            // 출력 폴더를 대본 파일과 같은 폴더로 자동 설정
            const normalizedPath = result.replace(/\\/g, '/');
            const folderPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
            quickOutputFolder = folderPath;
            document.getElementById('quick-output-folder').value = folderPath;

            console.log('[QuickConvert] 대본 파일 선택:', result);

            // 대본 파일 내용을 읽어서 문장 목록에 표시
            await loadScriptToSentenceList();
        }
    } catch (error) {
        console.error('[QuickConvert] 파일 선택 오류:', error);
        alert('파일 선택 중 오류가 발생했습니다.');
    }
}

/**
 * 대본 파일을 읽어서 문장 목록에 표시
 */
async function loadScriptToSentenceList() {
    if (!quickScriptPath) return;

    try {
        const content = await eel.studio_read_text_file(quickScriptPath)();
        const clips = parseScriptToClips(content);

        // 문장 목록 컨테이너
        const sentenceList = document.getElementById('design-sentence-list');
        sentenceList.innerHTML = '';

        // 캐릭터별로 색상 자동 할당
        const characterColors = {};
        const colors = ['#6495ED', '#FFB6C1', '#98FB98', '#FFD700', '#DDA0DD', '#F0E68C', '#87CEEB', '#FFA07A'];
        let colorIndex = 0;

        // 각 클립을 문장 아이템으로 변환
        clips.forEach((clip, index) => {
            // 캐릭터 색상 할당
            if (!characterColors[clip.character]) {
                characterColors[clip.character] = colors[colorIndex % colors.length];
                colorIndex++;
            }

            const sentenceItem = document.createElement('div');
            sentenceItem.className = 'sentence-item';
            sentenceItem.dataset.index = index;
            sentenceItem.dataset.character = clip.character;

            sentenceItem.innerHTML = `
                <input type="checkbox" checked onchange="quickToggleSentence(${index})">
                <div class="sentence-color" style="background: ${characterColors[clip.character]}"></div>
                <div class="sentence-character">${clip.character}</div>
                <div class="sentence-text" contenteditable="true" onblur="quickUpdateSentenceText(${index}, this)">${clip.text}</div>
                <button class="btn-icon-sm" onclick="quickPlaySentence(${index})" title="미리듣기">▶</button>
            `;

            sentenceList.appendChild(sentenceItem);
        });

        // 캐릭터 음성 설정 자동 생성
        loadCharactersToVoiceSettings(characterColors);

        console.log('[QuickConvert] 문장 목록 로드 완료:', clips.length, '개');
    } catch (error) {
        console.error('[QuickConvert] 대본 로드 오류:', error);
        alert('대본 파일을 읽을 수 없습니다.');
    }
}

/**
 * 캐릭터 음성 설정 자동 생성
 */
function loadCharactersToVoiceSettings(characterColors) {
    const characterList = document.getElementById('design-character-list');
    characterList.innerHTML = '';

    const characters = Object.keys(characterColors);
    const defaultVoiceModel = document.getElementById('quick-voice-model').value;

    characters.forEach((character, index) => {
        const characterItem = document.createElement('div');
        characterItem.className = 'character-item';
        characterItem.dataset.character = character;

        const voiceModelGroup = getVoiceModelGroup(defaultVoiceModel);

        characterItem.innerHTML = `
            <div class="character-header">
                <div class="character-name">
                    <div class="character-color" style="background: ${characterColors[character]}"></div>
                    <input type="text" value="${character}" class="character-name-input" readonly>
                </div>
                <button class="btn-icon-sm" onclick="quickPreviewCharacterVoice('${character}')" title="미리듣기">▶</button>
            </div>
            <div class="character-settings">
                <div class="form-row">
                    <select class="voice-model-select" onchange="quickUpdateCharacterVoiceModel('${character}', this.value)">
                        <option value="Wavenet" ${voiceModelGroup === 'Wavenet' ? 'selected' : ''}>Wavenet</option>
                        <option value="Neural2" ${voiceModelGroup === 'Neural2' ? 'selected' : ''}>Neural2</option>
                        <option value="Chirp3-HD-Female" ${voiceModelGroup === 'Chirp3-HD-Female' ? 'selected' : ''}>Chirp3-HD 여성</option>
                        <option value="Chirp3-HD-Male" ${voiceModelGroup === 'Chirp3-HD-Male' ? 'selected' : ''}>Chirp3-HD 남성</option>
                        <option value="Standard" ${voiceModelGroup === 'Standard' ? 'selected' : ''}>Standard</option>
                    </select>
                    <select class="voice-select" data-character="${character}" onchange="quickUpdateCharacterVoice('${character}', this.value)">
                        ${getVoiceOptionsHTML(voiceModelGroup, defaultVoiceModel)}
                    </select>
                </div>
                <div class="slider-row">
                    <label>속도</label>
                    <input type="range" min="0.25" max="4.0" step="0.05" value="1.0"
                           oninput="quickUpdateCharacterRate('${character}', this.value, this)">
                    <span class="slider-value">1.0</span>
                </div>
                <div class="slider-row">
                    <label>피치</label>
                    <input type="range" min="-20" max="20" step="1" value="0"
                           oninput="quickUpdateCharacterPitch('${character}', this.value, this)">
                    <span class="slider-value">0</span>
                </div>
            </div>
        `;

        characterList.appendChild(characterItem);
    });

    // 캐릭터 음성 설정 저장
    window.quickCharacterVoices = {};
    characters.forEach(character => {
        window.quickCharacterVoices[character] = {
            voice: defaultVoiceModel,
            rate: 1.0,
            pitch: 0
        };
    });
}

/**
 * 음성 모델에서 그룹 추출
 */
function getVoiceModelGroup(voiceModel) {
    if (voiceModel.includes('Wavenet')) return 'Wavenet';
    if (voiceModel.includes('Neural2')) return 'Neural2';
    if (voiceModel.includes('Chirp3-HD')) {
        // Chirp3-HD는 여성/남성으로 구분
        const femalVoices = ['Achernar', 'Aoede', 'Autonoe', 'Callirrhoe', 'Despina', 'Erinome', 'Gacrux', 'Kore', 'Laomedeia', 'Leda', 'Pulcherrima', 'Sulafat', 'Vindemiatrix', 'Zephyr'];
        const voiceName = voiceModel.split('-').pop();
        if (femaleVoices.includes(voiceName)) {
            return 'Chirp3-HD-Female';
        } else {
            return 'Chirp3-HD-Male';
        }
    }
    if (voiceModel.includes('Standard')) return 'Standard';
    return 'Wavenet';
}

/**
 * 음성 모델 표시 이름
 */
function getVoiceDisplayName(voiceModel) {
    const parts = voiceModel.split('-');
    return parts[parts.length - 1];
}

/**
 * 음성 모델 그룹에 따른 음성 옵션 HTML 생성
 */
function getVoiceOptionsHTML(voiceModelGroup, selectedVoice) {
    let optionsHTML = '';

    switch(voiceModelGroup) {
        case 'Wavenet':
            optionsHTML = `
                <option value="ko-KR-Wavenet-A" ${selectedVoice === 'ko-KR-Wavenet-A' ? 'selected' : ''}>A_여성</option>
                <option value="ko-KR-Wavenet-B" ${selectedVoice === 'ko-KR-Wavenet-B' ? 'selected' : ''}>B_여성</option>
                <option value="ko-KR-Wavenet-C" ${selectedVoice === 'ko-KR-Wavenet-C' ? 'selected' : ''}>C_남성</option>
                <option value="ko-KR-Wavenet-D" ${selectedVoice === 'ko-KR-Wavenet-D' ? 'selected' : ''}>D_남성</option>
            `;
            break;
        case 'Neural2':
            optionsHTML = `
                <option value="ko-KR-Neural2-A" ${selectedVoice === 'ko-KR-Neural2-A' ? 'selected' : ''}>A_여성</option>
                <option value="ko-KR-Neural2-B" ${selectedVoice === 'ko-KR-Neural2-B' ? 'selected' : ''}>B_여성</option>
                <option value="ko-KR-Neural2-C" ${selectedVoice === 'ko-KR-Neural2-C' ? 'selected' : ''}>C_남성</option>
            `;
            break;
        case 'Chirp3-HD-Female':
            optionsHTML = `
                <option value="ko-KR-Chirp3-HD-Achernar" ${selectedVoice === 'ko-KR-Chirp3-HD-Achernar' ? 'selected' : ''}>Achernar</option>
                <option value="ko-KR-Chirp3-HD-Aoede" ${selectedVoice === 'ko-KR-Chirp3-HD-Aoede' ? 'selected' : ''}>Aoede</option>
                <option value="ko-KR-Chirp3-HD-Autonoe" ${selectedVoice === 'ko-KR-Chirp3-HD-Autonoe' ? 'selected' : ''}>Autonoe</option>
                <option value="ko-KR-Chirp3-HD-Callirrhoe" ${selectedVoice === 'ko-KR-Chirp3-HD-Callirrhoe' ? 'selected' : ''}>Callirrhoe</option>
                <option value="ko-KR-Chirp3-HD-Despina" ${selectedVoice === 'ko-KR-Chirp3-HD-Despina' ? 'selected' : ''}>Despina</option>
                <option value="ko-KR-Chirp3-HD-Erinome" ${selectedVoice === 'ko-KR-Chirp3-HD-Erinome' ? 'selected' : ''}>Erinome</option>
                <option value="ko-KR-Chirp3-HD-Gacrux" ${selectedVoice === 'ko-KR-Chirp3-HD-Gacrux' ? 'selected' : ''}>Gacrux</option>
                <option value="ko-KR-Chirp3-HD-Kore" ${selectedVoice === 'ko-KR-Chirp3-HD-Kore' ? 'selected' : ''}>Kore</option>
                <option value="ko-KR-Chirp3-HD-Laomedeia" ${selectedVoice === 'ko-KR-Chirp3-HD-Laomedeia' ? 'selected' : ''}>Laomedeia</option>
                <option value="ko-KR-Chirp3-HD-Leda" ${selectedVoice === 'ko-KR-Chirp3-HD-Leda' ? 'selected' : ''}>Leda</option>
                <option value="ko-KR-Chirp3-HD-Pulcherrima" ${selectedVoice === 'ko-KR-Chirp3-HD-Pulcherrima' ? 'selected' : ''}>Pulcherrima</option>
                <option value="ko-KR-Chirp3-HD-Sulafat" ${selectedVoice === 'ko-KR-Chirp3-HD-Sulafat' ? 'selected' : ''}>Sulafat</option>
                <option value="ko-KR-Chirp3-HD-Vindemiatrix" ${selectedVoice === 'ko-KR-Chirp3-HD-Vindemiatrix' ? 'selected' : ''}>Vindemiatrix</option>
                <option value="ko-KR-Chirp3-HD-Zephyr" ${selectedVoice === 'ko-KR-Chirp3-HD-Zephyr' ? 'selected' : ''}>Zephyr</option>
            `;
            break;
        case 'Chirp3-HD-Male':
            optionsHTML = `
                <option value="ko-KR-Chirp3-HD-Achird" ${selectedVoice === 'ko-KR-Chirp3-HD-Achird' ? 'selected' : ''}>Achird</option>
                <option value="ko-KR-Chirp3-HD-Algenib" ${selectedVoice === 'ko-KR-Chirp3-HD-Algenib' ? 'selected' : ''}>Algenib</option>
                <option value="ko-KR-Chirp3-HD-Algieba" ${selectedVoice === 'ko-KR-Chirp3-HD-Algieba' ? 'selected' : ''}>Algieba</option>
                <option value="ko-KR-Chirp3-HD-Alnilam" ${selectedVoice === 'ko-KR-Chirp3-HD-Alnilam' ? 'selected' : ''}>Alnilam</option>
                <option value="ko-KR-Chirp3-HD-Charon" ${selectedVoice === 'ko-KR-Chirp3-HD-Charon' ? 'selected' : ''}>Charon</option>
                <option value="ko-KR-Chirp3-HD-Enceladus" ${selectedVoice === 'ko-KR-Chirp3-HD-Enceladus' ? 'selected' : ''}>Enceladus</option>
                <option value="ko-KR-Chirp3-HD-Fenrir" ${selectedVoice === 'ko-KR-Chirp3-HD-Fenrir' ? 'selected' : ''}>Fenrir</option>
                <option value="ko-KR-Chirp3-HD-Iapetus" ${selectedVoice === 'ko-KR-Chirp3-HD-Iapetus' ? 'selected' : ''}>Iapetus</option>
                <option value="ko-KR-Chirp3-HD-Orus" ${selectedVoice === 'ko-KR-Chirp3-HD-Orus' ? 'selected' : ''}>Orus</option>
                <option value="ko-KR-Chirp3-HD-Puck" ${selectedVoice === 'ko-KR-Chirp3-HD-Puck' ? 'selected' : ''}>Puck</option>
                <option value="ko-KR-Chirp3-HD-Rasalgethi" ${selectedVoice === 'ko-KR-Chirp3-HD-Rasalgethi' ? 'selected' : ''}>Rasalgethi</option>
                <option value="ko-KR-Chirp3-HD-Sadachbia" ${selectedVoice === 'ko-KR-Chirp3-HD-Sadachbia' ? 'selected' : ''}>Sadachbia</option>
                <option value="ko-KR-Chirp3-HD-Sadaltager" ${selectedVoice === 'ko-KR-Chirp3-HD-Sadaltager' ? 'selected' : ''}>Sadaltager</option>
                <option value="ko-KR-Chirp3-HD-Schedar" ${selectedVoice === 'ko-KR-Chirp3-HD-Schedar' ? 'selected' : ''}>Schedar</option>
                <option value="ko-KR-Chirp3-HD-Umbriel" ${selectedVoice === 'ko-KR-Chirp3-HD-Umbriel' ? 'selected' : ''}>Umbriel</option>
                <option value="ko-KR-Chirp3-HD-Zubenelgenubi" ${selectedVoice === 'ko-KR-Chirp3-HD-Zubenelgenubi' ? 'selected' : ''}>Zubenelgenubi</option>
            `;
            break;
        case 'Standard':
            optionsHTML = `
                <option value="ko-KR-Standard-A" ${selectedVoice === 'ko-KR-Standard-A' ? 'selected' : ''}>A_여성</option>
                <option value="ko-KR-Standard-B" ${selectedVoice === 'ko-KR-Standard-B' ? 'selected' : ''}>B_여성</option>
                <option value="ko-KR-Standard-C" ${selectedVoice === 'ko-KR-Standard-C' ? 'selected' : ''}>C_남성</option>
                <option value="ko-KR-Standard-D" ${selectedVoice === 'ko-KR-Standard-D' ? 'selected' : ''}>D_남성</option>
            `;
            break;
        default:
            optionsHTML = `<option value="ko-KR-Wavenet-A">A_여성</option>`;
    }

    return optionsHTML;
}

/**
 * 문장 활성화/비활성화 토글
 */
function quickToggleSentence(index) {
    console.log('[QuickConvert] 문장 토글:', index);
}

/**
 * 문장 텍스트 업데이트
 */
function quickUpdateSentenceText(index, element) {
    const newText = element.textContent.trim();
    console.log('[QuickConvert] 문장 업데이트:', index, newText);
}

/**
 * 문장 미리듣기
 */
async function quickPlaySentence(index) {
    const sentenceItem = document.querySelector(`[data-index="${index}"]`);
    if (!sentenceItem) return;

    const character = sentenceItem.dataset.character;
    const text = sentenceItem.querySelector('.sentence-text').textContent.trim();
    const voiceSettings = window.quickCharacterVoices[character];

    if (!voiceSettings) {
        alert('캐릭터 음성 설정이 없습니다.');
        return;
    }

    try {
        console.log('[QuickConvert] 미리듣기:', character, text);
        const result = await eel.generate_quick_tts_eel(text, voiceSettings.voice)();

        if (result && result.success) {
            // 오디오 재생
            const audio = new Audio('file://' + result.file_path);
            audio.play();
        } else {
            alert(`미리듣기 실패: ${result?.error || '알 수 없는 오류'}`);
        }
    } catch (error) {
        console.error('[QuickConvert] 미리듣기 오류:', error);
        alert('미리듣기 중 오류가 발생했습니다.');
    }
}

/**
 * 캐릭터 음성 미리듣기
 */
async function quickPreviewCharacterVoice(character) {
    const voiceSettings = window.quickCharacterVoices[character];
    if (!voiceSettings) {
        alert('캐릭터 음성 설정이 없습니다.');
        return;
    }

    const sampleText = '안녕하세요. 이것은 음성 미리듣기 테스트입니다.';

    try {
        console.log('[QuickConvert] 캐릭터 음성 미리듣기:', character, voiceSettings.voice);
        const result = await eel.generate_quick_tts_eel(sampleText, voiceSettings.voice)();

        if (result && result.success) {
            const audio = new Audio('file://' + result.file_path);
            audio.play();
        } else {
            alert(`미리듣기 실패: ${result?.error || '알 수 없는 오류'}`);
        }
    } catch (error) {
        console.error('[QuickConvert] 캐릭터 음성 미리듣기 오류:', error);
        alert('미리듣기 중 오류가 발생했습니다.');
    }
}

/**
 * 캐릭터 음성 모델 변경
 */
function quickUpdateCharacterVoiceModel(character, modelGroup) {
    console.log('[QuickConvert] 캐릭터 음성 모델 변경:', character, modelGroup);

    // 해당 캐릭터의 음성 선택 드롭다운 찾기
    const characterItem = document.querySelector(`[data-character="${character}"]`);
    if (!characterItem) return;

    const voiceSelect = characterItem.querySelector('.voice-select');
    if (!voiceSelect) return;

    // 기본 음성 결정
    let defaultVoice = '';
    switch(modelGroup) {
        case 'Wavenet':
            defaultVoice = 'ko-KR-Wavenet-A';
            break;
        case 'Neural2':
            defaultVoice = 'ko-KR-Neural2-A';
            break;
        case 'Chirp3-HD-Female':
            defaultVoice = 'ko-KR-Chirp3-HD-Achernar';
            break;
        case 'Chirp3-HD-Male':
            defaultVoice = 'ko-KR-Chirp3-HD-Achird';
            break;
        case 'Standard':
            defaultVoice = 'ko-KR-Standard-A';
            break;
        default:
            defaultVoice = 'ko-KR-Wavenet-A';
    }

    // 음성 옵션 업데이트
    voiceSelect.innerHTML = getVoiceOptionsHTML(modelGroup, defaultVoice);

    // 캐릭터 음성 설정 업데이트
    if (window.quickCharacterVoices[character]) {
        window.quickCharacterVoices[character].voice = defaultVoice;
    }
}

/**
 * 캐릭터 음성 변경
 */
function quickUpdateCharacterVoice(character, voice) {
    console.log('[QuickConvert] 캐릭터 음성 변경:', character, voice);

    // 캐릭터 음성 설정 업데이트
    if (window.quickCharacterVoices[character]) {
        window.quickCharacterVoices[character].voice = voice;
    }
}

/**
 * 캐릭터 속도 변경
 */
function quickUpdateCharacterRate(character, rate, sliderElement) {
    if (window.quickCharacterVoices[character]) {
        window.quickCharacterVoices[character].rate = parseFloat(rate);
    }
    // 슬라이더 값 표시 업데이트
    if (sliderElement) {
        const valueSpan = sliderElement.parentElement.querySelector('.slider-value');
        if (valueSpan) {
            valueSpan.textContent = parseFloat(rate).toFixed(2);
        }
    }
}

/**
 * 캐릭터 피치 변경
 */
function quickUpdateCharacterPitch(character, pitch, sliderElement) {
    if (window.quickCharacterVoices[character]) {
        window.quickCharacterVoices[character].pitch = parseFloat(pitch);
    }
    // 슬라이더 값 표시 업데이트
    if (sliderElement) {
        const valueSpan = sliderElement.parentElement.querySelector('.slider-value');
        if (valueSpan) {
            valueSpan.textContent = parseInt(pitch);
        }
    }
}

/**
 * 출력 폴더 선택
 */
async function quickSelectOutputFolder() {
    try {
        const result = await eel.select_folder()();
        if (result && result.path) {
            quickOutputFolder = result.path;
            document.getElementById('quick-output-folder').value = result.path;
            console.log('[QuickConvert] 출력 폴더 선택:', result.path);
        }
    } catch (error) {
        console.error('[QuickConvert] 폴더 선택 오류:', error);
        alert('폴더 선택 중 오류가 발생했습니다.');
    }
}

/**
 * MP3 + SRT 생성
 */
async function quickConvert() {
    if (!quickScriptPath) {
        alert('대본 파일을 선택해주세요.');
        return;
    }

    try {
        // 진행 상태 표시
        const progressDiv = document.getElementById('quick-convert-progress');
        const progressBar = document.getElementById('quick-progress-bar');
        progressDiv.style.display = 'block';
        progressBar.style.width = '0%';

        console.log('[QuickConvert] 변환 시작:', quickScriptPath);

        // 1. 대본 파일 읽기
        progressBar.style.width = '10%';
        const content = await eel.studio_read_text_file(quickScriptPath)();

        // 2. 문장 분리
        progressBar.style.width = '20%';
        const clips = parseScriptToClips(content);
        console.log('[QuickConvert] 문장 분리 완료:', clips.length, '개');

        // 3. 음성 모델 가져오기
        const voiceModel = document.getElementById('quick-voice-model').value;

        // 4. TTS 생성 및 MP3 결합
        progressBar.style.width = '30%';
        document.querySelector('.progress-text').textContent = 'TTS 생성 중...';

        const audioSegments = [];
        let totalDuration = 0;

        for (let i = 0; i < clips.length; i++) {
            const clip = clips[i];
            const progress = 30 + (i / clips.length) * 50;
            progressBar.style.width = progress + '%';

            // 캐릭터별 음성 설정 가져오기 (없으면 기본 음성 사용)
            const characterVoice = window.quickCharacterVoices && window.quickCharacterVoices[clip.character]
                ? window.quickCharacterVoices[clip.character].voice
                : voiceModel;

            // TTS 생성 (백엔드 함수 호출)
            const ttsResult = await eel.generate_quick_tts_eel(clip.text, characterVoice)();

            if (ttsResult && ttsResult.success) {
                audioSegments.push({
                    file: ttsResult.file_path,
                    duration: ttsResult.duration || 0,
                    start: totalDuration,
                    end: totalDuration + (ttsResult.duration || 0),
                    text: clip.text
                });
                totalDuration += ttsResult.duration || 0;
            } else {
                // TTS 생성 실패 시 에러 로깅 및 알림
                console.error('[QuickConvert] TTS 생성 실패:', clip.text, ttsResult);
                progressDiv.style.display = 'none';
                alert(`TTS 생성 실패: ${ttsResult?.error || '알 수 없는 오류'}\n\n텍스트: ${clip.text}\n\n상단의 🔑 API 키 버튼에서 Google Cloud TTS API 키를 등록해주세요.`);
                return;
            }
        }

        // 5. MP3 결합 및 SRT 생성
        progressBar.style.width = '80%';
        document.querySelector('.progress-text').textContent = 'MP3 결합 및 SRT 생성 중...';

        // 경로 구분자 통일 (Windows/Linux 모두 지원)
        const normalizedPath = quickScriptPath.replace(/\\/g, '/');
        const scriptFileName = normalizedPath.substring(normalizedPath.lastIndexOf('/') + 1);
        const baseName = scriptFileName.replace(/\.[^/.]+$/, '');

        let folderPath = quickOutputFolder;
        if (!folderPath) {
            folderPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
        } else {
            folderPath = folderPath.replace(/\\/g, '/');
        }

        const outputPath = folderPath + '/' + baseName;

        // 백엔드에서 MP3 결합 및 SRT 생성
        const result = await eel.combine_audio_and_generate_srt_eel(audioSegments, outputPath)();

        // 완료
        progressBar.style.width = '100%';
        document.querySelector('.progress-text').textContent = '완료!';

        setTimeout(() => {
            progressDiv.style.display = 'none';
            if (result && result.success) {
                alert(`변환 완료!\n\nMP3: ${result.mp3_path}\nSRT: ${result.srt_path}`);
            } else {
                alert('변환이 완료되었지만 일부 오류가 있을 수 있습니다.');
            }
        }, 1000);

        console.log('[QuickConvert] 변환 완료');

    } catch (error) {
        console.error('[QuickConvert] 변환 오류:', error);
        alert('변환 중 오류가 발생했습니다: ' + error);
        document.getElementById('quick-convert-progress').style.display = 'none';
    }
}

/**
 * MP3만 생성
 */
async function quickConvertMP3Only() {
    if (!quickScriptPath) {
        alert('대본 파일을 선택해주세요.');
        return;
    }

    try {
        const progressDiv = document.getElementById('quick-convert-progress');
        const progressBar = document.getElementById('quick-progress-bar');
        progressDiv.style.display = 'block';
        progressBar.style.width = '0%';

        console.log('[QuickConvert] MP3만 생성 시작:', quickScriptPath);

        // 대본 읽기 및 문장 분리
        const content = await eel.studio_read_text_file(quickScriptPath)();
        const clips = parseScriptToClips(content);

        const voiceModel = document.getElementById('quick-voice-model').value;

        const audioSegments = [];

        for (let i = 0; i < clips.length; i++) {
            const clip = clips[i];
            const progress = (i / clips.length) * 90;
            progressBar.style.width = progress + '%';

            // 캐릭터별 음성 설정 가져오기 (없으면 기본 음성 사용)
            const characterVoice = window.quickCharacterVoices && window.quickCharacterVoices[clip.character]
                ? window.quickCharacterVoices[clip.character].voice
                : voiceModel;

            const ttsResult = await eel.generate_quick_tts_eel(clip.text, characterVoice)();

            if (ttsResult && ttsResult.success) {
                audioSegments.push({
                    file: ttsResult.file_path,
                    duration: ttsResult.duration || 0
                });
            } else {
                // TTS 생성 실패 시 에러 로깅 및 알림
                console.error('[QuickConvert] TTS 생성 실패 (MP3 전용):', clip.text, ttsResult);
                progressDiv.style.display = 'none';
                alert(`TTS 생성 실패: ${ttsResult?.error || '알 수 없는 오류'}\n\n텍스트: ${clip.text}\n\n상단의 🔑 API 키 버튼에서 Google Cloud TTS API 키를 등록해주세요.`);
                return;
            }
        }

        progressBar.style.width = '95%';

        // 경로 구분자 통일 (Windows/Linux 모두 지원)
        const normalizedPath = quickScriptPath.replace(/\\/g, '/');
        const scriptFileName = normalizedPath.substring(normalizedPath.lastIndexOf('/') + 1);
        const baseName = scriptFileName.replace(/\.[^/.]+$/, '');

        let folderPath = quickOutputFolder;
        if (!folderPath) {
            folderPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
        } else {
            folderPath = folderPath.replace(/\\/g, '/');
        }

        const outputPath = folderPath + '/' + baseName + '.mp3';

        const result = await eel.combine_audio_files_only_eel(audioSegments, outputPath)();

        progressBar.style.width = '100%';
        document.querySelector('.progress-text').textContent = '완료!';

        setTimeout(() => {
            progressDiv.style.display = 'none';
            if (result && result.success) {
                alert(`MP3 생성 완료!\n\n${result.mp3_path}`);
            }
        }, 1000);

    } catch (error) {
        console.error('[QuickConvert] MP3 생성 오류:', error);
        alert('MP3 생성 중 오류가 발생했습니다: ' + error);
        document.getElementById('quick-convert-progress').style.display = 'none';
    }
}

/**
 * 대본 텍스트를 문장 단위로 분리
 */
function parseScriptToClips(content) {
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
                // 문장 단위로 분리
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

    return clips;
}

console.log('[QuickConvert] 빠른 변환 기능 로드 완료');
