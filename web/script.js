// 전역 상태
let isLoggedIn = false;
let subscriptionsLoaded = false;
let currentSubscriptions = [];
let userChannels = [];  // 사용자의 채널 목록
let selectedChannelId = null;  // 현재 선택된 채널 ID
let isSubscribing = false;  // 구독 진행 중 여부

// 로그인이 필요한 탭 목록
const TABS_REQUIRING_LOGIN = [
    'all-channel-monitor',
    'channel-monitor',
    'keyword-search',
    'hot-trend',
    'mutation',
    'batch-subscribe'
];

// 로그인이 필요 없는 탭 목록
const TABS_NO_LOGIN_REQUIRED = [
    'line-break',
    'chat-extract',
    'text-merge',
    'mp3-extract',
    'pdf-utils',
    'studio-production',
    'studio-settings',
    'studio-subtitle',
    'studio-blackscreen'
];

// 사용 가능한 아이콘 목록
const CATEGORY_ICONS = ['🚀', '📌', '⭐', '🏆', '💎', '🔥', '💡', '🎯', '🌟', '💫', '⚡', '🎪', '🎨', '🎭', '🎬', '📈', '💰', '🏅', '🎖️', '👑'];

// 카테고리 설정 저장 키
const CATEGORY_SETTINGS_KEY = 'categorySettings';

// 채널 카테고리 정의 (구독자 수 기준) - 동적으로 변경 가능
let CHANNEL_CATEGORIES = [];

// 기본 카테고리 설정
const DEFAULT_CATEGORIES = [
    { id: 'explosive', name: '폭발대기채널', icon: '🚀', min: 0, max: 999 },
    { id: 'reference', name: '참고채널', icon: '📌', min: 1000, max: 30000 },
    { id: 'middle', name: '어중간채널', icon: '⭐', min: 30001, max: 69999 },
    { id: 'master', name: '고수채널', icon: '🏆', min: 70000, max: Infinity }
];

// 랜덤 아이콘 선택
function getRandomIcon(excludeIcons = []) {
    const available = CATEGORY_ICONS.filter(icon => !excludeIcons.includes(icon));
    if (available.length === 0) return CATEGORY_ICONS[Math.floor(Math.random() * CATEGORY_ICONS.length)];
    return available[Math.floor(Math.random() * available.length)];
}

// 카테고리 설정 저장
function saveCategorySettings(categories) {
    // Infinity를 문자열로 변환하여 저장
    const toSave = categories.map(cat => ({
        ...cat,
        max: cat.max === Infinity ? 'Infinity' : cat.max
    }));
    localStorage.setItem(CATEGORY_SETTINGS_KEY, JSON.stringify(toSave));
    CHANNEL_CATEGORIES = categories;
}

// 카테고리 설정 불러오기
function loadCategorySettings() {
    try {
        const saved = localStorage.getItem(CATEGORY_SETTINGS_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            // Infinity 문자열을 실제 Infinity로 변환
            CHANNEL_CATEGORIES = parsed.map(cat => ({
                ...cat,
                max: cat.max === 'Infinity' ? Infinity : cat.max
            }));
            return CHANNEL_CATEGORIES;
        }
    } catch (e) {
        console.error('카테고리 설정 불러오기 실패:', e);
    }
    // 기본값 사용
    CHANNEL_CATEGORIES = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    CHANNEL_CATEGORIES[CHANNEL_CATEGORIES.length - 1].max = Infinity;
    return CHANNEL_CATEGORIES;
}

// 단일 채널 선택 드롭다운 채우기
function populateSingleChannelDropdown() {
    const select = document.getElementById('single-channel-select');
    if (!select) return;

    // 기존 옵션 제거 (첫 번째 "채널 선택..." 옵션 제외)
    while (select.options.length > 1) {
        select.remove(1);
    }

    // 구독자 수 기준 내림차순 정렬
    const sortedChannels = [...currentSubscriptions].sort((a, b) => {
        return (b.subscriberCount || 0) - (a.subscriberCount || 0);
    });

    // 채널 옵션 추가
    sortedChannels.forEach(channel => {
        const option = document.createElement('option');
        option.value = channel.id;
        const subCount = channel.subscriberCount || 0;
        const subText = subCount >= 10000 ? `${(subCount / 10000).toFixed(1)}만` :
                        subCount >= 1000 ? `${(subCount / 1000).toFixed(1)}천` :
                        subCount.toString();
        option.textContent = `${channel.title} (${subText}명)`;
        select.appendChild(option);
    });
}

// 카테고리 ID로 찾기
function getCategoryById(id) {
    return CHANNEL_CATEGORIES.find(cat => cat.id === id);
}

// 구독자 수로 카테고리 찾기
function getCategoryBySubscriberCount(count) {
    // min 기준으로 정렬된 카테고리에서 해당하는 것 찾기
    const sorted = [...CHANNEL_CATEGORIES].sort((a, b) => a.min - b.min);
    for (const cat of sorted) {
        if (count >= cat.min && count <= cat.max) {
            return cat;
        }
    }
    // 없으면 마지막 카테고리 반환
    return sorted[sorted.length - 1];
}

// 현재 선택된 카테고리 (필터로 사용)
let selectedCategory = null;

// 완료된 영상 저장 (localStorage)
const DONE_VIDEOS_KEY = 'doneVideos';
const DONE_EXPIRE_DAYS = 15;

// 필터 설정 저장 키
const FILTER_SETTINGS_KEY = 'filterSettings';

// 검색 히스토리 키
const SEARCH_HISTORY_KEY = 'searchHistory';
const MAX_HISTORY_ITEMS = 10;

// 키워드 히스토리 키
const KEYWORD_HISTORY_KEY = 'keywordHistory';
const MAX_KEYWORD_HISTORY = 20;

// 돌연변이 히스토리 키
const MUTATION_HISTORY_KEY = 'mutationHistory';
const MAX_MUTATION_HISTORY = 10;

// 무한대 표시용 숫자
const INFINITY_NUMBER = 999999999;

// 카테고리 설정 UI 렌더링
function renderCategorySettingsUI() {
    const container = document.getElementById('category-settings-list');
    if (!container) return;

    container.innerHTML = CHANNEL_CATEGORIES.map((cat, index) => {
        // min/max 값 표시 (Infinity는 999999999로 표시, 콤마 포맷팅만 적용)
        const minValue = formatWithComma(cat.min);
        const maxValue = cat.max === Infinity ? formatWithComma(INFINITY_NUMBER) : formatWithComma(cat.max);

        return `
            <div class="category-setting-row" data-category-id="${cat.id}" data-index="${index}" draggable="true">
                <span class="drag-handle" title="드래그하여 순서 변경">☰</span>
                <button class="btn-icon-picker" data-index="${index}" title="아이콘 변경">${cat.icon}</button>
                <input type="text" class="category-name-input" data-index="${index}" value="${cat.name}">
                <span class="category-range-text">구독자</span>
                <input type="text" class="threshold-input threshold-min" data-index="${index}" value="${minValue}">
                <span>~</span>
                <input type="text" class="threshold-input threshold-max" data-index="${index}" value="${maxValue}">
                <span>명</span>
                <button class="btn-delete-category btn-icon" data-index="${index}" title="삭제" ${CHANNEL_CATEGORIES.length <= 1 ? 'disabled' : ''}>✕</button>
            </div>
        `;
    }).join('');

    // 이벤트 리스너 추가
    container.querySelectorAll('.btn-icon-picker').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            changeRandomIcon(index);
        });
    });

    container.querySelectorAll('.btn-delete-category').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            deleteCategory(index);
        });
    });

    // 숫자 입력 필드에 콤마 자동 포맷팅 및 숫자만 입력 가능하도록
    container.querySelectorAll('.threshold-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const cursorPos = e.target.selectionStart;
            const oldValue = e.target.value;
            // 숫자만 추출
            const rawValue = oldValue.replace(/[^\d]/g, '');

            if (rawValue) {
                const newValue = formatWithComma(parseInt(rawValue));
                e.target.value = newValue;

                // 커서 위치 계산: 커서 앞의 숫자 개수를 기준으로 위치 결정
                const digitsBeforeCursor = oldValue.substring(0, cursorPos).replace(/[^\d]/g, '').length;
                let newPos = 0;
                let digitCount = 0;
                for (let i = 0; i < newValue.length; i++) {
                    if (newValue[i] !== ',') {
                        digitCount++;
                    }
                    if (digitCount >= digitsBeforeCursor) {
                        newPos = i + 1;
                        break;
                    }
                }
                if (digitCount < digitsBeforeCursor) {
                    newPos = newValue.length;
                }
                e.target.setSelectionRange(newPos, newPos);
            } else {
                e.target.value = '';
            }
        });
    });

    // 드래그 앤 드롭 이벤트 설정
    setupCategoryDragAndDrop(container);
}

// 드래그 앤 드롭 설정
function setupCategoryDragAndDrop(container) {
    let draggedItem = null;
    let draggedIndex = -1;

    container.querySelectorAll('.category-setting-row').forEach(row => {
        // 드래그 시작
        row.addEventListener('dragstart', (e) => {
            draggedItem = row;
            draggedIndex = parseInt(row.dataset.index);
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        // 드래그 종료
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            container.querySelectorAll('.category-setting-row').forEach(r => {
                r.classList.remove('drag-over');
            });
            draggedItem = null;
            draggedIndex = -1;
        });

        // 드래그 오버
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (draggedItem && draggedItem !== row) {
                row.classList.add('drag-over');
            }
        });

        // 드래그 리브
        row.addEventListener('dragleave', () => {
            row.classList.remove('drag-over');
        });

        // 드롭
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('drag-over');

            if (!draggedItem || draggedItem === row) return;

            const targetIndex = parseInt(row.dataset.index);
            if (draggedIndex === targetIndex) return;

            // 카테고리 순서 변경
            reorderCategories(draggedIndex, targetIndex);
        });
    });
}

// 카테고리 순서 변경
function reorderCategories(fromIndex, toIndex) {
    // UI에서 현재 값들을 먼저 읽어옴 (이름, 아이콘, 범위 모두 포함)
    const currentCategories = getCategoriesFromUI();

    // 항목 전체를 이동 (이름, 아이콘, 범위 모두 함께)
    const [movedItem] = currentCategories.splice(fromIndex, 1);
    currentCategories.splice(toIndex, 0, movedItem);

    // 전역 변수 업데이트
    CHANNEL_CATEGORIES = currentCategories;

    // UI 다시 렌더링
    renderCategorySettingsUI();
}

// 아이콘 랜덤 변경
function changeRandomIcon(index) {
    // UI에서 현재 값들을 먼저 읽어옴
    CHANNEL_CATEGORIES = getCategoriesFromUI();
    const usedIcons = CHANNEL_CATEGORIES.map(cat => cat.icon);
    const newIcon = getRandomIcon(usedIcons);
    CHANNEL_CATEGORIES[index].icon = newIcon;
    renderCategorySettingsUI();
}

// 카테고리 추가
function addCategory() {
    // UI에서 현재 값들을 먼저 읽어옴
    CHANNEL_CATEGORIES = getCategoriesFromUI();

    const usedIcons = CHANNEL_CATEGORIES.map(cat => cat.icon);
    const newId = 'category_' + Date.now();

    // 마지막 카테고리의 max를 새 카테고리의 기준으로 사용
    const lastCat = CHANNEL_CATEGORIES[CHANNEL_CATEGORIES.length - 1];
    const newMin = lastCat.max === Infinity ? lastCat.min + 10000 : lastCat.max + 1;

    // 기존 마지막 카테고리의 max를 새 min - 1로 설정
    if (lastCat.max === Infinity) {
        lastCat.max = newMin - 1;
    }

    const newCategory = {
        id: newId,
        name: '새 그룹',
        icon: getRandomIcon(usedIcons),
        min: newMin,
        max: Infinity
    };

    CHANNEL_CATEGORIES.push(newCategory);
    renderCategorySettingsUI();
}

// 카테고리 삭제
function deleteCategory(index) {
    if (CHANNEL_CATEGORIES.length <= 1) {
        alert('최소 1개의 그룹은 필요합니다.');
        return;
    }

    // UI에서 현재 값들을 먼저 읽어옴
    CHANNEL_CATEGORIES = getCategoriesFromUI();

    // 삭제 후 범위 조정
    if (index === CHANNEL_CATEGORIES.length - 1) {
        // 마지막 카테고리 삭제 시 이전 카테고리를 무한대로
        CHANNEL_CATEGORIES[index - 1].max = Infinity;
    } else if (index === 0) {
        // 첫 번째 카테고리 삭제 시 다음 카테고리를 0부터
        CHANNEL_CATEGORIES[1].min = 0;
    } else {
        // 중간 카테고리 삭제 시 이전 카테고리의 max를 다음 카테고리의 min - 1로
        CHANNEL_CATEGORIES[index - 1].max = CHANNEL_CATEGORIES[index + 1].min - 1;
    }

    CHANNEL_CATEGORIES.splice(index, 1);
    renderCategorySettingsUI();
}

// UI에서 카테고리 설정 읽기
function getCategoriesFromUI() {
    const rows = document.querySelectorAll('.category-setting-row');
    const categories = [];

    rows.forEach((row, index) => {
        const iconBtn = row.querySelector('.btn-icon-picker');
        const nameInput = row.querySelector('.category-name-input');
        const minInput = row.querySelector('.threshold-min');
        const maxInput = row.querySelector('.threshold-max');

        const minVal = parseNumberWithComma(minInput?.value) || 0;
        const maxVal = parseNumberWithComma(maxInput?.value) || 0;

        categories.push({
            id: row.dataset.categoryId,
            icon: iconBtn.textContent,
            name: nameInput.value.trim() || '그룹',
            min: minVal,
            // 999999999 이상이면 Infinity로 처리
            max: maxVal >= INFINITY_NUMBER ? Infinity : maxVal
        });
    });

    return categories;
}

function getDoneVideos() {
    try {
        const data = JSON.parse(localStorage.getItem(DONE_VIDEOS_KEY) || '{}');
        const now = Date.now();
        const expireMs = DONE_EXPIRE_DAYS * 24 * 60 * 60 * 1000;

        // 만료된 항목 제거
        const cleaned = {};
        for (const [videoId, timestamp] of Object.entries(data)) {
            if (now - timestamp < expireMs) {
                cleaned[videoId] = timestamp;
            }
        }

        // 정리된 데이터 저장
        if (Object.keys(cleaned).length !== Object.keys(data).length) {
            localStorage.setItem(DONE_VIDEOS_KEY, JSON.stringify(cleaned));
        }

        return cleaned;
    } catch {
        return {};
    }
}

function setVideoDone(videoId) {
    const data = getDoneVideos();
    data[videoId] = Date.now();
    localStorage.setItem(DONE_VIDEOS_KEY, JSON.stringify(data));
}

function removeVideoDone(videoId) {
    const data = getDoneVideos();
    delete data[videoId];
    localStorage.setItem(DONE_VIDEOS_KEY, JSON.stringify(data));
}

function isVideoDone(videoId) {
    const data = getDoneVideos();
    return videoId in data;
}

// 기간 값을 가져오는 헬퍼 함수
function getDaysWithinValue(selectId, customInputId) {
    const select = document.getElementById(selectId);
    const customInput = document.getElementById(customInputId);

    if (!select) return 30;  // 요소가 없으면 기본값 반환

    // RSS 모드 선택 시
    if (select.value === 'rss') {
        return 'rss';
    }

    if (select.value === 'custom' && customInput) {
        return parseInt(customInput.value) || 30;
    }
    return parseInt(select.value) || 30;
}

// RSS 모드인지 확인하는 헬퍼 함수
function isRssMode(selectId) {
    const select = document.getElementById(selectId);
    return select && select.value === 'rss';
}

// 기간 값을 설정하는 헬퍼 함수
function setDaysWithinValue(selectId, customInputId, value) {
    const select = document.getElementById(selectId);
    const customInput = document.getElementById(customInputId);
    const periodUnit = customInput ? customInput.nextElementSibling : null;
    const numValue = parseInt(value);

    if (!select) return;  // 요소가 없으면 무시

    // 프리셋 값 목록
    const presetValues = [7, 30, 90, 180, 270, 330];

    if (presetValues.includes(numValue)) {
        select.value = numValue.toString();
        if (customInput) customInput.style.display = 'none';
        if (periodUnit && periodUnit.classList.contains('period-unit')) {
            periodUnit.style.display = 'none';
        }
    } else {
        select.value = 'custom';
        if (customInput) {
            customInput.value = numValue;
            customInput.style.display = 'inline-block';
        }
        if (periodUnit && periodUnit.classList.contains('period-unit')) {
            periodUnit.style.display = 'inline';
        }
    }
}

// 기간 선택 드롭다운 이벤트 설정
function setupPeriodDropdown(selectId, customInputId) {
    const select = document.getElementById(selectId);
    const customInput = document.getElementById(customInputId);
    // 같은 .period-select 안의 .period-unit 찾기
    const periodUnit = customInput ? customInput.nextElementSibling : null;

    if (!select || !customInput) return;

    select.addEventListener('change', () => {
        if (select.value === 'custom') {
            customInput.style.display = 'inline-block';
            if (periodUnit && periodUnit.classList.contains('period-unit')) {
                periodUnit.style.display = 'inline';
            }
            customInput.focus();
            customInput.value = '30';  // 기본값
        } else {
            customInput.style.display = 'none';
            if (periodUnit && periodUnit.classList.contains('period-unit')) {
                periodUnit.style.display = 'none';
            }
        }
    });
}

// 구독자 카테고리 선택 드롭다운 이벤트 설정
function setupSubscriberDropdown() {
    const select = document.getElementById('subscriber-category');
    const customInput = document.getElementById('max-subscribers');
    const suffix = document.querySelector('.subscriber-suffix');

    if (!select || !customInput) return;

    select.addEventListener('change', () => {
        if (select.value === 'custom') {
            customInput.style.display = 'inline-block';
            suffix.style.display = 'inline';
            customInput.focus();
        } else {
            customInput.style.display = 'none';
            suffix.style.display = 'none';
        }
    });
}

// 구독자 필터 값을 가져오는 함수
function getSubscriberFilter(selectId = 'subscriber-category', customInputId = 'max-subscribers') {
    const select = document.getElementById(selectId);
    const customInput = customInputId ? document.getElementById(customInputId) : null;

    if (select.value === 'custom' && customInput) {
        return {
            type: 'custom',
            maxSubscribers: parseNumberWithComma(customInput.value) || 10000,
            channelIds: null
        };
    } else if (select.value === 'all') {
        return {
            type: 'all',
            maxSubscribers: Infinity,
            channelIds: null
        };
    } else {
        // 카테고리 선택: 해당 카테고리의 채널 ID 목록 반환
        const categorized = categorizeChannels(currentSubscriptions);
        const channelIds = categorized[select.value]?.map(ch => ch.id) || [];
        return {
            type: 'category',
            category: select.value,
            maxSubscribers: Infinity,
            channelIds: channelIds
        };
    }
}

// 필터 설정 저장/불러오기
function saveFilterSettings() {
    const settings = {
        currentTab: currentTab,
        // 채널모니터 탭 설정
        videoType: document.querySelector('input[name="video-type"]:checked')?.value || 'long',
        maxSubscribers: document.getElementById('max-subscribers')?.value || '10,000',
        minViews: document.getElementById('min-views')?.value || '10,000',
        daysWithin: getDaysWithinValue('days-within', 'days-within-custom'),
        // 키워드검색 탭 설정
        videoTypeKeyword: document.querySelector('input[name="video-type-keyword"]:checked')?.value || 'long',
        searchKeyword: document.getElementById('search-keyword')?.value || '',
        daysWithinKeyword: getDaysWithinValue('days-within-keyword', 'days-within-keyword-custom'),
        // 핫트렌드 탭 설정
        regionCode: document.getElementById('region-code')?.value || 'KR',
        trendCategory: document.getElementById('trend-category')?.value || '27',
        // 돌연변이 탭 설정
        videoTypeMutation: document.querySelector('input[name="video-type-mutation"]:checked')?.value || 'long',
        mutationRatio: document.getElementById('mutation-ratio')?.value || '2',
        daysWithinMutation: getDaysWithinValue('days-within-mutation', 'days-within-mutation-custom')
    };
    localStorage.setItem(FILTER_SETTINGS_KEY, JSON.stringify(settings));
}

function loadFilterSettings() {
    try {
        const settings = JSON.parse(localStorage.getItem(FILTER_SETTINGS_KEY));
        if (!settings) return;

        // 탭은 항상 channel-monitor로 시작 (탭 설정은 무시)

        // 채널모니터 탭: 영상 타입
        if (settings.videoType) {
            const videoRadio = document.querySelector(`input[name="video-type"][value="${settings.videoType}"]`);
            if (videoRadio) videoRadio.checked = true;
        }

        // 키워드검색 탭: 영상 타입
        if (settings.videoTypeKeyword) {
            const videoRadio = document.querySelector(`input[name="video-type-keyword"][value="${settings.videoTypeKeyword}"]`);
            if (videoRadio) videoRadio.checked = true;
        }

        // 돌연변이 탭: 영상 타입
        if (settings.videoTypeMutation) {
            const videoRadio = document.querySelector(`input[name="video-type-mutation"][value="${settings.videoTypeMutation}"]`);
            if (videoRadio) videoRadio.checked = true;
        }

        // 채널모니터 탭 숫자 값들
        const maxSubsEl = document.getElementById('max-subscribers');
        const minViewsEl = document.getElementById('min-views');
        if (settings.maxSubscribers && maxSubsEl) maxSubsEl.value = settings.maxSubscribers;
        if (settings.minViews && minViewsEl) minViewsEl.value = settings.minViews;
        if (settings.daysWithin) setDaysWithinValue('days-within', 'days-within-custom', settings.daysWithin);

        // 키워드검색 탭 값들 (키워드는 복원하지 않음 - 항상 빈 상태로 시작)
        if (settings.daysWithinKeyword) setDaysWithinValue('days-within-keyword', 'days-within-keyword-custom', settings.daysWithinKeyword);

        // 핫트렌드 탭 값들
        const regionCodeEl = document.getElementById('region-code');
        const trendCategoryEl = document.getElementById('trend-category');
        if (settings.regionCode && regionCodeEl) regionCodeEl.value = settings.regionCode;
        if (settings.trendCategory && trendCategoryEl) trendCategoryEl.value = settings.trendCategory;

        // 돌연변이 탭 숫자 값들
        const mutationRatioEl = document.getElementById('mutation-ratio');
        if (settings.mutationRatio && mutationRatioEl) mutationRatioEl.value = settings.mutationRatio;
        if (settings.daysWithinMutation) setDaysWithinValue('days-within-mutation', 'days-within-mutation-custom', settings.daysWithinMutation);
    } catch (e) {
        console.error('필터 설정 불러오기 실패:', e);
    }
}

// 검색 히스토리 관리
function getSearchHistory() {
    try {
        return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');
    } catch {
        return [];
    }
}

function addSearchHistory(filterConfig) {
    const history = getSearchHistory();
    const entry = {
        ...filterConfig,
        timestamp: Date.now()
    };

    // 중복 제거 (같은 설정이면 제거)
    const filtered = history.filter(h =>
        h.filterType !== entry.filterType ||
        h.maxSubscribers !== entry.maxSubscribers ||
        h.minViews !== entry.minViews ||
        h.daysWithin !== entry.daysWithin ||
        h.mutationRatio !== entry.mutationRatio
    );

    // 맨 앞에 추가
    filtered.unshift(entry);

    // 최대 개수 유지
    if (filtered.length > MAX_HISTORY_ITEMS) {
        filtered.pop();
    }

    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(filtered));
}

// 키워드 히스토리 관리
function getKeywordHistory() {
    try {
        return JSON.parse(localStorage.getItem(KEYWORD_HISTORY_KEY) || '[]');
    } catch {
        return [];
    }
}

function addKeywordToHistory(keyword) {
    if (!keyword || !keyword.trim()) return;

    keyword = keyword.trim();
    const history = getKeywordHistory();

    // 중복 제거 (같은 키워드 제거)
    const filtered = history.filter(h => h.keyword !== keyword);

    // 맨 앞에 추가
    filtered.unshift({
        keyword: keyword,
        timestamp: Date.now()
    });

    // 최대 개수 유지
    if (filtered.length > MAX_KEYWORD_HISTORY) {
        filtered.pop();
    }

    localStorage.setItem(KEYWORD_HISTORY_KEY, JSON.stringify(filtered));
}

function deleteKeywordFromHistory(index) {
    const history = getKeywordHistory();
    history.splice(index, 1);
    localStorage.setItem(KEYWORD_HISTORY_KEY, JSON.stringify(history));
}

// 돌연변이 히스토리 관리
function getMutationHistory() {
    try {
        return JSON.parse(localStorage.getItem(MUTATION_HISTORY_KEY) || '[]');
    } catch {
        return [];
    }
}

function addMutationToHistory(config) {
    const history = getMutationHistory();
    const entry = {
        videoType: config.videoType,
        subscriberCategory: config.subscriberCategory || 'all',
        mutationRatio: config.mutationRatio,
        daysWithin: config.daysWithin,
        timestamp: Date.now()
    };

    // 중복 제거 (같은 설정이면 제거)
    const filtered = history.filter(h =>
        h.videoType !== entry.videoType ||
        h.subscriberCategory !== entry.subscriberCategory ||
        h.mutationRatio !== entry.mutationRatio ||
        h.daysWithin !== entry.daysWithin
    );

    // 맨 앞에 추가
    filtered.unshift(entry);

    // 최대 개수 유지
    if (filtered.length > MAX_MUTATION_HISTORY) {
        filtered.pop();
    }

    localStorage.setItem(MUTATION_HISTORY_KEY, JSON.stringify(filtered));
}

function deleteMutationFromHistory(index) {
    const history = getMutationHistory();
    history.splice(index, 1);
    localStorage.setItem(MUTATION_HISTORY_KEY, JSON.stringify(history));
}

// DOM 요소
const setupSection = document.getElementById('setup-section');
const loginSection = document.getElementById('login-section');
const searchSection = document.getElementById('search-section');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const btnShowSetup = document.getElementById('btn-show-setup');
const btnSaveConfig = document.getElementById('btn-save-config');
const inputClientId = document.getElementById('input-client-id');
const inputClientSecret = document.getElementById('input-client-secret');
const inputApiKey = document.getElementById('input-api-key');
const btnShowGuide = document.getElementById('btn-show-guide');
const btnShowGuideLogin = document.getElementById('btn-show-guide-login');
const guideModal = document.getElementById('guide-modal');
const btnCloseGuide = document.getElementById('btn-close-guide');
const btnRefreshSubs = document.getElementById('btn-refresh-subs');
const btnGoogleConsole = document.getElementById('btn-google-console');
const btnSearch = document.getElementById('btn-search');
const subsInfo = document.getElementById('subs-info');
const progressSection = document.getElementById('progress-section');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const btnCancelSearch = document.getElementById('btn-cancel-search');
const resultsSection = document.getElementById('results-section');
const resultsCount = document.getElementById('results-count');
const resultsStats = document.getElementById('results-stats');
const resultsList = document.getElementById('results-list');

// 설정 관련
const btnCancelSetup = document.getElementById('btn-cancel-setup');

// 구독 목록 모달
const subsModal = document.getElementById('subs-modal');
const btnCloseSubsModal = document.getElementById('btn-close-subs-modal');
const btnExportSubs = document.getElementById('btn-export-subs');
const btnImportSubs = document.getElementById('btn-import-subs');
const btnRefreshSubsModal = document.getElementById('btn-refresh-subs-modal');
const btnSelectAll = document.getElementById('btn-select-all');
const btnBatchUnsubscribe = document.getElementById('btn-batch-unsubscribe');
const selectedCountSpan = document.getElementById('selected-count');
const subsModalCount = document.getElementById('subs-modal-count');
const subsList = document.getElementById('subs-list');

// 선택된 채널 ID 저장
let selectedChannels = new Set();

// 현재 활성 탭
let currentTab = 'all-channel-monitor';

// 무한 스크롤 관련
const ITEMS_PER_PAGE = 25;
let allSearchResults = [];
let filteredResults = [];
let displayedCount = 0;

// 탭별 검색결과 저장
const tabSearchResults = {
    'all-channel-monitor': [],
    'channel-monitor': [],
    'keyword-search': [],
    'hot-trend': [],
    'mutation': []
};

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
    // 카테고리 설정 불러오기
    loadCategorySettings();

    // 사이드바 구조 렌더링
    renderChannelSidebarStructure();

    // 필터 설정 불러오기
    loadFilterSettings();

    // 인증 상태 확인 및 화면 표시 (이 함수에서 기본 탭도 설정)
    await checkConfigAndAuth();
    setupEventListeners();
});

