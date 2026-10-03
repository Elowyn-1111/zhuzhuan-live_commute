const DATA = window.HOME_DATA;

const state = {
  view: 'commute',
  city: '上海', metroReady: false, communityCoverage: '',
  commute: { query: '', minMinutes: 5, maxMinutes: 30, preferred: new Set(), sort: 'asc', matches: [], transfers: 1, forbidden: new Set(), selectedStations: [] },
  homes: { selectedStationIds: [], walkMin: 0, walk: 30, cycleMin: 0, cycle: 15, sort: 'walk-asc', query: '', selectedCommunity: null },
  notes: { region: '全部区域', line: '全部地铁线', layout: '全部户型', maxRent: 7000 },
  favorites: loadLocalFavorites(),
  stations: DATA.stations,
  communities: DATA.communities,
  communityPois: [],
  communityReviews: [],
  communityTab: 'pois',
  routeOrigin: null,
  routeLoading: false,
  apiAvailable: false,
  user: null,
  isAdmin: false,
  remoteNotes: null,
  amap: { map: null, ready: false, config: null }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const leftRail = $('#left-rail');
const rightRail = $('#right-rail');
const mapStage = $('#map-stage');
const demoMap = $('#demo-map');
const notesView = $('#notes-view');
const markerLayer = document.createElement('div');
markerLayer.className = 'map-marker-layer';
mapStage.appendChild(markerLayer);
let toastTimer;

function emptyFavorites() { return { stations: [], communities: [], notes: [] }; }
function favoriteStorageKey(user = state.user) { return user ? `zhuzhuan-favorites:${user.id}` : 'zhuzhuan-favorites:guest'; }
function loadLocalFavorites() {
  try {
    const value = JSON.parse(localStorage.getItem('zhuzhuan-favorites:guest') || localStorage.getItem('zhuzhuan-favorites') || '{}');
    return Object.fromEntries(['stations', 'communities', 'notes'].map(key => [key, Array.isArray(value[key]) ? value[key].filter(item => typeof item === 'string') : []]));
  }
  catch { return emptyFavorites(); }
}
function setActiveUser(user) {
  saveFavorites();
  state.user = user;
  state.isAdmin = Boolean(user?.isAdmin);
  try { state.favorites = JSON.parse(localStorage.getItem(favoriteStorageKey(user)) || JSON.stringify(emptyFavorites())); }
  catch { state.favorites = emptyFavorites(); }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`/api/${path}`, {
    credentials: 'include',
    headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error || `请求失败（${response.status}）`); error.status = response.status; throw error; }
  if (payload.status === '0') throw new Error(payload.info || '地图服务暂时不可用。');
  return payload;
}

async function uploadMedia(file) {
  const form = new FormData(); form.append('file', file);
  return api('media', { method: 'POST', body: form });
}

function saveFavorites() {
  localStorage.setItem(favoriteStorageKey(), JSON.stringify(state.favorites));
  $('#favorite-count').textContent = Object.values(state.favorites).reduce((sum, list) => sum + list.length, 0);
}

function isFavorite(type, id) { return state.favorites[type].includes(id); }

async function toggleFavorite(type, id) {
  if (state.user && !state.apiAvailable) { showToast('服务不可用，收藏未保存'); return; }
  const remove = isFavorite(type, id);
  try {
    if (state.user) await (remove ? api(`favorites/${type}/${encodeURIComponent(id)}`, { method: 'DELETE' }) : api('favorites', { method: 'POST', body: JSON.stringify({ itemType: type, itemId: id }) }));
    const list = state.favorites[type];
    const index = list.indexOf(id);
    if (remove && index >= 0) list.splice(index, 1);
    if (!remove && index < 0) list.push(id);
    saveFavorites(); renderAll();
    showToast(state.user ? '收藏已保存到本机访客身份' : '已更新本机收藏');
  } catch (error) { showToast(`收藏未保存：${error.message}`); }
}

function icon(name) {
  if (name === 'heart') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.9c0 5-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.9A4.3 4.3 0 0 1 11 6.2a4.3 4.3 0 0 1 9.8 2.7Z"/></svg>';
  if (name === 'share') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="m8.1 10.8 7.7-4.4M8.1 13.2l7.7 4.4"/></svg>';
  return '';
}

function filteredStations() {
  return state.stations.filter(station => {
    const forbidden = (station.routeLines || []).some(line => [...state.commute.forbidden].some(blocked => line === blocked));
    return station.minutes >= state.commute.minMinutes && station.minutes <= state.commute.maxMinutes && (state.commute.transfers === 3 || station.transfers <= state.commute.transfers) && !forbidden;
  }).sort((a,b) => {const priority=station=>station.lines.some(line=>state.commute.preferred.has(line))?0:1;return priority(a)-priority(b)+(priority(a)===priority(b)?(state.commute.sort==='desc'?-1:1)*(a.minutes-b.minutes):0);});
}

function filteredCommunities() {
  const query = state.homes.query.trim().toLowerCase();
  const selectedNames = state.homes.selectedStationIds.map(id => state.stations.find(station => station.id === id)?.name);
  return state.communities.filter(item => (!query || item.name.toLowerCase().includes(query) || String(item.layout || '').toLowerCase().includes(query)) && item.walk >= state.homes.walkMin && item.walk <= state.homes.walk && item.cycle >= state.homes.cycleMin && item.cycle <= state.homes.cycle && (!selectedNames.length || selectedNames.includes(item.station))).sort((a,b)=>{const [field,direction]=state.homes.sort.split('-');return (direction==='desc'?-1:1)*(a[field]-b[field]);});
}

function renderAll() {
  saveFavorites();
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
  if (state.view === 'notes') renderNotesView();
  else if (state.view === 'favorites') renderFavoritesView();
  else renderCommuteView();
}

function renderCommuteView() {
  mapStage.classList.remove('notes-active');
  notesView.hidden = true;
  $('#map-canvas').style.display = '';
  document.body.dataset.step = state.homes.selectedStationIds.length ? 'homes' : 'commute';
  $('#journey-step').textContent = state.homes.selectedStationIds.length ? '02 / 小区与生活' : '01 / 我的通勤圈';
  leftRail.innerHTML = state.homes.selectedStationIds.length ? renderHomeFilters() : renderCommuteFilters();
  rightRail.innerHTML = state.homes.selectedStationIds.length ? renderCommunityRail() : renderStationRail();
  renderDemoMarkers();
  updateMapLabels();
  bindCommuteActions();
  bindCommonActions();
}

