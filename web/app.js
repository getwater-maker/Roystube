/**
 * Roystube 애플리케이션 메인 JavaScript
 */

// ========== F5 새로고침 처리 ==========
document.addEventListener('DOMContentLoaded', () => {
    // F5 키 이벤트 감지
    document.addEventListener('keydown', (event) => {
        if (event.key === 'F5' || (event.ctrlKey && event.key === 'r')) {
            event.preventDefault(); // 기본 동작 방지
            console.log('[Roystube] 페이지 새로고침 (F5)');
            location.reload(); // 페이지만 새로고침
        }
    });
});

// ========== API 키 관리 ==========

async function showApiKeyManager() {
    const modal = document.getElementById('api-key-modal');
    modal.style.display = 'flex';
    await loadApiKeys();
}

function closeApiKeyModal() {
    const modal = document.getElementById('api-key-modal');
    modal.style.display = 'none';
}

async function loadApiKeys() {
    try {
        const result = await eel.studio_get_tts_api_keys()();
        const listDiv = document.getElementById('api-key-list');

        if (result.success && result.keys && result.keys.length > 0) {
            listDiv.innerHTML = result.keys.map((key, index) => `
                <div class="api-key-item">
                    <div class="api-key-info-row">
                        <span class="api-key-name">${key.name || `API 키 ${index + 1}`}</span>
                        <span class="api-key-preview">${key.key_preview}</span>
                    </div>
                    <div class="api-key-actions">
                        <button class="btn btn-sm btn-danger" onclick="deleteApiKey('${key.id}')">삭제</button>
                    </div>
                </div>
            `).join('');
        } else {
            listDiv.innerHTML = '<p class="api-key-empty">등록된 API 키가 없습니다.</p>';
        }
    } catch (error) {
        console.error('[API Key] 키 목록 로드 오류:', error);
        document.getElementById('api-key-list').innerHTML = '<p class="api-key-error">API 키 목록을 불러올 수 없습니다.</p>';
    }
}

async function addApiKey() {
    const name = document.getElementById('new-api-key-name').value.trim() || '';
    const apiKey = document.getElementById('new-api-key-value').value.trim();

    if (!apiKey) {
        alert('API 키를 입력해주세요.');
        return;
    }

    if (!apiKey.startsWith('AIza')) {
        if (!confirm('일반적인 Google API 키는 "AIza"로 시작합니다. 계속하시겠습니까?')) {
            return;
        }
    }

    try {
        const result = await eel.studio_add_tts_api_key(apiKey, name)();

        if (result && result.success) {
            alert('API 키가 추가되었습니다.');
            document.getElementById('new-api-key-name').value = '';
            document.getElementById('new-api-key-value').value = '';
            await loadApiKeys();
        } else {
            alert(`API 키 추가 실패: ${result.error || '알 수 없는 오류'}`);
        }
    } catch (error) {
        console.error('[API Key] 추가 오류:', error);
        alert('API 키 추가 중 오류가 발생했습니다.');
    }
}

async function deleteApiKey(keyId) {
    if (!confirm('이 API 키를 삭제하시겠습니까?')) {
        return;
    }

    try {
        const result = await eel.studio_remove_tts_api_key(keyId)();

        if (result && result.success) {
            alert('API 키가 삭제되었습니다.');
            await loadApiKeys();
        } else {
            alert(`API 키 삭제 실패: ${result.error || '알 수 없는 오류'}`);
        }
    } catch (error) {
        console.error('[API Key] 삭제 오류:', error);
        alert('API 키 삭제 중 오류가 발생했습니다.');
    }
}

// 모달 외부 클릭 시 닫기
window.addEventListener('click', (event) => {
    const modal = document.getElementById('api-key-modal');
    if (event.target === modal) {
        closeApiKeyModal();
    }
});

// ========== 홈 이동 ==========