async function checkConfigAndAuth() {
    // 로그인 없이 바로 메인 화면으로 이동
    // 로그인이 필요한 기능 사용 시에만 로그인 요청
    showSearchSectionWithoutLogin();

    // 기본 탭을 영상 탭으로 설정
    switchTab('studio-tts-design');
}

// 로그인 없이 검색 화면 표시 (제한된 기능만 사용 가능)
async function showSearchSectionWithoutLogin() {
    setupSection.style.display = 'none';
    loginSection.style.display = 'none';
    searchSection.style.display = 'flex';
    subsInfo.textContent = '로그인하면 더 많은 기능을 사용할 수 있습니다';

    // 계정 선택기 숨기기
    const accountSelector = document.getElementById('account-selector');
    const presetOAuthSelector = document.getElementById('preset-oauth-selector');
    const channelSelector = document.getElementById('channel-selector');

    if (accountSelector) accountSelector.style.display = 'none';
    if (presetOAuthSelector) presetOAuthSelector.style.display = 'none';
    if (channelSelector) channelSelector.style.display = 'none';

    // 사이드바 숨기기 (로그인 전에는 구독 채널 표시 안 함)
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.style.display = 'none';

    // 구독 데이터 초기화
    currentSubscriptions = [];
    subscriptionsLoaded = false;
}

// 로그인 필요 여부 체크 및 로그인 요청
async function checkLoginAndProceed(callback) {
    if (isLoggedIn) {
        // 이미 로그인됨
        if (callback) callback();
        return true;
    }

    // 로그인 여부 확인
    try {
        const status = await eel.get_config_status()();
        if (status.isAuthenticated) {
            isLoggedIn = true;
            await showSearchSection();
            await loadSubscriptions(false);
            if (callback) callback();
            return true;
        }
    } catch (e) {
        console.log('인증 상태 확인 실패:', e);
    }

    // 로그인 필요 - 로그인 팝업 표시
    showLoginPopup();
    return false;
}

// 로그인 팝업 표시 (모달 형태)
function showLoginPopup() {
    // 기존 로그인 섹션을 모달처럼 표시
    const loginModal = document.createElement('div');
    loginModal.id = 'login-modal';
    loginModal.className = 'modal';
    loginModal.style.cssText = 'display:flex; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); z-index:9999; justify-content:center; align-items:center;';

    loginModal.innerHTML = `
        <div class="login-box setup-box" style="max-width:500px; max-height:90vh; overflow-y:auto; position:relative;">
            <button id="btn-close-login-modal" style="position:absolute; top:10px; right:15px; background:none; border:none; font-size:24px; cursor:pointer; color:#666;">&times;</button>
            <h1>로그인이 필요합니다</h1>
            <p>이 기능을 사용하려면 Google 계정으로 로그인해야 합니다.</p>

            <div id="login-modal-preset-section" style="display:none;">
                <div class="account-list" id="login-modal-account-list"></div>
                <div class="credential-management" style="margin-top:15px;">
                    <button id="btn-login-modal-add-account" class="btn btn-sm btn-outline">➕ 계정추가</button>
                </div>
                <button id="btn-login-modal-manual" class="btn btn-sm btn-link">직접 로그인정보 입력하기</button>
            </div>

            <div id="login-modal-manual-section">
                <div class="setup-form">
                    <div class="form-group">
                        <label for="login-modal-client-id">Client ID</label>
                        <input type="text" id="login-modal-client-id" placeholder="xxxxx.apps.googleusercontent.com">
                    </div>
                    <div class="form-group">
                        <label for="login-modal-client-secret">Client Secret</label>
                        <input type="password" id="login-modal-client-secret" placeholder="GOCSPX-xxxxx">
                    </div>
                    <button id="btn-login-modal-submit" class="btn btn-primary btn-large">Google 계정으로 로그인</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(loginModal);

    // 닫기 버튼
    document.getElementById('btn-close-login-modal').onclick = () => {
        loginModal.remove();
    };

    // 배경 클릭 시 닫기
    loginModal.onclick = (e) => {
        if (e.target === loginModal) {
            loginModal.remove();
        }
    };

    // 로그인 버튼
    document.getElementById('btn-login-modal-submit').onclick = async () => {
        const clientId = document.getElementById('login-modal-client-id').value.trim();
        const clientSecret = document.getElementById('login-modal-client-secret').value.trim();

        if (!clientId || !clientSecret) {
            alert('Client ID와 Client Secret을 입력해주세요.');
            return;
        }

        try {
            const result = await eel.login(clientId, clientSecret)();
            if (result.success) {
                isLoggedIn = true;
                loginModal.remove();
                await showSearchSection();
                await loadSubscriptions(false);
            } else {
                alert('로그인 실패: ' + (result.message || '알 수 없는 오류'));
            }
        } catch (e) {
            alert('로그인 중 오류 발생: ' + e);
        }
    };

    // 프리셋 계정 불러오기
    initLoginModalPresetAccounts(loginModal);
}

// 로그인 모달에서 프리셋 계정 초기화
async function initLoginModalPresetAccounts(loginModal) {
    try {
        const result = await eel.get_preset_oauth_accounts()();
        if (result.success && result.hasPresetAccounts && result.accounts.length > 0) {
            const presetSection = document.getElementById('login-modal-preset-section');
            const manualSection = document.getElementById('login-modal-manual-section');
            const accountList = document.getElementById('login-modal-account-list');

            presetSection.style.display = 'block';
            manualSection.style.display = 'none';

            // 계정 카드 렌더링
            accountList.innerHTML = result.accounts.map(account => `
                <div class="account-card" onclick="loginWithPresetAccount('${account.namePart}')" style="cursor:pointer;">
                    <div class="account-card-header">
                        <span class="account-card-name">${escapeHtml(account.display || account.name)}</span>
                        ${account.hasToken ? '<span class="account-status ready">✓ 준비됨</span>' : '<span class="account-status pending">토큰 필요</span>'}
                    </div>
                </div>
            `).join('');

            // 직접 입력 버튼
            document.getElementById('btn-login-modal-manual').onclick = () => {
                presetSection.style.display = 'none';
                manualSection.style.display = 'block';
            };
        }
    } catch (e) {
        console.log('프리셋 계정 로드 실패:', e);
    }
}

// 프리셋 계정으로 로그인
async function loginWithPresetAccount(accountId) {
    const loginModal = document.getElementById('login-modal');

    try {
        // login_with_preset_oauth(name_part, auto_login=True)
        const result = await eel.login_with_preset_oauth(accountId, true)();
        if (result.success && result.autoLogin) {
            // 자동 로그인 성공 (토큰 있음)
            isLoggedIn = true;
            if (loginModal) loginModal.remove();
            await showSearchSection();
            await loadSubscriptions(false);
        } else if (result.success && result.needsLogin) {
            // OAuth 설정은 됐지만 토큰이 없어서 로그인 필요
            const tokenResult = await eel.create_token_for_account(accountId)();
            if (tokenResult.success) {
                isLoggedIn = true;
                if (loginModal) loginModal.remove();
                await showSearchSection();
                await loadSubscriptions(false);
            } else {
                alert('로그인 실패: ' + (tokenResult.message || '알 수 없는 오류'));
            }
        } else if (result.needsToken) {
            // 토큰 생성 필요
            const tokenResult = await eel.create_token_for_account(accountId)();
            if (tokenResult.success) {
                isLoggedIn = true;
                if (loginModal) loginModal.remove();
                await showSearchSection();
                await loadSubscriptions(false);
            } else {
                alert('토큰 생성 실패: ' + (tokenResult.message || '알 수 없는 오류'));
            }
        } else {
            alert('로그인 실패: ' + (result.error || result.message || '알 수 없는 오류'));
        }
    } catch (e) {
        alert('로그인 중 오류 발생: ' + e);
    }
}

// 현재 설정 모드 저장
let isFirstSetupMode = false;
let setupAccountId = null;

function showSetupSection(isFirstSetup = false, accountId = null) {
    isFirstSetupMode = isFirstSetup;
    setupAccountId = accountId;

    setupSection.style.display = 'flex';
    loginSection.style.display = 'none';
    searchSection.style.display = 'none';

    // 입력 필드 초기화
    inputClientId.value = '';
    inputClientSecret.value = '';
    if (inputApiKey) inputApiKey.value = '';

    // 제목/설명 업데이트
    const setupBox = setupSection.querySelector('.setup-box h1');
    const setupDesc = setupSection.querySelector('.setup-box > p');

    if (isFirstSetup) {
        if (setupBox) setupBox.textContent = '첫 계정 설정';
        if (setupDesc) setupDesc.textContent = 'Google Cloud Console에서 발급받은 OAuth 2.0 자격증명을 입력하세요. 이 API는 새 계정에서 사용됩니다.';
    } else {
        if (setupBox) setupBox.textContent = '계정 API 설정';
        if (setupDesc) setupDesc.textContent = 'Google Cloud Console에서 발급받은 OAuth 2.0 자격증명을 입력하세요.';
    }
}

async function showLoginSection() {
    isLoggedIn = false;
    setupSection.style.display = 'none';
    loginSection.style.display = 'flex';
    searchSection.style.display = 'none';

    // 프리셋 계정 섹션 초기화 (항상 호출)
    await initPresetAccountSection();

    // 현재 계정의 API 설정이 있으면 필드에 표시
    const loginApiKey = document.getElementById('login-api-key');
    const loginClientId = document.getElementById('login-client-id');
    const loginClientSecret = document.getElementById('login-client-secret');

    try {
        const currentAccount = await eel.get_current_account_info()();
        if (currentAccount && currentAccount.id) {
            const apiConfig = await eel.load_account_api_config(currentAccount.id)();
            if (apiConfig.success) {
                loginApiKey.value = apiConfig.api_key || '';
                loginClientId.value = apiConfig.client_id || '';
                loginClientSecret.value = apiConfig.client_secret || '';
            }
        }
    } catch (e) {
        console.log('기존 API 설정 로드 실패:', e);
    }
}

async function showSearchSection() {
    isLoggedIn = true;
    setupSection.style.display = 'none';
    loginSection.style.display = 'none';
    searchSection.style.display = 'flex';
    subsInfo.textContent = '';

    // 사이드바 다시 표시 (로그인 후)
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.style.display = '';

    // 프리셋 OAuth 선택기 초기화 (프리셋 계정이 있으면 이것만 표시)
    await initPresetOAuthSelector();

    // 채널 목록 로드 및 표시 (YouTube 채널 - 브랜드 채널 등)
    await loadUserChannels();
}

async function loadUserChannels() {
    const channelSelector = document.getElementById('channel-selector');
    const channelThumbnail = document.getElementById('channel-thumbnail');
    const channelName = document.getElementById('channel-name');

    try {
        const result = await eel.get_user_channels()();

        if (result.success && result.channels.length > 0) {
            userChannels = result.channels;
            selectedChannelId = result.selectedChannelId;

            // 현재 선택된 채널 표시
            const currentChannel = userChannels.find(c => c.id === selectedChannelId) || userChannels[0];
            channelThumbnail.src = currentChannel.thumbnail;
            channelName.textContent = currentChannel.title;
            channelName.title = currentChannel.title;

            // 채널이 2개 이상일 때만 channel-selector 표시
            if (userChannels.length >= 2) {
                document.querySelector('.channel-arrow').style.display = 'inline';
                document.getElementById('channel-current').style.cursor = 'pointer';
                channelSelector.style.display = 'block';
            } else {
                // 채널이 1개면 선택기 자체를 숨김
                channelSelector.style.display = 'none';
            }
        } else {
            channelSelector.style.display = 'none';
        }
    } catch (e) {
        console.error('채널 목록 로드 실패:', e);
        channelSelector.style.display = 'none';
    }
}

function renderChannelDropdown() {
    const channelList = document.getElementById('channel-list');

    channelList.innerHTML = userChannels.map(channel => `
        <div class="channel-item ${channel.id === selectedChannelId ? 'selected' : ''}"
             onclick="selectChannel('${channel.id}')">
            <img src="${channel.thumbnail}" alt="${escapeHtml(channel.title)}">
            <div class="channel-item-info">
                <div class="channel-item-title">${escapeHtml(channel.title)}</div>
                ${channel.isDefault ? '<div class="channel-item-badge">기본 채널</div>' : ''}
            </div>
            ${channel.id === selectedChannelId ? '<span class="channel-item-check">✓</span>' : ''}
        </div>
    `).join('');
}

function toggleChannelDropdown() {
    // 채널이 1개면 드롭다운 열지 않음
    if (userChannels.length <= 1) return;

    const dropdown = document.getElementById('channel-dropdown');
    if (dropdown.style.display === 'none') {
        renderChannelDropdown();
        dropdown.style.display = 'block';
    } else {
        dropdown.style.display = 'none';
    }
}

async function selectChannel(channelId) {
    if (channelId === selectedChannelId) {
        document.getElementById('channel-dropdown').style.display = 'none';
        return;
    }

    // 채널 변경 확인
    if (subscriptionsLoaded) {
        if (!confirm('채널을 변경하면 구독 목록이 새로 로드됩니다.\n계속하시겠습니까?')) {
            document.getElementById('channel-dropdown').style.display = 'none';
            return;
        }
    }

    try {
        const result = await eel.select_channel(channelId)();

        if (result.success) {
            selectedChannelId = channelId;

            // UI 업데이트
            const channel = userChannels.find(c => c.id === channelId);
            if (channel) {
                document.getElementById('channel-thumbnail').src = channel.thumbnail;
                document.getElementById('channel-name').textContent = channel.title;
            }

            // 드롭다운 닫기
            document.getElementById('channel-dropdown').style.display = 'none';

            // 구독 목록 초기화 및 새로 로드
            subscriptionsLoaded = false;
            currentSubscriptions = [];
            btnSearch.disabled = true;
            resultsSection.style.display = 'none';

            // 새 채널의 구독 목록 로드
            loadSubscriptions(true);
        }
    } catch (e) {
        console.error('채널 선택 실패:', e);
        alert('채널 선택 중 오류가 발생했습니다.');
    }
}

function setupEventListeners() {
    // 인증 정보 저장 (첫 계정 또는 계정 추가) - setup-section용
    if (btnSaveConfig) {
        btnSaveConfig.addEventListener('click', async () => {
            const clientId = inputClientId.value.trim();
            const clientSecret = inputClientSecret.value.trim();
            const apiKey = inputApiKey ? inputApiKey.value.trim() : '';

            if (!clientId || !clientSecret || !apiKey) {
                alert('Client ID, Client Secret, API 키를 모두 입력해주세요.');
                return;
            }

            btnSaveConfig.disabled = true;
            btnSaveConfig.textContent = '저장 중...';

            try {
                let result;

                if (isFirstSetupMode) {
                    // 첫 계정 생성 (계정 + API 동시 생성)
                    result = await eel.create_first_account(apiKey, clientId, clientSecret)();
                } else if (setupAccountId) {
                    // 기존 계정에 API 설정
                    result = await eel.save_account_api_config(setupAccountId, apiKey, clientId, clientSecret)();
                } else {
                    // 새 계정 추가
                    result = await eel.add_account_with_api(apiKey, clientId, clientSecret)();
                }

                if (result.success) {
                    const accountId = result.account_id || setupAccountId;

                    if (result.needsLogin || isFirstSetupMode) {
                        // 로그인 필요
                        alert('API 설정이 저장되었습니다.\n이제 Google 계정으로 로그인해주세요.');

                        // 로그인 진행
                        const loginResult = await eel.login_account(accountId)();

                        if (loginResult.success) {
                            // 계정 전환 후 검색 화면으로
                            currentAccountId = accountId;
                            await loadAccounts();
                            showSearchSection();
                            loadSubscriptions(false);
                        } else {
                            alert('로그인 실패: ' + loginResult.error);
                            // 실패 시 계정 삭제
                            if (isFirstSetupMode || result.account_id) {
                                await eel.remove_account_by_id(accountId)();
                            }
                        }
                    } else {
                        alert('API 설정이 저장되었습니다.');
                        showSearchSection();
                    }
                } else {
                    alert('저장 실패: ' + result.error);
                }
            } catch (e) {
                alert('오류가 발생했습니다: ' + e);
                console.error(e);
            }

            btnSaveConfig.disabled = false;
            btnSaveConfig.textContent = '저장 및 로그인';
        });
    }

    // 인증 정보 변경 버튼 (존재하는 경우에만)
    if (btnShowSetup) {
        btnShowSetup.addEventListener('click', () => {
            showSetupSection();
        });
    }

    // 인증 정보 설정 취소 버튼 (존재하는 경우에만)
    if (btnCancelSetup) {
        btnCancelSetup.addEventListener('click', async () => {
            // 이전 화면으로 돌아가기
            const apiConfig = await eel.get_api_config()();
            if (apiConfig.hasSavedCredentials) {
                showUnlockSection();
            } else if (apiConfig.hasConfig) {
                showLoginSection();
            } else {
                // 저장된 정보가 아예 없으면 setup 화면 유지
                alert('인증 정보가 없습니다. 새로운 인증 정보를 입력해주세요.');
            }
        });
    }

    // 설정 가이드 모달 (setup-section)
    if (btnShowGuide) {
        btnShowGuide.addEventListener('click', () => {
            guideModal.style.display = 'flex';
        });
    }

    // 설정 가이드 모달 (login-section)
    if (btnShowGuideLogin) {
        btnShowGuideLogin.addEventListener('click', () => {
            guideModal.style.display = 'flex';
        });
    }

    if (btnCloseGuide) {
        btnCloseGuide.addEventListener('click', () => {
            guideModal.style.display = 'none';
        });
    }

    if (guideModal) {
        guideModal.addEventListener('click', (e) => {
            if (e.target === guideModal) {
                guideModal.style.display = 'none';
            }
        });
    }

    // 로그인
    if (btnLogin) btnLogin.addEventListener('click', async () => {
        const loginApiKey = document.getElementById('login-api-key');
        const loginClientId = document.getElementById('login-client-id');
        const loginClientSecret = document.getElementById('login-client-secret');

        const apiKey = loginApiKey.value.trim();
        const clientId = loginClientId.value.trim();
        const clientSecret = loginClientSecret.value.trim();

        // API 설정 검증
        if (!apiKey || !clientId || !clientSecret) {
            alert('API 키, Client ID, Client Secret을 모두 입력해주세요.');
            return;
        }

        btnLogin.disabled = true;
        btnLogin.textContent = '로그인 중...';

        try {
            // 현재 계정이 있는지 확인
            const currentAccount = await eel.get_current_account_info()();

            if (currentAccount && currentAccount.id) {
                // 기존 계정이 있으면 API 설정 업데이트
                const saveResult = await eel.save_account_api_config(currentAccount.id, apiKey, clientId, clientSecret)();
                if (!saveResult.success) {
                    alert('API 설정 저장 실패: ' + saveResult.error);
                    btnLogin.disabled = false;
                    btnLogin.textContent = 'Google 계정으로 로그인';
                    return;
                }
            } else {
                // 계정이 없으면 새 계정 생성
                const createResult = await eel.create_first_account(apiKey, clientId, clientSecret)();
                if (!createResult.success) {
                    alert('계정 생성 실패: ' + createResult.error);
                    btnLogin.disabled = false;
                    btnLogin.textContent = 'Google 계정으로 로그인';
                    return;
                }
            }

            // 로그인 시도
            const result = await eel.do_login()();

            if (result.success) {
                showSearchSection();
                loadSubscriptions(false);
                return;
            } else if (result.needsManualLogin) {
                // 전용 Chrome 창에서 로그인 진행
                btnLogin.textContent = '로그인 창 여는 중...';
                await startBrowserLogin();
                return;
            } else {
                alert('로그인 실패: ' + result.error);
            }
        } catch (e) {
            console.error('로그인 오류:', e);
            alert('로그인이 취소되었거나 오류가 발생했습니다.');
        }

        // 실패 또는 취소 시 버튼 복구
        btnLogin.disabled = false;
        btnLogin.textContent = 'Google 계정으로 로그인';
    });

    // 인증 코드 입력 모달 이벤트
    const authModal = document.getElementById('auth-code-modal');
    const authCodeInput = document.getElementById('auth-code-input');
    const btnSubmitAuthCode = document.getElementById('btn-submit-auth-code');
    const btnCancelAuth = document.getElementById('btn-cancel-auth');
    const btnCopyAuthUrl = document.getElementById('btn-copy-auth-url');

    if (btnSubmitAuthCode) {
        btnSubmitAuthCode.addEventListener('click', submitAuthCode);
    }
    if (btnCancelAuth) {
        btnCancelAuth.addEventListener('click', () => {
            authModal.style.display = 'none';
            btnLogin.disabled = false;
            btnLogin.textContent = 'Google 계정으로 로그인';
        });
    }
    if (btnCopyAuthUrl) {
        btnCopyAuthUrl.addEventListener('click', () => {
            const urlText = document.getElementById('auth-url-display').textContent;
            navigator.clipboard.writeText(urlText).then(() => {
                btnCopyAuthUrl.textContent = '복사됨!';
                setTimeout(() => {
                    btnCopyAuthUrl.textContent = 'URL 복사';
                }, 2000);
            });
        });
    }
    if (authCodeInput) {
        authCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                submitAuthCode();
            }
        });
    }

    // 로그아웃 (프로그램 종료)
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            if (confirm('로그아웃하시겠습니까?\n(프로그램이 종료됩니다)')) {
                // 로그아웃 요청 (비동기, 응답 기다리지 않음)
                eel.do_logout()();
                // 약간의 지연 후 창 닫기 (로그아웃 처리 시간 확보)
                setTimeout(() => {
                    window.close();
                }, 100);
            }
        });
    }

    // 구독 채널 새로고침
    if (btnRefreshSubs) btnRefreshSubs.addEventListener('click', () => loadSubscriptions(true));

    // 구글 서비스 버튼 (Google Cloud Console)
    if (btnGoogleConsole) {
        btnGoogleConsole.addEventListener('click', () => {
            window.open('https://console.cloud.google.com/apis/credentials', '_blank');
        });
    }

    // 채널 목록 보기
    if (btnCloseSubsModal) btnCloseSubsModal.addEventListener('click', closeSubsModal);
    if (subsModal) {
        subsModal.addEventListener('click', (e) => {
            if (e.target === subsModal) closeSubsModal();
        });
    }

    // 구독 내보내기/가져오기/새로고침
    if (btnExportSubs) btnExportSubs.addEventListener('click', exportSubscriptions);
    if (btnImportSubs) btnImportSubs.addEventListener('click', importSubscriptions);
    if (btnRefreshSubsModal) btnRefreshSubsModal.addEventListener('click', refreshSubscriptionsInModal);

    // 전체선택/일괄취소
    if (btnSelectAll) btnSelectAll.addEventListener('click', toggleSelectAll);
    if (btnBatchUnsubscribe) btnBatchUnsubscribe.addEventListener('click', batchUnsubscribe);

    // 카테고리 설정 저장/초기화/추가
    const btnSaveThresholds = document.getElementById('btn-save-thresholds');
    if (btnSaveThresholds) btnSaveThresholds.addEventListener('click', () => {
        const categories = getCategoriesFromUI();
        saveCategorySettings(categories);
        // 사이드바 구조와 데이터 다시 렌더링
        renderChannelSidebarStructure();
        if (currentSubscriptions.length > 0) {
            renderChannelSidebar();
        }
        // 모달 닫기
        closeSubsModal();
    });

    const btnResetThresholds = document.getElementById('btn-reset-thresholds');
    if (btnResetThresholds) btnResetThresholds.addEventListener('click', () => {
        // 기본 카테고리로 초기화
        CHANNEL_CATEGORIES = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
        CHANNEL_CATEGORIES[CHANNEL_CATEGORIES.length - 1].max = Infinity;
        saveCategorySettings(CHANNEL_CATEGORIES);
        renderCategorySettingsUI();
        // 사이드바 구조와 데이터 다시 렌더링
        renderChannelSidebarStructure();
        if (currentSubscriptions.length > 0) {
            renderChannelSidebar();
        }
        alert('기본값으로 초기화되었습니다.');
    });

    const btnAddCategory = document.getElementById('btn-add-category');
    if (btnAddCategory) btnAddCategory.addEventListener('click', addCategory);

    // 탭 전환 및 드롭다운 메뉴 처리
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            console.log('[Tab] 탭 클릭:', btn.dataset.tab, btn.textContent.trim());
            const tab = btn.dataset.tab;
            const isDropdownToggle = btn.classList.contains('tab-dropdown-toggle');

            if (isDropdownToggle) {
                // 드롭다운 토글 버튼 클릭
                toggleDropdownMenu(btn);
            } else {
                // 일반 탭 버튼 또는 드롭다운 메뉴 항목 클릭
                // 드롭다운 메뉴 닫기
                closeAllDropdownMenus();
                switchTab(tab);
            }
        });
    });

    // 드롭다운 메뉴 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.tab-dropdown')) {
            closeAllDropdownMenus();
        }
    });

    // 검색 (모든채널모니터)
    if (btnSearch) btnSearch.addEventListener('click', searchVideos);

    // 검색 (단일 채널모니터)
    const btnSearchSingleEl = document.getElementById('btn-search-single');
    if (btnSearchSingleEl) btnSearchSingleEl.addEventListener('click', searchVideos);

    // 단일 채널 선택 드롭다운 변경 시 검색 버튼 활성화
    const singleChannelSelect = document.getElementById('single-channel-select');
    if (singleChannelSelect) singleChannelSelect.addEventListener('change', (e) => {
        const btnSearchSingle = document.getElementById('btn-search-single');
        if (btnSearchSingle) btnSearchSingle.disabled = !subscriptionsLoaded || !e.target.value;
    });

    // 단일 채널 기간 드롭다운
    setupPeriodDropdown('days-within-single', 'days-within-single-custom');

    // 검색 (키워드)
    const btnSearchKeywordEl = document.getElementById('btn-search-keyword');
    if (btnSearchKeywordEl) btnSearchKeywordEl.addEventListener('click', searchVideos);

    // 검색 (핫트렌드)
    const btnSearchTrendEl = document.getElementById('btn-search-trend');
    if (btnSearchTrendEl) btnSearchTrendEl.addEventListener('click', searchVideos);

    // 검색 (돌연변이)
    const btnSearchMutationEl = document.getElementById('btn-search-mutation');
    if (btnSearchMutationEl) btnSearchMutationEl.addEventListener('click', searchVideos);

    // 검색 중단
    if (btnCancelSearch) btnCancelSearch.addEventListener('click', cancelSearch);

    // 무한 스크롤
    if (resultsList) resultsList.addEventListener('scroll', () => {
        const { scrollTop, scrollHeight, clientHeight } = resultsList;
        // 스크롤이 하단 200px 이내에 도달하면 더 로드
        if (scrollTop + clientHeight >= scrollHeight - 200) {
            if (displayedCount < filteredResults.length) {
                loadMoreResults();
            }
        }
        // 맨 위로 버튼 표시/숨김
        const btnScrollTop = document.getElementById('btn-scroll-top');
        if (scrollTop > 300) {
            btnScrollTop.classList.add('visible');
        } else {
            btnScrollTop.classList.remove('visible');
        }
    });

    // 결과 내 검색
    const resultsFilter = document.getElementById('results-filter');
    if (resultsFilter) resultsFilter.addEventListener('input', (e) => {
        filterResults(e.target.value);
    });

    // 맨 위로 버튼
    const btnScrollTopEl = document.getElementById('btn-scroll-top');
    if (btnScrollTopEl) btnScrollTopEl.addEventListener('click', scrollToTop);

    // 정렬 옵션 변경
    const sortOption = document.getElementById('sort-option');
    if (sortOption) sortOption.addEventListener('change', () => {
        sortAndRenderResults();
    });

    // 완료 숨기기 토글
    const hideDone = document.getElementById('hide-done');
    if (hideDone) hideDone.addEventListener('change', () => {
        applyFiltersAndRender();
    });

    // 채널별 그룹화 토글
    const groupByChannel = document.getElementById('group-by-channel');
    if (groupByChannel) groupByChannel.addEventListener('change', () => {
        applyFiltersAndRender();
    });

    // YouTube 전체 검색 체크박스 이벤트
    const youtubeGlobalCheckbox = document.getElementById('youtube-global-search');
    const keywordSearchDesc = document.getElementById('keyword-search-desc');
    const btnSearchKeyword = document.getElementById('btn-search-keyword');
    const keywordSubscriberWrapper = document.getElementById('keyword-subscriber-wrapper');
    if (youtubeGlobalCheckbox) youtubeGlobalCheckbox.addEventListener('change', () => {
        if (youtubeGlobalCheckbox.checked) {
            if (keywordSearchDesc) keywordSearchDesc.textContent = 'YouTube 전체에서 키워드로 영상을 검색합니다. (API 할당량 소모 주의)';
            if (btnSearchKeyword) btnSearchKeyword.disabled = false;  // 구독 채널 로드 여부와 상관없이 활성화
            if (keywordSubscriberWrapper) keywordSubscriberWrapper.style.display = 'none';  // 구독자 카테고리 숨김
        } else {
            if (keywordSearchDesc) keywordSearchDesc.textContent = '구독 채널 내에서 키워드가 포함된 영상을 검색합니다.';
            if (btnSearchKeyword) btnSearchKeyword.disabled = !subscriptionsLoaded;
            if (keywordSubscriberWrapper) keywordSubscriberWrapper.style.display = 'flex';  // 구독자 카테고리 표시
        }
    });

    // 필터바 내보내기 버튼들
    const btnExportFilter = document.getElementById('btn-export-filter');
    const btnExportFilterSingle = document.getElementById('btn-export-filter-single');
    const btnExportFilterKeyword = document.getElementById('btn-export-filter-keyword');
    const btnExportFilterTrend = document.getElementById('btn-export-filter-trend');
    const btnExportFilterMutation = document.getElementById('btn-export-filter-mutation');

    if (btnExportFilter) btnExportFilter.addEventListener('click', openExportOptionsModal);
    if (btnExportFilterSingle) btnExportFilterSingle.addEventListener('click', openExportOptionsModal);
    if (btnExportFilterKeyword) btnExportFilterKeyword.addEventListener('click', openExportOptionsModal);
    if (btnExportFilterTrend) btnExportFilterTrend.addEventListener('click', openExportOptionsModal);
    if (btnExportFilterMutation) btnExportFilterMutation.addEventListener('click', openExportOptionsModal);

    // 내보내기 옵션 모달 이벤트
    const btnCloseExportOptions = document.getElementById('btn-close-export-options');
    const btnCancelExport = document.getElementById('btn-cancel-export');
    const btnConfirmExport = document.getElementById('btn-confirm-export');
    const exportIncludeComments = document.getElementById('export-include-comments');

    if (btnCloseExportOptions) btnCloseExportOptions.addEventListener('click', closeExportOptionsModal);
    if (btnCancelExport) btnCancelExport.addEventListener('click', closeExportOptionsModal);
    if (btnConfirmExport) btnConfirmExport.addEventListener('click', executeExport);
    if (exportIncludeComments) exportIncludeComments.addEventListener('change', (e) => {
        const keywordsGroup = document.getElementById('export-keywords-group');
        if (keywordsGroup) {
            keywordsGroup.style.display = e.target.checked ? 'block' : 'none';
        }
    });

    // 검색 히스토리
    const btnHistory = document.getElementById('btn-history');
    if (btnHistory) btnHistory.addEventListener('click', toggleHistoryMenu);

    // 키워드 히스토리
    const btnKeywordHistory = document.getElementById('btn-keyword-history');
    if (btnKeywordHistory) btnKeywordHistory.addEventListener('click', () => toggleKeywordHistoryMenu('keyword-history-menu', 'search-keyword'));

    // 돌연변이 히스토리
    const btnMutationHistory = document.getElementById('btn-mutation-history');
    if (btnMutationHistory) btnMutationHistory.addEventListener('click', toggleMutationHistoryMenu);

    // 채널 선택 드롭다운
    const channelCurrent = document.getElementById('channel-current');
    if (channelCurrent) channelCurrent.addEventListener('click', toggleChannelDropdown);

    // 기간 선택 드롭다운 이벤트
    setupPeriodDropdown('days-within', 'days-within-custom');
    setupPeriodDropdown('days-within-keyword', 'days-within-keyword-custom');
    setupPeriodDropdown('days-within-mutation', 'days-within-mutation-custom');

    // 구독자 카테고리 드롭다운 이벤트
    setupSubscriberDropdown();

    // 외부 클릭 시 드롭다운 메뉴들 닫기
    document.addEventListener('click', (e) => {
        // 히스토리 메뉴
        const historyDropdown = document.querySelector('.history-dropdown:not(.keyword-history-dropdown):not(.mutation-history-dropdown)');
        if (historyDropdown && !historyDropdown.contains(e.target)) {
            document.getElementById('history-menu').style.display = 'none';
        }

        // 키워드 히스토리 메뉴
        const keywordHistoryBtn = document.getElementById('btn-keyword-history');
        const keywordHistoryMenu = document.getElementById('keyword-history-menu');
        if (keywordHistoryBtn && keywordHistoryMenu && !keywordHistoryBtn.contains(e.target) && !keywordHistoryMenu.contains(e.target)) {
            keywordHistoryMenu.style.display = 'none';
        }

        // 돌연변이 히스토리 메뉴
        const mutationHistoryBtn = document.getElementById('btn-mutation-history');
        const mutationHistoryMenu = document.getElementById('mutation-history-menu');
        if (mutationHistoryBtn && mutationHistoryMenu && !mutationHistoryBtn.contains(e.target) && !mutationHistoryMenu.contains(e.target)) {
            mutationHistoryMenu.style.display = 'none';
        }

        // 채널 선택 드롭다운
        const channelSelector = document.getElementById('channel-selector');
        if (!channelSelector.contains(e.target)) {
            document.getElementById('channel-dropdown').style.display = 'none';
        }
    });

    // 사이드바 버튼 이벤트
    const btnSidebarExport = document.getElementById('btn-sidebar-export');
    const btnSidebarImport = document.getElementById('btn-sidebar-import');
    const btnSidebarReload = document.getElementById('btn-sidebar-reload');
    const btnManageSubs = document.getElementById('btn-manage-subs');

    if (btnSidebarExport) {
        btnSidebarExport.addEventListener('click', exportSidebarSubscriptions);
    }
    if (btnSidebarImport) {
        btnSidebarImport.addEventListener('click', importSidebarSubscriptions);
    }
    if (btnSidebarReload) {
        btnSidebarReload.addEventListener('click', () => loadSubscriptions(true));
    }
    if (btnManageSubs) {
        btnManageSubs.addEventListener('click', openSubsModal);
    }

    // 사이드바 채널 검색 이벤트
    const sidebarSearchInput = document.getElementById('sidebar-channel-search');
    const sidebarSearchClear = document.getElementById('sidebar-search-clear');

    if (sidebarSearchInput) {
        sidebarSearchInput.addEventListener('input', function() {
            const query = this.value.trim();
            filterSidebarChannels(query);
            // 클리어 버튼 표시/숨김
            if (sidebarSearchClear) {
                sidebarSearchClear.style.display = query ? 'block' : 'none';
            }
        });

        // Enter 키로 검색 (첫 번째 매칭 채널로 이동)
        sidebarSearchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                this.value = '';
                filterSidebarChannels('');
                if (sidebarSearchClear) sidebarSearchClear.style.display = 'none';
            }
        });
    }

    if (sidebarSearchClear) {
        sidebarSearchClear.addEventListener('click', function() {
            if (sidebarSearchInput) {
                sidebarSearchInput.value = '';
                filterSidebarChannels('');
            }
            this.style.display = 'none';
        });
    }
}

async function loadSubscriptions(forceRefresh) {
    if (subsInfo) subsInfo.textContent = '로딩...';
    if (btnRefreshSubs) btnRefreshSubs.disabled = true;

    try {
        console.log('loadSubscriptions 호출됨, forceRefresh:', forceRefresh);
        const result = await eel.load_subscriptions(forceRefresh)();
        console.log('loadSubscriptions 결과:', result);

        if (result.success) {
            currentSubscriptions = result.subscriptions;
            subscriptionsLoaded = true;

            if (subsInfo) {
                subsInfo.textContent = `${currentSubscriptions.length}개 구독채널`;
                subsInfo.classList.add('loaded');
            }

            if (btnSearch) btnSearch.disabled = false;
            const btnSearchKeyword = document.getElementById('btn-search-keyword');
            if (btnSearchKeyword) btnSearchKeyword.disabled = false;
            // 핫트렌드는 이미 활성화 상태 유지
            const btnSearchMutation = document.getElementById('btn-search-mutation');
            if (btnSearchMutation) btnSearchMutation.disabled = false;

            // 단일 채널 선택 드롭다운 채우기
            populateSingleChannelDropdown();

            // 사이드바 채널 목록 렌더링
            renderChannelSidebar();
            console.log('renderChannelSidebar 호출 완료, 채널 수:', currentSubscriptions.length);
        } else {
            if (subsInfo) {
                subsInfo.textContent = '오류';
                subsInfo.classList.remove('loaded');
            }
            alert('오류: ' + result.error);
        }
    } catch (e) {
        if (subsInfo) subsInfo.textContent = '오류';
        console.error('loadSubscriptions 오류:', e);
    }

    if (btnRefreshSubs) btnRefreshSubs.disabled = false;
}

// 구독채널관리 팝업에서 새로고침
async function refreshSubscriptionsInModal() {
    const btn = btnRefreshSubsModal;
    if (btn) {
        btn.disabled = true;
        btn.textContent = '로딩...';
    }

    try {
        // 구독 목록 새로고침 (강제)
        await loadSubscriptions(true);
        // 팝업 내 목록 업데이트
        renderSubsList();
    } catch (e) {
        console.error('구독 새로고침 오류:', e);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '새로고침';
        }
    }
}

// 드롭다운 메뉴 토글
function toggleDropdownMenu(toggleBtn) {
    const dropdown = toggleBtn.closest('.tab-dropdown');
    const menu = dropdown.querySelector('.tab-dropdown-menu');

    // 다른 모든 드롭다운 메뉴 닫기
    document.querySelectorAll('.tab-dropdown-menu.active').forEach(m => {
        if (m !== menu) {
            m.classList.remove('active');
        }
    });
    document.querySelectorAll('.tab-dropdown-toggle.active').forEach(btn => {
        if (btn !== toggleBtn) {
            btn.classList.remove('active');
        }
    });

    // 현재 메뉴 토글
    menu.classList.toggle('active');
    toggleBtn.classList.toggle('active');
}

// 모든 드롭다운 메뉴 닫기
function closeAllDropdownMenus() {
    document.querySelectorAll('.tab-dropdown-menu.active').forEach(menu => {
        menu.classList.remove('active');
    });
    document.querySelectorAll('.tab-dropdown-toggle.active').forEach(btn => {
        btn.classList.remove('active');
    });
}

// 탭 전환
function switchTab(tab) {
    // 로그인 필요한 탭인지 체크
    if (TABS_REQUIRING_LOGIN.includes(tab) && !isLoggedIn) {
        // 로그인 필요 - 로그인 팝업 표시
        checkLoginAndProceed(() => {
            // 로그인 성공 후 탭 전환
            doSwitchTab(tab);
        });
        return;
    }

    doSwitchTab(tab);
}

// 구독채널 사이드바가 필요한 탭 목록
const TABS_REQUIRING_SIDEBAR = [
    'all-channel-monitor',
    'channel-monitor',
    'batch-subscribe'
];

// 실제 탭 전환 수행
function doSwitchTab(tab) {
    currentTab = tab;

    // 탭 버튼 활성화
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // 탭 컨텐츠 표시
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === `tab-${tab}`);
    });

    // 구독채널 사이드바 표시/숨기기
    const sidebar = document.getElementById('channel-sidebar');
    if (sidebar) {
        const showSidebar = TABS_REQUIRING_SIDEBAR.includes(tab);
        sidebar.style.display = showSidebar ? 'flex' : 'none';
    }

    // 로그인 필요 없는 탭은 검색 버튼 상태 체크 스킵
    if (TABS_NO_LOGIN_REQUIRED.includes(tab)) {
        return;
    }

    // 모든 검색 버튼 상태 동기화
    const btnSearchKeyword = document.getElementById('btn-search-keyword');
    const btnSearchTrend = document.getElementById('btn-search-trend');
    const btnSearchMutation = document.getElementById('btn-search-mutation');
    const btnSearchSingle = document.getElementById('btn-search-single');

    btnSearch.disabled = !subscriptionsLoaded;
    btnSearchKeyword.disabled = !subscriptionsLoaded;
    // 핫트렌드는 구독 채널과 무관하므로 항상 활성화
    btnSearchTrend.disabled = false;
    btnSearchMutation.disabled = !subscriptionsLoaded;

    // 채널모니터(단일)는 채널 선택 여부에 따라 활성화
    const singleChannelSelect = document.getElementById('single-channel-select');
    if (btnSearchSingle) {
        btnSearchSingle.disabled = !subscriptionsLoaded || !singleChannelSelect?.value;
    }

    // 탭별 검색결과 표시
    loadTabResults(tab);
}

// 탭별 검색결과 로드
function loadTabResults(tab) {
    const results = tabSearchResults[tab] || [];
    allSearchResults = results;

    if (results.length > 0) {
        resultsSection.style.display = 'flex';
        showExportButtons(true);

        // 모든채널모니터, 채널모니터는 기본 채널별 그룹화
        if (tab === 'all-channel-monitor' || tab === 'channel-monitor') {
            document.getElementById('group-by-channel').checked = true;
        }

        // 필터 및 정렬 적용 후 렌더링
        applyFiltersAndRender();
        updateResultsCount();
    } else {
        resultsSection.style.display = 'none';
        showExportButtons(false);
        resultsList.innerHTML = '';
    }
}

// 구독 목록 모달
function openSubsModal() {
    subsModal.style.display = 'flex';
    selectedChannels.clear();
    updateSelectedCount();
    renderSubsList();
    // 카테고리 설정 UI 렌더링
    renderCategorySettingsUI();
}

function closeSubsModal() {
    subsModal.style.display = 'none';
    selectedChannels.clear();
    updateSelectedCount();
}

function updateSelectedCount() {
    selectedCountSpan.textContent = selectedChannels.size;
    btnBatchUnsubscribe.disabled = selectedChannels.size === 0;

    // 전체선택 버튼 텍스트 변경
    if (selectedChannels.size === currentSubscriptions.length && currentSubscriptions.length > 0) {
        btnSelectAll.textContent = '전체해제';
    } else {
        btnSelectAll.textContent = '전체선택';
    }
}

function toggleSelectAll() {
    if (selectedChannels.size === currentSubscriptions.length) {
        // 전체 해제
        selectedChannels.clear();
        document.querySelectorAll('.subs-checkbox').forEach(cb => cb.checked = false);
    } else {
        // 전체 선택
        currentSubscriptions.forEach(sub => selectedChannels.add(sub.id));
        document.querySelectorAll('.subs-checkbox').forEach(cb => cb.checked = true);
    }
    updateSelectedCount();
}

// 전역 스코프에서 호출 가능하도록 window에 할당
window.toggleChannelSelection = function(channelId, checkbox) {
    if (checkbox.checked) {
        selectedChannels.add(channelId);
    } else {
        selectedChannels.delete(channelId);
    }
    updateSelectedCount();
};

async function batchUnsubscribe() {
    if (selectedChannels.size === 0) {
        return;
    }

    const confirmMsg = `선택한 ${selectedChannels.size}개 채널의 구독을 취소하시겠습니까?\n\n` +
        '주의: 이 작업은 되돌릴 수 없습니다.';

    if (!confirm(confirmMsg)) {
        return;
    }

    // 채널 ID 먼저 복사 (closeSubsModal에서 clear되기 전에)
    const channelIds = Array.from(selectedChannels);

    btnBatchUnsubscribe.disabled = true;
    btnBatchUnsubscribe.textContent = '취소 중...';

    // 모달 닫고 진행바 표시
    closeSubsModal();
    progressSection.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = '일괄 구독 취소 준비 중...';

    try {
        const result = await eel.unsubscribe_channels_batch(channelIds)();

        progressSection.style.display = 'none';

        if (result.success) {
            const msg = `일괄 구독 취소 완료!\n\n` +
                `전체: ${result.total}개\n` +
                `취소 완료: ${result.unsubscribed}개\n` +
                `실패: ${result.failed}개`;
            alert(msg);

            // 구독 목록에서 삭제된 채널 제거 (로컬)
            if (result.unsubscribed > 0) {
                currentSubscriptions = currentSubscriptions.filter(
                    sub => !channelIds.includes(sub.id)
                );
                subsInfo.textContent = `${currentSubscriptions.length}개 구독채널`;
            }
        } else {
            alert('일괄 취소 실패: ' + result.error);
        }
    } catch (e) {
        progressSection.style.display = 'none';
        alert('오류가 발생했습니다.');
        console.error(e);
    }

    btnBatchUnsubscribe.disabled = false;
    btnBatchUnsubscribe.innerHTML = '구독취소 (<span id="selected-count">0</span>)';
}

// 구독 목록 내보내기
async function exportSubscriptions() {
    if (currentSubscriptions.length === 0) {
        alert('내보낼 구독 목록이 없습니다.');
        return;
    }

    btnExportSubs.disabled = true;
    btnExportSubs.textContent = '내보내는 중...';

    try {
        const result = await eel.export_subscriptions()();

        if (result.success) {
            alert(`${result.count}개 채널을 내보냈습니다.\n\n저장 위치:\n${result.path}`);
        } else if (result.error !== '취소됨') {
            alert('내보내기 실패: ' + result.error);
        }
    } catch (e) {
        alert('오류가 발생했습니다.');
        console.error(e);
    }

    btnExportSubs.disabled = false;
    btnExportSubs.textContent = '내보내기';
}

// 구독 목록 가져오기
async function importSubscriptions() {
    const confirmMsg = '다른 계정에서 내보낸 구독 목록을 가져옵니다.\n\n' +
        '주의사항:\n' +
        '- 이미 구독 중인 채널은 건너뜁니다.\n' +
        '- API 할당량을 사용합니다 (채널당 50 quota).\n\n' +
        '계속하시겠습니까?';

    if (!confirm(confirmMsg)) {
        return;
    }

    btnImportSubs.disabled = true;
    btnImportSubs.textContent = '가져오는 중...';

    // 진행률 표시를 위해 모달 닫고 메인 진행바 사용
    closeSubsModal();
    progressSection.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = '구독 가져오기 준비 중...';

    try {
        const result = await eel.import_subscriptions()();

        progressSection.style.display = 'none';

        if (result.success) {
            const msg = `가져오기 완료!\n\n` +
                `전체: ${result.total}개\n` +
                `구독 완료: ${result.subscribed}개\n` +
                `이미 구독 중: ${result.skipped}개\n` +
                `실패: ${result.failed}개`;
            alert(msg);

            // 구독 목록 새로고침
            if (result.subscribed > 0) {
                loadSubscriptions(true);
            }
        } else if (result.error !== '취소됨') {
            alert('가져오기 실패: ' + result.error);
        }
    } catch (e) {
        progressSection.style.display = 'none';
        alert('오류가 발생했습니다.');
        console.error(e);
    }

    btnImportSubs.disabled = false;
    btnImportSubs.textContent = '가져오기';
}

function renderSubsList() {
    subsModalCount.textContent = `(${currentSubscriptions.length}개)`;

    if (currentSubscriptions.length === 0) {
        subsList.innerHTML = '<p style="text-align:center;color:#666;padding:20px;">구독 채널이 없습니다.</p>';
        return;
    }

    // 구독자수 내림차순 정렬
    const sortedSubs = [...currentSubscriptions].sort((a, b) =>
        (b.subscriberCount || 0) - (a.subscriberCount || 0)
    );

    subsList.innerHTML = sortedSubs.map(sub => `
        <div class="subs-item" data-channel-id="${sub.id}">
            <input type="checkbox" class="subs-checkbox"
                   ${selectedChannels.has(sub.id) ? 'checked' : ''}>
            <img src="${sub.thumbnail}" alt="${escapeHtml(sub.title)}" class="subs-thumbnail" data-channel-id="${sub.id}" title="채널 페이지로 이동">
            <div class="subs-item-info" data-channel-id="${sub.id}">
                <div class="subs-item-title">${escapeHtml(sub.title)}</div>
                <div class="subs-item-count">구독자 ${formatSubscriberCount(sub.subscriberCount)}</div>
            </div>
            <button class="btn-unsubscribe" data-channel-id="${sub.id}">구독취소</button>
        </div>
    `).join('');

    // 이벤트 리스너 추가
    subsList.querySelectorAll('.subs-item').forEach(item => {
        const channelId = item.dataset.channelId;
        const checkbox = item.querySelector('.subs-checkbox');
        const thumbnail = item.querySelector('.subs-thumbnail');
        const info = item.querySelector('.subs-item-info');
        const unsubBtn = item.querySelector('.btn-unsubscribe');

        // 체크박스 변경 이벤트
        checkbox.addEventListener('change', () => {
            toggleChannelSelection(channelId, checkbox);
        });

        // 썸네일(로고) 클릭 - 채널 페이지로 이동
        thumbnail.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(`https://www.youtube.com/channel/${channelId}`, '_blank');
        });

        // 채널 정보 영역 클릭 - 체크박스 토글
        info.addEventListener('click', (e) => {
            e.stopPropagation();
            checkbox.checked = !checkbox.checked;
            toggleChannelSelection(channelId, checkbox);
        });

        // 구독취소 버튼
        unsubBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            unsubscribeChannel(channelId, unsubBtn);
        });
    });
}