function renderCommuteFilters() {
  const lines = [...new Set(metroLines.map(line => line.name))];
  return `<div class="panel-inner"><div class="panel-header"><div><div class="eyebrow">STEP 01 · COMMUTE</div><h1>先找到你的通勤圈</h1><p class="panel-subtitle">输入工作地点，筛出适合你的地铁站。</p></div><span class="step-tag">通勤找房</span></div><label class="field-label" for="work-query">工作地点 <span class="field-hint">建议写站点或地标</span></label><div class="input-wrap"><span class="search-glyph">⌕</span><input id="work-query" value="${escapeHtml(state.commute.query || '')}" placeholder="例如：静安寺站 / 上海环球港" /></div><div id="work-results">${state.commute.matches.map((place,index)=>`<button class="search-result" data-work-place="${index}"><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(typeof place.address==='string'?place.address:'')}</small></button>`).join('')}</div><label class="field-label">地铁通勤时间范围</label><div class="time-range"><label>最少<input id="min-time" type="number" min="0" max="120" step="5" value="${state.commute.minMinutes}" aria-label="最短通勤分钟" /></label><span>—</span><label>最多<input id="max-time" type="number" min="0" max="120" step="5" value="${state.commute.maxMinutes}" aria-label="最长通勤分钟" /></label><span>分钟</span></div><label class="field-label">优先显示的地铁线 <span class="field-hint">可多选，其他线路仍保留</span></label><div class="line-chips">${lines.map(line=>`<button class="line-chip ${state.commute.preferred.has(line)?'active':''}" data-preferred-line="${escapeHtml(line)}">${escapeHtml(line)}</button>`).join('')}</div><label class="field-label">最多换乘次数</label><div class="segmented" id="transfer-options">${[0, 1, 2, 3].map(item => `<button class="segment ${state.commute.transfers === item ? 'active' : ''}" data-transfers="${item}">${item === 3 ? '不限' : `${item} 次`}</button>`).join('')}</div><label class="field-label">不乘坐的线路 <span class="field-hint">可多选</span></label><div class="line-chips">${lines.map((line, index) => `<button class="line-chip ${state.commute.forbidden.has(line) ? 'active' : ''}" data-forbidden-line="${line}"><span class="line-dot" style="--line-color:${['#d38b6a', '#75a6bb', '#65a883', '#d0a150', '#7c9ec5', '#d386a0'][index % 6]}"></span>${line}</button>`).join('')}</div><button class="button-primary button-block" id="find-stations">查看符合条件的站点 <span>→</span></button><div class="soft-callout"><strong>◎</strong><span>地铁通勤时间由线路距离、步行接驳和换乘估算，不包含公交；实际以运营时刻为准。</span></div></div>`;
}

function renderStationRail() {
  const stations = filteredStations();
  const group = (title, rows) => rows.length ? `<div class="group-title">${title}</div>${rows.map(renderStationRow).join('')}` : '';
  return `<div class="station-summary"><div><div class="eyebrow">MATCHED STATIONS</div><div class="summary-title">地铁站</div></div><span class="summary-count">${stations.length} 个符合</span></div><div class="sort-bar"><label for="station-sort">时长排序</label><select id="station-sort"><option value="asc" ${state.commute.sort==='asc'?'selected':''}>从短到长</option><option value="desc" ${state.commute.sort==='desc'?'selected':''}>从长到短</option></select></div><div class="station-groups">${stations.map(renderStationRow).join('')}${!stations.length ? '<div class="empty-state">暂时没有符合条件的站点<br>可以放宽通勤时间或换乘次数</div>' : ''}</div><div class="station-actions"><button class="button-primary" id="continue-to-homes" ${state.commute.selectedStations.length ? '' : 'disabled'}>选好啦，去看小区 <span>→</span></button><p class="station-actions-note">已选择 ${state.commute.selectedStations.length} / 3 个站点</p></div>`;
}

function renderStationRow(station) {
  const selected = state.commute.selectedStations.includes(station.id);
  const minutes = Number.isFinite(station.minutes) ? station.minutes : '—';
  return `<button class="station-row ${selected ? 'selected' : ''}" data-station-id="${escapeHtml(station.id)}"><span class="station-radio">${selected ? '✓' : ''}</span><span class="station-copy"><span class="station-name">${escapeHtml(station.name)}</span><span class="station-line">${escapeHtml(station.line)}</span></span><span class="station-time">${Number.isFinite(station.minutes) ? `约 ${minutes} min` : '待查'}<small>${station.transfers ? `${station.transfers} 次换乘` : '直达'}</small></span></button>`;
}

function renderHomeFilters() {
  const selectedNames = state.homes.selectedStationIds.map(id => state.stations.find(item => item.id === id)?.name).join('、');
  return `<div class="panel-inner"><div class="panel-header"><div><div class="eyebrow">STEP 02 · HOME</div><h1>在通勤圈里挑小区</h1><p class="panel-subtitle">读取所选地铁站周边 2.5 公里的住宅小区。</p></div><span class="step-tag">${state.homes.selectedStationIds.length} 个站点</span></div><div class="soft-callout"><strong>⌖</strong><span>已锁定：${selectedNames}</span></div><label class="field-label">小区 / 关键词</label><div class="input-wrap"><span class="search-glyph">⌕</span><input id="community-query" value="${escapeHtml(state.homes.query)}" placeholder="搜索小区名称" /></div><label class="field-label">步行到地铁范围</label><div class="time-range"><label>最少<input id="walk-min" type="number" min="0" max="60" value="${state.homes.walkMin}" aria-label="最短步行分钟" /></label><span>—</span><label>最多<input id="walk-time" type="number" min="0" max="60" value="${state.homes.walk}" aria-label="最长步行分钟" /></label><span>分钟</span></div><label class="field-label">骑行到地铁范围</label><div class="time-range"><label>最少<input id="cycle-min" type="number" min="0" max="60" value="${state.homes.cycleMin}" aria-label="最短骑行分钟" /></label><span>—</span><label>最多<input id="cycle-time" type="number" min="0" max="60" value="${state.homes.cycle}" aria-label="最长骑行分钟" /></label><span>分钟</span></div><button class="button-secondary button-block" id="back-to-stations">← 重新选择地铁站</button><div class="soft-callout"><strong>◎</strong><span>小区点位大小代表小区规模。点击点位或右侧列表，查看周边配套和口碑。</span></div></div>`;
}

function renderCommunityRail() {
  const communities = filteredCommunities();
  return `<div class="station-summary"><div><div class="eyebrow">STEP 02 · COMMUNITIES</div><div class="summary-title">附近小区</div></div><span class="summary-count">${communities.length} 个结果</span></div><div class="sort-bar"><label for="community-sort">时长排序</label><select id="community-sort">${[['walk-asc','步行：从短到长'],['walk-desc','步行：从长到短'],['cycle-asc','骑行：从短到长'],['cycle-desc','骑行：从长到短']].map(([value,label])=>`<option value="${value}" ${state.homes.sort===value?'selected':''}>${label}</option>`).join('')}</select></div><div class="guest-note" style="padding:12px 20px">${escapeHtml(state.communityCoverage)}${state.communityHasMore ? `<button class="button-secondary button-block" id="load-more-communities" ${state.communityLoading ? 'disabled' : ''}>继续读取小区</button>` : ''}</div><div class="community-list">${communities.map((item, index) => renderCommunityCard(item, index)).join('') || '<div class="empty-state">暂未显示小区<br>请查看查询状态，或放宽步行和骑行时间</div>'}</div>`;
}

function renderCommunityCard(item, index) {
  const saved = isFavorite('communities', item.id);
  return `<article class="community-card ${state.homes.selectedCommunity === item.id ? 'active' : ''}" data-community-id="${escapeHtml(item.id)}"><div class="community-card-top"><span class="community-rank">0${index + 1}</span><div class="community-name-wrap"><h3 class="community-name">${escapeHtml(item.name)}</h3><p class="community-meta">${escapeHtml(item.station || '附近地铁')} · ${item.area ? `${item.area}㎡` : '面积暂无资料'} · ${escapeHtml(item.layout || '户型暂无资料')}</p></div>${item.price == null ? '' : `<span class="community-price">¥${item.price}<small>/月</small></span>`}</div><div class="community-tags"><span class="mini-tag">步行约 ${item.walk ?? '—'} min</span><span class="mini-tag">骑行约 ${item.cycle ?? '—'} min</span><span class="mini-tag community-review">${item.reviews ? `★ ${item.reviews}` : '暂无评价'}</span>${item.source === 'demo' ? '<span class="mini-tag source-demo">演示数据</span>' : '<span class="mini-tag source-live">高德住宅小区</span>'}</div><div class="card-actions"><button class="icon-button ${saved ? 'saved' : ''}" title="${saved ? '取消收藏' : '收藏小区'}" data-favorite="communities" data-favorite-id="${escapeHtml(item.id)}">${icon('heart')}</button><button class="icon-button" title="分享小区" data-share="${escapeHtml(item.name)}">${icon('share')}</button><span class="text-button">查看周边 →</span></div></article>`;
}