function goHome() {
    // 영상 디자인 탭으로 이동
    const targetTab = 'studio-tts-design';
    const tabs = document.querySelectorAll('.tab-pane');
    const buttons = document.querySelectorAll('.tab-btn');

    tabs.forEach(tab => tab.classList.remove('active'));
    buttons.forEach(btn => btn.classList.remove('active'));

    const targetPane = document.getElementById('tab-' + targetTab);
    const targetBtn = document.querySelector(`[data-tab="${targetTab}"]`);

    if (targetPane) targetPane.classList.add('active');
    if (targetBtn) targetBtn.classList.add('active');

    console.log('[Roystube] 홈으로 이동');
}

// ========== 설정 및 정보 창 ==========

// 기본 설정값
const DEFAULT_SETTINGS = {
    whisperModel: 'base',
    outputFolder: '',
    subtitleMaxLength: 30,
    silenceDuration: 0.3,
    theme: 'dark'
};

function showSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.style.display = 'flex';
        loadSettings();
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function loadSettings() {
    try {
        // 백엔드에서 설정 불러오기
        const settings = await eel.get_app_settings()();

        if (settings) {
            document.getElementById('setting-whisper-model').value = settings.whisperModel || DEFAULT_SETTINGS.whisperModel;
            document.getElementById('setting-output-folder').value = settings.outputFolder || DEFAULT_SETTINGS.outputFolder;
            document.getElementById('setting-subtitle-max-length').value = settings.subtitleMaxLength || DEFAULT_SETTINGS.subtitleMaxLength;
            document.getElementById('setting-silence-duration').value = settings.silenceDuration || DEFAULT_SETTINGS.silenceDuration;
            document.getElementById('setting-theme').value = settings.theme || DEFAULT_SETTINGS.theme;
        } else {
            // 기본값 설정
            document.getElementById('setting-whisper-model').value = DEFAULT_SETTINGS.whisperModel;
            document.getElementById('setting-output-folder').value = DEFAULT_SETTINGS.outputFolder;
            document.getElementById('setting-subtitle-max-length').value = DEFAULT_SETTINGS.subtitleMaxLength;
            document.getElementById('setting-silence-duration').value = DEFAULT_SETTINGS.silenceDuration;
            document.getElementById('setting-theme').value = DEFAULT_SETTINGS.theme;
        }

        // OAuth 설정 로드
        await loadOAuthSettings();

        // YouTube 계정 상태 로드
        await loadSettingsYouTubeAccount();
    } catch (error) {
        console.error('[Settings] 설정 로드 오류:', error);
        // 오류 발생 시 기본값 사용
        document.getElementById('setting-whisper-model').value = DEFAULT_SETTINGS.whisperModel;
        document.getElementById('setting-output-folder').value = DEFAULT_SETTINGS.outputFolder;
        document.getElementById('setting-subtitle-max-length').value = DEFAULT_SETTINGS.subtitleMaxLength;
        document.getElementById('setting-silence-duration').value = DEFAULT_SETTINGS.silenceDuration;
        document.getElementById('setting-theme').value = DEFAULT_SETTINGS.theme;
    }
}

