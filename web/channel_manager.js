// 채널 관리 모듈
// YouTube 채널 모니터링 기능

let channelManagerData = [];

/**
 * 채널 추가 팝업 표시
 */
async function channelManagerAddChannel() {
    const html = `
        <div style="padding: 20px;">
            <h3 style="margin-top: 0; color: #fff;">📊 채널 추가</h3>

            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; color: #ddd;">채널 URL</label>
                <input type="text" id="channel-url-input"
                       placeholder="https://www.youtube.com/@채널명 또는 채널 URL"
                       style="width: 100%; padding: 8px; background: #2a2a2a; border: 1px solid #444; color: #fff; border-radius: 4px;">
                <small style="color: #888;">채널 URL, @핸들, 또는 채널 ID를 입력하세요</small>
            </div>

            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 5px; color: #ddd;">소유자 (별칭)</label>
                <input type="text" id="channel-owner-input"
                       placeholder="예: 홍길동, 내 채널, 경쟁사 등"
                       style="width: 100%; padding: 8px; background: #2a2a2a; border: 1px solid #444; color: #fff; border-radius: 4px;">
                <small style="color: #888;">이 채널을 식별할 이름을 입력하세요</small>
            </div>

            <div style="text-align: right; margin-top: 20px;">
                <button onclick="showPopup(null)" class="btn btn-secondary" style="margin-right: 10px;">취소</button>
                <button onclick="channelManagerSubmitChannel()" class="btn btn-primary">추가</button>
            </div>
        </div>
    `;

    showPopup(html);
}

/**
 * 채널 추가 제출
 */
async function channelManagerSubmitChannel() {
    const urlInput = document.getElementById('channel-url-input');
    const ownerInput = document.getElementById('channel-owner-input');

    const url = urlInput?.value?.trim();
    const owner = ownerInput?.value?.trim();

    if (!url) {
        alert('채널 URL을 입력하세요.');
        return;
    }

    if (!owner) {
        alert('소유자 이름을 입력하세요.');
        return;
    }

    // 로딩 표시
    showPopup('<div style="padding: 40px; text-align: center; color: #fff;"><div class="spinner"></div><p>채널 정보를 가져오는 중...</p></div>');

    try {
        // 백엔드에 채널 추가 요청
        const result = await eel.channel_manager_add_channel(url, owner)();

        if (!result.success) {
            showPopup(null);
            alert('채널 추가 실패: ' + (result.error || '알 수 없는 오류'));
            return;
        }

        // 성공
        showPopup(null);

        // 채널 목록 새로고침
        await channelManagerLoadChannels();

    } catch (error) {
        showPopup(null);
        console.error('[Channel Manager] 채널 추가 오류:', error);
        alert('채널 추가 중 오류가 발생했습니다.');
    }
}

/**
 * 전체 채널 새로고침
 */
async function channelManagerRefreshAll() {
    const refreshBtn = event?.target;
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '🔄 새로고침 중...';
    }

    try {
        const result = await eel.channel_manager_refresh_all()();

        if (!result.success) {
            alert('새로고침 실패: ' + (result.error || '알 수 없는 오류'));
            return;
        }

        // 채널 목록 다시 로드
        await channelManagerLoadChannels();

    } catch (error) {
        console.error('[Channel Manager] 새로고침 오류:', error);
        alert('새로고침 중 오류가 발생했습니다.');
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '🔄 전체 새로고침';
        }
    }
}

/**
 * 채널 목록 로드 및 표시
 */
async function channelManagerLoadChannels() {
    try {
        const result = await eel.channel_manager_get_channels()();

        if (!result.success) {
            console.error('[Channel Manager] 채널 목록 로드 실패:', result.error);
            return;
        }

        channelManagerData = result.channels || [];
        channelManagerRenderTable();

    } catch (error) {
        console.error('[Channel Manager] 채널 목록 로드 오류:', error);
    }
}

/**
 * 채널 테이블 렌더링
 */