async function unsubscribeChannel(channelId, btn) {
    if (!confirm('이 채널의 구독을 취소하시겠습니까?')) {
        return;
    }

    btn.disabled = true;
    btn.textContent = '취소 중...';

    try {
        const result = await eel.unsubscribe_channel(channelId)();

        if (result.success) {
            // 로컬 목록에서 제거
            currentSubscriptions = currentSubscriptions.filter(s => s.id !== channelId);

            // UI 업데이트
            const item = btn.closest('.subs-item');
            item.style.opacity = '0.5';
            setTimeout(() => {
                item.remove();
                subsModalCount.textContent = `(${currentSubscriptions.length}개)`;
                subsInfo.textContent = `${currentSubscriptions.length}개 구독채널`;
            }, 300);
        } else {
            console.error('구독 취소 실패:', result.error);
            btn.disabled = false;
            btn.textContent = '구독취소';
        }
    } catch (e) {
        console.error('구독 취소 오류:', e);
        btn.disabled = false;
        btn.textContent = '구독취소';
    }
}

async function cancelSearch() {
    try {
        await eel.cancel_search()();
        progressText.textContent = '중단 중...';
        btnCancelSearch.disabled = true;
    } catch (e) {
        console.error('중단 오류:', e);
    }
}

// 국가별 인기 동영상 검색
async function searchPopularVideos() {
    const regionCode = document.getElementById('region-code').value;
    const category = document.getElementById('trend-category').value;
    const btnSearchTrend = document.getElementById('btn-search-trend');

    // UI 상태 변경
    btnSearchTrend.disabled = true;
    btnSearchTrend.textContent = '검색 중...';
    progressSection.style.display = 'flex';
    progressFill.style.width = '0%';
    progressText.textContent = '인기 동영상 조회 중...';
    btnCancelSearch.disabled = false;
    resultsSection.style.display = 'none';
    showExportButtons(false);

    try {
        const result = await eel.search_popular_videos(regionCode, category)();

        progressSection.style.display = 'none';

        if (result.success) {
            displayPopularResults(result.videos, result.stats);
        } else {
            alert('검색 실패: ' + result.error);
        }
    } catch (e) {
        console.error('검색 오류:', e);
        alert('검색 중 오류가 발생했습니다.');
        progressSection.style.display = 'none';
    }

    btnSearchTrend.disabled = false;
    btnSearchTrend.textContent = '검색';
}

// YouTube 전체 검색
async function searchYouTubeGlobal(keyword, videoType) {
    const daysWithin = getDaysWithinValue('days-within-keyword', 'days-within-keyword-custom');
    const btnSearchKeyword = document.getElementById('btn-search-keyword');

    // UI 상태 변경
    btnSearchKeyword.disabled = true;
    btnSearchKeyword.textContent = '검색 중...';
    progressSection.style.display = 'flex';
    progressFill.style.width = '0%';
    progressText.textContent = 'YouTube 검색 중...';
    btnCancelSearch.disabled = false;
    resultsSection.style.display = 'none';
    showExportButtons(false);

    // 필터 설정 저장
    saveFilterSettings();

    try {
        const result = await eel.search_youtube_global(keyword, daysWithin, videoType)();

        progressSection.style.display = 'none';

        if (result.success) {
            displayYouTubeGlobalResults(result.videos, result.stats);
        } else {
            alert('검색 실패: ' + result.error);
        }
    } catch (e) {
        console.error('검색 오류:', e);
        alert('검색 중 오류가 발생했습니다.');
        progressSection.style.display = 'none';
    }

    btnSearchKeyword.disabled = false;
    btnSearchKeyword.textContent = '검색';
}

// YouTube 전체 검색 결과 표시
function displayYouTubeGlobalResults(videos, stats) {
    resultsSection.style.display = 'flex';
    showExportButtons(true);

    if (videos.length === 0) {
        resultsCount.textContent = `(0개)`;
        resultsStats.textContent = `"${stats.keyword}" 검색 결과 0개`;
        resultsList.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">조건에 맞는 영상이 없습니다.</p>';
        allSearchResults = [];
        filteredResults = [];
        tabSearchResults['keyword-search'] = [];
        return;
    }

    resultsCount.textContent = `(${videos.length}개)`;
    resultsStats.textContent = `YouTube 전체 "${stats.keyword}" 검색 결과 ${videos.length}개`;

    // 전체 결과 저장
    allSearchResults = videos;
    tabSearchResults['keyword-search'] = videos;

    // 정렬 및 필터 적용
    applyFiltersAndRender();

    // 맨 위로 버튼 표시
    updateScrollTopButton();
}

// 인기 동영상 결과 표시
function displayPopularResults(videos, stats) {
    resultsSection.style.display = 'flex';
    showExportButtons(true);

    // 국가 이름 매핑
    const regionNames = {
        'KR': '한국', 'US': '미국', 'JP': '일본', 'GB': '영국',
        'DE': '독일', 'FR': '프랑스', 'BR': '브라질', 'IN': '인도',
        'RU': '러시아', 'CA': '캐나다', 'AU': '호주', 'TW': '대만',
        'HK': '홍콩', 'SG': '싱가포르', 'TH': '태국', 'VN': '베트남',
        'ID': '인도네시아', 'PH': '필리핀', 'MY': '말레이시아', 'MX': '멕시코'
    };
    const regionName = regionNames[stats.regionCode] || stats.regionCode;

    if (videos.length === 0) {
        resultsCount.textContent = `(0개)`;
        resultsStats.textContent = `${regionName} 인기 동영상 0개`;
        resultsList.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">조건에 맞는 영상이 없습니다.</p>';
        allSearchResults = [];
        filteredResults = [];
        tabSearchResults['hot-trend'] = [];
        return;
    }

    resultsCount.textContent = `(${videos.length}개)`;
    resultsStats.textContent = `${regionName} 인기 동영상 Top ${videos.length}`;

    // 전체 결과 저장
    allSearchResults = videos;
    tabSearchResults['hot-trend'] = videos;

    // 정렬 및 필터 적용
    applyFiltersAndRender();

    // 맨 위로 버튼 표시
    updateScrollTopButton();
}