function renderCommunityDetails(item) {
  const tabs = `<div class="detail-tabs"><button class="detail-tab ${state.communityTab === 'pois' ? 'active' : ''}" data-community-tab="pois">周边配套</button><button class="detail-tab ${state.communityTab === 'reviews' ? 'active' : ''}" data-community-tab="reviews">本站评价</button></div>`;
  if (state.communityTab === 'reviews') {
    const reviews = state.communityReviews;
    const average = reviews.length ? (reviews.reduce((sum, row) => sum + Number(row.rating), 0) / reviews.length).toFixed(1) : '暂无';
    return `${tabs}<div class="detail-review"><div class="rating-big"><strong>${average}</strong><span>${reviews.length ? `${reviews.length} 条本站评价` : '尚无本站评价'}</span></div>${reviews.map(review => `<p class="review-quote">“${escapeHtml(review.body)}” <span class="review-source">${escapeHtml(review.source || '用户评价')}</span></p>`).join('') || '<p class="review-quote">目前还没有用户评价。</p>'}<button class="button-secondary button-block" id="write-review" ${state.user ? '' : 'disabled'}>写一条评价</button>${!state.user ? '<div class="disclaimer">登录后可以提交本站评价。</div>' : ''}</div><div class="disclaimer">仅展示本站用户提交的内容，不代表大众点评或其他平台评价。</div>`;
  }
  const categories=[{name:'生鲜超市',pattern:/超市|菜市场|农贸|生鲜|便利店/},{name:'商场',pattern:/商场|购物中心|百货/},{name:'医院',pattern:/医院|卫生服务中心|诊所/},{name:'学校',pattern:/学校|幼儿园|小学|中学|大学/},{name:'公园',pattern:/公园|绿地|广场/}];
  const groups=new Map(categories.map(category=>[category.name,[]]));
  for(const poi of state.communityPois){const text=`${poi.type || ''} ${poi.name || ''}`;if(/健身|游泳|餐馆|餐饮|充电|药店|药房/.test(text))continue;const group=categories.find(category=>category.pattern.test(text));if(group)groups.get(group.name).push(poi);}
  const stores=rows=>rows.map(poi=>{const address=typeof poi.address==='string'?poi.address:'地址暂无资料',distance=Number(poi.distance);const coordinate=String(poi.location||'');const link=/^\d{1,3}\.\d+,\d{1,2}\.\d+$/.test(coordinate)?`https://uri.amap.com/marker?position=${encodeURIComponent(coordinate)}&name=${encodeURIComponent(poi.name||'')}&src=zhuzhuan&coordinate=gaode&callnative=0`:null;return `<article class="poi-store"><strong>${escapeHtml(poi.name)}</strong><p>${escapeHtml(address)}${Number.isFinite(distance)&&distance>0?` · 约 ${distance} 米`:''}</p>${link?`<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">在高德查看位置 ↗</a>`:''}</article>`;}).join('');
  return `${tabs}<div class="poi-status">${state.poiLoading?'正在读取周边配套…':escapeHtml(state.poiStatus || '点击分类查看具体名称、地址和距离。')}</div><div class="poi-list">${categories.map(category=>{const rows=groups.get(category.name);return `<details class="poi-group" ${rows.length?'open':''}><summary><span>${category.name}</span><small>${rows.length} 处</small></summary>${rows.length?stores(rows):'<p class="poi-empty">当前查询范围内暂无结果</p>'}</details>`;}).join('')}</div><button class="button-secondary poi-refresh" id="refresh-poi">↻ 刷新周边数据</button><button class="text-button report-community" id="report-community">举报小区信息</button><div class="disclaimer">数据来源：高德周边 POI，站点名称和商户状态以实地核验为准。</div>`;
}

function renderRightCommunity() {
  const item = state.communities.find(community => community.id === state.homes.selectedCommunity);
  if (!item) return '<div class="panel-inner"><div class="eyebrow">A SMALL STEP</div><h1>先选一个小区</h1><p class="panel-subtitle">点击右侧小区或地图上的点位查看详情。</p></div>';
  return `<div class="station-summary"><div><div class="eyebrow">COMMUNITY DETAIL</div><div class="summary-title">${escapeHtml(item.name)}</div></div><button class="icon-button ${isFavorite('communities', item.id) ? 'saved' : ''}" title="收藏小区" data-favorite="communities" data-favorite-id="${item.id}">${icon('heart')}</button></div>${item.address ? `<div class="community-address">${escapeHtml(item.address)}<br>坐标：${item.lng}, ${item.lat}<br>来源：高德 POI · 租金、户型和入住状态暂无核验资料</div>` : ''}${renderCommunityDetails(item)}`;
}

async function loadCommunityPois() {
 const item=state.communities.find(community=>community.id===state.homes.selectedCommunity);if(!item||!state.apiAvailable)return;
 const selected=item.id;state.poiLoading=true;state.poiStatus='';state.communityPois=[];rightRail.innerHTML=renderRightCommunity();bindCommonActions();
 let count=0;try{const rows=new Map();for(let page=1;page<=4;page++){const result=await api(`communities/${encodeURIComponent(item.id)}/pois?page=${page}`);if(state.homes.selectedCommunity!==selected)return;count=Number(result.count)||0;for(const poi of result.pois||[])rows.set(poi.id||`${poi.name}:${poi.location}`,poi);state.communityPois=[...rows.values()];if(page*25>=count||!(result.pois||[]).length)break;}state.poiStatus=`小区周边1.5km · 已读取 ${state.communityPois.length} 条配套${count>100?' · 结果超过单次读取上限，未覆盖全部':''}`;}catch(error){state.poiStatus=`周边读取失败：${error.message}`;}finally{if(state.homes.selectedCommunity===selected){state.poiLoading=false;rightRail.innerHTML=renderRightCommunity();bindCommonActions();}}
}

async function loadCommunityReviews() {
  const item = state.communities.find(community => community.id === state.homes.selectedCommunity);
  if (!item || !state.apiAvailable) { state.communityReviews = []; return; }
  const result = await api(`communities/${encodeURIComponent(item.id)}/reviews`).catch(error => { showToast(`评价读取失败：${error.message}`); return null; });
  state.communityReviews = result?.reviews || [];
}

function renderNotesView() {
  mapStage.classList.add('notes-active');
  $('#map-canvas').style.display = 'none';
  notesView.hidden = false;
  leftRail.innerHTML = `<div class="panel-inner"><div class="panel-header"><div><div class="eyebrow">COMMUNITY NOTES</div><h1>把房子贴出来</h1><p class="panel-subtitle">真实的人，分享真实的居住信息。</p></div><span class="step-tag">便利贴墙</span></div><p class="panel-subtitle">在墙上留下你的出租信息，联系方式会自动打码，只有感兴趣的人点进来才能看到。</p><button class="button-primary button-block" id="publish-note">＋ 发布一张便利贴</button><div class="soft-callout"><strong>♡</strong><span>请勿发布虚假、违规或涉及押金转账的内容。平台提供举报入口。</span></div><div class="empty-inline">位置越具体越容易被找到<br>备注可以写采光、楼层、入住时间等<br>联系方式仅对点击者显示</div></div>`;
  const noteSource = state.remoteNotes || (state.apiAvailable ? [] : DATA.notes);
  const notes = noteSource.filter(note => (state.notes.region === '全部区域' || note.region === state.notes.region) && (state.notes.line === '全部地铁线' || note.line === state.notes.line) && (state.notes.layout === '全部户型' || note.layout === state.notes.layout) && note.rent <= state.notes.maxRent);
  notesView.innerHTML = `<div class="wall-title"><div><h2>住住安 · 租房便利贴</h2><p>今天也有人在找一个刚刚好的家</p></div><span class="note-counter">${notes.length} 张便签</span></div><div class="filter-strip"><select class="filter-select" id="note-region"><option>全部区域</option><option>静安区</option><option>徐汇区</option><option>长宁区</option></select><select class="filter-select" id="note-line"><option>全部地铁线</option><option>1号线</option><option>2号线</option><option>10号线</option><option>S3号线</option><option>4号线</option></select><select class="filter-select" id="note-layout"><option>全部户型</option><option>一居室</option><option>一室一厅</option><option>两室</option><option>三室</option><option>LOFTER</option></select><select class="filter-select" id="note-rent"><option value="7000">不限租金</option><option value="3000">3000 元以内</option><option value="4500">4500 元以内</option><option value="6000">6000 元以内</option></select></div><div class="note-board">${notes.map(note => renderNote(note)).join('') || '<div class="empty-state">墙上还没有符合条件的便利贴</div>'}</div>`;
  $('#note-region').value = state.notes.region; $('#note-line').value = state.notes.line; $('#note-layout').value = state.notes.layout; $('#note-rent').value = String(state.notes.maxRent);
  $$('.filter-select', notesView).forEach(select => select.addEventListener('change', () => { state.notes.region = $('#note-region').value; state.notes.line = $('#note-line').value; state.notes.layout = $('#note-layout').value; state.notes.maxRent = Number($('#note-rent').value); renderNotesView(); }));
  $$('.sticky-note', notesView).forEach(note => note.addEventListener('click', () => openNoteModal(note.dataset.noteId)));
  $('#publish-note').addEventListener('click', openPublishModal);
}

function renderNote(note) {
  const saved = isFavorite('notes', note.id);
  return `<button class="sticky-note ${note.color || 'yellow'}" data-note-id="${escapeHtml(note.id)}" style="--tilt:${note.id === 'note-2' ? '2deg' : note.id === 'note-3' ? '-4deg' : '2deg'}"><span class="note-pin"></span><span class="note-line">${escapeHtml(note.region)} · ${escapeHtml(note.line)}</span><strong class="note-title">${escapeHtml(note.title)}</strong><span class="note-rent">¥${note.rent}<small> / 月</small></span><span class="privacy-line">联系方式：•••• ••••</span><span class="note-footer"><span>${escapeHtml(note.layout)}</span><span>${saved ? '♥ 已收藏' : '点击查看'}</span></span></button>`;
}

function renderFavoritesView() {
  mapStage.classList.remove('notes-active');
  notesView.hidden = true; $('#map-canvas').style.display = '';
  markerLayer.innerHTML = '';
  leftRail.innerHTML = '<div class="panel-inner"><div class="eyebrow">YOUR SPACE</div><h1>我的收藏</h1><p class="panel-subtitle">把看中的站、小区和便利贴收在这里。</p><div class="soft-callout"><strong>♡</strong><span>登录后可以在不同设备同步收藏。</span></div></div>';
  const stations = state.stations.filter(item => isFavorite('stations', item.id));
  const communities = state.communities.filter(item => isFavorite('communities', item.id));
  const notes = (state.remoteNotes || (state.apiAvailable ? [] : DATA.notes)).filter(item => isFavorite('notes', item.id));
  rightRail.innerHTML = `<div class="station-summary"><div><div class="eyebrow">SAVED ITEMS</div><div class="summary-title">已收藏内容</div></div><span class="summary-count">${stations.length + communities.length + notes.length} 项</span></div><div class="fav-section">${renderFavoriteGroup('地铁站', stations, 'stations', item => `${item.name} · ${item.line}`)}${renderFavoriteGroup('小区', communities, 'communities', item => item.price == null ? item.name : `${item.name} · ¥${item.price}/月`)}${renderFavoriteGroup('便利贴', notes, 'notes', item => `${item.title} · ${item.region}`)}${!stations.length && !communities.length && !notes.length ? '<div class="empty-state">还没有收藏内容<br>去通勤找房或便利贴墙看看吧</div>' : ''}</div>`;
  bindCommonActions();
}

function renderFavoriteGroup(title, items, type, text) {
  if (!items.length) return '';
  return `<div class="fav-heading">${title}</div>${items.map(item => `<div class="fav-row"><span class="poi-icon">${type === 'stations' ? '●' : type === 'communities' ? '⌂' : '▤'}</span><span class="fav-main"><strong>${text(item)}</strong><small>${type === 'notes' ? '联系方式已遮蔽' : '已保存到你的收藏'}</small></span><button class="icon-button saved" title="取消收藏" data-favorite="${type}" data-favorite-id="${item.id}">${icon('heart')}</button></div>`).join('')}`;
}

function renderDemoMarkers() { renderMetroSchematic(); }

function positionAmapMarkers() {
  if (!state.amap.ready || !state.amap.map) return;
  $$('.demo-marker, .poi-map-marker', markerLayer).forEach(marker => {
    const item = state.stations.find(row => row.id === marker.dataset.markerId) || state.communities.find(row => row.id === marker.dataset.markerId);
    const lng = marker.dataset.lng ?? item?.lng; const lat = marker.dataset.lat ?? item?.lat;
    if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) return;
    const pixel = state.amap.map.lngLatToContainer([Number(lng), Number(lat)]);
    marker.style.left = `${pixel.x}px`; marker.style.top = `${pixel.y}px`;
  });
}

function createMarker(item, type) {
  const marker = document.createElement('button');
  marker.className = `demo-marker ${type === 'community' ? `community-marker size-${item.size} ${state.homes.selectedCommunity === item.id ? 'active' : ''}` : `station-marker ${state.commute.selectedStations.includes(item.id) || state.homes.selectedStationIds.includes(item.id) ? 'selected' : ''}`}`;
  marker.dataset.markerId = item.id;
  const x = item.x ?? ((Number(item.lng) - 118.68) / 0.13) * 100;
  const y = item.y ?? ((32.10 - Number(item.lat)) / 0.14) * 100;
  marker.style.left = `${Math.min(96, Math.max(4, x || 50))}%`; marker.style.top = `${Math.min(96, Math.max(4, y || 50))}%`; marker.title = item.name; marker.setAttribute('aria-label', item.name);
  if (type === 'community') marker.textContent = String(item.size || 1);
  else { const label = document.createElement('span'); label.className = 'marker-name'; label.textContent = item.name; marker.appendChild(label); }
  marker.addEventListener('click', event => { event.stopPropagation(); if (type === 'community') { state.homes.selectedCommunity = item.id; state.communityPois = []; state.communityReviews = []; state.communityTab = 'pois'; rightRail.innerHTML = renderRightCommunity(); bindCommonActions(); renderDemoMarkers(); loadCommunityPois(); } else toggleStation(item.id); });
  return marker;
}

function toggleStation(id) {
  const index = state.commute.selectedStations.indexOf(id);
  if (index >= 0) state.commute.selectedStations.splice(index, 1);
  else if (state.commute.selectedStations.length < 3) state.commute.selectedStations.push(id);
  else { showToast('最多同时选择 3 个地铁站'); return; }
  renderAll();
}

function bindCommonActions() {
  $$('[data-favorite]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); toggleFavorite(button.dataset.favorite, button.dataset.favoriteId); }));
  $$('[data-share]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); navigator.clipboard?.writeText(`${button.dataset.share} · 住住安`).then(() => showToast('小区名称已复制')); }));
  $('#refresh-poi')?.addEventListener('click', loadCommunityPois);
  $$('[data-community-tab]').forEach(button => button.addEventListener('click', async () => {
    state.communityTab = button.dataset.communityTab;
    if (state.communityTab === 'reviews') await loadCommunityReviews(); else await loadCommunityPois();
    rightRail.innerHTML = renderRightCommunity(); bindCommonActions();
  }));
  $('#write-review')?.addEventListener('click', openReviewModal);
  $('#report-community')?.addEventListener('click', () => { const item = state.communities.find(community => community.id === state.homes.selectedCommunity); if (item) openReportModal('community', item.id); });
}

function openReviewModal() {
  const item = state.communities.find(community => community.id === state.homes.selectedCommunity);
  if (!item || !state.user) { openAuthModal('login'); return; }
  openModal(`<div class="modal-head"><div><div class="eyebrow">COMMUNITY REVIEW</div><h2>评价 ${escapeHtml(item.name)}</h2><p>你的评价会显示在本站小区页</p></div><button class="modal-close" aria-label="关闭">×</button></div><form class="modal-body" id="review-form"><label class="form-label">评分</label><select class="form-control" name="rating"><option value="5">5 星，很满意</option><option value="4">4 星，满意</option><option value="3">3 星，一般</option><option value="2">2 星，不满意</option><option value="1">1 星，很不满意</option></select><label class="form-label">居住体验</label><textarea class="form-control textarea" name="body" maxlength="1000" required placeholder="写下真实的居住体验"></textarea><button class="button-primary button-block" type="submit">提交评价</button></form>`);
  $('#review-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      await api(`communities/${encodeURIComponent(item.id)}/reviews`, { method: 'POST', body: JSON.stringify({ rating: Number(form.get('rating')), body: form.get('body') }) });
      closeModal(); await loadCommunityReviews(); rightRail.innerHTML = renderRightCommunity(); bindCommonActions(); showToast('评价已提交');
    } catch (error) { showToast(error.message); }
  });
}

function bindCommuteActions() {
 const bindInterval=(id,scope,key,minKey,maxKey,limit)=>$(id)?.addEventListener('change',event=>{const value=Number(event.target.value),next={...scope,[key]:value};if(!Number.isInteger(value)||value<0||value>limit||next[minKey]>next[maxKey]){showToast('请填写有效范围：最少不能大于最多');event.target.value=scope[key];return;}scope[key]=value;if(scope===state.homes)state.homes.selectedCommunity=null;renderAll();});
 bindInterval('#min-time',state.commute,'minMinutes','minMinutes','maxMinutes',120);bindInterval('#max-time',state.commute,'maxMinutes','minMinutes','maxMinutes',120);
 bindInterval('#walk-min',state.homes,'walkMin','walkMin','walk',60);bindInterval('#walk-time',state.homes,'walk','walkMin','walk',60);
 bindInterval('#cycle-min',state.homes,'cycleMin','cycleMin','cycle',60);bindInterval('#cycle-time',state.homes,'cycle','cycleMin','cycle',60);
 $('#station-sort')?.addEventListener('change',event=>{state.commute.sort=event.target.value;renderAll();});$('#community-sort')?.addEventListener('change',event=>{state.homes.sort=event.target.value;renderAll();});
 $$('[data-preferred-line]').forEach(button=>button.addEventListener('click',()=>{const line=button.dataset.preferredLine;state.commute.preferred.has(line)?state.commute.preferred.delete(line):state.commute.preferred.add(line);renderAll();}));
 $$('[data-work-place]').forEach(button=>button.addEventListener('click',()=>{const place=state.commute.matches[Number(button.dataset.workPlace)];if(place){applyWorkLocation(place.location,place.name);}}));
 $('#work-query')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();findStationsByRoute();}});

  $('#work-query')?.addEventListener('input', event => { state.commute.query = event.target.value; });
  $$('[data-transfers]').forEach(button => button.addEventListener('click', () => { state.commute.transfers = Number(button.dataset.transfers);if(state.routeOrigin)estimateMetroRoutes(state.routeOrigin);renderAll(); }));
  $$('[data-forbidden-line]').forEach(button => button.addEventListener('click', () => { const line = button.dataset.forbiddenLine; state.commute.forbidden.has(line) ? state.commute.forbidden.delete(line) : state.commute.forbidden.add(line);if(state.routeOrigin)estimateMetroRoutes(state.routeOrigin);renderAll(); }));
  $$('[data-station-id]').forEach(button => button.addEventListener('click', () => toggleStation(button.dataset.stationId)));
  $('#find-stations')?.addEventListener('click', findStationsByRoute);
  $('#continue-to-homes')?.addEventListener('click', () => { state.homes.selectedStationIds = [...state.commute.selectedStations]; state.homes.selectedCommunity = null; renderAll(); showToast('正在读取所选站点周边小区'); metroZoom=1; discoverCommunities(); });
  $('#load-more-communities')?.addEventListener('click', () => discoverCommunities(true));
  $('#back-to-stations')?.addEventListener('click', () => { discoveryGeneration++;state.homes.selectedStationIds = []; state.homes.selectedCommunity = null;metroZoom=1;renderAll(); });
  $('#community-query')?.addEventListener('input', event => { state.homes.query = event.target.value; });
  $('#community-query')?.addEventListener('change', renderAll);
  $$('[data-community-id]').forEach(card => card.addEventListener('click', event => { if (event.target.closest('[data-favorite], [data-share]')) return; state.homes.selectedCommunity = card.dataset.communityId; state.communityPois = []; state.communityReviews = []; state.communityTab = 'pois'; rightRail.innerHTML = renderRightCommunity(); bindCommonActions(); renderDemoMarkers(); loadCommunityPois(); }));
}