async function saveSettings() {
    try {
        const settings = {
            whisperModel: document.getElementById('setting-whisper-model').value,
            outputFolder: document.getElementById('setting-output-folder').value,
            subtitleMaxLength: parseInt(document.getElementById('setting-subtitle-max-length').value),
            silenceDuration: parseFloat(document.getElementById('setting-silence-duration').value),
            theme: document.getElementById('setting-theme').value
        };

        const result = await eel.save_app_settings(settings)();

        if (result && result.success) {
            alert('설정이 저장되었습니다!');

            // 테마 적용
            applyTheme(settings.theme);

            closeSettingsModal();
        } else {
            alert('설정 저장 실패: ' + (result ? result.error : '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[Settings] 설정 저장 오류:', error);
        alert('설정 저장 중 오류가 발생했습니다.');
    }
}

async function selectOutputFolder() {
    try {
        const folder = await eel.select_folder('출력 폴더 선택')();
        if (folder && typeof folder === 'string') {
            document.getElementById('setting-output-folder').value = folder;
        }
    } catch (error) {
        console.error('[Settings] 폴더 선택 오류:', error);
        alert('폴더 선택 중 오류가 발생했습니다.');
    }
}

function applyTheme(theme) {
    // 테마 적용 로직 (추후 구현)
    console.log('[Settings] 테마 적용:', theme);
    // TODO: CSS 변수를 통한 테마 변경
}

// ========== OAuth 설정 ==========

async function loadOAuthSettings() {
    try {
        const oauthConfig = await eel.get_oauth_config()();

        const clientIdInput = document.getElementById('setting-oauth-client-id');
        const clientSecretInput = document.getElementById('setting-oauth-client-secret');

        if (oauthConfig) {
            clientIdInput.value = oauthConfig.client_id || '';
            clientSecretInput.value = oauthConfig.client_secret || '';
        } else {
            clientIdInput.value = '';
            clientSecretInput.value = '';
        }
    } catch (error) {
        console.error('[OAuth] 설정 로드 오류:', error);
    }
}

async function saveOAuthSettings() {
    try {
        const clientId = document.getElementById('setting-oauth-client-id').value.trim();
        const clientSecret = document.getElementById('setting-oauth-client-secret').value.trim();

        if (!clientId || !clientSecret) {
            alert('Client ID와 Client Secret을 모두 입력해주세요.');
            return;
        }

        const result = await eel.save_oauth_config(clientId, clientSecret)();

        if (result && result.success) {
            alert('OAuth 설정이 저장되었습니다!\n\n이제 YouTube 로그인을 시도할 수 있습니다.');
        } else {
            alert('OAuth 설정 저장 실패: ' + (result ? result.error : '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[OAuth] 설정 저장 오류:', error);
        alert('OAuth 설정 저장 중 오류가 발생했습니다.');
    }
}

// ========== 설정 모달 내 YouTube 계정 관리 ==========

async function loadSettingsYouTubeAccount() {
    try {
        // 현재 계정 정보 가져오기
        const accountData = await eel.account_get_list()();

        const accountInfoDiv = document.getElementById('setting-youtube-account-info');
        const loginBtn = document.getElementById('setting-youtube-login-btn');
        const logoutBtn = document.getElementById('setting-youtube-logout-btn');
        const channelsDiv = document.getElementById('setting-youtube-channels');

        if (accountData && accountData.current_account_id && accountData.accounts && accountData.accounts.length > 0) {
            // 현재 활성 계정 찾기
            const currentAccount = accountData.accounts.find(acc => acc.id === accountData.current_account_id);

            if (currentAccount) {
                // 현재 계정 ID 설정
                currentAccountId = accountData.current_account_id;

                // 계정 정보 표시
                accountInfoDiv.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg-secondary); border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                        ${currentAccount.thumbnail ? `<img src="${currentAccount.thumbnail}" style="width: 40px; height: 40px; border-radius: 50%;">` : ''}
                        <div style="flex: 1;">
                            <div style="font-weight: 600; font-size: 13px; color: var(--text-primary);">${currentAccount.name}</div>
                            <div style="font-size: 11px; color: var(--text-secondary);">${currentAccount.email}</div>
                        </div>
                        <span style="color: var(--success); font-size: 11px;">✓ 로그인됨</span>
                    </div>
                `;

                loginBtn.style.display = 'none';
                logoutBtn.style.display = 'inline-block';

                // 채널 목록 로드
                await loadSettingsYouTubeChannels();
                channelsDiv.style.display = 'block';
            } else {
                // 로그인되지 않음
                showNotLoggedIn();
            }
        } else {
            // 로그인되지 않음
            showNotLoggedIn();
        }
    } catch (error) {
        console.error('[Settings] YouTube 계정 로드 오류:', error);
        showNotLoggedIn();
    }

    function showNotLoggedIn() {
        const accountInfoDiv = document.getElementById('setting-youtube-account-info');
        const loginBtn = document.getElementById('setting-youtube-login-btn');
        const logoutBtn = document.getElementById('setting-youtube-logout-btn');
        const channelsDiv = document.getElementById('setting-youtube-channels');

        accountInfoDiv.innerHTML = '<div style="color: var(--text-tertiary); font-size: 12px;">로그인되지 않음</div>';
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        channelsDiv.style.display = 'none';
    }
}

async function loadSettingsYouTubeChannels() {
    try {
        const channelListDiv = document.getElementById('setting-channel-list');
        channelListDiv.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-secondary);">로딩 중...</div>';

        console.log('[DEBUG] currentAccountId:', currentAccountId);
        const result = await eel.youtube_get_my_channels(currentAccountId)();
        console.log('[DEBUG] youtube_get_my_channels result:', result);
        console.log('[DEBUG] result.success:', result?.success);
        console.log('[DEBUG] result.error:', result?.error);
        console.log('[DEBUG] result.channels:', result?.channels);
        console.log('[DEBUG] result.channels.length:', result?.channels?.length);

        if (result && result.success && result.channels && result.channels.length > 0) {
            const channels = result.channels;
            const selectedId = result.selected_channel_id;

            // 구독자수 포맷
            const formatCount = (count) => {
                if (count >= 1000000) {
                    return (count / 1000000).toFixed(1) + 'M';
                } else if (count >= 1000) {
                    return (count / 1000).toFixed(1) + 'K';
                }
                return count.toString();
            };

            channelListDiv.innerHTML = channels.map(channel => {
                const isSelected = channel.id === selectedId;
                return `
                    <div style="padding: 12px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 12px; ${isSelected ? 'background: var(--bg-secondary);' : ''}" onclick="selectSettingsYouTubeChannel('${channel.id}')">
                        <img src="${channel.thumbnail}" style="width: 40px; height: 40px; border-radius: 50%;">
                        <div style="flex: 1;">
                            <div style="font-weight: 600; font-size: 13px; color: var(--text-primary);">${channel.title}</div>
                            ${channel.customUrl ? `<div style="font-size: 11px; color: var(--text-secondary);">${channel.customUrl}</div>` : ''}
                            <div style="display: flex; gap: 12px; margin-top: 4px; font-size: 11px; color: var(--text-tertiary);">
                                <span>👥 ${formatCount(channel.subscriberCount)}</span>
                                <span>📹 ${formatCount(channel.videoCount)}</span>
                                <span>👁️ ${formatCount(channel.viewCount)}</span>
                            </div>
                        </div>
                        ${isSelected ? '<span style="color: var(--success); font-size: 18px;">✓</span>' : ''}
                    </div>
                `;
            }).join('');
        } else {
            channelListDiv.innerHTML = `
                <div style="padding: 24px; text-align: center; color: var(--text-tertiary);">
                    접근 가능한 채널이 없습니다
                </div>
            `;
        }
    } catch (error) {
        console.error('[Settings] 채널 목록 로드 오류:', error);
        const channelListDiv = document.getElementById('setting-channel-list');
        channelListDiv.innerHTML = `
            <div style="padding: 24px; text-align: center; color: var(--error);">
                채널 목록을 불러올 수 없습니다
            </div>
        `;
    }
}

async function settingsYouTubeLogin() {
    try {
        const btn = document.getElementById('setting-youtube-login-btn');
        btn.disabled = true;
        btn.textContent = '로그인 중...';

        const result = await eel.account_add_new()();

        if (result && result.success) {
            await loadSettingsYouTubeAccount();
        } else {
            alert('로그인 실패: ' + (result ? result.error : '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[Settings] YouTube 로그인 오류:', error);
        alert('로그인 중 오류가 발생했습니다.');
    } finally {
        const btn = document.getElementById('setting-youtube-login-btn');
        btn.disabled = false;
        btn.textContent = '🔑 YouTube 로그인';
    }
}

async function settingsYouTubeLogout() {
    if (!confirm('YouTube 계정에서 로그아웃하시겠습니까?')) {
        return;
    }

    try {
        // 현재 계정 정보 가져오기
        const accountData = await eel.account_get_list()();
        if (accountData && accountData.current_account_id) {
            const result = await eel.account_remove(accountData.current_account_id)();

            if (result && result.success) {
                await loadSettingsYouTubeAccount();
            } else {
                alert('로그아웃 실패: ' + (result ? result.error : '알 수 없는 오류'));
            }
        }
    } catch (error) {
        console.error('[Settings] YouTube 로그아웃 오류:', error);
        alert('로그아웃 중 오류가 발생했습니다.');
    }
}

async function selectSettingsYouTubeChannel(channelId) {
    try {
        const accountId = currentAccountId || 'default';
        const result = await eel.youtube_select_channel(accountId, channelId)();

        if (result && result.success) {
            await loadSettingsYouTubeChannels();
        } else {
            alert('채널 선택 실패: ' + (result ? result.error : '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[Settings] 채널 선택 오류:', error);
        alert('채널 선택 중 오류가 발생했습니다.');
    }
}

function showAbout() {
    const message = `
로이의 유튜브 v2.0

YouTube 콘텐츠 제작 및 관리 도구

주요 기능:
• YouTube 분석 (채널 모니터, 키워드 검색, 핫트렌드, 돌연변이)
• 콘텐츠 제작 (검은화면, 영상 디자인, 배치 제작, 자막 생성)
• YouTube 관리 (업로드, 구독 관리, 채널 관리, 계정 관리)
• 데이터 & 도구 (Excel 도구, 데이터 관리, 캐시 관리)

© 2024 Roystube
    `.trim();

    alert(message);
}

// ========== 전역 함수들 ==========

// 모든채널모니터 관련
function startAllChannelMonitor() {
    console.log('[AllChannelMonitor] 모니터링 시작');
    alert('모든채널모니터 기능은 아직 구현되지 않았습니다.');
}

function stopAllChannelMonitor() {
    console.log('[AllChannelMonitor] 모니터링 중지');
    alert('모니터링을 중지합니다.');
}

function refreshAllChannels() {
    console.log('[AllChannelMonitor] 새로고침');
    alert('채널을 새로고침합니다.');
}

// 채널모니터 관련
function onChannelChange() {
    const select = document.getElementById('channel-select');
    if (select) {
        console.log('[ChannelMonitor] 채널 선택:', select.value);
    }
}

function startChannelMonitor() {
    console.log('[ChannelMonitor] 모니터링 시작');
    alert('채널모니터 기능은 아직 구현되지 않았습니다.');
}

function stopChannelMonitor() {
    console.log('[ChannelMonitor] 모니터링 중지');
    alert('모니터링을 중지합니다.');
}

function refreshChannel() {
    console.log('[ChannelMonitor] 새로고침');
    alert('채널을 새로고침합니다.');
}

// 키워드검색 관련
function searchKeyword() {
    console.log('[KeywordSearch] 검색 실행');
    alert('키워드 검색 기능은 아직 구현되지 않았습니다.');
}

function exportKeywordResults() {
    console.log('[KeywordSearch] 결과 내보내기');
    alert('검색 결과를 내보냅니다.');
}

// 핫트렌드 관련
function searchHotTrend() {
    console.log('[HotTrend] 핫트렌드 검색');
    alert('핫트렌드 검색 기능은 아직 구현되지 않았습니다.');
}

function exportHotTrends() {
    console.log('[HotTrend] 결과 내보내기');
    alert('핫트렌드 결과를 내보냅니다.');
}

// 돌연변이 관련
function searchMutation() {
    console.log('[Mutation] 돌연변이 검색');
    alert('돌연변이 검색 기능은 아직 구현되지 않았습니다.');
}

function exportMutations() {
    console.log('[Mutation] 결과 내보내기');
    alert('돌연변이 결과를 내보냅니다.');
}

// 자막 생성 관련
function selectSubtitleVideo() {
    console.log('[Subtitle] 비디오 파일 선택');
    alert('비디오 파일 선택 기능은 아직 구현되지 않았습니다.');
}

function generateSubtitle() {
    console.log('[Subtitle] 자막 생성');
    alert('자막 생성 기능은 아직 구현되지 않았습니다.');
}

// 구독 관리 관련
function loadSubscriptions() {
    console.log('[Subscription] 구독 목록 로드');
    alert('구독 목록 새로고침 기능은 아직 구현되지 않았습니다.');
}

function exportSubscriptions() {
    console.log('[Subscription] 구독 목록 내보내기');
    alert('구독 목록을 내보냅니다.');
}

function importSubscriptions() {
    console.log('[Subscription] 구독 목록 가져오기');
    alert('구독 목록을 가져옵니다.');
}

function clearCache() {
    console.log('[Cache] 캐시 삭제');
    if (confirm('캐시를 삭제하시겠습니까?')) {
        alert('캐시가 삭제되었습니다.');
    }
}

// 계정 관리 관련
function addNewAccount() {
    console.log('[Account] 계정 추가');
    alert('계정 추가 기능은 아직 구현되지 않았습니다.');
}

function saveOAuthAccount() {
    console.log('[Account] OAuth 계정 저장');
    alert('OAuth 계정이 저장되었습니다.');
}

// Excel 도구 관련
function selectExcelFiles() {
    console.log('[Excel] Excel 파일 선택');
    alert('Excel 파일 선택 기능은 아직 구현되지 않았습니다.');
}

function extractUrlsFromExcel() {
    console.log('[Excel] URL 추출');
    alert('URL 추출 기능은 아직 구현되지 않았습니다.');
}

function extractCellsFromExcel() {
    console.log('[Excel] 셀 추출');
    alert('셀 추출 기능은 아직 구현되지 않았습니다.');
}

// 데이터 관리 관련
function exportCredentials() {
    console.log('[Data] 인증 정보 내보내기');
    alert('인증 정보를 내보냅니다.');
}

function importCredentials() {
    console.log('[Data] 인증 정보 가져오기');
    alert('인증 정보를 가져옵니다.');
}

function openDataFolder() {
    console.log('[Data] 데이터 폴더 열기');
    alert('데이터 폴더 열기 기능은 아직 구현되지 않았습니다.');
}

// 캐시 관리 관련
function refreshCacheStats() {
    console.log('[Cache] 캐시 통계 새로고침');
    alert('캐시 통계를 새로고칩니다.');
}

// 채널 관리 관련
function managerAddChannel() {
    console.log('[Manager] 채널 추가');
    alert('채널 추가 기능은 아직 구현되지 않았습니다.');
}

function managerAddAccount() {
    console.log('[Manager] 계정 추가');
    alert('계정 추가 기능은 아직 구현되지 않았습니다.');
}

// YouTube 관련
function youtubeSelectVideo() {
    console.log('[YouTube] 비디오 파일 선택');
    alert('비디오 파일 선택 기능은 아직 구현되지 않았습니다.');
}

// ========== YouTube 채널 관리 ==========

let currentAccountId = null; // 현재 로그인한 계정 ID
let currentChannels = []; // 채널 목록 캐시

async function loadYouTubeChannels() {
    const btn = document.getElementById('load-channels-btn');
    const status = document.getElementById('channel-load-status');
    const channelList = document.getElementById('youtube-channel-list');

    try {
        // 로딩 상태
        btn.disabled = true;
        status.textContent = '로딩 중...';
        status.style.color = 'var(--text-secondary)';

        // TODO: 현재 계정 ID 가져오기 (계정 관리 시스템과 연동 필요)
        // 임시로 null 전달 (백엔드에서 현재 계정 사용)
        const result = await eel.youtube_get_my_channels(currentAccountId)();

        if (result.success) {
            currentChannels = result.channels || [];
            const selectedId = result.selected_channel_id;

            if (currentChannels.length === 0) {
                channelList.innerHTML = `
                    <div class="channel-empty-state">
                        접근 가능한 채널이 없습니다.<br>
                        YouTube 계정에 로그인했는지 확인하세요.
                    </div>
                `;
                status.textContent = '채널이 없습니다';
                status.style.color = 'var(--text-tertiary)';
            } else {
                renderChannels(currentChannels, selectedId);
                status.textContent = `${currentChannels.length}개 채널 로드됨`;
                status.style.color = 'var(--success)';
            }
        } else {
            channelList.innerHTML = `
                <div class="channel-empty-state">
                    ⚠️ ${result.error || '채널 목록을 불러올 수 없습니다'}
                </div>
            `;
            status.textContent = '로드 실패';
            status.style.color = 'var(--error)';
        }
    } catch (error) {
        console.error('[YouTube] 채널 로드 오류:', error);
        channelList.innerHTML = `
            <div class="channel-empty-state">
                ⚠️ 오류가 발생했습니다: ${error.message}
            </div>
        `;
        status.textContent = '오류 발생';
        status.style.color = 'var(--error)';
    } finally {
        btn.disabled = false;
    }
}

function renderChannels(channels, selectedChannelId) {
    const channelList = document.getElementById('youtube-channel-list');

    channelList.innerHTML = channels.map(channel => {
        const isSelected = channel.id === selectedChannelId;

        // 구독자수 포맷 (1.2K, 1.2M 형식)
        const formatCount = (count) => {
            if (count >= 1000000) {
                return (count / 1000000).toFixed(1) + 'M';
            } else if (count >= 1000) {
                return (count / 1000).toFixed(1) + 'K';
            }
            return count.toString();
        };

        return `
            <div class="channel-item ${isSelected ? 'selected' : ''}" onclick="selectYouTubeChannel('${channel.id}')">
                <img src="${channel.thumbnail}" class="channel-thumbnail" alt="${channel.title}">
                <div class="channel-info">
                    <div class="channel-title">${channel.title}</div>
                    ${channel.customUrl ? `<div class="channel-custom-url">${channel.customUrl}</div>` : ''}
                    <div class="channel-stats">
                        <div class="channel-stat-item">
                            <span>👥</span>
                            <span>${formatCount(channel.subscriberCount)} 구독자</span>
                        </div>
                        <div class="channel-stat-item">
                            <span>📹</span>
                            <span>${formatCount(channel.videoCount)} 영상</span>
                        </div>
                        <div class="channel-stat-item">
                            <span>👁️</span>
                            <span>${formatCount(channel.viewCount)} 조회</span>
                        </div>
                    </div>
                </div>
                ${isSelected ? '<div class="channel-selected-badge">✓ 선택됨</div>' : ''}
            </div>
        `;
    }).join('');
}

async function selectYouTubeChannel(channelId) {
    try {
        // TODO: 현재 계정 ID 가져오기
        const accountId = currentAccountId || 'default'; // 임시

        const result = await eel.youtube_select_channel(accountId, channelId)();

        if (result.success) {
            // 현재 선택된 채널 업데이트
            renderChannels(currentChannels, channelId);

            // 성공 알림 (선택사항)
            const status = document.getElementById('channel-load-status');
            status.textContent = `'${result.channel.title}' 선택됨`;
            status.style.color = 'var(--success)';

            setTimeout(() => {
                status.textContent = '';
            }, 3000);
        } else {
            alert('채널 선택 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[YouTube] 채널 선택 오류:', error);
        alert('채널 선택 중 오류가 발생했습니다.');
    }
}

// ========== 계정 관리 ==========

async function loadAccountList() {
    try {
        const data = await eel.account_get_list()();
        const accountList = document.getElementById('api-account-list');

        if (!data.accounts || data.accounts.length === 0) {
            accountList.innerHTML = `
                <div style="text-align: center; padding: var(--spacing-xl); color: var(--text-tertiary);">
                    등록된 계정이 없습니다.<br>
                    아래 버튼을 눌러 계정을 추가하세요.
                </div>
            `;
            return;
        }

        accountList.innerHTML = data.accounts.map(account => {
            const isActive = account.id === data.current_account_id;
            return `
                <div class="api-key-item ${isActive ? 'selected' : ''}" style="${isActive ? 'border-color: var(--accent-primary);' : ''}">
                    ${account.thumbnail ? `<img src="${account.thumbnail}" style="width: 40px; height: 40px; border-radius: 50%; margin-right: var(--spacing-md);">` : ''}
                    <div class="api-key-info-row">
                        <div class="api-key-name">${account.name} ${isActive ? '✓' : ''}</div>
                        <div class="api-key-preview">${account.email}</div>
                    </div>
                    <div class="api-key-actions">
                        ${!isActive ? `<button onclick="selectAccount('${account.id}')" class="btn btn-sm">선택</button>` : ''}
                        <button onclick="removeAccount('${account.id}')" class="btn btn-sm btn-danger">삭제</button>
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('[Account] 계정 목록 로드 오류:', error);
    }
}

async function addNewAccount() {
    try {
        const btn = event.target;
        btn.disabled = true;
        btn.textContent = '로그인 중...';

        const result = await eel.account_add_new()();

        if (result.success) {
            alert('계정이 추가되었습니다!');
            await loadAccountList();
            await loadYouTubeChannels();
        } else {
            alert('계정 추가 실패: ' + (result.error || '알 수 없는 오류'));
        }

    } catch (error) {
        console.error('[Account] 계정 추가 오류:', error);
        alert('계정 추가 중 오류가 발생했습니다.');
    } finally {
        const btn = event.target;
        btn.disabled = false;
        btn.textContent = '➕ 계정 추가';
    }
}

async function selectAccount(accountId) {
    try {
        const result = await eel.account_select(accountId)();

        if (result.success) {
            await loadAccountList();
            await loadOAuthCredentials();
            await loadYouTubeChannels();
        } else {
            alert('계정 전환 실패: ' + (result.error || '알 수 없는 오류'));
        }

    } catch (error) {
        console.error('[Account] 계정 전환 오류:', error);
        alert('계정 전환 중 오류가 발생했습니다.');
    }
}

async function removeAccount(accountId) {
    if (!confirm('이 계정을 삭제하시겠습니까?')) {
        return;
    }

    try {
        const result = await eel.account_remove(accountId)();

        if (result.success) {
            await loadAccountList();
        } else {
            alert('계정 삭제 실패: ' + (result.error || '알 수 없는 오류'));
        }

    } catch (error) {
        console.error('[Account] 계정 삭제 오류:', error);
        alert('계정 삭제 중 오류가 발생했습니다.');
    }
}

async function saveOAuthAccount() {
    try {
        const clientId = document.getElementById('oauth-client-id').value.trim();
        const clientSecret = document.getElementById('oauth-client-secret').value.trim();

        if (!clientId || !clientSecret) {
            alert('Client ID와 Client Secret을 모두 입력해주세요.');
            return;
        }

        const result = await eel.oauth_save_credentials(clientId, clientSecret)();

        if (result.success) {
            alert('OAuth 설정이 저장되었습니다!');
        } else {
            alert('저장 실패: ' + (result.error || '알 수 없는 오류'));
        }

    } catch (error) {
        console.error('[OAuth] 저장 오류:', error);
        alert('OAuth 설정 저장 중 오류가 발생했습니다.');
    }
}

async function loadOAuthCredentials() {
    try {
        const creds = await eel.oauth_get_credentials()();

        document.getElementById('oauth-client-id').value = creds.client_id || '';
        document.getElementById('oauth-client-secret').value = creds.client_secret || '';

    } catch (error) {
        console.error('[OAuth] 자격 증명 로드 오류:', error);
    }
}

// 페이지 로드 시 계정 목록과 OAuth 설정 로드
document.addEventListener('DOMContentLoaded', () => {
    // 계정 관리 탭으로 전환될 때 데이터 로드
    const accountTab = document.querySelector('[data-tab="account-manager"]');
    if (accountTab) {
        accountTab.addEventListener('click', () => {
            setTimeout(() => {
                loadAccountList();
                loadOAuthCredentials();
            }, 100);
        });
    }
});

console.log('[Roystube] app.js 로드 완료');

// ========== 서브탭 전환 ==========
document.addEventListener('DOMContentLoaded', () => {
    // 서브탭 버튼 클릭 이벤트
    document.querySelectorAll('.subtab-btn').forEach(button => {
        button.addEventListener('click', () => {
            const targetSubtab = button.getAttribute('data-subtab');
            
            // 같은 부모 내의 서브탭 버튼들과 콘텐츠 찾기
            const parent = button.closest('.tab-pane');
            const subtabButtons = parent.querySelectorAll('.subtab-btn');
            const subtabContents = parent.querySelectorAll('.subtab-content');
            
            // 모든 서브탭 버튼 비활성화
            subtabButtons.forEach(btn => btn.classList.remove('active'));
            
            // 모든 서브탭 콘텐츠 숨기기
            subtabContents.forEach(content => content.classList.remove('active'));
            
            // 클릭된 버튼 활성화
            button.classList.add('active');
            
            // 해당 콘텐츠 표시
            const targetContent = parent.querySelector(`#subtab-${targetSubtab}`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
            
            console.log('[Roystube] 서브탭 전환:', targetSubtab);
        });
    });
});