async function searchVideos() {
    // YouTube 전체 검색 또는 핫트렌드의 경우 구독 채널 로드 체크 건너뛰기
    const isGlobalSearch = currentTab === 'keyword-search' &&
        document.getElementById('youtube-global-search')?.checked;
    const isHotTrend = currentTab === 'hot-trend';

    if (!subscriptionsLoaded && !isGlobalSearch && !isHotTrend) {
        alert('먼저 구독 채널을 불러와주세요.');
        return;
    }

    // 현재 탭에 따라 필터 설정 구성
    let filterConfig;

    if (currentTab === 'all-channel-monitor') {
        const videoType = document.querySelector('input[name="video-type"]:checked').value;
        const subscriberFilter = getSubscriberFilter();
        filterConfig = {
            filterType: 'channel-monitor',
            videoType: videoType,
            maxSubscribers: subscriberFilter.maxSubscribers,
            subscriberFilterType: subscriberFilter.type,
            subscriberCategory: subscriberFilter.category || null,
            channelIds: subscriberFilter.channelIds,
            minViews: parseNumberWithComma(document.getElementById('min-views').value) || 10000,
            daysWithin: getDaysWithinValue('days-within', 'days-within-custom'),
            mutationRatio: 1.0
        };
    } else if (currentTab === 'channel-monitor') {
        // 단일 채널 모니터
        const selectedChannelId = document.getElementById('single-channel-select').value;
        if (!selectedChannelId) {
            alert('채널을 선택해주세요.');
            return;
        }
        const videoType = document.querySelector('input[name="video-type-single"]:checked').value;
        filterConfig = {
            filterType: 'channel-monitor',
            videoType: videoType,
            maxSubscribers: null,  // 구독자 필터 없음
            subscriberFilterType: 'all',
            subscriberCategory: null,
            channelIds: [selectedChannelId],  // 단일 채널만
            minViews: parseNumberWithComma(document.getElementById('min-views-single').value) || 10000,
            daysWithin: getDaysWithinValue('days-within-single', 'days-within-single-custom'),
            mutationRatio: 1.0
        };
    } else if (currentTab === 'keyword-search') {
        const videoType = document.querySelector('input[name="video-type-keyword"]:checked').value;
        const keyword = document.getElementById('search-keyword').value.trim();
        const isGlobalSearch = document.getElementById('youtube-global-search').checked;
        if (!keyword) {
            alert('검색어를 입력해주세요.');
            return;
        }
        // 키워드 히스토리에 추가
        addKeywordToHistory(keyword);

        // YouTube 전체 검색인 경우 별도의 API 호출
        if (isGlobalSearch) {
            await searchYouTubeGlobal(keyword, videoType);
            return;
        }

        // 구독자 카테고리 필터
        const subscriberFilter = getSubscriberFilter('subscriber-category-keyword', null);

        // 조회수 필터
        const minViewsKeyword = parseNumberWithComma(document.getElementById('min-views-keyword').value) || 0;

        filterConfig = {
            filterType: 'keyword-search',
            videoType: videoType,
            keyword: keyword,
            daysWithin: getDaysWithinValue('days-within-keyword', 'days-within-keyword-custom'),
            maxSubscribers: subscriberFilter.maxSubscribers,
            channelIds: subscriberFilter.channelIds,
            minViews: minViewsKeyword,
            mutationRatio: 1.0
        };
    } else if (currentTab === 'hot-trend') {
        // 핫트렌드는 별도의 API 호출
        await searchPopularVideos();
        return;
    } else if (currentTab === 'mutation') {
        const videoType = document.querySelector('input[name="video-type-mutation"]:checked').value;
        const subscriberFilter = getSubscriberFilter('subscriber-category-mutation', null);
        const subscriberCategory = document.getElementById('subscriber-category-mutation').value;
        const daysWithin = getDaysWithinValue('days-within-mutation', 'days-within-mutation-custom');
        const mutationRatio = parseFloat(document.getElementById('mutation-ratio').value) || 2.0;

        // 돌연변이 히스토리에 추가
        addMutationToHistory({
            videoType: videoType,
            subscriberCategory: subscriberCategory,
            mutationRatio: mutationRatio,
            daysWithin: daysWithin
        });

        filterConfig = {
            filterType: 'mutation',
            videoType: videoType,
            maxSubscribers: subscriberFilter.maxSubscribers,
            channelIds: subscriberFilter.channelIds,
            minViews: 0,
            daysWithin: daysWithin,
            mutationRatio: mutationRatio
        };
    }

    // 필터 설정 저장
    saveFilterSettings();

    // 검색 히스토리에 추가
    addSearchHistory(filterConfig);

    btnSearch.disabled = true;
    btnCancelSearch.disabled = false;
    progressSection.style.display = 'block';
    resultsSection.style.display = 'none';
    showExportButtons(false);
    progressFill.style.width = '0%';
    progressText.textContent = '검색 준비 중...';

    try {
        const result = await eel.search_videos(filterConfig)();

        progressSection.style.display = 'none';

        if (result.success) {
            displayResults(result.videos, result.stats);
        } else if (result.cancelled) {
            // 취소된 경우 알림 없이 조용히 처리
            console.log('검색이 중단되었습니다.');
        } else {
            alert('검색 실패: ' + result.error);
        }
    } catch (e) {
        progressSection.style.display = 'none';
        alert('오류가 발생했습니다.');
        console.error(e);
    }

    btnSearch.disabled = false;
    btnCancelSearch.disabled = true;
}

// Python에서 호출하는 진행률 업데이트 함수
eel.expose(update_progress);
function update_progress(text, percent) {
    // 기본 진행바 업데이트
    progressFill.style.width = percent + '%';
    progressText.textContent = text;

    // 구독 중일 경우 구독 전용 진행바도 업데이트
    if (isSubscribing) {
        updateSubscribeProgress(text, percent);
    }
}

function displayResults(videos, stats) {
    resultsSection.style.display = 'flex';
    showExportButtons(true);

    if (videos.length === 0) {
        resultsCount.textContent = `(0개)`;
        resultsStats.textContent = `전체 ${stats.total}개 중 0개 필터됨`;
        resultsList.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">조건에 맞는 영상이 없습니다.</p>';
        allSearchResults = [];
        filteredResults = [];
        tabSearchResults[currentTab] = [];
        return;
    }

    // 전체 결과 저장 (원본)
    allSearchResults = videos;

    // 탭별로 결과 저장
    tabSearchResults[currentTab] = videos;

    // 모든채널모니터, 채널모니터는 기본 채널별 그룹화
    if (currentTab === 'all-channel-monitor' || currentTab === 'channel-monitor') {
        document.getElementById('group-by-channel').checked = true;
    }

    // 정렬 및 필터 적용
    applyFiltersAndRender();

    // 맨 위로 버튼 표시
    updateScrollTopButton();
}

// 정렬 함수
function sortVideos(videos) {
    const sortOption = document.getElementById('sort-option').value;
    return [...videos].sort((a, b) => {
        switch (sortOption) {
            case 'views':
                return b.viewCount - a.viewCount;
            case 'date':
                return new Date(b.publishedAt) - new Date(a.publishedAt);
            case 'ratio':
                return b.ratio - a.ratio;
            default:
                return 0;
        }
    });
}

// 정렬만 다시 적용
function sortAndRenderResults() {
    if (allSearchResults.length === 0) return;
    applyFiltersAndRender();
}

// 필터 및 정렬 적용 후 렌더링
function applyFiltersAndRender() {
    if (allSearchResults.length === 0) return;

    let videos = [...allSearchResults];

    // 완료 숨기기 필터
    const hideDone = document.getElementById('hide-done').checked;
    if (hideDone) {
        videos = videos.filter(v => !isVideoDone(v.videoId));
    }

    // 텍스트 검색 필터
    const searchText = document.getElementById('results-filter').value.toLowerCase().trim();
    if (searchText) {
        videos = videos.filter(video =>
            video.title.toLowerCase().includes(searchText) ||
            video.channelTitle.toLowerCase().includes(searchText)
        );
    }

    // 정렬 적용
    videos = sortVideos(videos);

    filteredResults = videos;
    displayedCount = 0;
    resultsList.innerHTML = '';

    if (filteredResults.length === 0) {
        resultsList.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">조건에 맞는 영상이 없습니다.</p>';
        updateResultsHeader();
        return;
    }

    // 채널별 그룹화 여부 확인
    const groupByChannel = document.getElementById('group-by-channel').checked;

    if (groupByChannel) {
        renderGroupedResults();
    } else {
        loadMoreResults();
    }

    updateResultsHeader();
}

// 채널별 그룹화 렌더링
function renderGroupedResults() {
    // 채널별로 그룹화
    const groups = {};
    for (const video of filteredResults) {
        if (!groups[video.channelId]) {
            groups[video.channelId] = {
                channelTitle: video.channelTitle,
                channelId: video.channelId,
                subscriberCount: video.subscriberCount,
                videos: []
            };
        }
        groups[video.channelId].videos.push(video);
    }

    // 모든채널모니터, 채널모니터: 구독자수 내림차순으로 채널 정렬
    // 그 외: 영상 수로 정렬
    let sortedGroups;
    if (currentTab === 'all-channel-monitor' || currentTab === 'channel-monitor') {
        sortedGroups = Object.values(groups).sort((a, b) => b.subscriberCount - a.subscriberCount);
    } else {
        sortedGroups = Object.values(groups).sort((a, b) => b.videos.length - a.videos.length);
    }

    // 채널 내 영상은 선택된 정렬 옵션에 따라 정렬
    const sortOption = document.getElementById('sort-option').value;
    for (const group of sortedGroups) {
        group.videos = sortVideos(group.videos);
    }

    // 채널 썸네일 조회 (구독 목록에서)
    const channelThumbnails = {};
    for (const sub of currentSubscriptions) {
        channelThumbnails[sub.id] = sub.thumbnail;
    }

    let html = '';
    for (const group of sortedGroups) {
        const thumbnail = channelThumbnails[group.channelId] || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23333" width="100" height="100"/></svg>';

        html += `
            <div class="channel-group-header" onclick="toggleChannelGroup('${group.channelId}')">
                <img src="${thumbnail}" alt="${escapeHtml(group.channelTitle)}">
                <div class="channel-group-info">
                    <div class="channel-group-title">${escapeHtml(group.channelTitle)}</div>
                    <div class="channel-group-meta">구독자 ${formatSubscriberCount(group.subscriberCount)} · 영상 ${group.videos.length}개</div>
                </div>
                <span class="channel-group-toggle">▼</span>
            </div>
            <div class="channel-group-videos" id="group-${group.channelId}">
        `;

        for (const video of group.videos) {
            html += renderVideoItem(video);
        }

        html += '</div>';
    }

    resultsList.innerHTML = html;
    displayedCount = filteredResults.length;
}

// 채널 그룹 접기/펼치기
function toggleChannelGroup(channelId) {
    const header = document.querySelector(`.channel-group-header[onclick*="${channelId}"]`);
    const videos = document.getElementById(`group-${channelId}`);

    if (header && videos) {
        header.classList.toggle('collapsed');
        videos.classList.toggle('collapsed');
    }
}

function updateResultsHeader() {
    const showing = Math.min(displayedCount, filteredResults.length);
    resultsCount.textContent = `(${filteredResults.length}개)`;

    const filterText = document.getElementById('results-filter').value;
    if (filterText) {
        resultsStats.textContent = `검색: "${filterText}" (${filteredResults.length}개)`;
    } else {
        resultsStats.textContent = `${showing}/${filteredResults.length}개 표시 중`;
    }
}

// 단일 비디오 아이템 HTML 생성
function renderVideoItem(video) {
    const isDone = isVideoDone(video.videoId);
    return `
        <div class="video-item" onclick="window.open('https://www.youtube.com/watch?v=${video.videoId}', '_blank')">
            <div class="video-thumbnail">
                <img src="${video.thumbnail}" alt="${escapeHtml(video.title)}">
                <span class="video-duration">${formatDuration(video.duration)}</span>
            </div>
            <div class="video-info">
                <div class="video-title">${escapeHtml(video.title)}</div>
                <div class="video-meta">
                    <span class="channel">${escapeHtml(video.channelTitle)}</span>
                    <span class="separator">|</span>
                    <span>조회수 <span class="highlight">${formatNumber(video.viewCount)}</span>회</span>
                    <span class="separator">|</span>
                    <span>구독자 ${formatNumber(video.subscriberCount)}명</span>
                    <span class="separator">|</span>
                    <span>돌연변이지수 <span class="highlight">${video.ratio}x</span></span>
                    <span class="separator">|</span>
                    <span>${formatDate(video.publishedAt)}</span>
                </div>
            </div>
            <div class="video-actions">
                <button class="btn-copy" onclick="copyThumbnail(event, '${video.videoId}')">썸네일</button>
                <button class="btn-copy" onclick="copyTitle(event, '${escapeHtml(video.title).replace(/'/g, "\\'")}')">제목</button>
                <button class="btn-done ${isDone ? 'checked' : ''}" onclick="toggleDone(event, '${video.videoId}')">완료</button>
            </div>
        </div>
    `;
}

function loadMoreResults() {
    const videosToLoad = filteredResults.slice(displayedCount, displayedCount + ITEMS_PER_PAGE);
    const html = videosToLoad.map(video => renderVideoItem(video)).join('');

    resultsList.insertAdjacentHTML('beforeend', html);
    displayedCount += videosToLoad.length;
    updateResultsHeader();
}

function filterResults(searchText) {
    // applyFiltersAndRender가 텍스트 검색도 처리함
    applyFiltersAndRender();
}

function scrollToTop() {
    resultsList.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateScrollTopButton() {
    const btn = document.getElementById('btn-scroll-top');
    if (allSearchResults.length > ITEMS_PER_PAGE) {
        btn.style.display = 'block';
    } else {
        btn.style.display = 'none';
    }
}

// 유틸리티 함수
function formatNumber(num) {
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + '만';
    }
    return num.toLocaleString();
}

function formatSubscriberCount(count) {
    if (!count) return '비공개';
    if (count >= 10000) {
        return (count / 10000).toFixed(1) + '만명';
    }
    return count.toLocaleString() + '명';
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return '오늘';
    if (days === 1) return '어제';
    if (days < 7) return `${days}일 전`;
    if (days < 30) return `${Math.floor(days / 7)}주 전`;
    return `${Math.floor(days / 30)}개월 전`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function copyTitle(event, title) {
    event.preventDefault();
    event.stopPropagation();
    navigator.clipboard.writeText(title).then(() => {
        const btn = event.target;
        btn.classList.add('copied');
        setTimeout(() => {
            btn.classList.remove('copied');
        }, 1500);
    }).catch(err => {
        console.error('복사 실패:', err);
        alert('복사에 실패했습니다.');
    });
}

function toggleDone(event, videoId) {
    event.preventDefault();
    event.stopPropagation();
    const btn = event.target;

    if (isVideoDone(videoId)) {
        removeVideoDone(videoId);
        btn.classList.remove('checked');
    } else {
        setVideoDone(videoId);
        btn.classList.add('checked');
    }
}

async function copyThumbnail(event, videoId) {
    event.preventDefault();
    event.stopPropagation();
    const btn = event.target;
    btn.disabled = true;

    // YouTube 썸네일 URL (최고 해상도부터 시도)
    const thumbnailUrls = [
        `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,  // 1280x720
        `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,     // 640x480
        `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,     // 480x360
        `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,     // 320x180
    ];

    try {
        let loadedImg = null;

        // 고해상도부터 시도하여 로드 가능한 이미지 찾기
        for (const url of thumbnailUrls) {
            try {
                const response = await fetch(url);
                if (!response.ok) continue;

                const blob = await response.blob();
                const img = new Image();

                await new Promise((resolve, reject) => {
                    img.onload = () => {
                        // maxresdefault가 없으면 기본 회색 이미지(120x90)가 반환됨
                        if (img.width > 200) {
                            loadedImg = img;
                            resolve();
                        } else {
                            reject('too small');
                        }
                    };
                    img.onerror = reject;
                    img.src = URL.createObjectURL(blob);
                });

                if (loadedImg) break;
            } catch {
                continue;
            }
        }

        if (!loadedImg) {
            throw new Error('썸네일을 찾을 수 없습니다.');
        }

        // PNG로 변환 (클립보드 호환성 위해)
        const canvas = document.createElement('canvas');
        canvas.width = loadedImg.width;
        canvas.height = loadedImg.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(loadedImg, 0, 0);

        // PNG blob 생성
        const pngBlob = await new Promise(resolve => {
            canvas.toBlob(resolve, 'image/png');
        });

        // 클립보드에 복사
        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': pngBlob })
        ]);

        btn.classList.add('copied');
        btn.disabled = false;
        setTimeout(() => {
            btn.classList.remove('copied');
        }, 1500);

    } catch (err) {
        console.error('썸네일 복사 실패:', err);
        btn.disabled = false;
        alert('썸네일 복사에 실패했습니다.');
    }
}

// 콤마가 포함된 숫자 문자열을 숫자로 변환
function parseNumberWithComma(str) {
    return parseInt(str.replace(/,/g, '')) || 0;
}

// 숫자를 콤마가 포함된 문자열로 변환
function formatWithComma(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 입력 필드에 콤마 자동 포맷팅
function setupCommaInput(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;  // 요소가 없으면 무시
    input.addEventListener('input', (e) => {
        const cursorPos = e.target.selectionStart;
        const oldValue = e.target.value;
        const rawValue = oldValue.replace(/[^\d]/g, '');

        if (rawValue) {
            const newValue = formatWithComma(parseInt(rawValue));
            e.target.value = newValue;

            // 커서 위치 계산: 커서 앞의 숫자 개수를 기준으로 위치 결정
            const digitsBeforeCursor = oldValue.substring(0, cursorPos).replace(/[^\d]/g, '').length;
            let newPos = 0;
            let digitCount = 0;
            for (let i = 0; i < newValue.length; i++) {
                if (newValue[i] !== ',') {
                    digitCount++;
                }
                if (digitCount >= digitsBeforeCursor) {
                    newPos = i + 1;
                    break;
                }
            }
            if (digitCount < digitsBeforeCursor) {
                newPos = newValue.length;
            }
            e.target.setSelectionRange(newPos, newPos);
        } else {
            e.target.value = '';
        }
    });
}

// 콤마 입력 필드 초기화
setupCommaInput('max-subscribers');
setupCommaInput('min-views');
setupCommaInput('min-views-single');
setupCommaInput('min-views-keyword');

// 검색 히스토리 UI
function toggleHistoryMenu() {
    const menu = document.getElementById('history-menu');
    if (menu.style.display === 'none') {
        renderHistoryMenu();
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
}

function renderHistoryMenu() {
    const menu = document.getElementById('history-menu');
    const history = getSearchHistory();

    if (history.length === 0) {
        menu.innerHTML = '<div class="history-empty">검색 기록이 없습니다.</div>';
        return;
    }

    menu.innerHTML = history.map((h, idx) => {
        const typeLabel = h.filterType === 'normal' ? '일반' : '돌연변이';
        const typeClass = h.filterType;

        let params;
        if (h.filterType === 'normal') {
            params = `구독자 ${formatWithComma(h.maxSubscribers)}↓ · 조회수 ${formatWithComma(h.minViews)}↑ · ${h.daysWithin}일`;
        } else {
            params = `지수 ${h.mutationRatio}x↑ · ${h.daysWithin}일`;
        }

        const timeAgo = formatTimeAgo(h.timestamp);

        return `
            <div class="history-item">
                <div class="history-item-content" onclick="applyHistory(${idx})">
                    <span class="history-item-type ${typeClass}">${typeLabel}</span>
                    <span class="history-item-params">${params}</span>
                    <div class="history-item-time">${timeAgo}</div>
                </div>
                <button class="history-delete-btn" onclick="deleteHistory(event, ${idx})" title="삭제">×</button>
            </div>
        `;
    }).join('');
}

function deleteHistory(event, index) {
    event.stopPropagation(); // 부모 클릭 이벤트 방지

    const history = getSearchHistory();
    history.splice(index, 1);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));

    renderHistoryMenu();
}

function applyHistory(index) {
    const history = getSearchHistory();
    const h = history[index];
    if (!h) return;

    // 필터 타입 설정
    const radio = document.querySelector(`input[name="filter-type"][value="${h.filterType}"]`);
    if (radio) {
        radio.checked = true;
        const isNormal = h.filterType === 'normal';
        document.getElementById('normal-filter').style.display = isNormal ? 'flex' : 'none';
        document.getElementById('mutation-filter').style.display = isNormal ? 'none' : 'flex';
    }

    // 값 설정
    document.getElementById('max-subscribers').value = formatWithComma(h.maxSubscribers);
    document.getElementById('min-views').value = formatWithComma(h.minViews);
    document.getElementById('days-within').value = h.daysWithin;
    document.getElementById('mutation-ratio').value = h.mutationRatio;

    // 메뉴 닫기
    document.getElementById('history-menu').style.display = 'none';
}

function formatTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    return `${days}일 전`;
}

// 필터바 내보내기 (채널명, 구독자수, 조회수, 업로드날짜, 제목 순서)
// 내보내기 진행 중 여부
let exportInProgress = false;

// 내보내기 옵션 모달 열기
function openExportOptionsModal() {
    if (filteredResults.length === 0) {
        alert('내보낼 결과가 없습니다.');
        return;
    }

    const modal = document.getElementById('export-options-modal');
    if (modal) {
        // 초기화
        const includeComments = document.getElementById('export-include-comments');
        const keywordsGroup = document.getElementById('export-keywords-group');
        const progressDiv = document.getElementById('export-progress');
        const confirmBtn = document.getElementById('btn-confirm-export');

        if (includeComments) includeComments.checked = false;
        if (keywordsGroup) keywordsGroup.style.display = 'none';
        if (progressDiv) progressDiv.style.display = 'none';
        if (confirmBtn) confirmBtn.disabled = false;

        modal.style.display = 'flex';
    }
}

// 내보내기 옵션 모달 닫기
function closeExportOptionsModal() {
    if (exportInProgress) {
        if (!confirm('내보내기가 진행 중입니다. 취소하시겠습니까?')) {
            return;
        }
        exportInProgress = false;
    }

    const modal = document.getElementById('export-options-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 내보내기 실행
async function executeExport() {
    const includeComments = document.getElementById('export-include-comments')?.checked || false;
    const keywordsInput = document.getElementById('export-comment-keywords')?.value || '공감, 위로, 저도 그랬어요';
    const keywords = keywordsInput.split(',').map(k => k.trim()).filter(k => k);

    const confirmBtn = document.getElementById('btn-confirm-export');
    const progressDiv = document.getElementById('export-progress');
    const progressFill = document.getElementById('export-progress-fill');
    const progressText = document.getElementById('export-progress-text');

    // 댓글 포함 시 댓글 가져오기
    let videoComments = {};

    if (includeComments) {
        console.log('[내보내기] 댓글 포함 모드, 영상 수:', filteredResults.length);
        exportInProgress = true;
        if (confirmBtn) confirmBtn.disabled = true;
        if (progressDiv) progressDiv.style.display = 'block';

        const total = filteredResults.length;
        for (let i = 0; i < total; i++) {
            if (!exportInProgress) break; // 취소됨

            const video = filteredResults[i];
            const percent = Math.round(((i + 1) / total) * 100);

            if (progressFill) progressFill.style.width = percent + '%';
            if (progressText) progressText.textContent = `댓글 가져오는 중... ${i + 1}/${total}`;

            console.log(`[내보내기] ${i + 1}/${total} 댓글 조회: ${video.videoId}`);

            try {
                const result = await eel.get_video_comments_filtered(video.videoId, keywords, 20)();
                console.log(`[내보내기] 결과:`, result);
                if (result.success) {
                    videoComments[video.videoId] = result.comments;
                    console.log(`[내보내기] ${video.videoId}: ${result.comments.length}개 댓글`);
                } else {
                    console.log(`[내보내기] ${video.videoId}: 실패 - ${result.error}`);
                    videoComments[video.videoId] = [];
                }
            } catch (e) {
                console.error('댓글 조회 실패:', video.videoId, e);
                videoComments[video.videoId] = [];
            }
        }

        console.log('[내보내기] 댓글 조회 완료, videoComments:', videoComments);
        exportInProgress = false;
    }

    // CSV 생성
    exportToCSV(includeComments, videoComments);

    // 모달 닫기
    closeExportOptionsModal();
}

// CSV 파일 생성 및 다운로드
function exportToCSV(includeComments, videoComments) {
    // CSV 헤더
    let headers = ['채널명', '구독자수', '조회수', '업로드날짜', '제목', 'URL'];
    if (includeComments) {
        headers.push('댓글');
    }

    // CSV 데이터 생성
    const rows = filteredResults.map(video => {
        const row = [
            `"${(video.channelTitle || '').replace(/"/g, '""')}"`,
            video.subscriberCount || 0,
            video.viewCount || 0,
            video.publishedAt || '',
            `"${(video.title || '').replace(/"/g, '""')}"`,
            `https://www.youtube.com/watch?v=${video.videoId}`
        ];

        if (includeComments) {
            const comments = videoComments[video.videoId] || [];
            // 댓글 내용을 줄바꿈으로 구분하여 하나의 셀에
            const commentTexts = comments.map((c, idx) => {
                const prefix = c.hasKeyword ? '[키워드]' : '';
                return `${idx + 1}. ${prefix}${c.author}: ${c.text.replace(/\n/g, ' ')}`;
            }).join('\n');
            row.push(`"${commentTexts.replace(/"/g, '""')}"`);
        }

        return row;
    });

    // CSV 문자열 생성 (BOM 추가로 한글 지원)
    const bom = '\uFEFF';
    const csv = bom + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    // 다운로드
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const now = new Date();
    const dateStr = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;

    // 현재 탭에 따른 파일명 설정
    let tabName = '검색결과';
    if (currentTab === 'all-channel-monitor') tabName = '모든채널모니터';
    else if (currentTab === 'channel-monitor') tabName = '채널모니터';
    else if (currentTab === 'keyword-search') tabName = '키워드검색';
    else if (currentTab === 'hot-trend') tabName = '핫트렌드';
    else if (currentTab === 'mutation') tabName = '돌연변이';

    const suffix = includeComments ? '_댓글포함' : '';
    link.href = url;
    link.download = `${tabName}${suffix}_${dateStr}.csv`;
    link.click();

    URL.revokeObjectURL(url);
}

// 내보내기 버튼 표시/숨김 (현재 탭에 맞는 버튼만 표시)
function showExportButtons(show) {
    // 탭별 버튼 매핑
    const tabButtonMap = {
        'all-channel-monitor': 'btn-export-filter',
        'channel-monitor': 'btn-export-filter-single',
        'keyword-search': 'btn-export-filter-keyword',
        'hot-trend': 'btn-export-filter-trend',
        'mutation': 'btn-export-filter-mutation'
    };

    // 모든 내보내기 버튼 숨김
    Object.values(tabButtonMap).forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.style.display = 'none';
        }
    });

    // 현재 탭의 버튼만 표시
    if (show) {
        const currentButtonId = tabButtonMap[currentTab];
        if (currentButtonId) {
            const btn = document.getElementById(currentButtonId);
            if (btn) {
                btn.style.display = 'inline-block';
            }
        }
    }
}

// ===== 채널 카테고리 사이드바 =====

// 채널을 카테고리별로 분류 (동적 카테고리 지원)
function categorizeChannels(subscriptions) {
    const categories = {};

    // 모든 카테고리 초기화
    CHANNEL_CATEGORIES.forEach(cat => {
        categories[cat.id] = [];
    });

    for (const sub of subscriptions) {
        const count = sub.subscriberCount || 0;
        const category = getCategoryBySubscriberCount(count);
        if (category && categories[category.id]) {
            categories[category.id].push(sub);
        }
    }

    // 각 카테고리 내에서 구독자순 정렬
    for (const key of Object.keys(categories)) {
        categories[key].sort((a, b) => (b.subscriberCount || 0) - (a.subscriberCount || 0));
    }

    return categories;
}

// 사이드바 전체 구조 렌더링 (카테고리 추가/삭제 시 호출)
function renderChannelSidebarStructure() {
    const container = document.querySelector('.channel-categories');
    if (!container) return;

    container.innerHTML = CHANNEL_CATEGORIES.map((cat, index) => `
        <div class="category-section ${index > 0 ? 'collapsed' : ''}" data-category="${cat.id}">
            <div class="category-header" onclick="toggleCategory('${cat.id}')">
                <span class="category-icon">${cat.icon}</span>
                <span class="category-name">${cat.name}</span>
                <span class="category-count" id="count-${cat.id}">0</span>
                <span class="category-toggle">▼</span>
            </div>
            <div class="category-desc">구독자 ${formatShortNumber(cat.min)}~${cat.max === Infinity ? '∞' : formatShortNumber(cat.max)}</div>
            <div class="category-channels" id="channels-${cat.id}"></div>
        </div>
    `).join('');

    // 드롭다운도 업데이트
    updateSubscriberDropdowns();
}

// 사이드바 렌더링 (채널 데이터 업데이트)
function renderChannelSidebar() {
    console.log('renderChannelSidebar 시작, 구독 채널 수:', currentSubscriptions.length);
    const categorized = categorizeChannels(currentSubscriptions);
    console.log('카테고리 분류 완료:', Object.keys(categorized).map(k => `${k}: ${categorized[k].length}`).join(', '));

    // 각 카테고리 채널 수 업데이트
    CHANNEL_CATEGORIES.forEach(cat => {
        const countEl = document.getElementById(`count-${cat.id}`);
        if (countEl) {
            countEl.textContent = (categorized[cat.id] || []).length;
        }
        renderCategoryChannels(cat.id, categorized[cat.id] || []);
    });
    console.log('renderChannelSidebar 완료');
}

