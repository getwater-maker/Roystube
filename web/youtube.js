/**
 * YouTube 계정 관리 및 업로드 기능
 */

// ========== 초기화 ==========

// 페이지 로드 시 계정 목록 불러오기
setTimeout(() => {
    youtubeLoadAccounts();
    youtubeInitBatchToggles();
}, 1000);

// 배치 탭 토글 초기화
function youtubeInitBatchToggles() {
    const autoUploadToggle = document.getElementById('batch-youtube-auto-upload');
    if (autoUploadToggle) {
        autoUploadToggle.addEventListener('change', function() {
            const accountRow = document.getElementById('batch-youtube-account-row');
            const channelRow = document.getElementById('batch-youtube-channel-row');
            const privacyRow = document.getElementById('batch-youtube-privacy-row');

            if (this.checked) {
                accountRow.style.display = 'flex';
                if (privacyRow) privacyRow.style.display = 'flex';
                // 계정 목록 로드
                youtubeFillBatchAccountSelect();
            } else {
                accountRow.style.display = 'none';
                if (channelRow) channelRow.style.display = 'none';
                if (privacyRow) privacyRow.style.display = 'none';
            }

            // 배치 작업 목록 UI 업데이트 (개별 드롭다운 표시/숨김)
            if (typeof updateBatchQueueUI === 'function') {
                updateBatchQueueUI();
            }
        });
    }

    // 계정 선택 시 채널 목록 로드
    const accountSelect = document.getElementById('batch-youtube-account');
    if (accountSelect) {
        accountSelect.addEventListener('change', function() {
            console.log('[YouTube] 계정 선택 변경됨:', this.value);
            batchLoadYouTubeChannels();
        });
    }
}

// 배치 탭 계정 선택 드롭다운 채우기
async function youtubeFillBatchAccountSelect() {
    try {
        const result = await eel.youtube_get_accounts()();
        if (!result.success) return;

        const accounts = result.accounts || [];
        const select = document.getElementById('batch-youtube-account');

        if (select) {
            select.innerHTML = '<option value="">-- 계정 선택 --</option>' +
                accounts.map(acc => `<option value="${acc.name}">${acc.name} (${acc.channel_title})</option>`).join('');
        }
    } catch (error) {
        console.error('[YouTube] 배치 계정 목록 로드 오류:', error);
    }
}

// 배치 탭 채널 목록 로드 (계정 선택 시)
async function batchLoadYouTubeChannels() {
    try {
        const accountSelect = document.getElementById('batch-youtube-account');
        const channelSelect = document.getElementById('batch-youtube-channel');
        const channelRow = document.getElementById('batch-youtube-channel-row');

        if (!accountSelect || !channelSelect || !channelRow) return;

        const accountName = accountSelect.value;

        if (!accountName) {
            // 계정 선택 안함 - 채널 드롭다운 숨김
            channelRow.style.display = 'none';
            channelSelect.innerHTML = '<option value="">-- 채널 선택 --</option>';
            return;
        }

        // 관리 채널 목록 가져오기
        const result = await eel.youtube_get_managed_channels(accountName)();

        if (!result.success) {
            console.error('[YouTube] 관리 채널 조회 실패:', result.error);
            channelRow.style.display = 'none';
            return;
        }

        const channels = result.channels || [];

        if (channels.length === 0) {
            // 채널이 없으면 숨김
            channelRow.style.display = 'none';
            channelSelect.innerHTML = '<option value="">-- 채널 선택 --</option>';
            return;
        }

        // 채널 드롭다운 채우기
        channelSelect.innerHTML = '<option value="">본인 채널 (기본)</option>' +
            channels.map(ch =>
                `<option value="${ch.channel_id}">${ch.title} (구독자 ${parseInt(ch.subscriber_count || 0).toLocaleString()}명)</option>`
            ).join('');

        // 채널 선택 드롭다운 표시
        channelRow.style.display = 'flex';

        console.log(`[YouTube] ${accountName} 계정의 관리 채널 ${channels.length}개 로드 완료`);
    } catch (error) {
        console.error('[YouTube] 관리 채널 로드 오류:', error);
    }
}

// ========== 계정 관리 ==========