function routeMinutes(route) {
    const transit = route?.route?.transits?.[0];
  if (!transit) return null;
  const segments = transit.segments || [];
  if (segments.some(segment => (segment.bus?.buslines || []).some(line => !/地铁|metro/i.test(`${line.name || ''}${line.type || ''}`)))) return null;
  const metroSegments = segments.filter(segment => (segment.bus?.buslines || []).some(line => /地铁|metro/i.test(`${line.name || ''}${line.type || ''}`)));
  const lines = [...new Set(metroSegments.flatMap(segment => (segment.bus?.buslines || []).map(line => line.name).filter(Boolean)))];
  if (!metroSegments.length) return null;
  return { minutes: Math.ceil(Number(transit.duration || 0) / 60), transfers: Math.max(0, metroSegments.length - 1), lines };
}

function pathMinutes(route) {
  const duration = Number(route?.route?.paths?.[0]?.duration || route?.data?.paths?.[0]?.duration || 0);
  return duration > 0 ? Math.ceil(duration / 60) : null;
}

function coordinateDistance(a, b) {
  const latitude = (Number(a.lat) + Number(b.lat)) * Math.PI / 360;
  return Math.hypot((Number(a.lat) - Number(b.lat)) * Math.PI / 180, Math.cos(latitude) * (Number(a.lng) - Number(b.lng)) * Math.PI / 180);
}