// 구독자 드롭다운 전체 옵션 업데이트
function updateSubscriberDropdowns() {
    const dropdowns = document.querySelectorAll('.subscriber-dropdown');
    dropdowns.forEach(dropdown => {
        const currentValue = dropdown.value;
        const hasCustom = dropdown.querySelector('option[value="custom"]') !== null;

        // 전체 옵션 유지
        let html = '<option value="all">전체</option>';

        // 동적 카테고리 옵션 추가
        CHANNEL_CATEGORIES.forEach(cat => {
            const rangeText = getCategoryRangeText(cat);
            html += `<option value="${cat.id}">${cat.name} | ${rangeText}</option>`;
        });

        // 직접입력 옵션 (있는 경우에만)
        if (hasCustom) {
            html += '<option value="custom">직접입력</option>';
        }

        dropdown.innerHTML = html;

        // 이전 선택값 복원 시도
        if (dropdown.querySelector(`option[value="${currentValue}"]`)) {
            dropdown.value = currentValue;
        } else {
            // 기본값: 첫 번째 카테고리 (보통 reference와 비슷한 역할)
            const defaultCat = CHANNEL_CATEGORIES.find(c => c.id === 'reference') || CHANNEL_CATEGORIES[0];
            if (defaultCat) {
                dropdown.value = defaultCat.id;
            }
        }
    });
}

// 카테고리 범위 텍스트 생성 (이하/이상 형식)
function getCategoryRangeText(cat) {
    const minIsZero = cat.min === 0;
    const maxIsInfinity = cat.max === Infinity || cat.max >= INFINITY_NUMBER;

    if (minIsZero && maxIsInfinity) {
        // 0 ~ 무한대: 전체
        return '전체';
    } else if (minIsZero) {
        // 0 ~ N: N명 이하
        return `${formatShortNumber(cat.max)}명 이하`;
    } else if (maxIsInfinity) {
        // N ~ 무한대: N명 이상
        return `${formatShortNumber(cat.min)}명 이상`;
    } else {
        // N ~ M: N~M명
        return `${formatShortNumber(cat.min)}~${formatShortNumber(cat.max)}명`;
    }
}

// 숫자를 짧은 형식으로 변환 (1000 -> 1천, 70000 -> 7만)
function formatShortNumber(num) {
    if (num === Infinity) return '∞';
    if (num >= 10000) {
        return Math.floor(num / 10000) + '만';
    } else if (num >= 1000) {
        return Math.floor(num / 1000) + '천';
    }
    return num.toString();
}

// 카테고리 내 채널 목록 렌더링
function renderCategoryChannels(category, channels) {
    const container = document.getElementById(`channels-${category}`);
    if (!container) return;

    if (channels.length === 0) {
        container.innerHTML = '<div class="no-channels">채널 없음</div>';
        return;
    }

    container.innerHTML = channels.map(ch => `
        <div class="channel-item" data-channel-id="${ch.id}" onclick="openChannelInYouTube('${ch.id}')">
            <img src="${ch.thumbnail}" alt="${escapeHtml(ch.title)}">
            <div class="channel-item-info">
                <div class="channel-item-title" title="${escapeHtml(ch.title)}">${escapeHtml(ch.title)}</div>
                <div class="channel-item-subs">${formatSubscriberCount(ch.subscriberCount)}</div>
            </div>
        </div>
    `).join('');
}

// 사이드바 채널 검색 필터링
function filterSidebarChannels(query) {
    const categorySections = document.querySelectorAll('.category-section');

    if (!query) {
        // 검색어가 없으면 모든 채널 표시, 카테고리 접힘 상태 복원
        categorySections.forEach((section, index) => {
            section.classList.remove('search-hidden');
            const channelItems = section.querySelectorAll('.channel-item');
            channelItems.forEach(item => {
                item.classList.remove('search-hidden');
                // 하이라이트 제거
                const titleEl = item.querySelector('.channel-item-title');
                if (titleEl) {
                    const channelId = item.dataset.channelId;
                    const channel = currentSubscriptions.find(ch => ch.id === channelId);
                    if (channel) {
                        titleEl.innerHTML = escapeHtml(channel.title);
                    }
                }
            });
            // 첫 번째 카테고리만 펼침
            if (index === 0) {
                section.classList.remove('collapsed');
            } else {
                section.classList.add('collapsed');
            }
        });
        return;
    }

    const lowerQuery = query.toLowerCase();
    let hasAnyMatch = false;

    categorySections.forEach(section => {
        const channelItems = section.querySelectorAll('.channel-item');
        let categoryHasMatch = false;

        channelItems.forEach(item => {
            const channelId = item.dataset.channelId;
            const channel = currentSubscriptions.find(ch => ch.id === channelId);

            if (channel && channel.title.toLowerCase().includes(lowerQuery)) {
                item.classList.remove('search-hidden');
                categoryHasMatch = true;
                hasAnyMatch = true;

                // 매칭 부분 하이라이트
                const titleEl = item.querySelector('.channel-item-title');
                if (titleEl) {
                    const title = channel.title;
                    const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
                    titleEl.innerHTML = escapeHtml(title).replace(regex, '<span class="highlight">$1</span>');
                }
            } else {
                item.classList.add('search-hidden');
                // 하이라이트 제거
                const titleEl = item.querySelector('.channel-item-title');
                if (titleEl && channel) {
                    titleEl.innerHTML = escapeHtml(channel.title);
                }
            }
        });

        // 매칭 채널이 있는 카테고리는 펼치고 표시
        if (categoryHasMatch) {
            section.classList.remove('search-hidden');
            section.classList.remove('collapsed');
        } else {
            section.classList.add('search-hidden');
        }
    });
}

// 정규식 특수문자 이스케이프
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 카테고리 접기/펼치기 (한 번에 하나만 펼침)
function toggleCategory(category) {
    const section = document.querySelector(`.category-section[data-category="${category}"]`);
    if (!section) return;

    const isCurrentlyCollapsed = section.classList.contains('collapsed');

    // 모든 카테고리 접기
    document.querySelectorAll('.category-section').forEach(sec => {
        sec.classList.add('collapsed');
    });

    // 현재 카테고리가 접혀있었다면 펼치기
    if (isCurrentlyCollapsed) {
        section.classList.remove('collapsed');
    }
    // 이미 펼쳐져 있었다면 모두 접힌 상태 유지 (위에서 이미 처리됨)
}

// 카테고리 헤더 클릭 시 해당 구독자 필터 적용
function applyCategoryFilter(categoryId) {
    const catDef = getCategoryById(categoryId);
    if (!catDef) return;

    // 현재 선택된 카테고리 토글
    if (selectedCategory === categoryId) {
        // 이미 선택된 카테고리 클릭 시 해제
        selectedCategory = null;
        clearCategorySelection();
        // 필터 초기화
        document.getElementById('max-subscribers').value = '';
        return;
    }

    // 새 카테고리 선택
    selectedCategory = categoryId;
    highlightSelectedCategory(categoryId);

    // 모든채널모니터 탭으로 전환
    switchTab('all-channel-monitor');

    // 구독자 필터 적용
    if (catDef.max === Infinity) {
        // 마지막 카테고리: 최소값만 설정
        document.getElementById('max-subscribers').value = '';
    } else {
        // 나머지: 최대 구독자수 설정
        document.getElementById('max-subscribers').value = formatWithComma(catDef.max);
    }
}

// 카테고리 선택 해제
function clearCategorySelection() {
    document.querySelectorAll('.category-section').forEach(sec => {
        sec.classList.remove('selected');
    });
}

// 선택된 카테고리 하이라이트
function highlightSelectedCategory(category) {
    clearCategorySelection();
    const section = document.querySelector(`.category-section[data-category="${category}"]`);
    if (section) {
        section.classList.add('selected');
    }
}

// 채널 유튜브에서 열기
function openChannelInYouTube(channelId) {
    window.open(`https://www.youtube.com/channel/${channelId}`, '_blank');
}

// 사이드바 내보내기 버튼
async function exportSidebarSubscriptions() {
    if (currentSubscriptions.length === 0) {
        alert('내보낼 구독 목록이 없습니다.');
        return;
    }

    const btn = document.getElementById('btn-export-subs');
    btn.disabled = true;

    try {
        const result = await eel.export_subscriptions()();

        if (result.success) {
            alert(`${result.count}개 채널을 내보냈습니다.\n\n저장 위치:\n${result.path}`);
        } else if (result.error !== '취소됨') {
            alert('내보내기 실패: ' + result.error);
        }
    } catch (e) {
        alert('오류가 발생했습니다.');
        console.error(e);
    }

    btn.disabled = false;
}

// 사이드바 가져오기 버튼
async function importSidebarSubscriptions() {
    const confirmMsg = '다른 계정에서 내보낸 구독 목록을 가져옵니다.\n\n' +
        '주의사항:\n' +
        '- 이미 구독 중인 채널은 건너뜁니다.\n' +
        '- API 할당량을 사용합니다 (채널당 50 quota).\n\n' +
        '계속하시겠습니까?';

    if (!confirm(confirmMsg)) {
        return;
    }

    const btn = document.getElementById('btn-import-subs');
    btn.disabled = true;

    progressSection.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = '구독 가져오기 준비 중...';

    try {
        const result = await eel.import_subscriptions()();

        progressSection.style.display = 'none';

        if (result.success) {
            const msg = `가져오기 완료!\n\n` +
                `전체: ${result.total}개\n` +
                `구독 완료: ${result.subscribed}개\n` +
                `이미 구독 중: ${result.skipped}개\n` +
                `실패: ${result.failed}개`;
            alert(msg);

            // 구독 목록 새로고침
            if (result.subscribed > 0) {
                loadSubscriptions(true);
            }
        } else if (result.error !== '취소됨') {
            alert('가져오기 실패: ' + result.error);
        }
    } catch (e) {
        progressSection.style.display = 'none';
        alert('오류가 발생했습니다.');
        console.error(e);
    }

    btn.disabled = false;
}

// 사이드바 전체선택/일괄취소 (팝업과 다른 기능)
function selectAllSidebarChannels() {
    // 구독 모달 열기
    openSubsModal();
}

// 키보드 단축키
document.addEventListener('keydown', (e) => {
    // Esc: 모달 닫기
    if (e.key === 'Escape') {
        if (guideModal.style.display !== 'none') {
            guideModal.style.display = 'none';
        } else if (subsModal.style.display !== 'none') {
            closeSubsModal();
        }
    }

    // Enter: 검색 실행 (입력 필드에서)
    if (e.key === 'Enter') {
        const activeElement = document.activeElement;
        const isFilterInput = activeElement.closest('.filter-bar') ||
                              activeElement.id === 'results-filter';

        // 필터 영역 입력 중이고, 검색 버튼이 활성화되어 있으면 검색 실행
        if (isFilterInput && !btnSearch.disabled && searchSection.style.display !== 'none') {
            e.preventDefault();
            if (activeElement.id !== 'results-filter') {
                searchVideos();
            }
        }
    }
});

// 전용 Chrome 창에서 로그인 (localhost 리다이렉트)
async function startBrowserLogin() {
    try {
        btnLogin.textContent = '로그인 창에서 진행해주세요...';

        // 전용 Chrome 창에서 로그인 (서버가 코드를 자동으로 받음)
        const result = await eel.start_login_with_browser()();

        if (result.success) {
            showSearchSection();
            loadSubscriptions(false);
        } else {
            alert('로그인 실패: ' + result.error);
            btnLogin.disabled = false;
            btnLogin.textContent = 'Google 계정으로 로그인';
        }
    } catch (e) {
        console.error('로그인 오류:', e);
        alert('로그인 중 오류가 발생했습니다.');
        btnLogin.disabled = false;
        btnLogin.textContent = 'Google 계정으로 로그인';
    }
}

// 수동 로그인 시작 (인증 URL 생성) - fallback용
async function startManualLogin() {
    try {
        const result = await eel.start_login()();

        if (result.success) {
            // 인증 URL 표시 모달 열기
            const authModal = document.getElementById('auth-code-modal');
            const authUrlDisplay = document.getElementById('auth-url-display');
            const authCodeInput = document.getElementById('auth-code-input');

            authUrlDisplay.textContent = result.authUrl;
            authCodeInput.value = '';
            authModal.style.display = 'flex';

            // 브라우저에서 URL 열기
            window.open(result.authUrl, '_blank');

            // 입력 필드에 포커스
            setTimeout(() => authCodeInput.focus(), 100);
        } else {
            alert('로그인 시작 실패: ' + result.error);
            btnLogin.disabled = false;
            btnLogin.textContent = 'Google 계정으로 로그인';
        }
    } catch (e) {
        console.error('로그인 시작 오류:', e);
        alert('로그인 시작 중 오류가 발생했습니다.');
        btnLogin.disabled = false;
        btnLogin.textContent = 'Google 계정으로 로그인';
    }
}

// 인증 코드 제출
async function submitAuthCode() {
    const authCodeInput = document.getElementById('auth-code-input');
    const authModal = document.getElementById('auth-code-modal');
    const btnSubmitAuthCode = document.getElementById('btn-submit-auth-code');

    const code = authCodeInput.value.trim();
    if (!code) {
        alert('인증 코드를 입력해주세요.');
        return;
    }

    btnSubmitAuthCode.disabled = true;
    btnSubmitAuthCode.textContent = '확인 중...';

    try {
        const result = await eel.complete_login(code)();

        if (result.success) {
            authModal.style.display = 'none';
            showSearchSection();
            loadSubscriptions(false);
        } else {
            alert('로그인 실패: ' + result.error);
        }
    } catch (e) {
        console.error('로그인 완료 오류:', e);
        alert('로그인 처리 중 오류가 발생했습니다.');
    }

    btnSubmitAuthCode.disabled = false;
    btnSubmitAuthCode.textContent = '로그인 완료';
    btnLogin.disabled = false;
    btnLogin.textContent = 'Google 계정으로 로그인';
}

// ===== 키워드 히스토리 UI =====

function toggleKeywordHistoryMenu(menuId, inputId) {
    const menu = document.getElementById(menuId);
    if (menu.style.display === 'none') {
        renderKeywordHistoryMenu(menuId, inputId);
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
}

function renderKeywordHistoryMenu(menuId, inputId) {
    const menu = document.getElementById(menuId);
    const history = getKeywordHistory();

    if (history.length === 0) {
        menu.innerHTML = '<div class="history-empty">검색 키워드 기록이 없습니다.</div>';
        return;
    }

    menu.innerHTML = history.map((h, idx) => {
        const timeAgo = formatTimeAgo(h.timestamp);
        return `
            <div class="history-item">
                <div class="history-item-content" onclick="applyKeywordHistory('${inputId}', '${escapeHtml(h.keyword).replace(/'/g, "\\'")}', '${menuId}')">
                    <span class="history-item-keyword">${escapeHtml(h.keyword)}</span>
                    <div class="history-item-time">${timeAgo}</div>
                </div>
                <button class="history-delete-btn" onclick="deleteKeywordHistory(event, ${idx}, '${menuId}', '${inputId}')" title="삭제">×</button>
            </div>
        `;
    }).join('');
}

// ===== 채널 구독 탭 =====

// 선택된 엑셀 파일 경로 저장
let selectedExcelFiles = [];
// 추출된 URL 목록
let extractedUrls = [];
// 조회된 채널 정보
let resolvedChannels = [];

// 채널 구독 탭 초기화
function initBatchSubscribe() {
    const btnSelectExcel = document.getElementById('btn-select-excel');
    const btnAddDirectUrls = document.getElementById('btn-add-direct-urls');
    const btnResolveChannels = document.getElementById('btn-resolve-channels');
    const btnSubscribeAll = document.getElementById('btn-subscribe-all');
    const btnClearChannels = document.getElementById('btn-clear-channels');
    const btnExtractCells = document.getElementById('btn-extract-cells');

    if (btnSelectExcel) {
        btnSelectExcel.addEventListener('click', selectExcelFiles);
    }
    if (btnAddDirectUrls) {
        btnAddDirectUrls.addEventListener('click', addDirectUrls);
    }
    if (btnResolveChannels) {
        // 채널 ID 조회 버튼: 엑셀 URL 추출 + 직접 입력 URL + 채널 ID 조회를 한 번에 수행
        btnResolveChannels.addEventListener('click', extractAndResolveChannels);
    }
    if (btnSubscribeAll) {
        btnSubscribeAll.addEventListener('click', subscribeAllChannels);
    }
    if (btnClearChannels) {
        btnClearChannels.addEventListener('click', clearChannelList);
    }
    if (btnExtractCells) {
        btnExtractCells.addEventListener('click', extractCellData);
    }
}

// 엑셀 파일 선택
async function selectExcelFiles() {
    try {
        const result = await eel.select_excel_files()();
        if (result.success) {
            selectedExcelFiles = result.files;
            document.getElementById('excel-file-count').textContent = `${result.files.length}개 파일 선택됨`;
        }
    } catch (err) {
        console.error('파일 선택 오류:', err);
    }
}

// 엑셀 셀 데이터 추출
async function extractCellData() {
    const btnExtract = document.getElementById('btn-extract-cells');
    const resultSpan = document.getElementById('extract-cell-result');

    if (selectedExcelFiles.length === 0) {
        alert('먼저 엑셀 파일을 선택하세요.');
        return;
    }

    const cellRange = document.getElementById('cell-range').value.trim();
    if (!cellRange) {
        alert('셀 범위를 입력하세요. (예: A2:A100 또는 A1:B5, A10:B15)');
        return;
    }

    try {
        btnExtract.disabled = true;
        btnExtract.textContent = '추출 중...';
        resultSpan.textContent = '';

        const result = await eel.extract_cells_from_excel(selectedExcelFiles, cellRange)();

        if (result.success) {
            // 추출된 데이터를 직접 입력 필드에 추가
            const textarea = document.getElementById('direct-urls');
            const existingText = textarea.value.trim();
            const newData = result.data.join('\n');

            if (existingText) {
                textarea.value = existingText + '\n' + newData;
            } else {
                textarea.value = newData;
            }

            resultSpan.textContent = `${result.count}개 셀 데이터 추출됨`;
            resultSpan.style.color = '#4CAF50';
        } else {
            resultSpan.textContent = result.error || '추출 실패';
            resultSpan.style.color = '#f44336';
        }
    } catch (err) {
        console.error('셀 데이터 추출 오류:', err);
        resultSpan.textContent = '추출 중 오류 발생';
        resultSpan.style.color = '#f44336';
    } finally {
        btnExtract.disabled = false;
        btnExtract.textContent = '셀 데이터 추출';
    }
}

// 엑셀에서 URL 추출 + 직접 입력 URL + 채널 ID 조회 통합 함수
async function extractAndResolveChannels() {
    const btnResolve = document.getElementById('btn-resolve-channels');

    try {
        btnResolve.disabled = true;
        btnResolve.textContent = '처리 중...';

        let allUrls = [];

        // 1. 엑셀 파일에서 URL 추출
        if (selectedExcelFiles.length > 0) {
            const cellRange = document.getElementById('cell-range').value.trim();
            if (cellRange) {
                const excelResult = await eel.extract_urls_from_excel(selectedExcelFiles, cellRange)();
                if (excelResult.success && excelResult.urls.length > 0) {
                    allUrls = allUrls.concat(excelResult.urls);
                }
            }
        }

        // 2. 직접 입력된 URL 추가
        const textarea = document.getElementById('direct-urls');
        const directText = textarea.value.trim();
        if (directText) {
            const directUrls = directText.split('\n').map(u => u.trim()).filter(u => u);
            allUrls = allUrls.concat(directUrls);
        }

        // 중복 제거
        allUrls = [...new Set(allUrls)];

        if (allUrls.length === 0) {
            alert('추출할 URL이 없습니다.\n엑셀 파일을 선택하거나 직접 URL을 입력하세요.');
            return;
        }

        // 3. 채널 ID 조회
        showProgress();
        const result = await eel.resolve_channel_urls(allUrls)();

        if (result.success) {
            resolvedChannels = [...result.channels, ...result.failed];
            extractedUrls = [];
            textarea.value = ''; // 직접 입력 필드 초기화
            updateChannelListUI();

            hideProgress();
            alert(`채널 조회 완료!\n성공: ${result.success_count}개\n실패: ${result.failed_count}개`);
        } else {
            hideProgress();
            alert('채널 조회 실패: ' + result.error);
        }
    } catch (err) {
        console.error('채널 조회 오류:', err);
        hideProgress();
        alert('처리 중 오류가 발생했습니다.');
    } finally {
        btnResolve.disabled = false;
        btnResolve.textContent = '채널 ID 조회';
    }
}

// 직접 URL 추가
function addDirectUrls() {
    const textarea = document.getElementById('direct-urls');
    const text = textarea.value.trim();

    if (!text) {
        alert('URL을 입력하세요.');
        return;
    }

    const urls = text.split('\n').map(u => u.trim()).filter(u => u);
    const existingUrls = new Set(extractedUrls);
    let addedCount = 0;

    urls.forEach(url => {
        if (!existingUrls.has(url)) {
            extractedUrls.push(url);
            addedCount++;
        }
    });

    updateChannelListUI();
    textarea.value = '';
    alert(`${addedCount}개 URL 추가됨 (총 ${extractedUrls.length}개)`);
}

// 채널 목록 UI 업데이트
function updateChannelListUI() {
    const container = document.getElementById('extracted-channel-list');
    const countSpan = document.getElementById('channel-list-count');

    if (resolvedChannels.length === 0) {
        container.innerHTML = '<p class="empty-message">엑셀 파일에서 URL을 추출하거나 직접 입력 후 \'채널 ID 조회\' 버튼을 클릭하세요.</p>';
        countSpan.textContent = '(0개)';
        document.getElementById('btn-subscribe-all').disabled = true;
        document.getElementById('btn-clear-channels').disabled = true;
        return;
    }

    // 조회된 채널 정보 표시
    container.innerHTML = resolvedChannels.map((ch, idx) => `
        <div class="channel-item ${ch.success ? '' : 'failed'}">
            ${ch.success ? `
                <img src="${ch.thumbnail}" class="channel-thumb" alt="">
                <span class="channel-title">${escapeHtml(ch.title)}</span>
                <span class="channel-id">${ch.channel_id}</span>
            ` : `
                <span class="channel-error">❌ ${escapeHtml(ch.original_url || ch.error)}</span>
            `}
            <button class="btn-remove" onclick="removeChannel(${idx})">×</button>
        </div>
    `).join('');

    const validCount = resolvedChannels.filter(c => c.success).length;
    countSpan.textContent = `(${validCount}개 채널)`;
    document.getElementById('btn-subscribe-all').disabled = validCount === 0;
    document.getElementById('btn-clear-channels').disabled = false;
}

// URL 제거
function removeUrl(index) {
    extractedUrls.splice(index, 1);
    updateChannelListUI();
}

// 채널 제거
function removeChannel(index) {
    resolvedChannels.splice(index, 1);
    updateChannelListUI();
}

// 구독 전용 진행바 표시
function showSubscribeProgress() {
    const section = document.getElementById('subscribe-progress-section');
    const fill = document.getElementById('subscribe-progress-fill');
    const text = document.getElementById('subscribe-progress-text');
    const percent = document.getElementById('subscribe-progress-percent');
    const detail = document.getElementById('subscribe-progress-detail');

    if (section) {
        section.style.display = 'block';
        fill.style.width = '0%';
        text.textContent = '준비 중...';
        percent.textContent = '0%';
        detail.innerHTML = '';
    }
    isSubscribing = true;
}

// 구독 전용 진행바 숨기기
function hideSubscribeProgress() {
    const section = document.getElementById('subscribe-progress-section');
    if (section) {
        section.style.display = 'none';
    }
    isSubscribing = false;
}

// 구독 진행률 업데이트
function updateSubscribeProgress(text, percent) {
    const fill = document.getElementById('subscribe-progress-fill');
    const textEl = document.getElementById('subscribe-progress-text');
    const percentEl = document.getElementById('subscribe-progress-percent');

    if (fill) fill.style.width = percent + '%';
    if (textEl) textEl.textContent = text;
    if (percentEl) percentEl.textContent = percent + '%';
}

// 일괄 구독
async function subscribeAllChannels() {
    const validChannels = resolvedChannels.filter(c => c.success);
    if (validChannels.length === 0) {
        alert('구독할 채널이 없습니다.');
        return;
    }

    if (!confirm(`${validChannels.length}개 채널을 구독하시겠습니까?`)) {
        return;
    }

    try {
        document.getElementById('btn-subscribe-all').disabled = true;
        document.getElementById('btn-subscribe-all').textContent = '구독 중...';
        document.getElementById('btn-clear-channels').disabled = true;

        // 결과 섹션 숨기기
        document.getElementById('subscribe-result-section').style.display = 'none';

        // 구독 전용 진행바 표시
        showSubscribeProgress();
        updateSubscribeProgress(`구독 준비 중... (0/${validChannels.length})`, 0);

        const channelIds = validChannels.map(c => c.channel_id);
        const result = await eel.subscribe_channels_from_urls(channelIds)();

        // 완료 후 잠시 대기하여 100% 진행률을 보여줌
        updateSubscribeProgress('완료!', 100);
        await new Promise(resolve => setTimeout(resolve, 800));
        hideSubscribeProgress();

        if (result.success) {
            // 결과 표시
            const resultSection = document.getElementById('subscribe-result-section');
            const resultDiv = document.getElementById('subscribe-result');

            resultSection.style.display = 'block';
            resultDiv.innerHTML = `
                <div class="result-summary">
                    <div class="result-item success">✅ 구독 완료: ${result.subscribed}개</div>
                    <div class="result-item already">⏭️ 이미 구독 중: ${result.already}개</div>
                    <div class="result-item failed">❌ 실패: ${result.failed}개</div>
                </div>
            `;

            // 목록 초기화
            clearChannelList();

            alert(`구독 완료!\n새로 구독: ${result.subscribed}개\n이미 구독 중: ${result.already}개\n실패: ${result.failed}개`);
        } else {
            alert('구독 실패: ' + result.error);
        }
    } catch (err) {
        console.error('구독 오류:', err);
        hideSubscribeProgress();
        alert('구독 중 오류가 발생했습니다.');
    } finally {
        document.getElementById('btn-subscribe-all').disabled = resolvedChannels.filter(c => c.success).length === 0;
        document.getElementById('btn-subscribe-all').textContent = '일괄 구독';
        document.getElementById('btn-clear-channels').disabled = resolvedChannels.length === 0;
    }
}

// 목록 초기화
function clearChannelList() {
    extractedUrls = [];
    resolvedChannels = [];
    selectedExcelFiles = [];
    document.getElementById('excel-file-count').textContent = '선택된 파일 없음';
    document.getElementById('direct-urls').value = '';
    updateChannelListUI();
}

// 진행바 표시/숨김
function showProgress() {
    document.getElementById('progress-section').style.display = 'flex';
}

function hideProgress() {
    document.getElementById('progress-section').style.display = 'none';
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', function() {
    initBatchSubscribe();
});

function applyKeywordHistory(inputId, keyword, menuId) {
    const input = document.getElementById(inputId);
    if (input) {
        input.value = keyword;
        input.focus();
    }
    document.getElementById(menuId).style.display = 'none';
}

function deleteKeywordHistory(event, index, menuId, inputId) {
    event.stopPropagation();
    deleteKeywordFromHistory(index);
    renderKeywordHistoryMenu(menuId, inputId);
}

// ===== 돌연변이 히스토리 UI =====