async function youtubeSetupClientSecrets() {
    console.log('[YouTube] client_secrets 설정 버튼 클릭됨');
    try {
        console.log('[YouTube] 백엔드 함수 호출 중...');
        const result = await eel.youtube_set_client_secrets()();
        console.log('[YouTube] 백엔드 응답:', result);

        if (result && result.success) {
            console.log('[YouTube] ✅ 설정 성공! alert() 호출');
            setTimeout(() => {
                alert('client_secrets.json 파일이 성공적으로 설정되었습니다.');
            }, 100);
        } else {
            console.log('[YouTube] ❌ 설정 실패! alert() 호출');
            setTimeout(() => {
                alert('설정 실패: ' + (result?.error || '알 수 없는 오류'));
            }, 100);
        }
    } catch (error) {
        console.error('[YouTube] client_secrets 설정 오류:', error);
        setTimeout(() => {
            alert('파일 설정 중 오류가 발생했습니다: ' + error);
        }, 100);
    }
}

async function youtubeAddAccount() {
    console.log('[YouTube] 새 계정 추가 버튼 클릭됨');
    try {
        // client_secrets.json 확인
        console.log('[YouTube] client_secrets.json 확인 중...');
        const hasSecrets = await eel.youtube_has_client_secrets()();
        if (!hasSecrets) {
            const setup = confirm('먼저 Google Cloud Console에서 다운로드한 client_secrets.json 파일을 설정해야 합니다.\n\n설정하시겠습니까?');
            if (setup) {
                await youtubeSetupClientSecrets();
                return;
            } else {
                return;
            }
        }

        const accountName = prompt('계정 이름을 입력하세요 (비워두면 채널명 사용):');
        if (accountName === null) return; // 취소

        alert('브라우저가 열리면 Google 계정으로 로그인하고 권한을 승인해주세요.');

        const result = await eel.youtube_add_account(accountName || null)();

        if (result.success) {
            alert(`계정 "${result.account_name}" 추가 완료!\n채널: ${result.channel_info.channel_title}`);
            youtubeLoadAccounts();
        } else {
            alert('계정 추가 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[YouTube] 계정 추가 오류:', error);
        alert('계정 추가 중 오류가 발생했습니다: ' + error);
    }
}

async function youtubeRemoveAccount(accountName) {
    if (!confirm(`계정 "${accountName}"을(를) 삭제하시겠습니까?`)) {
        return;
    }

    try {
        const result = await eel.youtube_remove_account(accountName)();
        if (result.success) {
            alert('계정이 삭제되었습니다.');
            youtubeLoadAccounts();
        } else {
            alert('계정 삭제 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[YouTube] 계정 삭제 오류:', error);
        alert('계정 삭제 중 오류가 발생했습니다.');
    }
}

async function youtubeLoadAccounts() {
    try {
        const result = await eel.youtube_get_accounts()();

        if (!result.success) {
            console.error('[YouTube] 계정 목록 조회 실패:', result.error);
            return;
        }

        const accounts = result.accounts || [];
        const listContainer = document.getElementById('youtube-accounts-list');

        // 여러 탭의 계정 선택 드롭다운 가져오기
        const designAccountSelect = document.getElementById('design-youtube-account');
        const batchAccountSelect = document.getElementById('batch-youtube-account');

        // 계정 목록 UI 업데이트
        if (accounts.length === 0) {
            listContainer.innerHTML = `
                <div class="youtube-empty-state">
                    <p style="color:#888;">등록된 계정이 없습니다</p>
                    <p style="color:#666; font-size:0.9rem;">처음 사용 시 Google Cloud Console에서 client_secrets.json 파일이 필요합니다</p>
                    <button class="btn btn-secondary" onclick="youtubeSetupClientSecrets()">client_secrets.json 설정</button>
                </div>
            `;
            // 각 드롭다운 초기화
            if (designAccountSelect) designAccountSelect.innerHTML = '<option value="">-- 계정 선택 --</option>';
            if (batchAccountSelect) batchAccountSelect.innerHTML = '<option value="">-- 계정 선택 --</option>';
        } else {
            listContainer.innerHTML = accounts.map(acc => `
                <div class="youtube-account-card">
                    <div class="youtube-account-info">
                        <div class="youtube-account-header">
                            <h4>📺 ${acc.name}</h4>
                            <span class="youtube-status-badge">✅ 연결됨</span>
                        </div>
                        <div class="youtube-account-details">
                            <p>채널: ${acc.channel_title}</p>
                            <p>구독자: ${parseInt(acc.subscriber_count).toLocaleString()}명</p>
                            <p>오늘 업로드: ${acc.uploads_today}개</p>
                        </div>
                    </div>
                    <div class="youtube-account-actions">
                        <button class="btn btn-sm btn-primary" onclick="youtubeShowChannelsList('${acc.name}')">📋 관리 채널 보기</button>
                        <button class="btn btn-sm btn-danger" onclick="youtubeRemoveAccount('${acc.name}')">🗑️ 삭제</button>
                    </div>
                </div>
            `).join('');

            // 업로드 계정 선택 드롭다운 업데이트 (영상탭, 배치탭)
            const accountOptions = '<option value="">-- 계정 선택 --</option>' +
                accounts.map(acc => `<option value="${acc.name}">${acc.name} (${acc.channel_title})</option>`).join('');

            if (designAccountSelect) designAccountSelect.innerHTML = accountOptions;
            if (batchAccountSelect) batchAccountSelect.innerHTML = accountOptions;
        }
    } catch (error) {
        console.error('[YouTube] 계정 목록 로드 오류:', error);
    }
}

// ========== 관리 채널 목록 ==========

async function youtubeShowChannelsList(accountName) {
    console.log(`[YouTube] ${accountName} 계정의 관리 채널 목록 조회 시작`);

    try {
        // 백엔드에서 채널 목록 가져오기
        const result = await eel.youtube_get_managed_channels(accountName)();

        if (!result.success) {
            alert(`채널 목록 조회 실패: ${result.error}`);
            return;
        }

        const channels = result.channels || [];
        console.log(`[YouTube] 조회된 채널 수: ${channels.length}개`);

        // 통계 계산
        const ownedChannels = channels.filter(ch => ch.is_owner).length;
        const managedChannels = channels.filter(ch => !ch.is_owner).length;

        // 섹션 표시
        const section = document.getElementById('youtube-channels-section');
        const accountNameSpan = document.getElementById('youtube-channels-account-name');
        const totalChannelsSpan = document.getElementById('youtube-total-channels');
        const ownedChannelsSpan = document.getElementById('youtube-owned-channels');
        const managedChannelsSpan = document.getElementById('youtube-managed-channels');
        const channelsList = document.getElementById('youtube-channels-list');

        accountNameSpan.textContent = accountName;
        totalChannelsSpan.textContent = channels.length;
        ownedChannelsSpan.textContent = ownedChannels;
        managedChannelsSpan.textContent = managedChannels;

        // 채널 카드 생성
        if (channels.length === 0) {
            channelsList.innerHTML = `
                <div style="grid-column: 1/-1; text-align:center; padding:40px; color:#888;">
                    <p>조회된 채널이 없습니다.</p>
                </div>
            `;
        } else {
            channelsList.innerHTML = channels.map(ch => `
                <div class="youtube-channel-card">
                    <div class="youtube-channel-card-header">
                        ${ch.thumbnail ? `<img src="${ch.thumbnail}" class="youtube-channel-thumbnail" alt="${ch.title}">` : '<div class="youtube-channel-thumbnail"></div>'}
                        <div class="youtube-channel-title-area">
                            <h4 class="youtube-channel-title">${ch.title}</h4>
                            <span class="youtube-channel-type ${ch.is_owner ? 'owner' : 'managed'}">${ch.type}</span>
                        </div>
                    </div>
                    <div class="youtube-channel-stats">
                        <div class="youtube-channel-stat">
                            <span class="youtube-channel-stat-label">구독자</span>
                            <span class="youtube-channel-stat-value">${parseInt(ch.subscriber_count || 0).toLocaleString()}</span>
                        </div>
                        <div class="youtube-channel-stat">
                            <span class="youtube-channel-stat-label">영상</span>
                            <span class="youtube-channel-stat-value">${parseInt(ch.video_count || 0).toLocaleString()}</span>
                        </div>
                        <div class="youtube-channel-stat">
                            <span class="youtube-channel-stat-label">조회수</span>
                            <span class="youtube-channel-stat-value">${parseInt(ch.view_count || 0).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        section.style.display = 'block';
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
        console.error('[YouTube] 관리 채널 목록 조회 오류:', error);
        alert('채널 목록 조회 중 오류가 발생했습니다.');
    }
}

function youtubeCloseChannelsList() {
    const section = document.getElementById('youtube-channels-section');
    section.style.display = 'none';
}

// ========== 업로드 ==========

let youtubeSelectedVideoFile = null;
let youtubeSelectedThumbnail = null;

async function youtubeSelectVideoFile() {
    try {
        const result = await eel.select_video_file()();
        if (result && result.success && result.file_path) {
            youtubeSelectedVideoFile = result.file_path;
            document.getElementById('youtube-video-file').value = result.file_path;

            // 파일명에서 제목 자동 생성 (확장자 제거)
            const fileName = result.file_path.split(/[\\/]/).pop().replace(/\.[^/.]+$/, '');
            const titleInput = document.getElementById('youtube-video-title');
            if (!titleInput.value) {
                titleInput.value = fileName;
                youtubeUpdateCharCount('youtube-video-title', 'youtube-title-count');
            }
        }
    } catch (error) {
        console.error('[YouTube] 영상 파일 선택 오류:', error);
        alert('파일 선택 중 오류가 발생했습니다.');
    }
}

async function youtubeSelectThumbnail() {
    try {
        const result = await eel.youtube_select_thumbnail()();
        if (result && result.success && result.file_path) {
            youtubeSelectedThumbnail = result.file_path;
            document.getElementById('youtube-thumbnail-file').value = result.file_path;
        }
    } catch (error) {
        console.error('[YouTube] 썸네일 선택 오류:', error);
        alert('파일 선택 중 오류가 발생했습니다.');
    }
}

function youtubeClearThumbnail() {
    youtubeSelectedThumbnail = null;
    document.getElementById('youtube-thumbnail-file').value = '';
}

function youtubeUpdateCharCount(inputId, countId) {
    const input = document.getElementById(inputId);
    const count = document.getElementById(countId);
    if (input && count) {
        count.textContent = input.value.length;
    }
}

// 제목/설명 글자수 카운터
document.addEventListener('DOMContentLoaded', () => {
    const titleInput = document.getElementById('youtube-video-title');
    const descInput = document.getElementById('youtube-video-description');

    if (titleInput) {
        titleInput.addEventListener('input', () => {
            youtubeUpdateCharCount('youtube-video-title', 'youtube-title-count');
        });
    }

    if (descInput) {
        descInput.addEventListener('input', () => {
            youtubeUpdateCharCount('youtube-video-description', 'youtube-desc-count');
        });
    }
});

async function youtubeUploadVideo() {
    // 입력 검증
    const accountName = document.getElementById('youtube-upload-account').value;
    if (!accountName) {
        alert('업로드할 계정을 선택하세요.');
        return;
    }

    if (!youtubeSelectedVideoFile) {
        alert('영상 파일을 선택하세요.');
        return;
    }

    const title = document.getElementById('youtube-video-title').value.trim();
    if (!title) {
        alert('영상 제목을 입력하세요.');
        return;
    }

    const description = document.getElementById('youtube-video-description').value.trim();
    const privacyStatus = document.getElementById('youtube-privacy-status').value;
    const tagsInput = document.getElementById('youtube-tags').value.trim();
    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];

    if (!confirm(`"${accountName}" 계정으로 영상을 업로드하시겠습니까?\n\n제목: ${title}\n상태: ${privacyStatus}`)) {
        return;
    }

    try {
        // 업로드 시작 알림
        alert('업로드를 시작합니다. 완료될 때까지 기다려주세요...');

        const result = await eel.youtube_upload_video(
            accountName,
            youtubeSelectedVideoFile,
            title,
            description,
            youtubeSelectedThumbnail,
            privacyStatus,
            tags
        )();

        if (result.success) {
            alert(`업로드 성공!\n\n영상 제목: ${result.title}\nURL: ${result.video_url}\n\n브라우저에서 YouTube Studio를 확인하세요.`);

            // 폼 초기화
            youtubeClearForm();

            // 계정 목록 갱신 (업로드 횟수 업데이트)
            youtubeLoadAccounts();
        } else {
            alert('업로드 실패:\n' + (result.error || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('[YouTube] 업로드 오류:', error);
        alert('업로드 중 오류가 발생했습니다: ' + error);
    }
}

function youtubeClearForm() {
    youtubeSelectedVideoFile = null;
    youtubeSelectedThumbnail = null;

    document.getElementById('youtube-video-file').value = '';
    document.getElementById('youtube-video-title').value = '';
    document.getElementById('youtube-video-description').value = '';
    document.getElementById('youtube-thumbnail-file').value = '';
    document.getElementById('youtube-tags').value = '';
    document.getElementById('youtube-privacy-status').value = 'private';

    youtubeUpdateCharCount('youtube-video-title', 'youtube-title-count');
    youtubeUpdateCharCount('youtube-video-description', 'youtube-desc-count');
}

// ========== 영상/배치 탭에서 자동 업로드 ==========

/**
 * 배치 제작 완료 후 YouTube 업로드
 *
 * @param {string} videoPath - 제작된 영상 파일 경로
 * @param {string} title - 영상 제목
 * @param {string} description - 영상 설명 (선택)
 */
async function youtubeBatchAutoUpload(videoPath, title, description = '') {
    try {
        // 자동 업로드 활성화 확인
        const autoUploadEnabled = document.getElementById('batch-youtube-auto-upload')?.checked;
        if (!autoUploadEnabled) {
            return { success: false, skip: true };
        }

        // 계정 선택 확인
        const accountName = document.getElementById('batch-youtube-account')?.value;
        if (!accountName) {
            console.log('[YouTube] 업로드 계정이 선택되지 않았습니다.');
            return { success: false, error: '계정 미선택' };
        }

        // 채널 선택 확인 (선택 안하면 null로 본인 채널 사용)
        const channelId = document.getElementById('batch-youtube-channel')?.value || null;

        // 공개 상태
        const privacyStatus = document.getElementById('batch-youtube-privacy')?.value || 'private';

        console.log(`[YouTube] 자동 업로드 시작: ${title} -> ${accountName}${channelId ? ` (채널 ID: ${channelId})` : ' (본인 채널)'}`);

        const result = await eel.youtube_upload_video(
            accountName,
            videoPath,
            title,
            description,
            null,  // 썸네일 없음
            privacyStatus,
            [],  // 태그 없음
            channelId  // 채널 ID 추가
        )();

        if (result.success) {
            console.log(`[YouTube] 자동 업로드 성공: ${result.video_url}`);
            return { success: true, video_url: result.video_url };
        } else {
            console.error('[YouTube] 자동 업로드 실패:', result.error);
            return { success: false, error: result.error };
        }
    } catch (error) {
        console.error('[YouTube] 자동 업로드 오류:', error);
        return { success: false, error: error.toString() };
    }
}

/**
 * 영상 제작 완료 후 YouTube 업로드 (단일 영상)
 *
 * @param {string} videoPath - 제작된 영상 파일 경로
 * @param {string} title - 영상 제목
 * @param {string} description - 영상 설명 (선택)
 */
async function youtubeAutoUpload(videoPath, title, description = '') {
    try {
        const accounts = await eel.youtube_get_accounts()();
        if (!accounts.success || accounts.accounts.length === 0) {
            console.log('[YouTube] 등록된 계정이 없어 자동 업로드를 건너뜁니다.');
            return;
        }

        // 첫 번째 계정 사용 (또는 사용자가 설정한 기본 계정)
        const defaultAccount = accounts.accounts[0].name;

        const result = await eel.youtube_upload_video(
            defaultAccount,
            videoPath,
            title,
            description,
            null,  // 썸네일 없음
            'private',  // 비공개
            []  // 태그 없음
        )();

        if (result.success) {
            console.log(`[YouTube] 자동 업로드 성공: ${result.video_url}`);
            alert(`YouTube 업로드 완료!\n\n${result.video_url}`);
        } else {
            console.error('[YouTube] 자동 업로드 실패:', result.error);
        }
    } catch (error) {
        console.error('[YouTube] 자동 업로드 오류:', error);
    }
}

console.log('[YouTube] YouTube 모듈 로드 완료');