async function loadCommunityTravelTimes() {
  if (!state.apiAvailable || !state.amap.config?.routesEnabled) return;
  const stations = state.homes.selectedStationIds.map(id => state.stations.find(row => row.id === id)).filter(row => row?.lng && row?.lat);
  const communities = state.communities.filter(row => stations.some(station => station.id === row.station_id || station.name === row.station));
  if (!stations.length || !communities.length) return;
  await Promise.all(communities.map(async community => {
    const station = stations.reduce((nearest, item) => coordinateDistance(item, community) < coordinateDistance(nearest, community) ? item : nearest);
    const params = new URLSearchParams({ origin: `${station.lng},${station.lat}`, destination: `${community.lng},${community.lat}` });
    const [walk, cycle] = await Promise.all(['walking', 'bicycling'].map(async mode => {
      try { return pathMinutes(await api(`map/${mode}?${params}`)); } catch { return null; }
    }));
    if (walk) community.walk = walk;
    if (cycle) community.cycle = cycle;
  }));
  renderAll();
}

function applyWorkLocation(location,name){state.commute.query=name;state.commute.matches=[];state.routeOrigin=location;estimateMetroRoutes(location);metroZoom=1;renderAll();showToast('已按地铁线路估算通勤范围');}
async function findStationsByRoute(){
 if(state.routeLoading)return;const query=state.commute.query.trim();if(!query){showToast('请填写站点、地标或详细地址');return;}if(!state.metroReady){showToast('请先选择城市');return;}
 const normalize=value=>value.replace(state.city,'').replace(/地铁站|站$/g,'').replace(/[（(].*?[）)]/g,'').trim();
 const station=state.stations.find(station=>normalize(station.name)===normalize(query));
 if(station){applyWorkLocation(`${station.lng},${station.lat}`,station.name);return;}
 if(!state.amap.config?.routesEnabled){showToast('地点查询暂不可用，请尝试完整地铁站名');return;}
 state.routeLoading=true;state.commute.matches=[];
 try{const search=await api(`map/search?keywords=${encodeURIComponent(query)}&city=${encodeURIComponent(state.city)}`),matches=(search.pois||[]).filter(poi=>/^\d+(?:\.\d+)?,\d+(?:\.\d+)?$/.test(poi.location||'')).slice(0,6);
 if(matches.length===1){applyWorkLocation(matches[0].location,matches[0].name);return;}
 if(matches.length){state.commute.matches=matches;renderAll();showToast('请选择你要找的地点');return;}
 const result=await api(`map/geocode?address=${encodeURIComponent(query)}&city=${encodeURIComponent(state.city)}`),location=result.geocodes?.[0]?.location;if(!location)throw Error('没有匹配地点，请补充所在区或完整名称');applyWorkLocation(location,query);
 }catch(error){showToast(error.message);}finally{state.routeLoading=false;}
}