function toggleMutationHistoryMenu() {
    const menu = document.getElementById('mutation-history-menu');
    if (menu.style.display === 'none') {
        renderMutationHistoryMenu();
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
}

function renderMutationHistoryMenu() {
    const menu = document.getElementById('mutation-history-menu');
    const history = getMutationHistory();

    if (history.length === 0) {
        menu.innerHTML = '<div class="history-empty">돌연변이 검색 기록이 없습니다.</div>';
        return;
    }

    // 구독자 카테고리 라벨
    const categoryLabels = {
        'all': '전체',
        'master': '고수채널',
        'middle': '어중간채널',
        'reference': '참고채널',
        'explosive': '폭발대기'
    };

    menu.innerHTML = history.map((h, idx) => {
        const timeAgo = formatTimeAgo(h.timestamp);
        const videoTypeLabel = h.videoType === 'long' ? '롱폼' : '쇼츠';
        const categoryLabel = categoryLabels[h.subscriberCategory] || h.subscriberCategory;
        const params = `${videoTypeLabel} · ${categoryLabel} · 지수 ${h.mutationRatio}x↑ · ${h.daysWithin}일`;

        return `
            <div class="history-item">
                <div class="history-item-content" onclick="applyMutationHistory(${idx})">
                    <span class="history-item-params">${params}</span>
                    <div class="history-item-time">${timeAgo}</div>
                </div>
                <button class="history-delete-btn" onclick="deleteMutationHistory(event, ${idx})" title="삭제">×</button>
            </div>
        `;
    }).join('');
}

function applyMutationHistory(index) {
    const history = getMutationHistory();
    const h = history[index];
    if (!h) return;

    // 영상 타입 설정
    const videoRadio = document.querySelector(`input[name="video-type-mutation"][value="${h.videoType}"]`);
    if (videoRadio) videoRadio.checked = true;

    // 구독자 카테고리 설정
    const subscriberCategory = document.getElementById('subscriber-category-mutation');
    if (subscriberCategory) subscriberCategory.value = h.subscriberCategory;

    // 돌연변이 지수 설정
    const mutationRatio = document.getElementById('mutation-ratio');
    if (mutationRatio) mutationRatio.value = h.mutationRatio;

    // 기간 설정
    setDaysWithinValue('days-within-mutation', 'days-within-mutation-custom', h.daysWithin);

    // 메뉴 닫기
    document.getElementById('mutation-history-menu').style.display = 'none';
}

function deleteMutationHistory(event, index) {
    event.stopPropagation();
    deleteMutationFromHistory(index);
    renderMutationHistoryMenu();
}


// ===================== 멀티 계정 관리 =====================

// 계정 목록
let accountList = [];
let currentAccountId = null;

// 계정 목록 로드 및 UI 업데이트
async function loadAccounts() {
    try {
        const result = await eel.get_accounts()();
        if (result.success) {
            accountList = result.accounts;
            currentAccountId = result.current_account_id;
            renderAccountDropdown();
            updateCurrentAccountDisplay();
        }
    } catch (e) {
        console.error('계정 목록 로드 오류:', e);
    }
}

// 계정 드롭다운 렌더링
function renderAccountDropdown() {
    const accountListEl = document.getElementById('account-list');
    if (!accountListEl) return;

    if (accountList.length === 0) {
        accountListEl.innerHTML = '<div class="account-empty">등록된 계정이 없습니다.</div>';
        return;
    }

    accountListEl.innerHTML = accountList.map(account => {
        const isActive = account.id === currentAccountId;
        const hasApiConfig = account.has_api_config;
        const isAuthenticated = account.is_authenticated;

        // 상태 결정: API 설정 없음 > 재로그인 필요 > 정상
        let statusClass = '';
        let statusIcon = '';
        let statusText = '';

        if (!hasApiConfig) {
            statusClass = 'needs-api';
            statusIcon = '🔑 ';
            statusText = 'API 키 필요';
        } else if (!isAuthenticated) {
            statusClass = 'needs-login';
            statusIcon = '⚠️ ';
            statusText = '재로그인 필요';
        }

        return `
            <div class="account-item ${isActive ? 'active' : ''} ${statusClass}" data-account-id="${account.id}">
                <img src="${account.thumbnail || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23666%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2260%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2240%22>?</text></svg>'}"
                     class="account-item-avatar" alt="">
                <div class="account-item-info">
                    <span class="account-item-name">${statusIcon}${escapeHtml(account.name || '새 계정')}</span>
                    ${statusText ? `<span class="account-item-status">${statusText}</span>` : ''}
                </div>
                <div class="account-item-actions">
                    ${isActive ? '<span class="account-check">✓</span>' : ''}
                    <button class="btn-account-action" onclick="event.stopPropagation(); showAccountMenu('${account.id}')" title="더보기">⋮</button>
                </div>
            </div>
        `;
    }).join('');

    // 계정 클릭 이벤트
    accountListEl.querySelectorAll('.account-item').forEach(item => {
        item.addEventListener('click', () => {
            const accountId = item.dataset.accountId;
            switchAccount(accountId);
        });
    });
}

// 현재 계정 표시 업데이트
function updateCurrentAccountDisplay() {
    const accountNameEl = document.getElementById('account-name');
    const accountThumbnailEl = document.getElementById('account-thumbnail');

    const currentAccount = accountList.find(a => a.id === currentAccountId);

    if (currentAccount) {
        accountNameEl.textContent = currentAccount.name || '계정';
        accountThumbnailEl.src = currentAccount.thumbnail || '';
        accountThumbnailEl.style.display = currentAccount.thumbnail ? 'block' : 'none';
    } else {
        accountNameEl.textContent = '계정 선택';
        accountThumbnailEl.style.display = 'none';
    }
}

// 계정 드롭다운 토글
function toggleAccountDropdown() {
    const dropdown = document.getElementById('account-dropdown');
    if (dropdown.style.display === 'none') {
        dropdown.style.display = 'block';
        // 외부 클릭 시 닫기
        setTimeout(() => {
            document.addEventListener('click', closeAccountDropdownOnOutside);
        }, 0);
    } else {
        dropdown.style.display = 'none';
        document.removeEventListener('click', closeAccountDropdownOnOutside);
    }
}

function closeAccountDropdownOnOutside(e) {
    const selector = document.getElementById('account-selector');
    if (!selector.contains(e.target)) {
        document.getElementById('account-dropdown').style.display = 'none';
        document.removeEventListener('click', closeAccountDropdownOnOutside);
    }
}

// 계정 전환
async function switchAccount(accountId) {
    if (accountId === currentAccountId) {
        document.getElementById('account-dropdown').style.display = 'none';
        return;
    }

    try {
        const result = await eel.switch_to_account(accountId)();

        if (result.success) {
            currentAccountId = accountId;
            updateCurrentAccountDisplay();
            document.getElementById('account-dropdown').style.display = 'none';

            // 구독 목록 새로고침 (강제 새로고침)
            currentSubscriptions = [];
            subscriptionsLoaded = false;
            await loadSubscriptions(true);
        } else if (result.needsApiSetup) {
            // API 설정이 없음 - API 설정 화면으로
            alert('이 계정에 API 설정이 없습니다.\nAPI 설정을 먼저 해주세요.');
            showAccountApiModal(accountId);
        } else if (result.needsLogin) {
            // 재로그인 필요
            if (confirm('이 계정은 재로그인이 필요합니다.\n지금 로그인하시겠습니까?')) {
                await loginToAccount(accountId);
            }
        } else {
            alert('계정 전환 실패: ' + result.error);
        }
    } catch (e) {
        console.error('계정 전환 오류:', e);
        alert('계정 전환 중 오류가 발생했습니다.');
    }
}

// 새 계정 추가 (API 설정 화면으로 이동)
async function addNewAccount() {
    document.getElementById('account-dropdown').style.display = 'none';

    // API 설정 화면을 표시 (새 계정 추가 모드)
    // isFirstSetupMode = false, setupAccountId = null (새 계정 생성)
    showAddAccountApiModal();
}

// 새 계정 추가용 API 설정 모달
function showAddAccountApiModal() {
    // setup-section을 사용하여 새 계정 + API 설정
    isFirstSetupMode = false;
    setupAccountId = null;

    setupSection.style.display = 'flex';
    loginSection.style.display = 'none';
    searchSection.style.display = 'none';

    // 입력 필드 초기화
    inputClientId.value = '';
    inputClientSecret.value = '';
    if (inputApiKey) inputApiKey.value = '';

    // 제목/설명 업데이트
    const setupBox = setupSection.querySelector('.setup-box h1');
    const setupDesc = setupSection.querySelector('.setup-box > p');

    if (setupBox) setupBox.textContent = '새 계정 추가';
    if (setupDesc) setupDesc.textContent = '새 계정을 위한 Google Cloud 프로젝트의 OAuth 자격증명을 입력하세요. 각 계정은 자체 API 할당량을 사용합니다.';

    // 취소 버튼이 검색 화면으로 돌아가도록 설정
    const cancelBtn = document.getElementById('btn-cancel-setup');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            showSearchSection();
        };
    }
}

// 특정 계정으로 로그인
async function loginToAccount(accountId) {
    try {
        const result = await eel.login_account(accountId)();

        if (result.success) {
            await loadAccounts();
            await switchAccount(accountId);
        } else {
            alert('로그인 실패: ' + result.error);
        }
    } catch (e) {
        console.error('계정 로그인 오류:', e);
        alert('로그인 중 오류가 발생했습니다.');
    }
}

// 계정 메뉴 표시 (더보기)
async function showAccountMenu(accountId) {
    const account = accountList.find(a => a.id === accountId);
    if (!account) return;

    const actions = [];

    if (!account.is_authenticated) {
        actions.push({ text: '🔑 다시 로그인', action: () => loginToAccount(accountId) });
    }

    // API 설정 상태 확인
    const apiStatus = await eel.get_account_api_status(accountId)();
    const apiText = apiStatus.has_own_api ? '⚙️ API 설정 (✓ 설정됨)' : '⚙️ API 설정';
    actions.push({ text: apiText, action: () => showAccountApiModal(accountId) });

    actions.push({ text: '✏️ 이름 변경', action: () => renameAccount(accountId, account.name) });

    if (accountList.length > 1) {
        actions.push({ text: '🗑️ 계정 삭제', action: () => deleteAccount(accountId, account.name) });
    }

    // 간단한 컨텍스트 메뉴 (prompt/confirm 사용)
    const choice = prompt(
        `"${account.name}" 계정 관리\n\n` +
        actions.map((a, i) => `${i + 1}. ${a.text}`).join('\n') +
        '\n\n번호를 입력하세요:'
    );

    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < actions.length) {
        actions[idx].action();
    }
}

// 계정 이름 변경
async function renameAccount(accountId, currentName) {
    const newName = prompt('새 계정 이름을 입력하세요:', currentName);
    if (!newName || newName === currentName) return;

    try {
        const result = await eel.rename_account(accountId, newName)();
        if (result.success) {
            await loadAccounts();
            alert('계정 이름이 변경되었습니다.');
        } else {
            alert('이름 변경 실패: ' + result.error);
        }
    } catch (e) {
        console.error('이름 변경 오류:', e);
    }
}

// 계정 삭제
async function deleteAccount(accountId, accountName) {
    if (!confirm(`"${accountName}" 계정을 삭제하시겠습니까?\n\n이 계정의 로그인 정보가 삭제됩니다.`)) {
        return;
    }

    try {
        const result = await eel.remove_account_by_id(accountId)();
        if (result.success) {
            await loadAccounts();

            // 삭제된 계정이 현재 계정이었으면 구독 목록 새로고침
            if (accountId === currentAccountId) {
                currentSubscriptions = [];
                subscriptionsLoaded = false;
                await loadSubscriptions(false);
            }

            alert('계정이 삭제되었습니다.');
        } else {
            alert('계정 삭제 실패: ' + result.error);
        }
    } catch (e) {
        console.error('계정 삭제 오류:', e);
    }
}

// 계정 드롭다운 이벤트 초기화
function initAccountDropdown() {
    const accountCurrent = document.getElementById('account-current');
    const btnAddAccount = document.getElementById('btn-add-account');

    if (accountCurrent) {
        accountCurrent.addEventListener('click', toggleAccountDropdown);
    }

    if (btnAddAccount) {
        btnAddAccount.addEventListener('click', (e) => {
            e.stopPropagation();
            addNewAccount();
        });
    }
}

// 기존 초기화 함수에 계정 초기화 추가 (DOMContentLoaded에서 호출)
const originalDOMContentLoaded = document.addEventListener;
document.addEventListener('DOMContentLoaded', function() {
    initAccountDropdown();
    initAccountApiModals();
});


// ===================== 계정별 API 설정 관련 함수 =====================

// 현재 API 설정 대상 계정 ID
let currentApiAccountId = null;
let pendingSwitchAccountId = null;

// 계정별 API 설정 모달 표시
async function showAccountApiModal(accountId) {
    currentApiAccountId = accountId;
    const modal = document.getElementById('account-api-modal');
    const statusBox = document.getElementById('account-api-status');
    const deleteBtn = document.getElementById('btn-delete-account-api');

    // 상태 확인
    const apiStatus = await eel.get_account_api_status(accountId)();
    const account = accountList.find(a => a.id === accountId);
    const accountName = account ? account.name : accountId;

    // 상태 박스 업데이트
    if (apiStatus.has_own_api) {
        statusBox.className = 'api-status-box has-own';
        statusBox.innerHTML = `✓ "${accountName}" 계정에 API 설정이 되어 있습니다.<br><small>이 계정은 자체 할당량을 사용합니다.</small>`;
        deleteBtn.style.display = 'inline-block';
    } else {
        statusBox.className = 'api-status-box no-config';
        statusBox.innerHTML = `⚠️ API 설정이 없습니다.<br><small>이 계정을 사용하려면 API 자격 증명을 입력해야 합니다.</small>`;
        deleteBtn.style.display = 'none';
    }

    // 입력 필드 초기화
    document.getElementById('account-api-key').value = '';

    // 계정 드롭다운 닫기
    document.getElementById('account-dropdown').style.display = 'none';

    modal.style.display = 'flex';
}

// 계정별 API 키 저장 (기존 계정에 API 키만 추가)
async function saveAccountApi() {
    const apiKey = document.getElementById('account-api-key').value.trim();

    if (!apiKey) {
        alert('API 키를 입력하세요.');
        return;
    }

    try {
        const result = await eel.save_account_api_key(currentApiAccountId, apiKey)();

        if (result.success) {
            alert('API 설정이 저장되었습니다.\n\n이 계정은 이제 별도의 API 할당량을 사용합니다.');
            closeAccountApiModal();
        } else {
            alert('저장 실패: ' + result.error);
        }
    } catch (e) {
        console.error('API 저장 오류:', e);
        alert('저장 중 오류가 발생했습니다.');
    }
}

// 계정별 API 설정 삭제
async function deleteAccountApi() {
    if (!confirm('이 계정의 API 설정을 삭제하시겠습니까?\n\n삭제 후 이 계정은 사용할 수 없습니다. 다시 사용하려면 API를 다시 설정해야 합니다.')) {
        return;
    }

    try {
        const result = await eel.delete_account_api_config(currentApiAccountId)();

        if (result.success) {
            alert('API 설정이 삭제되었습니다.');
            closeAccountApiModal();
        } else {
            alert('삭제 실패');
        }
    } catch (e) {
        console.error('API 삭제 오류:', e);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

// 계정별 API 설정 모달 닫기
function closeAccountApiModal() {
    document.getElementById('account-api-modal').style.display = 'none';
    currentApiAccountId = null;
}

// 계정별 API 모달 이벤트 초기화
function initAccountApiModals() {
    // API 설정 모달 이벤트
    const closeApiBtn = document.getElementById('btn-close-account-api');
    const saveApiBtn = document.getElementById('btn-save-account-api');
    const deleteApiBtn = document.getElementById('btn-delete-account-api');

    if (closeApiBtn) closeApiBtn.addEventListener('click', closeAccountApiModal);
    if (saveApiBtn) saveApiBtn.addEventListener('click', saveAccountApi);
    if (deleteApiBtn) deleteApiBtn.addEventListener('click', deleteAccountApi);
}

// ===== 브루최적화 탭 기능 =====
let lineBreakOriginalText = '';
let lineBreakConvertedText = '';
let lineBreakFileName = '';
let lineBreakFilePath = '';  // 파일 경로

// 브루최적화 탭 초기화
function initLineBreakTab() {
    const dropZone = document.getElementById('line-break-drop-zone');
    const clearFileBtn = document.getElementById('btn-clear-line-break-file');
    const convertBtn = document.getElementById('btn-convert-line-break');
    const copyBtn = document.getElementById('btn-copy-line-break');
    const downloadBtn = document.getElementById('btn-download-line-break');

    if (!dropZone) return;

    // 클릭 시 백엔드 파일 선택 대화상자 사용 (.txt, .docx 모두 지원)
    dropZone.addEventListener('click', async () => {
        try {
            const result = await eel.select_and_read_docx_file()();
            if (result.cancelled) return;
            if (!result.success) {
                alert('파일 읽기 실패: ' + result.error);
                return;
            }
            lineBreakOriginalText = result.text;
            lineBreakFileName = result.filename;
            lineBreakFilePath = result.path || '';  // 파일 경로 저장
            document.getElementById('line-break-file-info').style.display = 'flex';
            document.getElementById('line-break-file-name').textContent = `${result.filename} (${formatFileSize(result.fileSize)})`;
            document.getElementById('btn-convert-line-break').disabled = false;
            convertSubtitleSplit();
        } catch (err) {
            console.error('파일 처리 오류:', err);
            alert('파일 처리 중 오류가 발생했습니다.');
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            const fileName = file.name.toLowerCase();
            if (fileName.endsWith('.docx')) {
                alert('Word 파일(.docx)은 클릭하여 파일 선택 대화상자에서 선택해주세요.');
                return;
            }
            if (fileName.endsWith('.txt')) {
                handleLineBreakFile(file);
            } else {
                alert('.txt 또는 .docx 파일만 지원합니다.');
            }
        }
    });

    // 파일 삭제 버튼
    clearFileBtn.addEventListener('click', clearLineBreakFile);

    // 변환 버튼
    convertBtn.addEventListener('click', convertSubtitleSplit);

    // 복사 버튼
    copyBtn.addEventListener('click', () => {
        const preview = document.getElementById('line-break-preview');
        if (preview.value) {
            navigator.clipboard.writeText(preview.value).then(() => {
                alert('클립보드에 복사되었습니다.');
            });
        }
    });

    // 다운로드 버튼
    downloadBtn.addEventListener('click', downloadLineBreakResult);

    // 옵션 변경시 자동 재변환
    const optionInputs = ['subtitle-target-length', 'subtitle-min-length', 'subtitle-max-length', 'subtitle-search-range'];
    optionInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', () => {
                if (lineBreakOriginalText || lineBreakFilePath) {
                    convertSubtitleSplit();
                }
            });
        }
    });
}

// 브루최적화 변환
async function convertSubtitleSplit() {
    if (!lineBreakFilePath && !lineBreakOriginalText) return;

    const convertBtn = document.getElementById('btn-convert-line-break');
    convertBtn.disabled = true;
    convertBtn.textContent = '최적화 중...';

    try {
        const options = {
            target_length: parseInt(document.getElementById('subtitle-target-length').value) || 15,
            min_length: parseInt(document.getElementById('subtitle-min-length').value) || 10,
            max_length: parseInt(document.getElementById('subtitle-max-length').value) || 18,
            search_range: parseInt(document.getElementById('subtitle-search-range').value) || 3
        };

        const result = await eel.process_subtitle_split(lineBreakFilePath, options)();

        if (result.success) {
            lineBreakConvertedText = result.result;

            // 미리보기 표시
            document.getElementById('line-break-preview').value = lineBreakConvertedText;

            // 통계 표시
            document.getElementById('line-break-stats').style.display = 'flex';
            document.getElementById('original-line-count').textContent = result.original_lines;
            document.getElementById('converted-line-count').textContent = result.converted_lines;

            // 복사/다운로드 버튼 활성화
            document.getElementById('btn-copy-line-break').disabled = false;
            document.getElementById('btn-download-line-break').disabled = false;
        } else {
            alert('최적화 실패: ' + result.error);
        }
    } catch (err) {
        console.error('브루최적화 오류:', err);
        alert('브루최적화 중 오류가 발생했습니다.');
    } finally {
        convertBtn.disabled = false;
        convertBtn.textContent = '최적화';
    }
}

// 파일 처리
async function handleLineBreakFile(file) {
    const fileName = file.name.toLowerCase();

    // Word 파일인 경우 백엔드에서 처리
    if (fileName.endsWith('.docx')) {
        try {
            // 파일 경로를 얻기 위해 백엔드 API 사용
            const result = await eel.select_and_read_docx_file()();

            if (result.cancelled) return;

            if (!result.success) {
                alert('파일 읽기 실패: ' + result.error);
                return;
            }

            lineBreakOriginalText = result.text;
            lineBreakFileName = result.filename;

            // 파일 정보 표시
            document.getElementById('line-break-file-info').style.display = 'flex';
            document.getElementById('line-break-file-name').textContent = `${result.filename} (${formatFileSize(result.fileSize)})`;

            // 버튼 활성화
            document.getElementById('btn-convert-line-break').disabled = false;

            // 자동 변환
            convertSubtitleSplit();
        } catch (e) {
            console.error('Word 파일 처리 오류:', e);
            alert('Word 파일 처리 중 오류가 발생했습니다.');
        }
        return;
    }

    // txt 파일인 경우 기존 방식 사용
    if (!fileName.endsWith('.txt')) {
        alert('.txt 또는 .docx 파일만 업로드할 수 있습니다.');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        lineBreakOriginalText = e.target.result;
        lineBreakFileName = file.name;

        // 파일 정보 표시
        document.getElementById('line-break-file-info').style.display = 'flex';
        document.getElementById('line-break-file-name').textContent = `${file.name} (${formatFileSize(file.size)})`;

        // 버튼 활성화
        document.getElementById('btn-convert-line-break').disabled = false;

        // 자동 변환
        convertSubtitleSplit();
    };
    reader.readAsText(file, 'UTF-8');
}

// 파일 크기 포맷
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 파일 삭제
function clearLineBreakFile() {
    lineBreakOriginalText = '';
    lineBreakConvertedText = '';
    lineBreakFileName = '';
    lineBreakFilePath = '';

    document.getElementById('line-break-file-input').value = '';
    document.getElementById('line-break-file-info').style.display = 'none';
    document.getElementById('line-break-preview').value = '';
    document.getElementById('line-break-stats').style.display = 'none';
    document.getElementById('btn-convert-line-break').disabled = true;
    document.getElementById('btn-copy-line-break').disabled = true;
    document.getElementById('btn-download-line-break').disabled = true;
}