function channelManagerRenderTable() {
    const listContainer = document.getElementById('channel-manager-list');

    if (!listContainer) return;

    if (channelManagerData.length === 0) {
        listContainer.innerHTML = `
            <div class="channel-manager-empty">
                <p style="color:#888;">등록된 채널이 없습니다</p>
                <p style="color:#666; font-size:0.9rem;">"채널 추가" 버튼을 클릭하여 모니터링할 채널을 추가하세요</p>
            </div>
        `;
        return;
    }

    let html = `
        <table class="channel-manager-table">
            <thead>
                <tr>
                    <th style="width: 50px;"></th>
                    <th>소유자</th>
                    <th>채널명</th>
                    <th>구독자 수</th>
                    <th>동영상 개수</th>
                    <th>총 조회수</th>
                    <th>마지막 업데이트</th>
                    <th style="width: 100px;">작업</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const channel of channelManagerData) {
        const subscriberChange = channelManagerGetChangeHtml(channel.subscriber_change);
        const videoChange = channelManagerGetChangeHtml(channel.video_change);
        const viewChange = channelManagerGetChangeHtml(channel.view_change);

        const thumbnailUrl = channel.thumbnail || '';
        const channelUrl = channel.url || `https://www.youtube.com/channel/${channel.channel_id}`;

        html += `
            <tr>
                <td>
                    ${thumbnailUrl ? `<img src="${thumbnailUrl}" alt="" class="channel-manager-avatar">` : '📺'}
                </td>
                <td><strong>${escapeHtml(channel.owner)}</strong></td>
                <td>
                    <a href="${channelUrl}" target="_blank" style="color: #6fa3ef; text-decoration: none;">
                        ${escapeHtml(channel.channel_title)}
                    </a>
                </td>
                <td>
                    ${formatNumber(channel.subscriber_count)}
                    ${subscriberChange}
                </td>
                <td>
                    ${formatNumber(channel.video_count)}
                    ${videoChange}
                </td>
                <td>
                    ${formatNumber(channel.view_count)}
                    ${viewChange}
                </td>
                <td style="color: #888; font-size: 0.85rem;">
                    ${formatDateTime(channel.last_updated)}
                </td>
                <td>
                    <button class="btn btn-sm" onclick="channelManagerRefreshOne('${channel.channel_id}')"
                            title="새로고침" style="padding: 4px 8px; margin-right: 4px;">🔄</button>
                    <button class="btn btn-sm btn-danger" onclick="channelManagerDeleteChannel('${channel.channel_id}')"
                            title="삭제" style="padding: 4px 8px;">🗑️</button>
                </td>
            </tr>
        `;
    }

    html += `
            </tbody>
        </table>
    `;

    listContainer.innerHTML = html;
}

/**
 * 변화량 HTML 생성
 */
function channelManagerGetChangeHtml(change) {
    if (!change || change === 0) {
        return '<span class="channel-manager-stat-change neutral">-</span>';
    }

    const isPositive = change > 0;
    const className = isPositive ? 'positive' : 'negative';
    const symbol = isPositive ? '▲' : '▼';
    const absChange = Math.abs(change);

    return `<span class="channel-manager-stat-change ${className}">${symbol} ${formatNumber(absChange)}</span>`;
}

/**
 * 개별 채널 새로고침
 */
async function channelManagerRefreshOne(channelId) {
    try {
        const result = await eel.channel_manager_refresh_channel(channelId)();

        if (!result.success) {
            alert('새로고침 실패: ' + (result.error || '알 수 없는 오류'));
            return;
        }

        // 채널 목록 다시 로드
        await channelManagerLoadChannels();

    } catch (error) {
        console.error('[Channel Manager] 채널 새로고침 오류:', error);
        alert('새로고침 중 오류가 발생했습니다.');
    }
}

/**
 * 채널 삭제
 */
async function channelManagerDeleteChannel(channelId) {
    if (!confirm('이 채널을 목록에서 삭제하시겠습니까?')) {
        return;
    }

    try {
        const result = await eel.channel_manager_delete_channel(channelId)();

        if (!result.success) {
            alert('삭제 실패: ' + (result.error || '알 수 없는 오류'));
            return;
        }

        // 채널 목록 다시 로드
        await channelManagerLoadChannels();

    } catch (error) {
        console.error('[Channel Manager] 채널 삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

/**
 * 숫자 포맷팅 (천 단위 구분)
 */
function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return num.toLocaleString('ko-KR');
}

/**
 * 날짜/시간 포맷팅
 */
function formatDateTime(dateStr) {
    if (!dateStr) return '-';

    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    if (diffDays < 7) return `${diffDays}일 전`;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const mins = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${mins}`;
}

/**
 * HTML 이스케이프
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 페이지 로드 시 채널 목록 로드
document.addEventListener('DOMContentLoaded', () => {
    // 관리 탭이 활성화될 때 채널 목록 로드
    const observer = new MutationObserver(() => {
        const managerTab = document.getElementById('tab-studio-channel-manager');
        if (managerTab && managerTab.classList.contains('active')) {
            channelManagerLoadChannels();
        }
    });

    // 탭 변경 감지
    const tabContainer = document.querySelector('.studio-tabs');
    if (tabContainer) {
        observer.observe(tabContainer, { attributes: true, subtree: true });
    }
});