function updateMapLabels() {
  $('#map-zoom-label').textContent = state.homes.selectedStationIds.length ? '站点周边小区' : '通勤范围';
  $('#map-hint').innerHTML = state.homes.selectedStationIds.length ? '<span class="hint-star">⌂</span> 已选站点周边 6km 小区' : `<span class="hint-star">★</span> 通勤起点 · ${escapeHtml(state.commute.query || '静安寺')}`;
  const demoListings = !state.apiAvailable || state.communities.some(community => community.source === 'demo');
  $('#map-provider-status').innerHTML = `<i></i>${state.metroReady ? '高德地铁数据 · 时间为估算' : '请选择城市'}${demoListings ? ' · 房源示例' : ''}`;
  $('#map-provider-status').classList.toggle('live', state.amap.ready);
}

function openModal(content) { const layer = $('#modal-layer'); layer.hidden = false; layer.innerHTML = `<div class="modal">${content}</div>`; $('.modal-close', layer)?.addEventListener('click', closeModal); layer.addEventListener('click', event => { if (event.target === layer) closeModal(); }, { once: true }); }
function closeModal() { const layer = $('#modal-layer'); layer.hidden = true; layer.innerHTML = ''; }

function accountLabel() { return state.user?.display_name || state.user?.email || '住住安用户'; }