// 결과 다운로드
function downloadLineBreakResult() {
    // 미리보기 창의 현재 값 사용 (사용자가 수정한 내용 반영)
    const preview = document.getElementById('line-break-preview');
    const textToDownload = preview.value;

    if (!textToDownload) {
        alert('먼저 파일을 업로드하고 변환해주세요.');
        return;
    }

    // BOM 추가하여 UTF-8로 저장 (한글 지원)
    const bom = '\uFEFF';
    const blob = new Blob([bom + textToDownload], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    // 파일명 생성
    const baseName = lineBreakFileName ? lineBreakFileName.replace(/\.(txt|docx)$/i, '') : '브루최적화';
    link.href = url;
    link.download = `${baseName}_최적화완료.txt`;
    link.click();

    URL.revokeObjectURL(url);
}

// DOMContentLoaded에서 초기화 - 기존 이벤트에 추가
document.addEventListener('DOMContentLoaded', () => {
    initLineBreakTab();
});

// ====================================
// 프리셋 OAuth 계정 선택 기능
// ====================================

let presetOAuthAccounts = [];
let selectedPresetAccount = null;  // 선택된 계정의 namePart

async function initPresetAccountSection() {
    try {
        const result = await eel.get_preset_oauth_accounts()();

        if (result.success && result.hasPresetAccounts) {
            presetOAuthAccounts = result.accounts;

            // 프리셋 계정이 있으면 카드 목록 표시
            const presetSection = document.getElementById('preset-account-section');
            const manualSection = document.getElementById('manual-setup-section');
            const backToPresetBtn = document.getElementById('btn-back-to-preset');

            if (presetSection && manualSection) {
                presetSection.style.display = 'block';
                manualSection.style.display = 'none';
                if (backToPresetBtn) backToPresetBtn.style.display = 'inline-block';

                // 계정 카드 렌더링
                renderAccountCards();
            }
        } else {
            // 프리셋 계정 없음 - 수동 입력만 표시
            const presetSection = document.getElementById('preset-account-section');
            const manualSection = document.getElementById('manual-setup-section');

            if (presetSection) presetSection.style.display = 'none';
            if (manualSection) manualSection.style.display = 'block';
        }
    } catch (e) {
        console.error('프리셋 계정 로드 오류:', e);
    }
}

// 계정 카드 렌더링
function renderAccountCards() {
    const accountList = document.getElementById('account-list');
    if (!accountList) return;

    accountList.innerHTML = '';

    presetOAuthAccounts.forEach((account) => {
        const card = document.createElement('div');
        card.className = 'account-card';
        card.dataset.namePart = account.namePart;

        // 토큰 상태에 따른 아이콘
        const icon = account.hasToken ? '👤' : '🔒';
        const statusClass = account.hasToken ? 'has-token' : 'no-token';
        const statusText = account.hasToken ? '로그인 가능' : '토큰 필요';

        card.innerHTML = `
            <div class="account-icon">${icon}</div>
            <div class="account-info">
                <div class="account-name">${account.name}</div>
                <div class="account-email">${account.email || account.namePart}</div>
            </div>
            <div class="account-status ${statusClass}">${statusText}</div>
        `;

        // 카드 클릭 이벤트
        card.addEventListener('click', () => selectAccountCard(account));

        accountList.appendChild(card);
    });
}

// 로그인 진행 중 여부 (중복 클릭 방지)
let isLoggingIn = false;

// 계정 카드 선택 - 바로 로그인/토큰 생성 진행
async function selectAccountCard(account) {
    // 중복 클릭 방지
    if (isLoggingIn) {
        console.log('이미 로그인 진행 중...');
        return;
    }
    isLoggingIn = true;

    console.log('계정 선택:', account.namePart, 'hasToken:', account.hasToken);

    // 기존 선택 해제
    document.querySelectorAll('.account-card').forEach(c => c.classList.remove('selected'));

    // 새 카드 선택
    const selectedCard = document.querySelector(`.account-card[data-name-part="${account.namePart}"]`);
    if (selectedCard) selectedCard.classList.add('selected');

    selectedPresetAccount = account.namePart;

    // 액션 버튼 영역 표시 (진행 상태 표시용)
    const actionsDiv = document.getElementById('account-actions');
    const btnLogin = document.getElementById('btn-preset-login');
    const btnCreateToken = document.getElementById('btn-create-token');

    if (actionsDiv) actionsDiv.style.display = 'flex';

    if (account.hasToken) {
        // 토큰이 있으면 바로 로그인 진행
        if (btnLogin) {
            btnLogin.style.display = 'flex';
            btnLogin.disabled = true;
            btnLogin.innerHTML = '<span class="btn-icon">⏳</span> 로그인 중...';
        }
        if (btnCreateToken) btnCreateToken.style.display = 'none';

        // 바로 로그인 실행
        try {
            console.log('login_with_preset_oauth 호출...');
            const applyResult = await eel.login_with_preset_oauth(selectedPresetAccount, true)();
            console.log('login_with_preset_oauth 결과:', applyResult);

            if (!applyResult.success) {
                alert('로그인 실패: ' + applyResult.error);
                if (btnLogin) {
                    btnLogin.disabled = false;
                    btnLogin.innerHTML = '<span class="btn-icon">🔐</span> 로그인';
                }
                isLoggingIn = false;
                return;
            }

            // 현재 선택된 프리셋 계정 저장
            currentPresetOAuthFile = selectedPresetAccount;

            // 로그인 성공 - UI 전환
            document.getElementById('login-section').style.display = 'none';
            document.getElementById('search-section').style.display = 'block';
            isLoggedIn = true;

            // 구독 목록 자동 로드
            await loadSubscriptions();
        } catch (err) {
            console.error('로그인 오류:', err);
            alert('로그인 중 오류가 발생했습니다: ' + err.message);
            if (btnLogin) {
                btnLogin.disabled = false;
                btnLogin.innerHTML = '<span class="btn-icon">🔐</span> 로그인';
            }
        }
    } else {
        // 토큰이 없으면 바로 토큰 생성 진행
        if (btnLogin) btnLogin.style.display = 'none';
        if (btnCreateToken) {
            btnCreateToken.style.display = 'flex';
            btnCreateToken.disabled = true;
            btnCreateToken.innerHTML = '<span class="btn-icon">⏳</span> 토큰 생성 중...';
        }

        // 바로 토큰 생성 실행
        try {
            console.log('create_token_for_account 호출...');
            const result = await eel.create_token_for_account(selectedPresetAccount)();
            console.log('create_token_for_account 결과:', result);

            if (result.success) {
                currentPresetOAuthFile = selectedPresetAccount;

                // 로그인 성공 - UI 전환
                document.getElementById('login-section').style.display = 'none';
                document.getElementById('search-section').style.display = 'block';
                isLoggedIn = true;

                // 구독 목록 자동 로드
                await loadSubscriptions();
            } else {
                alert('토큰 생성 실패: ' + result.error);
                if (btnCreateToken) {
                    btnCreateToken.disabled = false;
                    btnCreateToken.innerHTML = '<span class="btn-icon">🔑</span> 토큰 생성';
                }
            }
        } catch (err) {
            console.error('토큰 생성 오류:', err);
            alert('토큰 생성 중 오류가 발생했습니다: ' + err.message);
            if (btnCreateToken) {
                btnCreateToken.disabled = false;
                btnCreateToken.innerHTML = '<span class="btn-icon">🔑</span> 토큰 생성';
            }
        }
    }

    isLoggingIn = false;
}

function setupPresetAccountEvents() {
    const btnPresetLogin = document.getElementById('btn-preset-login');
    const btnCreateToken = document.getElementById('btn-create-token');
    const btnShowManualSetup = document.getElementById('btn-show-manual-setup');
    const btnBackToPreset = document.getElementById('btn-back-to-preset');
    const btnAddOAuthAccount = document.getElementById('btn-add-oauth-account');
    const btnExportCredentials = document.getElementById('btn-export-credentials');
    const btnImportCredentials = document.getElementById('btn-import-credentials');
    const presetSection = document.getElementById('preset-account-section');
    const manualSection = document.getElementById('manual-setup-section');

    // 프리셋 계정으로 로그인
    if (btnPresetLogin) {
        btnPresetLogin.addEventListener('click', async function() {
            if (!selectedPresetAccount) {
                alert('계정을 선택해주세요.');
                return;
            }

            this.disabled = true;
            this.innerHTML = '<span class="btn-icon">⏳</span> 로그인 중...';

            try {
                // 선택한 계정으로 로그인 시도 (namePart 전달)
                const applyResult = await eel.login_with_preset_oauth(selectedPresetAccount, true)();

                if (!applyResult.success) {
                    alert('로그인 실패: ' + applyResult.error);
                    this.disabled = false;
                    this.innerHTML = '<span class="btn-icon">🔐</span> 로그인';
                    return;
                }

                // 현재 선택된 프리셋 계정 저장
                currentPresetOAuthFile = selectedPresetAccount;

                if (applyResult.autoLogin) {
                    // 자동 로그인 성공
                    showSearchSection();
                    loadSubscriptions(false);
                } else {
                    // 브라우저 로그인 진행
                    this.innerHTML = '<span class="btn-icon">🌐</span> 브라우저에서 진행...';

                    const loginResult = await eel.start_login_with_browser()();

                    if (loginResult.success) {
                        showSearchSection();
                        loadSubscriptions(false);
                    } else {
                        alert('로그인 실패: ' + loginResult.error);
                        currentPresetOAuthFile = null;
                        this.disabled = false;
                        this.innerHTML = '<span class="btn-icon">🔐</span> 로그인';
                    }
                }
            } catch (e) {
                console.error('프리셋 로그인 오류:', e);
                alert('로그인 중 오류가 발생했습니다.');
                currentPresetOAuthFile = null;
                this.disabled = false;
                this.innerHTML = '<span class="btn-icon">🔐</span> 로그인';
            }
        });
    }

    // 토큰 생성 버튼
    if (btnCreateToken) {
        btnCreateToken.addEventListener('click', async function() {
            if (!selectedPresetAccount) {
                alert('계정을 선택해주세요.');
                return;
            }

            this.disabled = true;
            this.innerHTML = '<span class="btn-icon">⏳</span> 브라우저에서 인증 중...';

            try {
                const result = await eel.create_token_for_account(selectedPresetAccount)();

                if (result.success) {
                    // 토큰 생성 성공 - 자동으로 로그인됨
                    currentPresetOAuthFile = selectedPresetAccount;
                    showSearchSection();
                    loadSubscriptions(false);
                } else {
                    alert('토큰 생성 실패: ' + result.error);
                    this.disabled = false;
                    this.innerHTML = '<span class="btn-icon">🔑</span> 토큰 생성';
                }
            } catch (e) {
                console.error('토큰 생성 오류:', e);
                alert('토큰 생성 중 오류가 발생했습니다.');
                this.disabled = false;
                this.innerHTML = '<span class="btn-icon">🔑</span> 토큰 생성';
            }
        });
    }

    // 새 OAuth 계정 추가 버튼
    if (btnAddOAuthAccount) {
        btnAddOAuthAccount.addEventListener('click', async function() {
            this.disabled = true;
            this.textContent = '파일 선택 중...';

            try {
                const result = await eel.add_oauth_account_from_file()();

                if (result.success) {
                    alert(result.message + '\n\n토큰을 생성하려면 새로 추가된 계정을 선택하고 "토큰 생성" 버튼을 클릭하세요.');
                    // 계정 목록 새로고침
                    await initPresetAccountSection();
                } else {
                    if (result.error !== '파일 선택이 취소되었습니다.') {
                        alert('계정 추가 실패: ' + result.error);
                    }
                }
            } catch (e) {
                console.error('계정 추가 오류:', e);
                alert('계정 추가 중 오류가 발생했습니다.');
            } finally {
                this.disabled = false;
                this.textContent = '➕ 계정 추가';
            }
        });
    }

    // 자격증명 내보내기
    if (btnExportCredentials) {
        btnExportCredentials.addEventListener('click', async function() {
            const password = prompt('내보내기 파일을 보호할 비밀번호를 입력하세요:');
            if (!password) return;

            if (password.length < 4) {
                alert('비밀번호는 4자 이상이어야 합니다.');
                return;
            }

            this.disabled = true;
            this.textContent = '내보내는 중...';

            try {
                const result = await eel.export_all_credentials(password)();

                if (result.success) {
                    alert(result.message);
                } else {
                    alert('내보내기 실패: ' + result.error);
                }
            } catch (e) {
                console.error('내보내기 오류:', e);
                alert('내보내기 중 오류가 발생했습니다.');
            } finally {
                this.disabled = false;
                this.textContent = '📤 내보내기';
            }
        });
    }

    // 자격증명 가져오기
    if (btnImportCredentials) {
        btnImportCredentials.addEventListener('click', async function() {
            const password = prompt('가져오기 파일의 비밀번호를 입력하세요:');
            if (!password) return;

            this.disabled = true;
            this.textContent = '가져오는 중...';

            try {
                const result = await eel.import_all_credentials(password)();

                if (result.success) {
                    alert(result.message);
                    // 계정 목록 새로고침
                    await initPresetAccountSection();
                } else {
                    alert('가져오기 실패: ' + result.error);
                }
            } catch (e) {
                console.error('가져오기 오류:', e);
                alert('가져오기 중 오류가 발생했습니다.');
            } finally {
                this.disabled = false;
                this.textContent = '📥 가져오기';
            }
        });
    }

    // 직접 API 입력하기 버튼
    if (btnShowManualSetup) {
        btnShowManualSetup.addEventListener('click', function() {
            if (presetSection) presetSection.style.display = 'none';
            if (manualSection) manualSection.style.display = 'block';
        });
    }

    // 계정 선택으로 돌아가기 버튼
    if (btnBackToPreset) {
        btnBackToPreset.addEventListener('click', function() {
            if (presetSection) presetSection.style.display = 'block';
            if (manualSection) manualSection.style.display = 'none';
        });
    }
}

// 페이지 로드 시 프리셋 계정 이벤트 설정
document.addEventListener('DOMContentLoaded', () => {
    // initPresetAccountSection은 showLoginSection에서 호출됨
    setupPresetAccountEvents();
    setupPresetOAuthSelectorEvents();
});

// ====================================
// 검색 섹션 상단의 프리셋 OAuth 계정 선택 드롭다운
// ====================================

let currentPresetOAuthFile = null;  // 현재 선택된 프리셋 OAuth 파일명

// 프리셋 OAuth 선택기 초기화 (검색 섹션에서 호출)
async function initPresetOAuthSelector() {
    try {
        const result = await eel.get_preset_oauth_accounts()();

        if (result.success && result.hasPresetAccounts) {
            presetOAuthAccounts = result.accounts;

            const selector = document.getElementById('preset-oauth-selector');
            const accountSelector = document.getElementById('account-selector');

            // 프리셋 OAuth 계정이 있으면 프리셋 선택기 표시, 기존 계정 선택기 숨김
            if (selector) selector.style.display = 'block';
            if (accountSelector) accountSelector.style.display = 'none';

            // 현재 로그인된 프리셋 계정 표시
            updatePresetOAuthDisplay();
        } else {
            // 프리셋 계정이 없으면 기존 계정 선택기 사용
            const selector = document.getElementById('preset-oauth-selector');
            const accountSelector = document.getElementById('account-selector');

            if (selector) selector.style.display = 'none';
            if (accountSelector) accountSelector.style.display = 'block';
        }
    } catch (e) {
        console.error('프리셋 OAuth 선택기 초기화 오류:', e);
    }
}

// 현재 프리셋 OAuth 계정 표시 업데이트
function updatePresetOAuthDisplay() {
    const nameEl = document.getElementById('preset-oauth-name');
    const thumbnailEl = document.getElementById('preset-oauth-thumbnail');

    if (!currentPresetOAuthFile) {
        if (nameEl) nameEl.textContent = '계정 선택';
        if (thumbnailEl) thumbnailEl.style.display = 'none';
        return;
    }

    // 현재 파일에 해당하는 계정 정보 찾기
    const account = presetOAuthAccounts.find(a => a.file === currentPresetOAuthFile);

    if (account) {
        // 이름만 표시 (이메일 힌트 제외)
        if (nameEl) nameEl.textContent = account.name;
        // 썸네일은 YouTube 채널에서 가져오므로 여기서는 기본값 사용
        if (thumbnailEl) {
            thumbnailEl.style.display = 'none';
        }
    }
}

// 프리셋 OAuth 드롭다운 렌더링
function renderPresetOAuthDropdown() {
    const listEl = document.getElementById('preset-oauth-list');
    if (!listEl) return;

    if (presetOAuthAccounts.length === 0) {
        listEl.innerHTML = '<div class="preset-oauth-empty">프리셋 계정이 없습니다.</div>';
        return;
    }

    listEl.innerHTML = presetOAuthAccounts.map(account => {
        const isActive = account.file === currentPresetOAuthFile;
        const hasToken = account.hasToken;

        return `
            <div class="preset-oauth-item ${isActive ? 'active' : ''}" data-file="${account.file}">
                <div class="preset-oauth-item-avatar" style="display: flex; align-items: center; justify-content: center; font-size: 14px; color: #888;">
                    ${account.name.charAt(0)}
                </div>
                <div class="preset-oauth-item-info">
                    <span class="preset-oauth-item-name">${escapeHtml(account.name)}</span>
                </div>
                ${hasToken ? '<span class="preset-oauth-item-status">자동</span>' : ''}
                ${isActive ? '<span class="preset-oauth-item-check">✓</span>' : ''}
            </div>
        `;
    }).join('');

    // 클릭 이벤트 추가
    listEl.querySelectorAll('.preset-oauth-item').forEach(item => {
        item.addEventListener('click', () => {
            const file = item.dataset.file;
            switchPresetOAuthAccount(file);
        });
    });
}

// 프리셋 OAuth 드롭다운 토글
function togglePresetOAuthDropdown() {
    const dropdown = document.getElementById('preset-oauth-dropdown');
    if (dropdown.style.display === 'none') {
        renderPresetOAuthDropdown();
        dropdown.style.display = 'block';
        // 외부 클릭 시 닫기
        setTimeout(() => {
            document.addEventListener('click', closePresetOAuthDropdownOnOutside);
        }, 0);
    } else {
        dropdown.style.display = 'none';
        document.removeEventListener('click', closePresetOAuthDropdownOnOutside);
    }
}

function closePresetOAuthDropdownOnOutside(e) {
    const selector = document.getElementById('preset-oauth-selector');
    if (!selector.contains(e.target)) {
        document.getElementById('preset-oauth-dropdown').style.display = 'none';
        document.removeEventListener('click', closePresetOAuthDropdownOnOutside);
    }
}

// 프리셋 OAuth 계정 전환
async function switchPresetOAuthAccount(oauthFile) {
    if (oauthFile === currentPresetOAuthFile) {
        document.getElementById('preset-oauth-dropdown').style.display = 'none';
        return;
    }

    // 드롭다운 닫기
    document.getElementById('preset-oauth-dropdown').style.display = 'none';

    // 확인 메시지
    const account = presetOAuthAccounts.find(a => a.file === oauthFile);
    const accountName = account ? account.display : oauthFile;

    if (!confirm(`"${accountName}" 계정으로 전환하시겠습니까?\n\n구독 목록이 새로 로드됩니다.`)) {
        return;
    }

    try {
        // 로딩 표시
        const nameEl = document.getElementById('preset-oauth-name');
        if (nameEl) nameEl.textContent = '전환 중...';

        // OAuth 파일로 로그인 설정 (자동 로그인 시도)
        const result = await eel.login_with_preset_oauth(oauthFile, true)();

        if (!result.success) {
            alert('계정 전환 실패: ' + result.error);
            updatePresetOAuthDisplay();
            return;
        }

        if (result.autoLogin) {
            // 자동 로그인 성공
            currentPresetOAuthFile = oauthFile;
            updatePresetOAuthDisplay();

            // 구독 목록 초기화 및 새로 로드
            subscriptionsLoaded = false;
            currentSubscriptions = [];
            btnSearch.disabled = true;
            resultsSection.style.display = 'none';

            loadSubscriptions(true);
        } else if (result.needsLogin) {
            // 브라우저 로그인 필요
            if (nameEl) nameEl.textContent = '로그인 창에서 진행...';

            const loginResult = await eel.start_login_with_browser()();

            if (loginResult.success) {
                currentPresetOAuthFile = oauthFile;
                updatePresetOAuthDisplay();

                // 구독 목록 초기화 및 새로 로드
                subscriptionsLoaded = false;
                currentSubscriptions = [];
                btnSearch.disabled = true;
                resultsSection.style.display = 'none';

                loadSubscriptions(true);
            } else {
                alert('로그인 실패: ' + loginResult.error);
                updatePresetOAuthDisplay();
            }
        }
    } catch (e) {
        console.error('프리셋 OAuth 계정 전환 오류:', e);
        alert('계정 전환 중 오류가 발생했습니다.');
        updatePresetOAuthDisplay();
    }
}

// 프리셋 OAuth 선택기 이벤트 설정
function setupPresetOAuthSelectorEvents() {
    const current = document.getElementById('preset-oauth-current');
    if (current) {
        current.addEventListener('click', togglePresetOAuthDropdown);
    }
}

// ====================================
// 대화추출 탭 기능
// ====================================

let chatExtractFileContent = null;

function setupChatExtractTab() {
    const dropZone = document.getElementById('chat-extract-drop-zone');
    const fileInput = document.getElementById('chat-extract-file-input');
    const btnClear = document.getElementById('btn-clear-chat-extract-file');
    const btnExtract = document.getElementById('btn-extract-chat');
    const btnCopy = document.getElementById('btn-copy-chat-extract');
    const btnDownload = document.getElementById('btn-download-chat-extract');

    if (!dropZone) return;

    // 대화명 태그 클릭 이벤트 설정
    setupTargetNameTags();

    // 클릭 시 백엔드 파일 선택 대화상자 사용 (.txt, .docx 모두 지원)
    dropZone.addEventListener('click', async () => {
        try {
            const result = await eel.select_and_read_docx_file()();
            if (result.cancelled) return;
            if (!result.success) {
                alert('파일 읽기 실패: ' + result.error);
                return;
            }
            chatExtractFileContent = result.text;
            document.getElementById('chat-extract-drop-zone').style.display = 'none';
            document.getElementById('chat-extract-file-info').style.display = 'flex';
            document.getElementById('chat-extract-file-name').textContent = result.filename;
            document.getElementById('btn-extract-chat').disabled = false;
        } catch (err) {
            console.error('파일 처리 오류:', err);
            alert('파일 처리 중 오류가 발생했습니다.');
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) {
            const fileName = file.name.toLowerCase();
            if (fileName.endsWith('.docx')) {
                alert('Word 파일(.docx)은 클릭하여 파일 선택 대화상자에서 선택해주세요.');
                return;
            }
            if (fileName.endsWith('.txt')) {
                handleChatExtractFile(file);
            } else {
                alert('.txt 또는 .docx 파일만 지원합니다.');
            }
        }
    });

    // 파일 삭제 버튼
    btnClear.addEventListener('click', () => {
        clearChatExtractFile();
    });

    // 추출 버튼
    btnExtract.addEventListener('click', () => {
        extractChatMessages();
    });

    // 복사 버튼
    btnCopy.addEventListener('click', () => {
        const result = document.getElementById('chat-extract-result');
        if (result.value) {
            navigator.clipboard.writeText(result.value).then(() => {
                alert('클립보드에 복사되었습니다.');
            });
        }
    });

    // 다운로드 버튼
    btnDownload.addEventListener('click', () => {
        const result = document.getElementById('chat-extract-result');
        if (result.value) {
            const blob = new Blob([result.value], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = '추출된_대화.txt';
            a.click();
            URL.revokeObjectURL(url);
        }
    });
}

async function handleChatExtractFile(file) {
    const fileName = file.name.toLowerCase();

    // Word 파일인 경우 백엔드에서 처리
    if (fileName.endsWith('.docx')) {
        try {
            const result = await eel.select_and_read_docx_file()();

            if (result.cancelled) return;

            if (!result.success) {
                alert('파일 읽기 실패: ' + result.error);
                return;
            }

            chatExtractFileContent = result.text;

            // UI 업데이트
            document.getElementById('chat-extract-drop-zone').style.display = 'none';
            document.getElementById('chat-extract-file-info').style.display = 'flex';
            document.getElementById('chat-extract-file-name').textContent = result.filename;
            document.getElementById('btn-extract-chat').disabled = false;
        } catch (e) {
            console.error('Word 파일 처리 오류:', e);
            alert('Word 파일 처리 중 오류가 발생했습니다.');
        }
        return;
    }

    // txt 파일인 경우 기존 방식 사용
    const reader = new FileReader();
    reader.onload = (e) => {
        chatExtractFileContent = e.target.result;

        // UI 업데이트
        document.getElementById('chat-extract-drop-zone').style.display = 'none';
        document.getElementById('chat-extract-file-info').style.display = 'flex';
        document.getElementById('chat-extract-file-name').textContent = file.name;
        document.getElementById('btn-extract-chat').disabled = false;
    };
    reader.readAsText(file, 'UTF-8');
}

function clearChatExtractFile() {
    chatExtractFileContent = null;
    document.getElementById('chat-extract-file-input').value = '';
    document.getElementById('chat-extract-drop-zone').style.display = 'block';
    document.getElementById('chat-extract-file-info').style.display = 'none';
    document.getElementById('chat-extract-result').value = '';
    document.getElementById('chat-extract-stats').style.display = 'none';
    document.getElementById('btn-extract-chat').disabled = true;
    document.getElementById('btn-copy-chat-extract').disabled = true;
    document.getElementById('btn-download-chat-extract').disabled = true;
}

function setupTargetNameTags() {
    const input = document.getElementById('chat-extract-names-input');
    if (!input) return;

    input.addEventListener('input', () => {
        // 입력값 변경 시 파일이 있으면 자동 재추출
        if (chatExtractFileContent) {
            extractChatMessages();
        }
    });
}

function extractChatMessages() {
    if (!chatExtractFileContent) return;

    const lines = chatExtractFileContent.split('\n');
    const extractedMessages = [];
    let totalMessages = 0;
    let currentMessage = null;

    // 입력 필드에서 대화명 읽기
    const input = document.getElementById('chat-extract-names-input');
    let filterNames = [];

    if (input && input.value.trim()) {
        // 쉼표로 구분된 대화명 파싱
        filterNames = input.value
            .split(',')
            .map(name => name.trim())
            .filter(name => name.length > 0);
    }

    // 대화명이 입력되지 않으면 모든 대화 추출
    const filterEnabled = filterNames.length > 0;

    // 카카오톡 대화 형식: [대화명] [오전/오후 시:분] 메시지
    // 정규식: [대화명] [오전/오후 시:분] 형태 감지 (시간 형식을 더 엄격하게)
    const messagePattern = /^\[([^\]]+)\]\s*\[(오전|오후)\s*\d{1,2}:\d{2}\]\s*(.*)$/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(messagePattern);

        if (match) {
            // 새 메시지 시작
            // 이전 메시지가 있으면 저장
            if (currentMessage) {
                totalMessages++;
                if (!filterEnabled || filterNames.includes(currentMessage.name)) {
                    extractedMessages.push(currentMessage.content);
                }
            }

            const name = match[1];
            const content = match[3]; // match[2]는 오전/오후
            currentMessage = { name, content };
        } else if (currentMessage && line.trim() !== '') {
            // 이전 메시지의 연속 (여러 줄 메시지)
            // 대괄호로 시작하면 다른 형식의 메시지일 수 있으므로 무시
            // 시스템 메시지도 제외 (예: "님이 들어왔습니다" 등)
            if (!line.startsWith('[') &&
                !line.includes('님이 들어왔습니다') &&
                !line.includes('님이 나갔습니다') &&
                !line.includes('님을 초대했습니다') &&
                !line.includes('채팅방을 나갔습니다')) {
                currentMessage.content += '\n' + line;
            }
        }
    }

    // 마지막 메시지 처리
    if (currentMessage) {
        totalMessages++;
        if (!filterEnabled || filterNames.includes(currentMessage.name)) {
            extractedMessages.push(currentMessage.content);
        }
    }

    // 결과 표시
    const resultText = extractedMessages.join('\n\n---\n\n');
    document.getElementById('chat-extract-result').value = resultText;

    // 통계 표시
    document.getElementById('total-message-count').textContent = totalMessages;
    document.getElementById('extracted-message-count').textContent = extractedMessages.length;
    document.getElementById('chat-extract-stats').style.display = 'flex';

    // 버튼 활성화/비활성화
    if (extractedMessages.length > 0) {
        document.getElementById('btn-copy-chat-extract').disabled = false;
        document.getElementById('btn-download-chat-extract').disabled = false;
    } else {
        document.getElementById('btn-copy-chat-extract').disabled = true;
        document.getElementById('btn-download-chat-extract').disabled = true;
    }
}

// 페이지 로드 시 대화추출 탭 이벤트 설정
document.addEventListener('DOMContentLoaded', () => {
    setupChatExtractTab();
    setupTextMergeTab();
});

// ====================================
// 텍스트합치기 탭 기능
// ====================================

let textMergeFiles = []; // {name: string, content: string}[]

function setupTextMergeTab() {
    const dropZone = document.getElementById('text-merge-drop-zone');
    const fileInput = document.getElementById('text-merge-file-input');
    const btnSort = document.getElementById('btn-sort-files');
    const btnClearAll = document.getElementById('btn-clear-all-files');
    const btnMerge = document.getElementById('btn-merge-text');
    const btnCopy = document.getElementById('btn-copy-text-merge');
    const btnDownload = document.getElementById('btn-download-text-merge');

    if (!dropZone) return;

    // 클릭 시 백엔드 파일 선택 대화상자 사용 (.txt, .docx 모두 지원, 다중 선택)
    dropZone.addEventListener('click', async () => {
        try {
            const result = await eel.select_and_read_multiple_files()();
            if (result.cancelled) return;
            if (!result.success) {
                alert('파일 읽기 실패: ' + result.error);
                return;
            }
            result.files.forEach(file => {
                textMergeFiles.push({
                    name: file.name,
                    content: file.content
                });
            });
            if (result.errors && result.errors.length > 0) {
                alert('일부 파일 읽기 실패:\n' + result.errors.join('\n'));
            }
            renderTextMergeFileList();
            updateTextMergeUI();
        } catch (err) {
            console.error('파일 처리 오류:', err);
            alert('파일 처리 중 오류가 발생했습니다.');
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const allFiles = Array.from(e.dataTransfer.files);
        const hasDocx = allFiles.some(f => f.name.toLowerCase().endsWith('.docx'));

        if (hasDocx) {
            alert('Word 파일(.docx)은 클릭하여 파일 선택 대화상자에서 선택해주세요.');
            return;
        }

        const txtFiles = allFiles.filter(f => f.name.toLowerCase().endsWith('.txt'));
        if (txtFiles.length > 0) {
            handleTextMergeFiles(txtFiles);
        } else {
            alert('.txt 또는 .docx 파일만 지원합니다.');
        }
    });

    // 파일명 정렬 버튼
    btnSort.addEventListener('click', () => {
        textMergeFiles.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        renderTextMergeFileList();
    });

    // 전체 삭제 버튼
    btnClearAll.addEventListener('click', () => {
        clearAllTextMergeFiles();
    });

    // 합치기 버튼
    btnMerge.addEventListener('click', () => {
        mergeTextFiles();
    });

    // 복사 버튼
    btnCopy.addEventListener('click', () => {
        const result = document.getElementById('text-merge-result');
        if (result.value) {
            navigator.clipboard.writeText(result.value).then(() => {
                alert('클립보드에 복사되었습니다.');
            });
        }
    });

    // 다운로드 버튼
    btnDownload.addEventListener('click', () => {
        const result = document.getElementById('text-merge-result');
        if (result.value) {
            const blob = new Blob([result.value], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = '합쳐진_텍스트.txt';
            a.click();
            URL.revokeObjectURL(url);
        }
    });
}

async function handleTextMergeFiles(files) {
    // .docx 파일이 포함되어 있는지 확인
    const hasDocx = Array.from(files).some(f => f.name.toLowerCase().endsWith('.docx'));

    if (hasDocx) {
        // Word 파일이 포함되어 있으면 백엔드 API 사용
        try {
            const result = await eel.select_and_read_multiple_files()();

            if (result.cancelled) return;

            if (!result.success) {
                alert('파일 읽기 실패: ' + result.error);
                return;
            }

            // 파일 추가
            result.files.forEach(file => {
                textMergeFiles.push({
                    name: file.name,
                    content: file.content
                });
            });

            if (result.errors && result.errors.length > 0) {
                alert('일부 파일 읽기 실패:\n' + result.errors.join('\n'));
            }

            renderTextMergeFileList();
            updateTextMergeUI();
        } catch (e) {
            console.error('파일 처리 오류:', e);
            alert('파일 처리 중 오류가 발생했습니다.');
        }
        return;
    }

    // txt 파일만 있는 경우 기존 방식 사용
    const readPromises = Array.from(files).map(file => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                resolve({
                    name: file.name,
                    content: e.target.result
                });
            };
            reader.readAsText(file, 'UTF-8');
        });
    });

    Promise.all(readPromises).then(results => {
        textMergeFiles = textMergeFiles.concat(results);
        renderTextMergeFileList();
        updateTextMergeUI();
    });
}