function openAuthModal(mode = 'login') {
  const render = active => `<div class="modal-head"><div><div class="eyebrow">WELCOME HOME</div><h2>${active === 'login' ? '登录住住安' : '创建住住安账户'}</h2><p>管理员登录</p></div><button class="modal-close" aria-label="关闭">×</button></div><div class="modal-tabs"><button class="modal-tab ${active === 'login' ? 'active' : ''}" data-auth-tab="login">登录</button></div><form class="modal-body" id="auth-form"><label class="form-label">邮箱或手机号</label><input class="form-control" name="account" type="text" autocomplete="username" placeholder="name@example.com" required /><label class="form-label">密码</label><input class="form-control" name="password" type="password" minlength="8" autocomplete="${active === 'login' ? 'current-password' : 'new-password'}" placeholder="至少 8 位" required />${active === 'register' ? '<label class="form-label">昵称</label><input class="form-control" name="displayName" maxlength="40" placeholder="怎么称呼你" />' : ''}<button class="button-primary button-block" type="submit">${active === 'login' ? '登录' : '创建账户'}</button><div class="secure-note">密码只通过 HTTPS 发送并由服务端保存哈希。</div></form>`;
  openModal(render(mode));
  $$('[data-auth-tab]', $('#modal-layer')).forEach(tab => tab.addEventListener('click', () => openAuthModal(tab.dataset.authTab)));
  $('#auth-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const account = String(form.get('account')).trim(); const payload = { password: String(form.get('password')), displayName: String(form.get('displayName') || '').trim() };
    if (account.includes('@')) payload.email = account; else payload.phone = account;
    try { const result = await api(`auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) }); setActiveUser({ ...result.user, isAdmin: result.isAdmin }); closeModal(); renderAll(); await loadRemoteNotes(); await loadRemoteFavorites(); showToast(mode === 'login' ? '登录成功' : '账户创建成功'); } catch (error) { showToast(error.message); }
  });
}

function openAccountModal() {
  if (!state.user || state.user.role === 'guest') { openModal(`<div class="modal-head"><h2>本机访客</h2><button class="modal-close" aria-label="关闭">×</button></div><div class="modal-body guest-note">无需注册即可发布。发布身份和收藏通过本机浏览器保存；清除浏览器数据或换设备后无法找回原身份。</div>`); return; }
  openModal(`<div class="modal-head"><div><div class="eyebrow">YOUR ACCOUNT</div><h2>${escapeHtml(accountLabel())}</h2><p>${escapeHtml(state.user.email || state.user.phone || '')}</p></div><button class="modal-close" aria-label="关闭">×</button></div><div class="modal-tabs"><button class="modal-tab active" data-account-tab="account">账户信息</button><button class="modal-tab" data-account-tab="feedback">建议与打赏</button>${state.isAdmin ? '<button class="modal-tab" data-account-tab="admin">内容管理</button>' : ''}</div><div class="modal-body" id="account-modal-body"><div class="soft-callout"><strong>安</strong><span>你的收藏和便利贴会在登录后跨设备同步。</span></div><label class="form-label">昵称</label><input class="form-control" value="${escapeHtml(accountLabel())}" /><button class="button-secondary button-block" id="logout-button">退出登录</button></div>`);
  bindAccountTabs();
}

function bindAccountTabs() {
  $$('[data-account-tab]', $('#modal-layer')).forEach(tab => tab.addEventListener('click', () => {
    $$('[data-account-tab]', $('#modal-layer')).forEach(item => item.classList.toggle('active', item === tab));
    $('#account-modal-body').innerHTML = tab.dataset.accountTab === 'feedback' ? '<label class="form-label">给管理员的建议</label><textarea class="form-control textarea" id="feedback-body" placeholder="告诉我们哪里还可以更好"></textarea><button class="button-primary button-block" id="send-feedback">发送建议</button><label class="form-label">给住住安一点鼓励</label><div class="amount-options"><button class="amount-option active">♡ 比心</button><button class="amount-option">✿ 鲜花</button><button class="amount-option">¥ 打赏</button></div><div class="secure-note">比心和鲜花不收费。金额打赏暂未接入真实人民币支付。</div><button class="button-secondary button-block" id="support-button">送出鼓励</button>' : tab.dataset.accountTab === 'admin' ? '<div class="admin-switch"><button class="admin-switch-button active" data-admin-view="reports">举报记录</button><button class="admin-switch-button" data-admin-view="users">用户管理</button><button class="admin-switch-button" data-admin-view="media">图片额度</button></div><div class="admin-report-list" id="admin-report-list"><p class="empty-inline">正在读取举报…</p></div>' : `<div class="soft-callout"><strong>安</strong><span>你的账户已启用。</span></div><label class="form-label">昵称</label><input class="form-control" value="${escapeHtml(accountLabel())}" /><button class="button-secondary button-block" id="logout-button">退出登录</button>`;
    $('#send-feedback')?.addEventListener('click', async () => { try { await api('feedback', { method: 'POST', body: JSON.stringify({ body: $('#feedback-body').value }) }); showToast('建议已发送，谢谢你的反馈'); } catch (error) { showToast(error.message); } });
    $$('.amount-option').forEach(option => option.addEventListener('click', () => { $$('.amount-option').forEach(item => item.classList.remove('active')); option.classList.add('active'); }));
    $('#support-button')?.addEventListener('click', () => showToast('感谢你的鼓励，支付功能暂未启用'));
    $('#logout-button')?.addEventListener('click', logout);
    if (tab.dataset.accountTab === 'admin') {
      loadAdminReports();
      $$('[data-admin-view]').forEach(view => view.addEventListener('click', () => {
        $$('[data-admin-view]').forEach(item => item.classList.toggle('active', item === view));
        if (view.dataset.adminView === 'users') loadAdminUsers(); else if (view.dataset.adminView === 'media') loadAdminMedia(); else loadAdminReports();
      }));
    }
  }));
  $('#logout-button')?.addEventListener('click', logout);
}

async function logout() { try { await api('auth/logout', { method: 'POST' }); setActiveUser(null); closeModal(); renderAll(); showToast('已退出登录'); } catch (error) { showToast(`退出失败：${error.message}`); } }

async function loadAdminReports() {
  const root = $('#admin-report-list'); if (!root) return;
  try {
    const result = await api('admin/reports');
    root.innerHTML = result.reports.map(report => `<article class="admin-report"><strong>${escapeHtml(report.reason)}</strong><p>${escapeHtml(report.detail || '没有补充说明')}</p><small>${escapeHtml(report.target_type)} · ${escapeHtml(report.target_id)} · ${escapeHtml(report.created_at)}</small>${['note', 'community'].includes(report.target_type) ? `<div class="admin-actions"><button class="button-secondary" data-admin-type="${escapeHtml(report.target_type)}" data-admin-action="${report.target_status === 'visible' ? 'hide' : 'restore'}" data-admin-id="${escapeHtml(report.target_id)}">${report.target_status === 'visible' ? '下架内容' : '恢复内容'}</button></div>` : ''}</article>`).join('') || '<p class="empty-inline">目前没有举报。</p>';
    $$('[data-admin-action]', root).forEach(button => button.addEventListener('click', async () => {
      try { await api(`admin/${button.dataset.adminType === 'community' ? 'communities' : 'notes'}/${encodeURIComponent(button.dataset.adminId)}/${button.dataset.adminAction}`, { method: 'POST' }); await loadAdminReports(); showToast('内容状态已更新'); }
      catch (error) { showToast(error.message); }
    }));
  } catch (error) { root.innerHTML = `<p class="empty-inline">${escapeHtml(error.message)}</p>`; }
}

async function loadAdminUsers() {
  const root = $('#admin-report-list'); if (!root) return;
  try {
    const result = await api('admin/users');
    root.innerHTML = result.users.map(user => `<article class="admin-report"><strong>${escapeHtml(user.display_name)}</strong><p>${escapeHtml(user.email || user.phone || '未填写联系方式')}</p><small>${user.suspended_at ? '已冻结' : '正常'} · ${escapeHtml(user.created_at)}</small><div class="admin-actions"><button class="button-secondary" data-user-action="${user.suspended_at ? 'restore' : 'suspend'}" data-user-id="${escapeHtml(user.id)}">${user.suspended_at ? '恢复账户' : '冻结账户'}</button></div></article>`).join('') || '<p class="empty-inline">目前没有用户。</p>';
    $$('[data-user-action]', root).forEach(button => button.addEventListener('click', async () => {
      try { await api(`admin/users/${encodeURIComponent(button.dataset.userId)}/${button.dataset.userAction}`, { method: 'POST' }); await loadAdminUsers(); showToast('账户状态已更新'); }
      catch (error) { showToast(error.message); }
    }));
  } catch (error) { root.innerHTML = `<p class="empty-inline">${escapeHtml(error.message)}</p>`; }
}

function openMapSettings() {
  const connected = state.amap.ready;
  openModal(`<div class="modal-head"><div><div class="eyebrow">MAP & LIFE</div><h2>一张关于生活的地图</h2><p>${connected ? '高德地图已连接' : '地图暂未连接，当前展示示意底图'}</p></div><button class="modal-close" aria-label="关闭">×</button></div><div class="modal-body"><p class="panel-subtitle">周边商户信息由高德提供，居住评价来自本站。标注为示例的租金和房源请勿作为交易依据。</p><button class="button-secondary button-block" id="reload-map">重新连接地图</button></div>`);
  $('#reload-map').addEventListener('click', () => { closeModal(); if (state.amap.config?.enabled) loadAmap(state.amap.config.key); else showToast('地图暂不可用，请稍后再试'); });
}

function loadAmap(key) {
  if (!key || document.getElementById('amap-sdk')) return;
  window._AMapSecurityConfig = { serviceHost: `${location.origin}/_AMapService` };
  const script = document.createElement('script'); script.id = 'amap-sdk'; script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Scale,AMap.ToolBar`;
  script.onload = () => { try { state.amap.map = new AMap.Map('amap-container', { zoom: 12, center: [121.4465, 31.2230], viewMode: '2D' }); state.amap.map.addControl(new AMap.Scale()); state.amap.map.addControl(new AMap.ToolBar({ position: 'RB' })); state.amap.map.on('mapmove', positionAmapMarkers); state.amap.map.on('zoomchange', positionAmapMarkers); state.amap.ready = true; mapStage.classList.add('has-amap'); updateMapLabels(); renderDemoMarkers(); showToast('高德地图已加载'); } catch { resetAmap('地图初始化失败，已切换到演示地图'); } };
  script.onerror = () => resetAmap('高德地图加载失败，已切换到演示地图'); document.head.appendChild(script);
}

function resetAmap(message) {
  state.amap.ready = false; state.amap.map = null; mapStage.classList.remove('has-amap');
  document.getElementById('amap-sdk')?.remove(); updateMapLabels(); renderDemoMarkers(); showToast(message);
}

function openReportModal(targetType, targetId) {
  openModal(`<div class="modal-head"><div><div class="eyebrow">SAFETY FIRST</div><h2>举报内容</h2><p>帮助我们处理违规房源信息</p></div><button class="modal-close" aria-label="关闭">×</button></div><form class="modal-body" id="report-form"><label class="form-label">举报原因</label><select class="form-control" name="reason"><option>虚假房源</option><option>联系方式违规</option><option>疑似诈骗</option><option>重复发布</option><option>其他</option></select><label class="form-label">补充说明</label><textarea class="form-control textarea" name="detail" placeholder="可以补充时间、地点或异常信息"></textarea><button class="button-primary button-block" type="submit">提交举报</button></form>`);
  $('#report-form').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.currentTarget); if (!state.apiAvailable) { closeModal(); showToast('当前为演示模式，举报未发送'); return; } try { await api('reports', { method: 'POST', body: JSON.stringify({ targetType, targetId, reason: form.get('reason'), detail: form.get('detail') }) }); closeModal(); showToast('举报已提交'); } catch (error) { showToast(error.message); } });
}

async function openNoteModal(id) {
  let note = (state.remoteNotes || DATA.notes).find(item => item.id === id); if (!note) return;
  let contact = '联系方式暂不可用';
  if (state.apiAvailable) {
    const detail = await api(`notes/${encodeURIComponent(id)}`).catch(() => null);
    if (detail?.note) note = { ...note, ...detail.note };
    const result = await api(`notes/${encodeURIComponent(id)}/contact`).catch(() => null);
    if (result?.contact) contact = result.contact;
  } else contact = note.contact || '演示数据未提供联系方式';
  openModal(`<div class="modal-head"><div><div class="eyebrow">COMMUNITY NOTE</div><h2>${escapeHtml(note.title)}</h2><p>${escapeHtml(note.region)} · ${escapeHtml(note.line)} · ${escapeHtml(note.layout)}</p></div><button class="modal-close" aria-label="关闭">×</button></div><div class="modal-body">${note.imageUrl ? `<img class="note-photo" src="${escapeHtml(note.imageUrl)}" alt="房屋图片" loading="lazy" />` : ''}<div class="contact-reveal">联系方式：${escapeHtml(contact)}</div><p class="panel-subtitle">${escapeHtml(note.detail || '')}</p><button class="button-primary button-block" data-favorite="notes" data-favorite-id="${escapeHtml(note.id)}">${isFavorite('notes', note.id) ? '♥ 已收藏这张便利贴' : '♡ 收藏这张便利贴'}</button><button class="button-secondary button-block" id="report-note">举报这张便利贴</button><div class="secure-note">联系方式访问会被记录。请核实房屋和出租人身份后再沟通转账。</div></div>`);
  $('[data-favorite]', $('#modal-layer')).addEventListener('click', () => { toggleFavorite('notes', note.id); closeModal(); }); $('#report-note').addEventListener('click', () => openReportModal('note', note.id));
}

function openPublishModal() {
  if (!state.apiAvailable) { showToast('服务尚未连接，无法发布或保存便利贴'); return; }
  if (!state.user) { showToast('访客连接尚未完成，请稍后再试'); return; }
  openModal(`<div class="modal-head"><div><div class="eyebrow">NEW NOTE</div><h2>发布一张便利贴</h2><p>把你的房子和真实状态写下来</p></div><button class="modal-close" aria-label="关闭">×</button></div><form class="modal-body" id="note-form"><div class="form-grid"><div><label class="form-label">区域</label><input class="form-control" name="region" placeholder="所在区 / 街道" maxlength="40" required /></div><div><label class="form-label">地铁线</label><select class="form-control" name="line">${[...new Set(metroLines.map(line => line.name))].map(line => `<option>${escapeHtml(line)}</option>`).join('')}</select></div><div><label class="form-label">户型</label><select class="form-control" name="layout"><option>一居室</option><option>一室一厅</option><option>两室</option><option>三室</option><option>LOFTER</option></select></div><div><label class="form-label">月租金</label><input class="form-control" name="rent" type="number" min="0" placeholder="例如 3200" required /></div></div><label class="form-label">标题</label><input class="form-control" name="title" maxlength="80" placeholder="例如：阳光两居，拎包入住" required /><label class="form-label">备注</label><textarea class="form-control textarea" name="detail" maxlength="800" placeholder="采光、楼层、入住时间等"></textarea><label class="form-label">房屋图片 <span class="field-hint">可选，JPG / PNG / WebP，5 MB 内</span></label><input class="form-control" name="image" type="file" accept="image/jpeg,image/png,image/webp" /><label class="form-label">联系方式</label><input class="form-control" name="contact" maxlength="120" placeholder="手机号或微信号" required /><button class="button-primary button-block" type="submit">贴到墙上</button><div class="secure-note">联系方式在墙上会自动隐藏；发布后请及时处理举报。</div></form>`);
  if (!state.amap.config?.mediaEnabled) { $('#note-form input[name="image"]').disabled = true; $('#note-form input[name="image"]').title = '图片服务尚未开放'; }
  $('#note-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const payload = { city: state.city, region: form.get('region'), line: form.get('line'), layout: form.get('layout'), rent: Number(form.get('rent')), title: form.get('title'), detail: form.get('detail'), contact: form.get('contact') };
    if (state.apiAvailable) { try { const file = form.get('image'); if (file instanceof File && file.size) { showToast('正在上传图片'); payload.imageKey = (await uploadMedia(file)).imageKey; } await api('notes', { method: 'POST', body: JSON.stringify(payload) }); closeModal(); await loadRemoteNotes(); showToast('便利贴已发布到墙上'); } catch (error) { showToast(error.message); } }
    else { showToast('服务不可用，便利贴未保存'); }
  });
}

async function loadRemoteNotes() {
  if (!state.apiAvailable) return;
  const result = await api(`notes?city=${encodeURIComponent(state.city)}`).catch(() => null);
  if (!result?.notes) { state.remoteNotes = []; showToast('便利贴读取失败，请稍后重试'); if (state.view === 'notes') renderNotesView(); return; }
  state.remoteNotes = result.notes.map((note, index) => ({ ...note, x: 18 + ((index * 23) % 70), y: 18 + ((index * 31) % 68), color: ['coral', 'mint', 'blue', 'yellow', 'lavender', 'pink'][index % 6] }));
  if (state.view === 'notes') renderNotesView();
}

async function loadRemoteFavorites() {
  if (!state.apiAvailable || !state.user) return;
  const result = await api('favorites').catch(() => null); if (!result?.favorites) return;
  state.favorites = emptyFavorites();
  for (const item of result.favorites) if (state.favorites[item.item_type]) state.favorites[item.item_type].push(item.item_id);
  saveFavorites();
}

async function loadApiState() {
  try {
    const config = await api('map/config');
    state.apiAvailable = true; state.amap.config = config;
    const identity = await api('me').catch(async error => { if (error.status === 401) return api('auth/guest', {method:'POST',body:'{}'}); throw error; });
    setActiveUser(identity.user ? { ...identity.user, isAdmin: identity.isAdmin } : null);
    await loadRemoteNotes(); await loadRemoteFavorites();
  } catch { state.apiAvailable = false; showToast('服务未连接：当前仅展示示例，发布功能不可用'); }
}

function bindGlobal() {
  $$('.nav-item').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; renderAll(); }));
  $('#account-button').addEventListener('click', openAccountModal);
  $('#map-settings-button').addEventListener('click', openMapSettings);
  $('#city-button').addEventListener('click', () => window.showCityEntrance());
  $('#zoom-in').addEventListener('click', () => { metroZoom=Math.min(4,metroZoom*1.25);renderMetroSchematic(); });
  $('#zoom-out').addEventListener('click', () => { metroZoom=Math.max(.4,metroZoom/1.25);renderMetroSchematic(); });
}

bindGlobal(); renderAll(); loadApiState().then(() => {renderAll();if(new URLSearchParams(location.search).has('admin'))openAuthModal('login');});

async function loadAdminMedia() {
  const root = $('#admin-report-list');
  try {
    const result = await api('admin/media');
    root.innerHTML = `<p>图片服务：${result.enabled ? '已开放' : '已关闭'} · 已预留 ${(result.bytes / 1048576).toFixed(1)} MB</p><p>${result.usage.map(item => `${escapeHtml(item.scope)}: ${item.hits}`).join(' · ')}</p><p class="secure-note">删除后房源图片将不可访问；关闭服务需在托管后台设置 MEDIA_ENABLED=false。</p>${result.objects.map(item => `<div class="admin-report-card"><p>${escapeHtml(item.key)} · ${(item.size / 1024).toFixed(0)} KB · ${escapeHtml(item.state)}</p><button class="button-secondary" data-delete-media="${escapeHtml(item.key)}">永久删除图片</button></div>`).join('')}`;
    $$('[data-delete-media]', root).forEach(button => button.addEventListener('click', async () => {
      if (!confirm('永久删除这张图片？')) return;
      try { await api(`admin/media/${button.dataset.deleteMedia}`, { method: 'DELETE' }); await loadAdminMedia(); showToast('图片已清理'); } catch (error) { showToast(error.message); }
    }));
  } catch (error) { root.textContent = error.message; }
}