function renderTextMergeFileList() {
    const container = document.getElementById('text-merge-file-list');
    const filesSection = document.getElementById('text-merge-files-section');
    const countBadge = document.getElementById('files-count-badge');
    const filesPerSet = parseInt(document.getElementById('files-per-set').value) || 3;

    if (textMergeFiles.length === 0) {
        filesSection.style.display = 'none';
        return;
    }

    filesSection.style.display = 'block';
    countBadge.textContent = `${textMergeFiles.length}개`;

    let html = '';
    textMergeFiles.forEach((file, index) => {
        // filesPerSet가 0이면 세트 구분 없이 표시
        if (filesPerSet > 0) {
            const setNumber = Math.floor(index / filesPerSet) + 1;
            const isSetStart = index % filesPerSet === 0;

            if (isSetStart) {
                html += `<div class="set-divider">━━━ 세트 ${setNumber} 시작 ━━━</div>`;
            }
        }

        html += `
            <div class="file-list-item" data-index="${index}">
                <span class="file-index">${index + 1}</span>
                <span class="file-name" title="${file.name}">${file.name}</span>
                <div class="file-actions">
                    <button onclick="moveTextMergeFile(${index}, -1)" ${index === 0 ? 'disabled' : ''}>↑</button>
                    <button onclick="moveTextMergeFile(${index}, 1)" ${index === textMergeFiles.length - 1 ? 'disabled' : ''}>↓</button>
                    <button class="btn-delete" onclick="removeTextMergeFile(${index})">삭제</button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function moveTextMergeFile(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= textMergeFiles.length) return;

    const temp = textMergeFiles[index];
    textMergeFiles[index] = textMergeFiles[newIndex];
    textMergeFiles[newIndex] = temp;

    renderTextMergeFileList();
}

function removeTextMergeFile(index) {
    textMergeFiles.splice(index, 1);
    renderTextMergeFileList();
    updateTextMergeUI();
}

function clearAllTextMergeFiles() {
    textMergeFiles = [];
    document.getElementById('text-merge-file-input').value = '';
    document.getElementById('text-merge-result').value = '';
    document.getElementById('text-merge-stats').style.display = 'none';
    renderTextMergeFileList();
    updateTextMergeUI();
}

function updateTextMergeUI() {
    const hasFiles = textMergeFiles.length > 0;
    document.getElementById('btn-merge-text').disabled = !hasFiles;

    const result = document.getElementById('text-merge-result').value;
    document.getElementById('btn-copy-text-merge').disabled = !result;
    document.getElementById('btn-download-text-merge').disabled = !result;
}

function mergeTextFiles() {
    if (textMergeFiles.length === 0) return;

    const filesPerSet = parseInt(document.getElementById('files-per-set').value);
    let resultText = '';
    let totalSets = 0;

    // filesPerSet가 0이면 세트 없이 파일마다 구분선
    if (filesPerSet === 0) {
        totalSets = textMergeFiles.length;  // 파일 개수 = 세트 개수

        textMergeFiles.forEach((file, index) => {
            resultText += '================================================================================\n';
            resultText += `[${index + 1}] ${file.name}\n`;
            resultText += '================================================================================\n\n';
            resultText += file.content.trim();
            resultText += '\n\n';
        });
    } else {
        // 기존 방식: filesPerSet 개씩 묶어서 세트로
        totalSets = Math.ceil(textMergeFiles.length / filesPerSet);

        for (let setIndex = 0; setIndex < totalSets; setIndex++) {
            const startIdx = setIndex * filesPerSet;
            const endIdx = Math.min(startIdx + filesPerSet, textMergeFiles.length);
            const setFiles = textMergeFiles.slice(startIdx, endIdx);

            // 세트 헤더
            resultText += '================================================================================\n';
            resultText += `[세트 ${setIndex + 1}]\n`;
            resultText += '================================================================================\n\n';

            // 세트 내 각 파일
            setFiles.forEach((file, fileIndex) => {
                resultText += `--- 파일 ${fileIndex + 1}: ${file.name} ---\n`;
                resultText += file.content.trim();
                resultText += '\n\n';
            });

            // 세트 간 구분 (마지막 세트가 아니면)
            if (setIndex < totalSets - 1) {
                resultText += '\n';
            }
        }
    }

    document.getElementById('text-merge-result').value = resultText.trim();

    // 통계 표시
    document.getElementById('merge-total-files').textContent = textMergeFiles.length;
    document.getElementById('merge-total-sets').textContent = filesPerSet === 0 ? '-' : totalSets;
    document.getElementById('text-merge-stats').style.display = 'flex';

    // 버튼 활성화
    document.getElementById('btn-copy-text-merge').disabled = false;
    document.getElementById('btn-download-text-merge').disabled = false;
}

// 세트당 파일 수 변경 시 목록 다시 렌더링
document.addEventListener('DOMContentLoaded', () => {
    const filesPerSetInput = document.getElementById('files-per-set');
    if (filesPerSetInput) {
        filesPerSetInput.addEventListener('change', () => {
            renderTextMergeFileList();
        });
    }
});

// ===== MP3추출 탭 기능 =====

// MP3추출 관련 전역 변수
let mp3MediaFiles = [];
let mp3OutputFolder = '';
let mp3SelectedModel = 'small';
let mp3ModelLoaded = false;
let mp3SuccessCount = 0;
let mp3ErrorCount = 0;

// MP3추출 탭 초기화
document.addEventListener('DOMContentLoaded', async () => {
    // MP3추출 탭 요소가 없으면 리턴
    if (!document.getElementById('tab-mp3-extract')) return;

    // 시스템 상태 확인
    await checkMp3SystemStatus();

    // 이벤트 리스너 설정
    setupMp3EventListeners();
});

// 시스템 상태 확인
async function checkMp3SystemStatus() {
    try {
        // FFmpeg 확인
        const hasFFmpeg = await eel.check_ffmpeg()();
        const ffmpegDot = document.getElementById('ffmpegDot');
        const ffmpegWarning = document.getElementById('ffmpegWarning');
        if (ffmpegDot) {
            ffmpegDot.classList.toggle('ok', hasFFmpeg);
        }
        if (ffmpegWarning) {
            ffmpegWarning.style.display = hasFFmpeg ? 'none' : 'block';
        }

        // Whisper 확인
        const hasWhisper = await eel.check_whisper()();
        const whisperDot = document.getElementById('whisperDot');
        const whisperWarning = document.getElementById('whisperWarning');
        const modelSection = document.getElementById('modelSection');
        if (whisperDot) {
            whisperDot.classList.toggle('ok', hasWhisper);
        }
        if (whisperWarning) {
            whisperWarning.style.display = hasWhisper ? 'none' : 'block';
        }
        if (modelSection && !hasWhisper) {
            modelSection.style.opacity = '0.5';
            modelSection.style.pointerEvents = 'none';
        }

        // Whisper가 설치되어 있으면 자동으로 base 모델 로드
        if (hasWhisper) {
            loadMp3WhisperModel();
        }
    } catch (e) {
        console.error('시스템 상태 확인 오류:', e);
    }
}

// 이벤트 리스너 설정
function setupMp3EventListeners() {
    // 모델 선택 버튼
    document.querySelectorAll('.mp3-model-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mp3-model-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            mp3SelectedModel = btn.dataset.model;
        });
    });

    // 모델 로드 버튼
    const btnLoadModel = document.getElementById('btnLoadModel');
    if (btnLoadModel) {
        btnLoadModel.addEventListener('click', loadMp3WhisperModel);
    }

    // 파일 선택 버튼
    const btnSelectMediaFiles = document.getElementById('btnSelectMediaFiles');
    if (btnSelectMediaFiles) {
        btnSelectMediaFiles.addEventListener('click', selectMp3MediaFiles);
    }

    // 폴더 선택 버튼
    const btnSelectMediaFolder = document.getElementById('btnSelectMediaFolder');
    if (btnSelectMediaFolder) {
        btnSelectMediaFolder.addEventListener('click', selectMp3MediaFolder);
    }

    // 초기화 버튼
    const btnClearMediaFiles = document.getElementById('btnClearMediaFiles');
    if (btnClearMediaFiles) {
        btnClearMediaFiles.addEventListener('click', clearMp3MediaFiles);
    }

    // 원본 폴더에 저장 체크박스
    const optSameFolder = document.getElementById('optSameFolder');
    if (optSameFolder) {
        optSameFolder.addEventListener('change', (e) => {
            const outputFolderSection = document.getElementById('outputFolderSection');
            if (outputFolderSection) {
                outputFolderSection.style.display = e.target.checked ? 'none' : 'flex';
            }
            updateMp3StartButton();
        });
    }

    // 출력 폴더 선택 버튼
    const btnSelectOutputFolder = document.getElementById('btnSelectOutputFolder');
    if (btnSelectOutputFolder) {
        btnSelectOutputFolder.addEventListener('click', selectMp3OutputFolder);
    }

    // 변환 시작 버튼
    const btnStartMediaProcessing = document.getElementById('btnStartMediaProcessing');
    if (btnStartMediaProcessing) {
        btnStartMediaProcessing.addEventListener('click', startMp3Processing);
    }

    // 폴더 열기 버튼
    const btnOpenOutputFolder = document.getElementById('btnOpenOutputFolder');
    if (btnOpenOutputFolder) {
        btnOpenOutputFolder.addEventListener('click', openMp3OutputFolder);
    }

    // 새로 시작 버튼
    const btnResetMedia = document.getElementById('btnResetMedia');
    if (btnResetMedia) {
        btnResetMedia.addEventListener('click', resetMp3Tab);
    }
}

// Whisper 모델 로드
async function loadMp3WhisperModel() {
    const btn = document.getElementById('btnLoadModel');
    const status = document.getElementById('modelLoadStatus');
    const dot = document.getElementById('modelDot');
    const text = document.getElementById('modelStatusText');

    if (btn) btn.disabled = true;
    if (status) {
        status.textContent = '로딩 중... (처음은 다운로드 필요)';
        status.className = 'mp3-load-status';
    }
    if (dot) dot.className = 'mp3-status-dot loading';

    try {
        const ok = await eel.load_whisper_model(mp3SelectedModel)();

        if (ok) {
            mp3ModelLoaded = true;
            if (status) {
                status.textContent = `${mp3SelectedModel} 로드됨`;
                status.className = 'mp3-load-status success';
            }
            if (dot) dot.className = 'mp3-status-dot ok';
            if (text) text.textContent = `${mp3SelectedModel} 로드됨`;
        } else {
            if (status) {
                status.textContent = '로드 실패';
                status.className = 'mp3-load-status error';
            }
            if (dot) dot.className = 'mp3-status-dot';
        }
    } catch (e) {
        console.error('모델 로드 오류:', e);
        if (status) {
            status.textContent = '오류 발생';
            status.className = 'mp3-load-status error';
        }
    }

    if (btn) btn.disabled = false;
    updateMp3StartButton();
}

// 파일 선택
async function selectMp3MediaFiles() {
    try {
        const selected = await eel.select_media_files()();
        if (selected && selected.length) {
            addMp3Files(selected);
        }
    } catch (e) {
        console.error('파일 선택 오류:', e);
    }
}

// 폴더 선택
async function selectMp3MediaFolder() {
    try {
        const folder = await eel.select_media_folder()();
        if (folder) {
            const files = await eel.get_media_files_from_folder(folder)();
            if (files && files.length) {
                addMp3Files(files);
            } else {
                alert('폴더에 미디어 파일이 없습니다.');
            }
        }
    } catch (e) {
        console.error('폴더 선택 오류:', e);
    }
}

// 출력 폴더 선택
async function selectMp3OutputFolder() {
    try {
        const folder = await eel.select_output_folder()();
        if (folder) {
            mp3OutputFolder = folder;
            const el = document.getElementById('outputFolderPath');
            if (el) {
                el.textContent = folder;
                el.classList.add('active');
            }
            updateMp3StartButton();
        }
    } catch (e) {
        console.error('출력 폴더 선택 오류:', e);
    }
}

// 파일 추가
function addMp3Files(fileList) {
    fileList.forEach(path => {
        if (!mp3MediaFiles.find(f => f.path === path)) {
            mp3MediaFiles.push({
                path: path,
                name: path.split(/[/\\]/).pop(),
                status: 'waiting',
                statusText: '대기'
            });
        }
    });
    renderMp3FileList();
    updateMp3StartButton();
}

// 파일 제거
function removeMp3File(index) {
    mp3MediaFiles.splice(index, 1);
    renderMp3FileList();
    updateMp3StartButton();
}

// 파일 초기화
function clearMp3MediaFiles() {
    mp3MediaFiles = [];
    renderMp3FileList();
    updateMp3StartButton();
}

// 파일 목록 렌더링
function renderMp3FileList() {
    const listEl = document.getElementById('mediaFileList');
    const countEl = document.getElementById('mediaFileCount');
    const progressListEl = document.getElementById('mediaProgressList');

    if (!listEl) return;

    if (mp3MediaFiles.length === 0) {
        listEl.innerHTML = '';
        if (countEl) countEl.textContent = '';
        if (progressListEl) progressListEl.innerHTML = '';
        return;
    }

    // 파일 목록 (왼쪽)
    listEl.innerHTML = mp3MediaFiles.map((f, i) => `
        <div class="mp3-file-item">
            <span class="mp3-file-name">📄 ${f.name}</span>
            <span class="mp3-file-status ${f.status}">${f.statusText}</span>
            ${f.status === 'waiting' ? `<span class="mp3-file-remove" onclick="removeMp3File(${i})">✕</span>` : ''}
        </div>
    `).join('');

    if (countEl) {
        countEl.textContent = `${mp3MediaFiles.length}개 파일`;
    }

    // 진행 목록 (오른쪽)
    if (progressListEl) {
        progressListEl.innerHTML = mp3MediaFiles.map(f => `
            <div class="mp3-file-item">
                <span class="mp3-file-name">📄 ${f.name}</span>
                <span class="mp3-file-status ${f.status}">${f.statusText}</span>
            </div>
        `).join('');
    }
}

// 시작 버튼 상태 업데이트
function updateMp3StartButton() {
    const btn = document.getElementById('btnStartMediaProcessing');
    if (!btn) return;

    const sameFolder = document.getElementById('optSameFolder')?.checked ?? true;
    const hasFiles = mp3MediaFiles.length > 0;
    const hasOutput = sameFolder || mp3OutputFolder;

    btn.disabled = !(hasFiles && hasOutput);
}

// 변환 시작
async function startMp3Processing() {
    const optTranscribe = document.getElementById('optTranscribe')?.checked ?? true;

    // 텍스트 변환이 체크되어 있고 모델이 로드되지 않은 경우
    if (optTranscribe && !mp3ModelLoaded) {
        await loadMp3WhisperModel();
        if (!mp3ModelLoaded) {
            alert('Whisper 모델 로드에 실패했습니다.');
            return;
        }
    }

    const options = {
        extract_mp3: document.getElementById('optExtractMp3')?.checked ?? true,
        transcribe: optTranscribe,
        bitrate: document.getElementById('optBitrate')?.value ?? '192',
        language: document.getElementById('optLanguage')?.value ?? 'ko',
        output_format: document.getElementById('optOutputFormat')?.value ?? 'txt',
        same_folder: document.getElementById('optSameFolder')?.checked ?? true
    };

    mp3SuccessCount = 0;
    mp3ErrorCount = 0;

    // UI 상태 변경
    document.getElementById('btnStartMediaProcessing').disabled = true;
    document.getElementById('mediaCompleteSection').style.display = 'none';
    document.getElementById('mediaProgressBar').style.width = '0%';
    document.getElementById('mediaProgressBar').textContent = '0%';
    document.getElementById('mediaProgressText').textContent = '처리 시작...';

    try {
        await eel.start_media_processing(mp3MediaFiles.map(f => f.path), mp3OutputFolder, options)();
    } catch (e) {
        console.error('처리 시작 오류:', e);
        alert('처리 중 오류가 발생했습니다.');
        document.getElementById('btnStartMediaProcessing').disabled = false;
    }
}

// Python에서 호출하는 진행 상황 업데이트 함수
eel.expose(update_media_progress);
function update_media_progress(current, total, filename, status, statusText) {
    const pct = Math.round((current / total) * 100);

    const progressBar = document.getElementById('mediaProgressBar');
    const progressText = document.getElementById('mediaProgressText');

    if (progressBar) {
        progressBar.style.width = pct + '%';
        progressBar.textContent = pct + '%';
    }
    if (progressText) {
        progressText.textContent = `${current}/${total} - ${filename}: ${statusText}`;
    }

    // 파일 상태 업데이트
    const idx = mp3MediaFiles.findIndex(f => f.name === filename);
    if (idx !== -1) {
        mp3MediaFiles[idx].status = status;
        mp3MediaFiles[idx].statusText = statusText;
        renderMp3FileList();
    }

    if (status === 'done') mp3SuccessCount++;
    if (status === 'error') mp3ErrorCount++;
}

// Python에서 호출하는 처리 완료 함수
eel.expose(media_processing_complete);
function media_processing_complete() {
    document.getElementById('mediaProgressText').textContent = '완료!';
    document.getElementById('mediaCompleteSection').style.display = 'block';
    document.getElementById('mediaCompleteMsg').textContent = `성공: ${mp3SuccessCount}개 / 실패: ${mp3ErrorCount}개`;
    document.getElementById('btnStartMediaProcessing').disabled = false;
}

// 출력 폴더 열기
async function openMp3OutputFolder() {
    try {
        const sameFolder = document.getElementById('optSameFolder')?.checked ?? true;
        let folder = mp3OutputFolder;

        if (sameFolder && mp3MediaFiles.length > 0) {
            const path = mp3MediaFiles[0].path;
            const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
            folder = path.substring(0, idx);
        }

        if (folder) {
            await eel.open_folder_in_explorer(folder)();
        }
    } catch (e) {
        console.error('폴더 열기 오류:', e);
    }
}

// MP3 탭 초기화
function resetMp3Tab() {
    mp3MediaFiles = [];
    mp3SuccessCount = 0;
    mp3ErrorCount = 0;

    renderMp3FileList();

    document.getElementById('mediaCompleteSection').style.display = 'none';
    document.getElementById('mediaProgressBar').style.width = '0%';
    document.getElementById('mediaProgressBar').textContent = '0%';
    document.getElementById('mediaProgressText').textContent = '파일을 선택하세요';

    updateMp3StartButton();
}

// ========== PDF 도구 탭 ==========

// PDF 상태 변수
let pdfFiles = [];
let pdfSelectedIndex = -1;
let pdfMode = 'merge'; // 'merge' or 'extract'
let pdfOutputFolder = '';

// 모드 변경
function pdfSetMode(mode) {
    pdfMode = mode;

    // 버튼 활성화 상태 변경
    document.querySelectorAll('.pdf-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // 합치기 모드일 때만 파일명 입력 표시
    const nameSection = document.getElementById('pdfMergeNameSection');
    if (nameSection) {
        nameSection.style.display = mode === 'merge' ? 'flex' : 'none';
    }

    pdfLog(`모드 변경: ${mode === 'merge' ? 'PDF 합치기' : '텍스트 추출'}`, 'info');
}

// 파일 선택
async function pdfSelectFiles() {
    try {
        const result = await eel.pdf_select_files()();
        if (result.success && result.files.length > 0) {
            result.files.forEach(file => {
                if (!pdfFiles.find(f => f.path === file.path)) {
                    pdfFiles.push(file);
                }
            });
            pdfRenderFileList();
            pdfLog(`${result.files.length}개 파일 추가됨`, 'success');
        }
    } catch (e) {
        console.error('파일 선택 오류:', e);
        pdfLog('파일 선택 중 오류 발생', 'error');
    }
}

// 폴더 선택
async function pdfSelectFolder() {
    try {
        const result = await eel.pdf_select_folder()();
        if (result.success && result.files.length > 0) {
            result.files.forEach(file => {
                if (!pdfFiles.find(f => f.path === file.path)) {
                    pdfFiles.push(file);
                }
            });
            pdfRenderFileList();
            pdfLog(`폴더에서 ${result.files.length}개 PDF 파일 발견`, 'success');
        } else if (result.files && result.files.length === 0) {
            pdfLog('폴더에 PDF 파일이 없습니다', 'info');
        }
    } catch (e) {
        console.error('폴더 선택 오류:', e);
        pdfLog('폴더 선택 중 오류 발생', 'error');
    }
}

// 파일 목록 초기화
function pdfClearFiles() {
    pdfFiles = [];
    pdfSelectedIndex = -1;
    pdfRenderFileList();
    pdfLog('파일 목록 초기화됨', 'info');
}

// 파일 목록 렌더링
function pdfRenderFileList() {
    const container = document.getElementById('pdfFileList');
    const countEl = document.getElementById('pdfFileCount');
    const actionsEl = document.getElementById('pdfFileActions');
    const executeBtn = document.getElementById('btnPdfExecute');

    if (pdfFiles.length === 0) {
        container.innerHTML = '<div class="pdf-empty-msg">PDF 파일을 선택해주세요</div>';
        countEl.textContent = '';
        actionsEl.style.display = 'none';
        executeBtn.disabled = true;
        return;
    }

    container.innerHTML = pdfFiles.map((file, idx) => `
        <div class="pdf-file-item ${idx === pdfSelectedIndex ? 'selected' : ''}"
             onclick="pdfSelectFile(${idx})">
            <span class="pdf-file-icon">📄</span>
            <span class="pdf-file-name" title="${file.path}">${file.name}</span>
            <span class="pdf-file-size">${formatFileSize(file.size)}</span>
        </div>
    `).join('');

    countEl.textContent = `총 ${pdfFiles.length}개 파일`;
    actionsEl.style.display = 'flex';
    executeBtn.disabled = false;
}

// 파일 선택
function pdfSelectFile(idx) {
    pdfSelectedIndex = pdfSelectedIndex === idx ? -1 : idx;
    pdfRenderFileList();
}

// 위로 이동
function pdfMoveUp() {
    if (pdfSelectedIndex <= 0) return;

    const temp = pdfFiles[pdfSelectedIndex];
    pdfFiles[pdfSelectedIndex] = pdfFiles[pdfSelectedIndex - 1];
    pdfFiles[pdfSelectedIndex - 1] = temp;
    pdfSelectedIndex--;
    pdfRenderFileList();
}

// 아래로 이동
function pdfMoveDown() {
    if (pdfSelectedIndex < 0 || pdfSelectedIndex >= pdfFiles.length - 1) return;

    const temp = pdfFiles[pdfSelectedIndex];
    pdfFiles[pdfSelectedIndex] = pdfFiles[pdfSelectedIndex + 1];
    pdfFiles[pdfSelectedIndex + 1] = temp;
    pdfSelectedIndex++;
    pdfRenderFileList();
}

// 선택 항목 삭제
function pdfRemoveSelected() {
    if (pdfSelectedIndex < 0) return;

    pdfFiles.splice(pdfSelectedIndex, 1);
    pdfSelectedIndex = -1;
    pdfRenderFileList();
}

// 출력 폴더 토글
function pdfToggleOutputFolder() {
    const checked = document.getElementById('pdfSameFolder').checked;
    document.getElementById('pdfOutputSection').style.display = checked ? 'none' : 'flex';
}

// 출력 폴더 선택
async function pdfSelectOutputFolder() {
    try {
        const result = await eel.pdf_select_output_folder()();
        if (result.success && result.folder) {
            pdfOutputFolder = result.folder;
            document.getElementById('pdfOutputPath').textContent = result.folder;
        }
    } catch (e) {
        console.error('출력 폴더 선택 오류:', e);
    }
}

// 로그 출력
function pdfLog(message, type = '') {
    const logContainer = document.getElementById('pdfLog');
    const logItem = document.createElement('div');
    logItem.className = `pdf-log-item ${type}`;
    logItem.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContainer.appendChild(logItem);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// 진행률 업데이트
function pdfUpdateProgress(percent, text) {
    const bar = document.getElementById('pdfProgressBar');
    const textEl = document.getElementById('pdfProgressText');

    bar.style.width = `${percent}%`;
    bar.textContent = `${percent}%`;
    if (text) textEl.textContent = text;
}

// 실행
async function pdfExecute() {
    if (pdfFiles.length === 0) {
        alert('PDF 파일을 선택해주세요.');
        return;
    }

    // 출력 폴더 결정
    let outputFolder = pdfOutputFolder;
    const sameFolder = document.getElementById('pdfSameFolder').checked;

    if (sameFolder && pdfFiles.length > 0) {
        const path = pdfFiles[0].path;
        const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        outputFolder = path.substring(0, idx);
    }

    if (!outputFolder) {
        alert('출력 폴더를 선택해주세요.');
        return;
    }

    const filePaths = pdfFiles.map(f => f.path);

    document.getElementById('btnPdfExecute').disabled = true;
    document.getElementById('pdfCompleteSection').style.display = 'none';

    pdfUpdateProgress(0, '처리 중...');

    try {
        if (pdfMode === 'merge') {
            // PDF 합치기
            const outputName = document.getElementById('pdfOutputName').value.trim() || 'merged.pdf';
            pdfLog(`PDF 합치기 시작: ${pdfFiles.length}개 파일`, 'info');

            const result = await eel.pdf_merge_files(filePaths, outputFolder, outputName)();

            if (result.success) {
                pdfUpdateProgress(100, '완료!');
                pdfLog(`합치기 완료: ${result.output_path}`, 'success');
                pdfShowComplete(`${pdfFiles.length}개 PDF가 하나로 합쳐졌습니다.`);
                pdfOutputFolder = outputFolder;
            } else {
                pdfLog(`오류: ${result.error}`, 'error');
                pdfUpdateProgress(0, '오류 발생');
            }
        } else {
            // 텍스트 추출
            pdfLog(`텍스트 추출 시작: ${pdfFiles.length}개 파일`, 'info');

            let successCount = 0;
            for (let i = 0; i < filePaths.length; i++) {
                const file = pdfFiles[i];
                const percent = Math.round(((i + 1) / filePaths.length) * 100);

                pdfUpdateProgress(percent, `${i + 1}/${filePaths.length} 처리 중...`);
                pdfLog(`처리 중: ${file.name}`, 'info');

                const result = await eel.pdf_extract_text(file.path, outputFolder)();

                if (result.success) {
                    pdfLog(`완료: ${file.name} → ${result.output_name}`, 'success');
                    successCount++;
                } else {
                    pdfLog(`실패: ${file.name} - ${result.error}`, 'error');
                }
            }

            pdfUpdateProgress(100, '완료!');
            pdfLog(`텍스트 추출 완료: ${successCount}/${pdfFiles.length}개 성공`, 'success');
            pdfShowComplete(`${successCount}개 파일에서 텍스트가 추출되었습니다.`);
            pdfOutputFolder = outputFolder;
        }
    } catch (e) {
        console.error('PDF 처리 오류:', e);
        pdfLog(`오류: ${e.message || e}`, 'error');
        pdfUpdateProgress(0, '오류 발생');
    }

    document.getElementById('btnPdfExecute').disabled = false;
}

// 완료 표시
function pdfShowComplete(message) {
    document.getElementById('pdfCompleteMsg').textContent = message;
    document.getElementById('pdfCompleteSection').style.display = 'block';
}

// 폴더 열기
async function pdfOpenOutputFolder() {
    if (pdfOutputFolder) {
        await eel.open_folder_in_explorer(pdfOutputFolder)();
    }
}

// 초기화
function pdfReset() {
    pdfFiles = [];
    pdfSelectedIndex = -1;
    pdfOutputFolder = '';

    pdfRenderFileList();
    document.getElementById('pdfLog').innerHTML = '';
    document.getElementById('pdfCompleteSection').style.display = 'none';
    pdfUpdateProgress(0, '파일을 선택하세요');
    pdfLog('초기화됨', 'info');
}

// 파일 크기 포맷
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ============================================================================
// 썸네일 PDF 내보내기
// ============================================================================

// PDF 생성 진행률 업데이트 (Python에서 호출)
eel.expose(updatePdfProgress);
function updatePdfProgress(message, percent) {
    const container = document.getElementById('pdf-progress-container');
    const progressBar = document.getElementById('pdf-progress-bar');
    const progressText = document.getElementById('pdf-progress-text');
    const progressPercent = document.getElementById('pdf-progress-percent');

    if (container) container.style.display = 'block';
    if (progressBar) progressBar.style.width = percent + '%';
    if (progressText) progressText.textContent = message;
    if (progressPercent) progressPercent.textContent = percent + '%';
}

async function exportThumbnailsToPDF() {
    try {
        // 현재 표시된 영상들에서 썸네일 URL 수집
        const thumbnailUrls = [];

        // filteredResults에서 썸네일 URL 추출
        if (!filteredResults || filteredResults.length === 0) {
            alert('출력할 영상이 없습니다.');
            return;
        }

        // 썸네일 URL 수집
        for (const video of filteredResults) {
            if (video.thumbnail) {
                thumbnailUrls.push(video.thumbnail);
            }
        }

        if (thumbnailUrls.length === 0) {
            alert('썸네일이 없습니다.');
            return;
        }

        // 확인 메시지
        const confirmed = confirm(`${thumbnailUrls.length}개의 썸네일을 PDF로 출력하시겠습니까?\n\n바탕화면에 PDF 파일이 생성됩니다.`);
        if (!confirmed) return;

        // 버튼 비활성화
        const btn = document.getElementById('btn-export-pdf');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '⏳ 생성 중...';

        // 진행률 바 초기화 및 표시
        const progressContainer = document.getElementById('pdf-progress-container');
        if (progressContainer) progressContainer.style.display = 'block';
        updatePdfProgress('PDF 생성 준비 중...', 0);

        // PDF 생성 요청
        console.log(`[PDF] ${thumbnailUrls.length}개 썸네일 PDF 생성 요청`);
        const result = await eel.export_thumbnails_to_pdf(thumbnailUrls)();

        // 진행률 바 숨기기
        if (progressContainer) progressContainer.style.display = 'none';

        // 버튼 복원
        btn.disabled = false;
        btn.innerHTML = originalText;

        if (result.success) {
            alert(`PDF 생성 완료!\n\n파일: ${result.output_path}\n썸네일: ${result.thumbnail_count}개`);

            // 폴더 열기
            const openFolder = confirm('바탕화면 폴더를 열까요?');
            if (openFolder) {
                const desktop = result.output_path.substring(0, result.output_path.lastIndexOf('\\'));
                await eel.open_folder_in_explorer(desktop)();
            }
        } else {
            alert(`PDF 생성 실패\n\n${result.error}`);
        }

    } catch (error) {
        console.error('[PDF] 생성 오류:', error);
        alert(`PDF 생성 중 오류가 발생했습니다.\n\n${error}`);

        // 진행률 바 숨기기
        const progressContainer = document.getElementById('pdf-progress-container');
        if (progressContainer) progressContainer.style.display = 'none';

        // 버튼 복원
        const btn = document.getElementById('btn-export-pdf');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '📄 PDF';
        }
    }
}
