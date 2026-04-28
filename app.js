// ===== MOBILE DETECTION =====
// Touch-only devices (phones, tablets without mouse) get the mobile UI.
// `(pointer: coarse)` + `(hover: none)` matches real finger input — desktop
// touchscreen laptops with a pointer still get the desktop UI.
const IS_MOBILE = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(pointer: coarse) and (hover: none)').matches;
if (IS_MOBILE) document.body.classList.add('mobile');

// Mobile interaction mode — null = "reader" (pan/scroll only).
let mobileMode = null;
let mobileLabelPlaceMode = false;
let mobileEvolvePending = false;

// ===== CONSTANTS =====
const STAGES = [
    { key: 'genesis',   label: 'Genesis',      color: '#ef4444' },
    { key: 'custom',    label: 'Custom Built',  color: '#f59e0b' },
    { key: 'product',   label: 'Product',       color: '#3b82f6' },
    { key: 'commodity', label: 'Commodity',      color: '#10b981' },
];

const ICONS = {
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
};

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function stageLabel(key) {
    const s = STAGES.find(s => s.key === key);
    return s ? s.label : '';
}

function stageColCenter(key) {
    const idx = STAGES.findIndex(s => s.key === key);
    if (idx < 0) return 50;
    return (idx + 0.5) / 4 * 100;
}

function stageFromX(pctX) {
    const idx = Math.max(0, Math.min(3, Math.floor(pctX / 25)));
    return STAGES[idx].key;
}

// ===== GEOMETRY & TIMING CONSTANTS =====
const AREA_PADDING = 3.5;
const EXPORT_AREA_PADDING = 45;
const BEZIER_BULGE = 0.55;
const EXPORT_HEADER_H = 40;
const EXPORT_BUBBLE_RADIUS = 12;
const LINK_MIDPOINT_RADIUS = 12;
const HANDLE_RADIUS = 7;
const HANDLE_HIT_RADIUS = 14;
const HANDLE_HIDE_DELAY = 150;
const BOUNCE_DURATION = 450;

// ===== HELPERS =====
function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

// ===== LOCAL STORAGE DATA LAYER =====
const STORAGE_KEYS = { items: 'km-items', links: 'km-links', areas: 'km-areas', labels: 'km-labels', meta: 'km-meta' };

function storeRead(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function storeWrite(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}
function storeReadMeta() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.meta)) || { anchor: '', anchorLinks: [] }; }
    catch { return { anchor: '', anchorLinks: [] }; }
}
function storeWriteMeta(meta) {
    localStorage.setItem(STORAGE_KEYS.meta, JSON.stringify(meta));
}
function generateId() {
    return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

const STAGE_TO_X = { genesis: 0.125, custom: 0.375, product: 0.625, commodity: 0.875 };
const Y_MARGIN = 0.08;

function nextPosYForStage(stage) {
    const siblings = items.filter(i => i.stage === stage);
    if (siblings.length === 0) return 0.5;
    const count = siblings.length + 1;
    const spacing = (1 - 2 * Y_MARGIN) / (count + 1);
    const positions = [];
    for (let n = 1; n <= count; n++) positions.push(Y_MARGIN + spacing * n);
    const usedY = siblings.map(i => i.posY);
    let bestPos = 0.5;
    let bestDist = -1;
    for (const p of positions) {
        const minDist = Math.min(...usedY.map(y => Math.abs(y - p)));
        if (minDist > bestDist) { bestDist = minDist; bestPos = p; }
    }
    return bestPos;
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// (findEdgeBoundary removed — replaced by Bezier blob system)

// ===== STATE =====
let items = [];
let links = [];
let areas = [];
let labels = [];
let anchor = '';
let anchorLinks = [];
let stageIndex = 0;
let unstaged = [];
let areaSelectMode = false;
let areaSelectedIds = new Set();
let areaElements = [];
let currentAreaHandles = [];
let hoveredAreaId = null;
let draggingHandle = false;
let areaHandleHideTimer = null;

// ===== DOM =====
const listView = document.getElementById('list-view');
const stageView = document.getElementById('stage-view');
const mapView = document.getElementById('map-view');
const importView = document.getElementById('import-view');
const itemInput = document.getElementById('item-input');
const addBtn = document.getElementById('add-btn');
const errorMsg = document.getElementById('error-msg');
const itemsList = document.getElementById('items-list');
const sortCard = document.getElementById('sort-card');
const sortCardWrap = document.getElementById('sort-card-wrap');
const sortProgress = document.getElementById('sort-progress');
const sortDone = document.getElementById('sort-done');
const mapCanvas = document.getElementById('map-canvas');

function showError(msg) {
    errorMsg.textContent = msg;
    setTimeout(() => { if (errorMsg.textContent === msg) errorMsg.textContent = ''; }, 4000);
}

// ===== VIEW SWITCHING =====
function showView(view) {
    if (editingItemId) saveEdit();
    listView.classList.add('hidden');
    stageView.classList.remove('active');
    mapView.classList.remove('active');
    importView.classList.remove('active');
    cancelConnect();
    if (anchorConnectMode) cancelAnchorConnect();
    if (evolveMode) cancelEvolve();
    if (view === 'list') { listView.classList.remove('hidden'); renderList(); }
    else if (view === 'stage') { stageView.classList.add('active'); }
    else if (view === 'map') { mapView.classList.add('active'); renderMap(); }
    else if (view === 'import') { importView.classList.add('active'); resetDropZone(); }
    // Toggle body.map-active so the mobile bar only shows on the map view.
    document.body.classList.toggle('map-active', view === 'map');
    // Leaving the map view always drops any active mobile mode.
    if (view !== 'map' && IS_MOBILE) setMobileMode(null);
}

document.getElementById('btn-stage').addEventListener('click', () => {
    unstaged = items.filter(i => !i.stage);
    stageIndex = 0;
    showView('stage');
    renderStageTargets();
    showStageCard();
});
document.getElementById('btn-done-map').addEventListener('click', () => showView('map'));
document.getElementById('btn-map').addEventListener('click', () => showView('map'));
document.getElementById('btn-map-back').addEventListener('click', () => showView('list'));
document.querySelectorAll('.km-home').forEach(el => {
    el.addEventListener('click', () => showView('list'));
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showView('list'); }
    });
});
document.getElementById('btn-import-map').addEventListener('click', () => showView('import'));
document.getElementById('btn-reset-map').addEventListener('click', async () => {
    const confirmed = await AreYouSure.confirm('This will permanently delete all components, links, areas, labels, and the anchor. You cannot undo this.');
    if (!confirmed) return;
    items = []; links = []; areas = []; labels = []; anchor = ''; anchorLinks = [];
    saveItems(); saveLinks(); saveAreas(); saveLabels(); saveAnchor();
    document.getElementById('anchor-input').value = '';
    renderList();
});
document.getElementById('btn-map-assign').addEventListener('click', () => {
    unstaged = items.filter(i => !i.stage);
    stageIndex = 0;
    showView('stage');
    renderStageTargets();
    showStageCard();
});

// ===== MAP ADD-ITEM MODAL =====
const addItemModal = document.getElementById('add-item-modal');
const modalInput = document.getElementById('modal-item-input');
const modalAddBtn = document.getElementById('modal-add-btn');
const modalStagesEl = document.getElementById('modal-stages');
let modalSelectedStage = '';

let modalPlacePosX = null, modalPlacePosY = null;

function openAddModal() {
    modalInput.value = '';
    modalSelectedStage = '';
    modalPlacePosX = null;
    modalPlacePosY = null;
    modalAddBtn.disabled = true;
    modalStagesEl.innerHTML = STAGES.map(s =>
        `<button class="modal-stage-btn" data-stage="${s.key}">${s.label}</button>`
    ).join('');
    addItemModal.classList.add('open');
    modalInput.focus();
}

function closeAddModal() {
    addItemModal.classList.remove('open');
}

function updateModalAddBtn() {
    modalAddBtn.disabled = !(modalInput.value.trim() && modalSelectedStage);
}

function selectModalStage(stageKey) {
    modalSelectedStage = stageKey;
    const stage = STAGES.find(s => s.key === stageKey);
    modalStagesEl.querySelectorAll('.modal-stage-btn').forEach(b => {
        const match = b.dataset.stage === stageKey;
        b.classList.toggle('selected', match);
        b.style.background = match ? stage.color : '';
        b.style.borderColor = match ? stage.color : '';
    });
    updateModalAddBtn();
}

modalStagesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.modal-stage-btn');
    if (!btn) return;
    selectModalStage(btn.dataset.stage);
});

modalInput.addEventListener('input', updateModalAddBtn);
modalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !modalAddBtn.disabled) modalAddItem();
    if (e.key === 'Escape') closeAddModal();
});

document.getElementById('btn-map-add').addEventListener('click', openAddModal);
document.getElementById('modal-close').addEventListener('click', closeAddModal);
addItemModal.addEventListener('click', (e) => { if (e.target === addItemModal) closeAddModal(); });

modalAddBtn.addEventListener('click', modalAddItem);

function modalAddItem() {
    const text = modalInput.value.trim();
    if (!text || !modalSelectedStage) return;
    modalAddBtn.disabled = true;
    const item = { id: generateId(), text, stage: modalSelectedStage, posX: STAGE_TO_X[modalSelectedStage] || 0.5, posY: nextPosYForStage(modalSelectedStage) };
    if (modalPlacePosX != null) { item.posX = modalPlacePosX; item.posY = modalPlacePosY; }
    items.unshift(item);
    saveItems();
    closeAddModal();
    renderMap();
}

// ===== CONTEXT MENU =====
const ctxMenu = document.getElementById('ctx-menu');
let ctxClickX = 0, ctxClickY = 0;
let ctxTargetAreaId = null;

mapCanvas.addEventListener('contextmenu', (e) => {
    if (areaSelectMode) { e.preventDefault(); return; }
    if (e.target.closest('.map-bubble')) return; // let bubbles use default
    e.preventDefault();
    ctxClickX = e.clientX;
    ctxClickY = e.clientY;

    // Detect if right-click was on an area path
    const areaPath = e.target.closest('.area-path');
    ctxTargetAreaId = areaPath ? areaPath.dataset.areaId : null;
    document.getElementById('ctx-delete-area').style.display = ctxTargetAreaId ? '' : 'none';

    // Show/hide "Clear All Areas" based on whether areas exist
    document.getElementById('ctx-clear-areas').style.display = areas.length > 0 ? '' : 'none';

    // Position menu, keep within viewport
    ctxMenu.classList.add('open');
    const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
    ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - mw - 4) + 'px';
    ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - mh - 4) + 'px';
});

function closeCtxMenu() { ctxMenu.classList.remove('open'); }

document.addEventListener('click', closeCtxMenu);
document.addEventListener('contextmenu', (e) => {
    if (!mapCanvas.contains(e.target) || e.target.closest('.map-bubble')) closeCtxMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtxMenu(); });
window.addEventListener('scroll', closeCtxMenu, true);

ctxMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.ctx-menu-item');
    if (!item) return;
    const action = item.dataset.action;
    closeCtxMenu();

    if (action === 'add-here') {
        // Pre-select stage based on click column
        const rect = mapCanvas.getBoundingClientRect();
        const pctX = (ctxClickX - rect.left) / rect.width;
        const pctY = (ctxClickY - rect.top) / rect.height;
        const colIndex = Math.max(0, Math.min(3, Math.floor(pctX * 4)));
        const stageKey = STAGES[colIndex].key;

        openAddModal();
        // Store snapped click position for placement
        modalPlacePosX = snapToGrid(Math.max(0.02, Math.min(0.98, pctX)));
        modalPlacePosY = snapToGrid(Math.max(0.02, Math.min(0.98, 1 - pctY)));
        selectModalStage(stageKey);
    }

    if (action === 'add-label') addLabelAtClick();
    if (action === 'create-area') enterAreaSelectMode();
    if (action === 'delete-area') deleteArea(ctxTargetAreaId);
    if (action === 'clear-areas') clearAllAreas();
    if (action === 'export-map') {
        const fmt = document.getElementById('export-format-select').value;
        if (fmt === 'png') exportMapPNG();
        else if (fmt === 'json') saveMapData();
        else exportMapSVG();
    }
    if (action === 'save-data') saveMapData();
    if (action === 'import-data') showView('import');
    if (action === 'share-qr') openShareQR();
});

// ===== LABELS =====
const labelCtxMenu = document.getElementById('label-ctx-menu');
let labelCtxTargetId = null;

function closeLabelCtx() { labelCtxMenu.classList.remove('open'); labelCtxTargetId = null; }
document.addEventListener('click', closeLabelCtx);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLabelCtx(); });
window.addEventListener('scroll', closeLabelCtx, true);

document.getElementById('label-ctx-remove').addEventListener('click', () => {
    if (!labelCtxTargetId) return;
    const id = labelCtxTargetId;
    closeLabelCtx();
    labels = labels.filter(l => l.id !== id);
    saveLabels();
    renderMap();
});

function showLabelCtx(e, labelId) {
    e.preventDefault();
    e.stopPropagation();
    closeLabelCtx();
    closeCtxMenu();
    labelCtxTargetId = labelId;
    labelCtxMenu.classList.add('open');
    const mw = labelCtxMenu.offsetWidth, mh = labelCtxMenu.offsetHeight;
    labelCtxMenu.style.left = Math.min(e.clientX, window.innerWidth - mw - 4) + 'px';
    labelCtxMenu.style.top = Math.min(e.clientY, window.innerHeight - mh - 4) + 'px';
}

function addLabelAtClick() {
    const text = prompt('Label text:');
    if (!text || !text.trim()) return;
    const rect = mapCanvas.getBoundingClientRect();
    const posX = Math.max(0.02, Math.min(0.98, (ctxClickX - rect.left) / rect.width));
    const posY = Math.max(0.02, Math.min(0.98, 1 - (ctxClickY - rect.top) / rect.height));
    const label = { id: generateId(), text: text.trim(), posX, posY, width: 100 };
    labels.push(label);
    saveLabels();
    renderMap();
}

function startLabelDrag(e, label, el) {
    e.preventDefault();
    const rect = mapCanvas.getBoundingClientRect();
    const onMove = (ev) => {
        const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX);
        const cy = (ev.touches ? ev.touches[0].clientY : ev.clientY);
        const px = Math.max(0.02, Math.min(0.98, (cx - rect.left) / rect.width));
        const py = Math.max(0.02, Math.min(0.98, 1 - (cy - rect.top) / rect.height));
        el.style.left = (px * 100) + '%';
        el.style.top = ((1 - py) * 100) + '%';
        label._dragX = px;
        label._dragY = py;
    };
    const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchend', onUp);
        if (label._dragX !== undefined) {
            label.posX = label._dragX;
            label.posY = label._dragY;
            delete label._dragX;
            delete label._dragY;
            saveLabels();
        }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
}

function startLabelResize(e, label, el) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX || e.touches[0].clientX;
    const startW = el.offsetWidth;
    const onMove = (ev) => {
        const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX);
        const newW = Math.max(40, Math.min(600, startW + (cx - startX)));
        el.style.width = newW + 'px';
        label._resizeW = newW;
    };
    const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchend', onUp);
        if (label._resizeW !== undefined) {
            label.width = label._resizeW;
            delete label._resizeW;
            saveLabels();
        }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
}

// ===== AREA SELECTION MODE =====
let areaSelectionBar = null;

function enterAreaSelectMode() {
    areaSelectMode = true;
    areaSelectedIds = new Set();
    mapCanvas.classList.add('area-select-active');

    areaSelectionBar = document.createElement('div');
    areaSelectionBar.className = 'area-selection-bar';
    areaSelectionBar.innerHTML = `
        <span>Click on all items that should be included, then click OK</span>
        <div style="display:flex;gap:0.5rem;">
            <button class="btn btn-cancel" id="area-cancel-btn">Cancel</button>
            <button class="btn" id="area-ok-btn" disabled>OK (0 selected)</button>
        </div>
    `;
    document.body.appendChild(areaSelectionBar);

    document.getElementById('area-cancel-btn').addEventListener('click', exitAreaSelectMode);
    document.getElementById('area-ok-btn').addEventListener('click', confirmAreaSelection);
}

function exitAreaSelectMode() {
    areaSelectMode = false;
    areaSelectedIds.clear();
    mapCanvas.classList.remove('area-select-active');
    mapCanvas.querySelectorAll('.map-bubble.area-selected').forEach(b => b.classList.remove('area-selected'));
    if (areaSelectionBar) { areaSelectionBar.remove(); areaSelectionBar = null; }
}

function toggleAreaItem(itemId) {
    if (areaSelectedIds.has(itemId)) areaSelectedIds.delete(itemId);
    else areaSelectedIds.add(itemId);

    const bubble = mapCanvas.querySelector(`.map-bubble[data-id="${CSS.escape(itemId)}"]`);
    if (bubble) bubble.classList.toggle('area-selected', areaSelectedIds.has(itemId));

    const okBtn = document.getElementById('area-ok-btn');
    if (okBtn) {
        const n = areaSelectedIds.size;
        okBtn.disabled = n === 0;
        okBtn.textContent = `OK (${n} selected)`;
    }
}

function confirmAreaSelection() {
    const itemIds = [...areaSelectedIds];
    exitAreaSelectMode();
    if (itemIds.length === 0) return;
    const area = { id: generateId(), itemIds, vertexAdjustments: [], midpointOffsets: [] };
    areas.push(area);
    saveAreas();
    renderLinks();
}

function deleteArea(areaId) {
    if (!areaId) return;
    areas = areas.filter(a => a.id !== areaId);
    saveAreas();
    renderLinks();
}

function clearAllAreas() {
    areas = [];
    saveAreas();
    renderLinks();
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && areaSelectMode) exitAreaSelectMode(); });

// ===== SAVE / IMPORT MAP DATA =====
const KARTMAKARE_FILE_TYPE = 'kartmakare';
const KARTMAKARE_FILE_VERSION = 1;
const COMPACT_VERSION = 2;
const STAGE_KEYS_ORDER = ['genesis', 'custom', 'product', 'commodity'];
const STYLE_KEYS_ORDER = ['solid', 'dashed', 'evolution'];
const POS_SCALE = 1000;
const OFFSET_SCALE = 100;
const ANGLE_SCALE = 1000;
const MP_SCALE = 10;

function encodeCompactV2() {
    const idMap = new Map();
    items.forEach((it, i) => idMap.set(it.id, i));
    const mapId = id => idMap.has(id) ? idMap.get(id) : -1;
    const qp = v => Math.round((+v || 0) * POS_SCALE);

    const cItems = items.map(it => [
        it.text || '',
        it.stage ? STAGE_KEYS_ORDER.indexOf(it.stage) : -1,
        qp(it.posX),
        qp(it.posY),
    ]);

    const cLinks = links.map(l => {
        const s = STYLE_KEYS_ORDER.indexOf(l.style || 'solid');
        return [mapId(l.fromId), mapId(l.toId), s < 0 ? 0 : s];
    }).filter(l => l[0] >= 0 && l[1] >= 0);

    const cAreas = areas.map(a => {
        const ids = (a.itemIds || []).map(mapId).filter(i => i >= 0);
        const adjs = (a.vertexAdjustments || []).map(v => [
            mapId(v.itemId),
            Math.round((v.radiusOffset || 0) * OFFSET_SCALE),
            Math.round((v.handleLenA || 0) * OFFSET_SCALE),
            Math.round((v.handleLenB || 0) * OFFSET_SCALE),
            Math.round((v.handleAngleA || 0) * ANGLE_SCALE),
            Math.round((v.handleAngleB || 0) * ANGLE_SCALE),
        ]).filter(v => v[0] >= 0);
        const mps = (a.midpointOffsets || []).map(m => [
            mapId(m.fromId),
            mapId(m.toId),
            Math.round((m.dx || 0) * MP_SCALE),
            Math.round((m.dy || 0) * MP_SCALE),
        ]).filter(v => v[0] >= 0 && v[1] >= 0);
        if (adjs.length === 0 && mps.length === 0) return [ids];
        if (mps.length === 0) return [ids, adjs];
        return [ids, adjs, mps];
    });

    const cLabels = labels.map(lb => {
        const base = [lb.text || '', qp(lb.posX), qp(lb.posY)];
        if (lb.width != null && lb.width !== 100) base.push(lb.width);
        return base;
    });

    const cAnchorLinks = (anchorLinks || []).map(mapId).filter(i => i >= 0);
    const hasAnchor = !!(anchor && anchor.length);
    const hasAnchorLinks = cAnchorLinks.length > 0;

    const payload = [COMPACT_VERSION, cItems, cLinks, cAreas, cLabels];
    if (hasAnchor || hasAnchorLinks) payload.push(anchor || '');
    if (hasAnchorLinks) payload.push(cAnchorLinks);
    return payload;
}

function decodeCompactV2(arr) {
    if (!Array.isArray(arr) || arr[0] !== COMPACT_VERSION) return null;
    const cItems = arr[1], cLinks = arr[2], cAreas = arr[3], cLabels = arr[4];
    const cAnchor = arr.length > 5 ? arr[5] : '';
    const cAnchorLinks = arr.length > 6 ? arr[6] : [];
    if (!Array.isArray(cItems) || !Array.isArray(cLinks) || !Array.isArray(cAreas) || !Array.isArray(cLabels)) return null;

    const ids = cItems.map(() => generateId());
    const idAt = i => (Number.isInteger(i) && i >= 0 && i < ids.length) ? ids[i] : null;
    const up = v => (+v || 0) / POS_SCALE;

    const outItems = cItems.map((t, i) => ({
        id: ids[i],
        text: String(t[0] || ''),
        stage: (t[1] >= 0 && t[1] < STAGE_KEYS_ORDER.length) ? STAGE_KEYS_ORDER[t[1]] : '',
        posX: up(t[2]),
        posY: up(t[3]),
    }));

    const outLinks = cLinks.map(l => {
        const fromId = idAt(l[0]), toId = idAt(l[1]);
        if (!fromId || !toId) return null;
        return { id: generateId(), fromId, toId, style: STYLE_KEYS_ORDER[l[2]] || 'solid' };
    }).filter(Boolean);

    const outAreas = cAreas.map(a => {
        const aIds = (a[0] || []).map(idAt).filter(Boolean);
        const adjs = (a[1] || []).map(v => {
            const itemId = idAt(v[0]);
            if (!itemId) return null;
            return {
                itemId,
                radiusOffset: (+v[1] || 0) / OFFSET_SCALE,
                handleLenA: (+v[2] || 0) / OFFSET_SCALE,
                handleLenB: (+v[3] || 0) / OFFSET_SCALE,
                handleAngleA: (+v[4] || 0) / ANGLE_SCALE,
                handleAngleB: (+v[5] || 0) / ANGLE_SCALE,
            };
        }).filter(Boolean);
        const mps = (a[2] || []).map(m => {
            const fromId = idAt(m[0]), toId = idAt(m[1]);
            if (!fromId || !toId) return null;
            return { fromId, toId, dx: (+m[2] || 0) / MP_SCALE, dy: (+m[3] || 0) / MP_SCALE };
        }).filter(Boolean);
        return { id: generateId(), itemIds: aIds, vertexAdjustments: adjs, midpointOffsets: mps };
    });

    const outLabels = cLabels.map(l => ({
        id: generateId(),
        text: String(l[0] || ''),
        posX: up(l[1]),
        posY: up(l[2]),
        width: (l.length > 3 && typeof l[3] === 'number') ? l[3] : 100,
    }));

    const outAnchorLinks = (Array.isArray(cAnchorLinks) ? cAnchorLinks : []).map(idAt).filter(Boolean);

    return {
        type: KARTMAKARE_FILE_TYPE,
        version: KARTMAKARE_FILE_VERSION,
        items: outItems,
        links: outLinks,
        areas: outAreas,
        labels: outLabels,
        anchor: typeof cAnchor === 'string' ? cAnchor : '',
        anchorLinks: outAnchorLinks,
    };
}

function saveMapData() {
    downloadFile(JSON.stringify(encodeCompactV2()), 'Kartmakare-data.json', 'application/json');
}

function isKartmakareData(data) {
    return (
        data !== null && typeof data === 'object' &&
        data.type === KARTMAKARE_FILE_TYPE &&
        Array.isArray(data.items) && Array.isArray(data.links) && Array.isArray(data.areas)
    );
}

function normalizeImportData(raw) {
    if (Array.isArray(raw) && raw[0] === COMPACT_VERSION) return decodeCompactV2(raw);
    if (isKartmakareData(raw)) return raw;
    return null;
}

async function tryImportKartmakareFile(file) {
    if (!file) return false;
    try {
        const text = await file.text();
        const data = normalizeImportData(JSON.parse(text));
        if (!data) return false;
        items = data.items;
        links = data.links;
        areas = data.areas;
        labels = Array.isArray(data.labels) ? data.labels : [];
        anchor = typeof data.anchor === 'string' ? data.anchor : '';
        anchorLinks = Array.isArray(data.anchorLinks) ? data.anchorLinks : [];
        saveItems(); saveLinks(); saveAreas(); saveLabels(); saveAnchor();
        syncAnchorInput();
        return true;
    } catch { return false; }
}

// ===== IMPORT VIEW / DROP ZONE =====
const dropZone = document.getElementById('drop-zone');
const dropZoneFeedback = document.getElementById('drop-zone-feedback');
const importFileInput = document.getElementById('import-file-input');
let dropRejectTimer = null;

function resetDropZone() {
    dropZone.classList.remove('drag-over', 'reject');
    dropZoneFeedback.textContent = '';
    dropZoneFeedback.className = 'drop-zone-feedback';
    if (dropRejectTimer) { clearTimeout(dropRejectTimer); dropRejectTimer = null; }
}

function flashReject(msg) {
    dropZone.classList.remove('drag-over');
    dropZone.classList.remove('reject');
    void dropZone.offsetWidth;
    dropZone.classList.add('reject');
    dropZoneFeedback.textContent = msg;
    dropZoneFeedback.className = 'drop-zone-feedback error';
    if (dropRejectTimer) clearTimeout(dropRejectTimer);
    dropRejectTimer = setTimeout(() => {
        dropZone.classList.remove('reject');
        dropZoneFeedback.textContent = '';
        dropZoneFeedback.className = 'drop-zone-feedback';
    }, 2500);
}

async function handleDroppedFile(file) {
    if (!file) return;
    const looksLikeJson = /\.json$/i.test(file.name) || file.type === 'application/json' || file.type === '';
    if (!looksLikeJson) { flashReject('Make sure it\u2019s a Kartmakare JSON file.'); return; }
    const ok = await tryImportKartmakareFile(file);
    if (!ok) { flashReject('Make sure it\u2019s a Kartmakare JSON file.'); return; }
    dropZoneFeedback.textContent = 'Imported. Opening map\u2026';
    dropZoneFeedback.className = 'drop-zone-feedback success';
    setTimeout(() => showView('map'), 400);
}

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', (e) => {
    if (e.target === dropZone) dropZone.classList.remove('drag-over');
});

document.getElementById('drop-zone-browse').addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    importFileInput.value = '';
    if (file) handleDroppedFile(file);
});

// Accept file drops anywhere on the window. handleDroppedFile runs the payload
// through normalizeImportData, so non-Kartmakare JSON is rejected before any state changes.
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}, false);
window.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleDroppedFile(file);
}, false);

// ===== QR SHARE / HASH IMPORT =====
function bytesToB64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
async function gzipString(str) {
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzipToString(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
}

async function buildShareUrl() {
    const json = JSON.stringify(encodeCompactV2());
    const gz = await gzipString(json);
    const payload = bytesToB64url(gz);
    const base = location.origin === 'null' || location.protocol === 'file:'
        ? location.href.split('#')[0]
        : location.origin + location.pathname;
    return base + '#k=' + payload;
}

const shareQrModal = document.getElementById('share-qr-modal');
const shareQrBody = document.getElementById('share-qr-body');
document.getElementById('share-qr-close').addEventListener('click', () => shareQrModal.classList.remove('open'));
shareQrModal.addEventListener('click', (e) => { if (e.target === shareQrModal) shareQrModal.classList.remove('open'); });

async function openShareQR() {
    shareQrBody.innerHTML = '<div class="share-qr-stats">Generating\u2026</div>';
    shareQrModal.classList.add('open');
    try {
        const json = JSON.stringify(encodeCompactV2());
        const gz = await gzipString(json);
        const payload = bytesToB64url(gz);
        const base = location.origin === 'null' || location.protocol === 'file:'
            ? location.href.split('#')[0]
            : location.origin + location.pathname;
        const url = base + '#k=' + payload;

        const qr = KmQR.encode(url);
        if (!qr) {
            shareQrBody.innerHTML = '<div class="share-qr-error">This map is too large for a single QR code (' +
                url.length + ' chars). Export the JSON file and transfer it another way.</div>';
            return;
        }
        const svg = KmQR.renderSVG(qr.modules, { scale: 6, margin: 4 });
        shareQrBody.innerHTML = svg +
            '<div class="share-qr-stats">' + json.length + ' B raw \u2192 ' + gz.length + ' B gzipped \u2192 QR v' + qr.version + '</div>' +
            '<div class="share-qr-url">' + escapeHtml(url) + '</div>';
    } catch (err) {
        shareQrBody.innerHTML = '<div class="share-qr-error">Could not build QR: ' + escapeHtml(err.message || String(err)) + '</div>';
    }
}

// ============ ABOUT MODAL ============
const KARTMAKARE_CANONICAL_URL = 'https://thekmf.github.io/Kartmakare/';
function getKartmakareShareUrl() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
        return location.origin + location.pathname.replace(/index\.html$/, '');
    }
    return KARTMAKARE_CANONICAL_URL;
}
const aboutModal = document.getElementById('about-modal');
const aboutQr = document.getElementById('about-qr');
const aboutUrl = document.getElementById('about-url');
let aboutRendered = false;

function openAbout() {
    aboutModal.classList.add('open');
    if (!aboutRendered) {
        const url = getKartmakareShareUrl();
        aboutUrl.textContent = url;
        try {
            const qr = KmQR.encode(url);
            if (qr) aboutQr.innerHTML = KmQR.renderSVG(qr.modules, { scale: 6, margin: 4 });
        } catch (_) { /* QR is non-critical */ }
        aboutRendered = true;
    }
}
function closeAbout() {
    aboutModal.classList.remove('open');
    aboutUrl.classList.remove('copied');
}

document.querySelectorAll('[data-about-trigger]').forEach(b => b.addEventListener('click', openAbout));
document.getElementById('about-close').addEventListener('click', closeAbout);
aboutModal.addEventListener('click', (e) => { if (e.target === aboutModal) closeAbout(); });
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aboutModal.classList.contains('open')) closeAbout();
});

aboutUrl.addEventListener('click', async () => {
    const url = aboutUrl.textContent;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            aboutUrl.classList.add('copied');
            const original = aboutUrl.textContent;
            aboutUrl.textContent = 'Copied!';
            setTimeout(() => {
                aboutUrl.textContent = original;
                aboutUrl.classList.remove('copied');
            }, 1200);
        }
    } catch (_) { /* clipboard may be blocked, ignore */ }
});

document.getElementById('about-share').addEventListener('click', async () => {
    const url = getKartmakareShareUrl();
    const shareData = {
        url,
        title: 'Kartmakare',
        text: 'Kartmakare — a Wardley Mapping tool',
    };
    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            aboutUrl.classList.add('copied');
            aboutUrl.textContent = 'Link copied to clipboard';
            setTimeout(() => {
                aboutUrl.textContent = url;
                aboutUrl.classList.remove('copied');
            }, 1500);
        }
    } catch (err) {
        if (err && err.name !== 'AbortError') {
            // best-effort fallback
            console.warn('Share failed:', err);
        }
    }
});

async function tryHashImport() {
    const hash = location.hash || '';
    const match = hash.match(/^#k=([A-Za-z0-9_-]+)$/);
    if (!match) return false;
    try {
        const bytes = b64urlToBytes(match[1]);
        const json = await gunzipToString(bytes);
        const data = normalizeImportData(JSON.parse(json));
        if (!data) throw new Error('Not a Kartmakare payload');
        items = data.items;
        links = data.links;
        areas = data.areas;
        labels = Array.isArray(data.labels) ? data.labels : [];
        anchor = typeof data.anchor === 'string' ? data.anchor : '';
        anchorLinks = Array.isArray(data.anchorLinks) ? data.anchorLinks : [];
        saveItems(); saveLinks(); saveAreas(); saveLabels(); saveAnchor();
        syncAnchorInput();
        history.replaceState(null, '', location.pathname + location.search);
        showView('map');
        return true;
    } catch (err) {
        showError('Shared link could not be read.');
        history.replaceState(null, '', location.pathname + location.search);
        return false;
    }
}

// ===== AREA GEOMETRY =====
const AREA_COLORS = [
    { fill: '#5046e5', stroke: '#5046e5' },
    { fill: '#ef4444', stroke: '#ef4444' },
    { fill: '#10b981', stroke: '#10b981' },
    { fill: '#f59e0b', stroke: '#f59e0b' },
    { fill: '#8b5cf6', stroke: '#8b5cf6' },
    { fill: '#06b6d4', stroke: '#06b6d4' },
    { fill: '#ec4899', stroke: '#ec4899' },
];

function convexHull(points) {
    if (points.length <= 2) return points.slice();
    const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (O, A, B) => (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
    const lower = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
        upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
}

// ---- Bezier blob core algorithm ----

function computeBezierBlobFromPoints(points, padding, vertexAdj, aspectRatio, midpointOffsets) {
    if (points.length === 0) return null;

    if (points.length === 1) {
        return { type: 'circle', cx: points[0].x, cy: points[0].y / aspectRatio, r: padding };
    }

    const adjMap = {};
    (vertexAdj || []).forEach(va => { adjMap[va.itemId] = va; });

    // Build midpoint offset lookup: "id1:id2" -> {dx, dy}
    const mpMap = {};
    (midpointOffsets || []).forEach(mo => {
        const key = mo.fromId < mo.toId ? mo.fromId + ':' + mo.toId : mo.toId + ':' + mo.fromId;
        mpMap[key] = mo;
    });

    // 2-point: capsule
    if (points.length === 2) {
        const [a, b] = points;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const perp = angle + Math.PI / 2;
        const k = 0.5523;

        const adjA = adjMap[a.itemId] || {};
        const adjB = adjMap[b.itemId] || {};
        const padA = padding + (adjA.radiusOffset || 0);
        const padB = padding + (adjB.radiusOffset || 0);

        const capA = { x: a.x + Math.cos(angle + Math.PI) * padA, y: a.y + Math.sin(angle + Math.PI) * padA };
        const top  = { x: mx + Math.cos(perp) * ((padA + padB) / 2), y: my + Math.sin(perp) * ((padA + padB) / 2) };
        const capB = { x: b.x + Math.cos(angle) * padB, y: b.y + Math.sin(angle) * padB };
        const bot  = { x: mx + Math.cos(perp + Math.PI) * ((padA + padB) / 2), y: my + Math.sin(perp + Math.PI) * ((padA + padB) / 2) };

        const avgPad = (padA + padB) / 2;
        const segments = [
            { vertex: capA, cpIn: { x: capA.x + Math.cos(perp + Math.PI) * padA * k, y: capA.y + Math.sin(perp + Math.PI) * padA * k }, cpOut: { x: capA.x + Math.cos(perp) * padA * k, y: capA.y + Math.sin(perp) * padA * k }, itemId: a.itemId },
            { vertex: top,  cpIn: { x: top.x + Math.cos(angle + Math.PI) * avgPad * k, y: top.y + Math.sin(angle + Math.PI) * avgPad * k }, cpOut: { x: top.x + Math.cos(angle) * avgPad * k, y: top.y + Math.sin(angle) * avgPad * k }, itemId: null, isMidpoint: true },
            { vertex: capB, cpIn: { x: capB.x + Math.cos(perp) * padB * k, y: capB.y + Math.sin(perp) * padB * k }, cpOut: { x: capB.x + Math.cos(perp + Math.PI) * padB * k, y: capB.y + Math.sin(perp + Math.PI) * padB * k }, itemId: b.itemId },
            { vertex: bot,  cpIn: { x: bot.x + Math.cos(angle) * avgPad * k, y: bot.y + Math.sin(angle) * avgPad * k }, cpOut: { x: bot.x + Math.cos(angle + Math.PI) * avgPad * k, y: bot.y + Math.sin(angle + Math.PI) * avgPad * k }, itemId: null, isMidpoint: true },
        ];
        const finalSegs = segments.map(s => ({
            vertex: { x: s.vertex.x, y: s.vertex.y / aspectRatio },
            cpIn:   { x: s.cpIn.x,   y: s.cpIn.y / aspectRatio },
            cpOut:  { x: s.cpOut.x,  y: s.cpOut.y / aspectRatio },
            itemId: s.itemId, isMidpoint: s.isMidpoint || false,
        }));
        return { type: 'bezier', segments: finalSegs, centroid: { x: mx, y: my / aspectRatio } };
    }

    // 3+ points: full centroid-radial Bezier blob
    const hull = convexHull(points);
    const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
    const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
    const hn = hull.length;

    // Expand hull vertices outward from centroid
    const expanded = hull.map(p => {
        const adj = adjMap[p.itemId] || {};
        const dx = p.x - cx, dy = p.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const effPad = padding + (adj.radiusOffset || 0);
        const radAngle = Math.atan2(dy, dx);
        return {
            x: p.x + (dx / dist) * effPad,
            y: p.y + (dy / dist) * effPad,
            radAngle, itemId: p.itemId, adj,
        };
    });

    // Insert one midpoint between each pair of hull vertices
    const allVertices = [];
    for (let i = 0; i < hn; i++) {
        const curr = expanded[i];
        const next = expanded[(i + 1) % hn];
        allVertices.push({ ...curr, isMidpoint: false });

        // Midpoint default position
        let mpx = (curr.x + next.x) / 2;
        let mpy = (curr.y + next.y) / 2;

        // Apply stored offset
        const key = curr.itemId < next.itemId ? curr.itemId + ':' + next.itemId : next.itemId + ':' + curr.itemId;
        const mo = mpMap[key];
        if (mo) { mpx += mo.dx; mpy += mo.dy * aspectRatio; }

        const dx = mpx - cx, dy = mpy - cy;
        const radAngle = Math.atan2(dy, dx);
        allVertices.push({
            x: mpx, y: mpy, radAngle,
            itemId: null, adj: {}, isMidpoint: true,
            fromId: curr.itemId, toId: next.itemId,
        });
    }

    // Compute cubic Bezier control points for each vertex
    const n = allVertices.length;
    const segments = [];
    for (let i = 0; i < n; i++) {
        const curr = allVertices[i];
        const prev = allVertices[(i - 1 + n) % n];
        const next = allVertices[(i + 1) % n];
        const adj = curr.adj || {};

        const tangent = curr.radAngle + Math.PI / 2;
        const distPrev = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2);
        const distNext = Math.sqrt((curr.x - next.x) ** 2 + (curr.y - next.y) ** 2);
        const armA = BEZIER_BULGE * distPrev / 2 + (adj.handleLenA || 0);
        const armB = BEZIER_BULGE * distNext / 2 + (adj.handleLenB || 0);

        const cpInAngle = tangent + Math.PI + (adj.handleAngleA || 0);
        const cpIn = { x: curr.x + Math.cos(cpInAngle) * armA, y: curr.y + Math.sin(cpInAngle) * armA };
        const cpOutAngle = tangent + (adj.handleAngleB || 0);
        const cpOut = { x: curr.x + Math.cos(cpOutAngle) * armB, y: curr.y + Math.sin(cpOutAngle) * armB };

        segments.push({
            vertex: { x: curr.x, y: curr.y }, cpIn, cpOut,
            itemId: curr.itemId, isMidpoint: curr.isMidpoint,
            fromId: curr.fromId || null, toId: curr.toId || null,
        });
    }

    const finalSegs = segments.map(s => ({
        vertex: { x: s.vertex.x, y: s.vertex.y / aspectRatio },
        cpIn:   { x: s.cpIn.x,   y: s.cpIn.y / aspectRatio },
        cpOut:  { x: s.cpOut.x,  y: s.cpOut.y / aspectRatio },
        itemId: s.itemId, isMidpoint: s.isMidpoint,
        fromId: s.fromId, toId: s.toId,
    }));
    return { type: 'bezier', segments: finalSegs, centroid: { x: cx, y: cy / aspectRatio } };
}

function bezierBlobToSVGPath(blob) {
    if (!blob) return '';
    if (blob.type === 'circle') {
        const r = blob.r;
        return `M ${blob.cx - r},${blob.cy} a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 ${-r * 2},0 Z`;
    }
    if (blob.type !== 'bezier' || !blob.segments.length) return '';
    const segs = blob.segments;
    const n = segs.length;
    let d = `M ${segs[0].vertex.x},${segs[0].vertex.y}`;
    for (let i = 0; i < n; i++) {
        const curr = segs[i];
        const next = segs[(i + 1) % n];
        d += ` C ${curr.cpOut.x},${curr.cpOut.y} ${next.cpIn.x},${next.cpIn.y} ${next.vertex.x},${next.vertex.y}`;
    }
    d += ' Z';
    return d;
}

function computeAreaPath(area, aspectRatio) {
    const points = [];
    area.itemIds.forEach(id => {
        const bubble = mapCanvas.querySelector(`.map-bubble[data-id="${CSS.escape(id)}"]`);
        if (!bubble) return;
        const pos = getBubblePos(bubble);
        points.push({ x: pos.x, y: pos.y * aspectRatio, itemId: id });
    });
    if (points.length === 0) return '';
    const blob = computeBezierBlobFromPoints(points, AREA_PADDING, area.vertexAdjustments, aspectRatio, area.midpointOffsets);
    return bezierBlobToSVGPath(blob);
}

function computeBezierHandles(area, aspectRatio) {
    const points = [];
    area.itemIds.forEach(id => {
        const bubble = mapCanvas.querySelector(`.map-bubble[data-id="${CSS.escape(id)}"]`);
        if (!bubble) return;
        const pos = getBubblePos(bubble);
        points.push({ x: pos.x, y: pos.y * aspectRatio, itemId: id });
    });
    if (points.length < 2) return [];
    const blob = computeBezierBlobFromPoints(points, AREA_PADDING, area.vertexAdjustments, aspectRatio, area.midpointOffsets);
    if (!blob || blob.type !== 'bezier') return [];
    // Return handles for hull vertices AND midpoint vertices
    return blob.segments.filter(s => s.itemId || s.isMidpoint).map((seg, i) => ({
        x: seg.vertex.x, y: seg.vertex.y,
        cpInX: seg.cpIn.x, cpInY: seg.cpIn.y,
        cpOutX: seg.cpOut.x, cpOutY: seg.cpOut.y,
        centroidX: blob.centroid.x, centroidY: blob.centroid.y,
        itemId: seg.itemId, isMidpoint: seg.isMidpoint || false,
        fromId: seg.fromId || null, toId: seg.toId || null,
        segIndex: i, aspectRatio,
    }));
}

function showAreaHandles(areaId) {
    hideAreaHandles();
    hoveredAreaId = areaId;
    const area = areas.find(a => a.id === areaId);
    if (!area) return;
    const svg = document.getElementById('link-svg');
    const rect = mapCanvas.getBoundingClientRect();
    const ar = rect.width / rect.height;
    const pxToVbX = 100 / rect.width;
    const pxToVbY = 100 / rect.height;

    const handles = computeBezierHandles(area, ar);

    handles.forEach(h => {
        const isMp = h.isMidpoint;
        const cls = isMp ? 'area-vertex-handle area-midpoint-handle' : 'area-vertex-handle';
        const g = svgEl('g', { class: cls });
        const dotG = svgEl('g', { transform: `translate(${h.x},${h.y}) scale(${pxToVbX},${pxToVbY})` });
        const hitC = svgEl('circle', { cx: 0, cy: 0, r: HANDLE_HIT_RADIUS, fill: 'transparent', stroke: 'none' });
        const visC = svgEl('circle', { class: isMp ? 'midpoint-dot' : 'handle-dot', cx: 0, cy: 0, r: isMp ? 5 : HANDLE_RADIUS });
        dotG.appendChild(hitC);
        dotG.appendChild(visC);
        g.appendChild(dotG);
        svg.appendChild(g);
        requestAnimationFrame(() => g.classList.add('visible'));

        [hitC, visC].forEach(el => {
            el.addEventListener('mouseenter', cancelHideAreaHandles);
            el.addEventListener('mouseleave', scheduleHideAreaHandles);
            el.addEventListener('mousedown', (e) => {
                if (isMp) startMidpointDrag(areaId, h, g, e);
                else startVertexDrag(areaId, h, g, e);
            });
        });

        currentAreaHandles.push({ el: g, handle: h });
    });
}

function hideAreaHandles() {
    if (draggingHandle) return;
    currentAreaHandles.forEach(({ el }) => el.remove());
    currentAreaHandles = [];
    hoveredAreaId = null;
    cancelHideAreaHandles();
}

function scheduleHideAreaHandles() {
    cancelHideAreaHandles();
    areaHandleHideTimer = setTimeout(() => {
        if (!draggingHandle) hideAreaHandles();
    }, HANDLE_HIDE_DELAY);
}

function cancelHideAreaHandles() {
    if (areaHandleHideTimer) {
        clearTimeout(areaHandleHideTimer);
        areaHandleHideTimer = null;
    }
}

function refreshAreaHandles(areaId, ar, rect) {
    // Re-render all handles (simpler than patching positions for vertex + plus handles)
    showAreaHandles(areaId);
}

function saveVertexAdjustments(areaId) {
    const area = areas.find(a => a.id === areaId);
    if (!area) return;
    // Clean up near-zero adjustments
    area.vertexAdjustments = (area.vertexAdjustments || []).filter(va =>
        Math.abs(va.radiusOffset || 0) > 0.05 ||
        Math.abs(va.handleLenA || 0) > 0.05 ||
        Math.abs(va.handleLenB || 0) > 0.05 ||
        Math.abs(va.handleAngleA || 0) > 0.01 ||
        Math.abs(va.handleAngleB || 0) > 0.01
    );
    saveAreas();
}

function getOrCreateAdj(area, itemId) {
    if (!area.vertexAdjustments) area.vertexAdjustments = [];
    let adj = area.vertexAdjustments.find(va => va.itemId === itemId);
    if (!adj) {
        adj = { itemId, radiusOffset: 0, handleLenA: 0, handleLenB: 0, handleAngleA: 0, handleAngleB: 0 };
        area.vertexAdjustments.push(adj);
    }
    return adj;
}

function startVertexDrag(areaId, handle, handleEl, e) {
    e.preventDefault();
    e.stopPropagation();
    draggingHandle = true;
    cancelHideAreaHandles();

    const area = areas.find(a => a.id === areaId);
    if (!area) return;
    const rect = mapCanvas.getBoundingClientRect();
    const ar = handle.aspectRatio;

    // Record initial radial distance from centroid to vertex (in viewBox coords)
    const initDx = handle.x - handle.centroidX;
    const initDy = handle.y - handle.centroidY;
    const initDist = Math.sqrt(initDx * initDx + initDy * initDy) || 1;
    const ux = initDx / initDist;
    const uy = initDy / initDist;
    const adj = getOrCreateAdj(area, handle.itemId);
    const initOffset = adj.radiusOffset;

    function onMove(ev) {
        const mx = ((ev.clientX - rect.left) / rect.width) * 100;
        const my = ((ev.clientY - rect.top) / rect.height) * 100;
        // Project mouse-centroid vector onto radial unit vector
        const dmx = mx - handle.centroidX;
        const dmy = my - handle.centroidY;
        const projDist = dmx * ux + dmy * uy;
        adj.radiusOffset = initOffset + (projDist - initDist);

        const areaEl = areaElements.find(ae => ae.area.id === areaId);
        if (areaEl) {
            const pathD = computeAreaPath(area, ar);
            if (pathD) areaEl.path.setAttribute('d', pathD);
        }
        refreshAreaHandles(areaId, ar, rect);
    }

    function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        draggingHandle = false;
        saveVertexAdjustments(areaId);
        scheduleHideAreaHandles();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function saveMidpointOffsets(areaId) {
    const area = areas.find(a => a.id === areaId);
    if (!area) return;
    // Clean near-zero offsets
    area.midpointOffsets = (area.midpointOffsets || []).filter(mo =>
        Math.abs(mo.dx) > 0.1 || Math.abs(mo.dy) > 0.1
    );
    saveAreas();
}

function startMidpointDrag(areaId, handle, handleEl, e) {
    e.preventDefault();
    e.stopPropagation();
    draggingHandle = true;
    cancelHideAreaHandles();

    const area = areas.find(a => a.id === areaId);
    if (!area) return;
    if (!area.midpointOffsets) area.midpointOffsets = [];
    const rect = mapCanvas.getBoundingClientRect();
    const ar = handle.aspectRatio;

    // Find or create offset entry for this midpoint
    const key = handle.fromId < handle.toId ? handle.fromId + ':' + handle.toId : handle.toId + ':' + handle.fromId;
    let mo = area.midpointOffsets.find(m => {
        const mk = m.fromId < m.toId ? m.fromId + ':' + m.toId : m.toId + ':' + m.fromId;
        return mk === key;
    });
    if (!mo) {
        mo = { fromId: handle.fromId, toId: handle.toId, dx: 0, dy: 0 };
        area.midpointOffsets.push(mo);
    }

    // Record the initial handle position and mouse position for delta
    const initMx = ((e.clientX - rect.left) / rect.width) * 100;
    const initMy = ((e.clientY - rect.top) / rect.height) * 100;
    const initDx = mo.dx;
    const initDy = mo.dy;

    function onMove(ev) {
        const mx = ((ev.clientX - rect.left) / rect.width) * 100;
        const my = ((ev.clientY - rect.top) / rect.height) * 100;
        mo.dx = initDx + (mx - initMx);
        mo.dy = initDy + (my - initMy);

        const areaEl = areaElements.find(ae => ae.area.id === areaId);
        if (areaEl) {
            const pathD = computeAreaPath(area, ar);
            if (pathD) areaEl.path.setAttribute('d', pathD);
        }
    }

    function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        draggingHandle = false;
        saveMidpointOffsets(areaId);
        scheduleHideAreaHandles();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

// ===== EXPORT =====
document.getElementById('btn-map-export').addEventListener('click', () => {
    const fmt = document.getElementById('export-format-select').value;
    if (fmt === 'png') exportMapPNG();
    else if (fmt === 'json') saveMapData();
    else exportMapSVG();
});

function buildExportSVGString() {
    const rect = mapCanvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const hh = EXPORT_HEADER_H;
    const fontStack = "'Inter','SF Pro Display',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

    const svg = svgEl('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: `0 0 ${w} ${h}`, width: w, height: h, 'font-family': fontStack,
    });

    // Background + header
    svg.appendChild(svgEl('rect', { width: w, height: h, fill: '#f8f8fa' }));
    svg.appendChild(svgEl('rect', { width: w, height: hh, fill: '#ffffff' }));
    svg.appendChild(svgEl('line', { x1: 0, y1: hh, x2: w, y2: hh, stroke: '#e8e8ee', 'stroke-width': 1 }));

    // Column separators
    [0.25, 0.5, 0.75].forEach(pct => {
        svg.appendChild(svgEl('line', { x1: w * pct, y1: 0, x2: w * pct, y2: h, stroke: '#e8e8ee', 'stroke-width': 1 }));
    });

    // Column headers (use STAGES array instead of hardcoded labels)
    STAGES.forEach((stage, i) => {
        const txt = svgEl('text', {
            x: w * (i + 0.5) / STAGES.length, y: hh / 2,
            'text-anchor': 'middle', 'dominant-baseline': 'central',
            'font-size': 11, 'font-weight': 600, 'letter-spacing': '0.1em', fill: '#6e6e82',
        });
        txt.textContent = stage.label.toUpperCase();
        svg.appendChild(txt);
    });

    // Y-axis labels
    const yLabelAttrs = { 'font-size': 9, 'font-weight': 600, 'letter-spacing': '0.1em', fill: '#a0a0b4' };
    const yTop = svgEl('text', { x: 8, y: hh + 16, ...yLabelAttrs });
    yTop.textContent = 'VISIBLE';
    svg.appendChild(yTop);
    const yBot = svgEl('text', { x: 8, y: h - 8, ...yLabelAttrs });
    yBot.textContent = 'INVISIBLE';
    svg.appendChild(yBot);

    // Anchor
    if (anchor) {
        const anchorTxt = svgEl('text', {
            x: w / 2, y: hh + 14,
            'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: '#1a1a2e',
        });
        anchorTxt.textContent = anchor;
        svg.appendChild(anchorTxt);
        // Underline
        const tw = anchor.length * 7; // approximate text width
        svg.appendChild(svgEl('line', {
            x1: w / 2 - tw / 2, y1: hh + 18, x2: w / 2 + tw / 2, y2: hh + 18,
            stroke: '#5046e5', 'stroke-width': 2,
        }));
    }

    // Areas
    const exportAr = w / h;
    areas.forEach((area, idx) => {
        const pts = [];
        area.itemIds.forEach(id => {
            const it = items.find(i => i.id === id);
            if (!it || !it.stage) return;
            pts.push({ x: it.posX * w, y: (1 - it.posY) * h * exportAr, itemId: id });
        });
        if (pts.length === 0) return;
        // Scale midpoint offsets from viewBox % to export pixel space
        const exportMpOffsets = (area.midpointOffsets || []).map(mo => ({
            ...mo, dx: mo.dx * w / 100, dy: mo.dy,
        }));
        const blob = computeBezierBlobFromPoints(pts, EXPORT_AREA_PADDING, area.vertexAdjustments, exportAr, exportMpOffsets);
        const pathD = bezierBlobToSVGPath(blob);
        if (!pathD) return;
        const color = AREA_COLORS[idx % AREA_COLORS.length];
        svg.appendChild(svgEl('path', {
            d: pathD, fill: color.fill, 'fill-opacity': 0.10, stroke: color.stroke, 'stroke-width': 2,
        }));
    });

    // Arrow marker for exported SVG
    const expDefs = svgEl('defs', {});
    const expMarker = svgEl('marker', {
        id: 'exp-evo-arrow', viewBox: '0 0 10 10', refX: 10, refY: 5,
        markerWidth: 12, markerHeight: 12, orient: 'auto-start-reverse',
    });
    expMarker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#000000' }));
    expDefs.appendChild(expMarker);
    svg.appendChild(expDefs);

    // Links
    links.forEach(link => {
        const fromItem = items.find(i => i.id === link.fromId);
        const toItem = items.find(i => i.id === link.toId);
        if (!fromItem || !toItem || !fromItem.stage || !toItem.stage) return;
        const lineEl = svgEl('line', {
            x1: fromItem.posX * w, y1: (1 - fromItem.posY) * h,
            x2: toItem.posX * w, y2: (1 - toItem.posY) * h,
            stroke: '#000000', 'stroke-width': 1.5,
        });
        if (link.style === 'dashed') lineEl.setAttribute('stroke-dasharray', '6,4');
        if (link.style === 'evolution') {
            lineEl.setAttribute('stroke-width', '3');
            lineEl.setAttribute('stroke-dasharray', '8,5');
            lineEl.setAttribute('marker-end', 'url(#exp-evo-arrow)');
        }
        svg.appendChild(lineEl);
    });

    // Anchor links
    if (anchor && anchorLinks.length > 0) {
        const anchorX = w / 2;
        const anchorY = hh + 20;
        anchorLinks.forEach(itemId => {
            const toItem = items.find(i => i.id === itemId);
            if (!toItem || !toItem.stage) return;
            svg.appendChild(svgEl('line', {
                x1: anchorX, y1: anchorY,
                x2: toItem.posX * w, y2: (1 - toItem.posY) * h,
                stroke: '#000000', 'stroke-width': 1.5,
            }));
        });
    }

    // Bubbles
    items.filter(i => i.stage).forEach(item => {
        const cx = item.posX * w;
        const cy = (1 - item.posY) * h;
        const isEvolved = !!item.evolvedFrom;
        const circleAttrs = {
            cx, cy, r: EXPORT_BUBBLE_RADIUS,
            fill: isEvolved ? 'none' : '#ffffff',
            stroke: '#1a1a2e', 'stroke-width': 2,
        };
        if (isEvolved) circleAttrs['stroke-dasharray'] = '4,3';
        svg.appendChild(svgEl('circle', circleAttrs));
        const label = svgEl('text', {
            x: cx, y: cy - 18, 'text-anchor': 'middle', 'font-size': 10,
            'font-weight': 500, fill: '#1a1a2e',
            'font-style': isEvolved ? 'italic' : 'normal',
            opacity: isEvolved ? 0.6 : 1,
        });
        label.textContent = item.text;
        svg.appendChild(label);
    });

    // Labels
    labels.forEach(label => {
        const lx = label.posX * w;
        const ly = (1 - label.posY) * h;
        const lw = label.width || 100;
        const padding = 4;
        const fontSize = 10;
        const lineHeight = fontSize * 1.3;

        // Word-wrap text to fit width
        const words = label.text.split(/\s+/);
        const lines = [];
        let currentLine = '';
        words.forEach(word => {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            if (testLine.length * fontSize * 0.6 > lw - padding * 2 && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        });
        if (currentLine) lines.push(currentLine);

        const textH = lines.length * lineHeight + padding * 2;
        const boxX = lx - lw / 2;
        const boxY = ly - textH / 2;

        // Drop shadow (3px offset, solid black)
        svg.appendChild(svgEl('rect', {
            x: boxX + 3, y: boxY + 3, width: lw, height: textH,
            fill: '#1a1a2e',
        }));
        // White box with black border
        svg.appendChild(svgEl('rect', {
            x: boxX, y: boxY, width: lw, height: textH,
            fill: '#ffffff', stroke: '#1a1a2e', 'stroke-width': 1.5,
        }));
        // Text lines
        lines.forEach((line, i) => {
            const txt = svgEl('text', {
                x: boxX + padding, y: boxY + padding + (i + 0.75) * lineHeight,
                'text-anchor': 'start', 'font-size': fontSize, fill: '#1a1a2e',
            });
            txt.textContent = line;
            svg.appendChild(txt);
        });
    });

    return new XMLSerializer().serializeToString(svg);
}

function exportMapSVG() {
    downloadFile(buildExportSVGString(), 'wardley-map.svg', 'image/svg+xml;charset=utf-8');
}

function buildMapPNGBlob(scale = 2) {
    const rect = mapCanvas.getBoundingClientRect();
    const w = rect.width * scale;
    const h = rect.height * scale;
    const svgStr = buildExportSVGString();
    return new Promise((resolve, reject) => {
        const img = new Image();
        const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#f8f8fa';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/png');
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG image failed to load')); };
        img.src = url;
    });
}

function exportMapPNG() {
    buildMapPNGBlob(2).then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'wardley-map.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }).catch(err => showError('Could not export PNG: ' + (err.message || err)));
}

// ===== DATA LOAD/SAVE =====
function loadItems() { items = storeRead(STORAGE_KEYS.items); }
function loadLinks() { links = storeRead(STORAGE_KEYS.links); }
function loadAreas() { areas = storeRead(STORAGE_KEYS.areas); }
function loadLabels() { labels = storeRead(STORAGE_KEYS.labels); }
function loadAnchor() { const meta = storeReadMeta(); anchor = meta.anchor || ''; anchorLinks = meta.anchorLinks || []; }
function saveItems() { storeWrite(STORAGE_KEYS.items, items); }
function saveLinks() { storeWrite(STORAGE_KEYS.links, links); }
function saveAreas() { storeWrite(STORAGE_KEYS.areas, areas); }
function saveLabels() { storeWrite(STORAGE_KEYS.labels, labels); }
function saveAnchor() { storeWriteMeta({ anchor, anchorLinks }); }

// ===== LIST VIEW =====
let editingItemId = null;

function renderList() {
    if (items.length === 0) {
        itemsList.innerHTML = '<div class="empty-state"><p>No components yet.<br>Add one above.</p></div>';
        return;
    }
    itemsList.innerHTML = items.map(item => {
        const isEditing = editingItemId === item.id;
        return `
        <div class="list-item ${isEditing ? 'editing' : ''}" data-id="${escapeHtml(item.id)}">
            ${isEditing
                ? `<input class="list-item-edit-input" value="${escapeHtml(item.text)}" maxlength="200" autocomplete="off" spellcheck="false">`
                : `<span class="list-item-text">${escapeHtml(item.text)}</span>`
            }
            ${item.stage ? `<span class="stage-badge-wrap"><span class="stage-badge stage-${item.stage}">${escapeHtml(stageLabel(item.stage))}</span><button class="stage-remove" data-id="${escapeHtml(item.id)}" title="Remove stage">&times;</button></span>` : ''}
            <button class="item-delete" data-id="${escapeHtml(item.id)}">${ICONS.trash}</button>
        </div>`;
    }).join('');

    if (editingItemId) {
        const input = itemsList.querySelector('.list-item-edit-input');
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }

    // Disable "Assign Stages" when all items have a stage
    const stageBtn = document.getElementById('btn-stage');
    const assigned = items.filter(i => i.stage).length;
    const unassigned = items.length - assigned;
    stageBtn.disabled = items.length > 0 && unassigned === 0;

    // Disable "Let's Map" when fewer than 2 components have stages
    document.getElementById('btn-map').disabled = assigned < 2;
}

itemsList.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.item-delete');
    if (deleteBtn) { e.stopPropagation(); deleteItem(deleteBtn.dataset.id); return; }

    const removeStageBtn = e.target.closest('.stage-remove');
    if (removeStageBtn) { e.stopPropagation(); removeItemStage(removeStageBtn.dataset.id); return; }

    const row = e.target.closest('.list-item');
    if (!row) return;
    const id = row.dataset.id;

    if (editingItemId === id) return;
    if (editingItemId) saveEdit();
    editingItemId = id;
    renderList();
});

itemsList.addEventListener('keydown', (e) => {
    if (!editingItemId) return;
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); editingItemId = null; renderList(); }
});

itemsList.addEventListener('focusout', (e) => {
    if (!editingItemId) return;
    const input = itemsList.querySelector('.list-item-edit-input');
    if (input && e.target === input) {
        setTimeout(() => {
            if (!itemsList.contains(document.activeElement) || !document.activeElement.closest('.list-item.editing')) {
                saveEdit();
            }
        }, 0);
    }
});

function saveEdit() {
    if (!editingItemId) return;
    const input = itemsList.querySelector('.list-item-edit-input');
    const newText = input ? input.value.trim() : '';
    const item = items.find(i => i.id === editingItemId);
    editingItemId = null;

    if (!item || !newText || newText === item.text) { renderList(); return; }

    item.text = newText;
    saveItems();
    renderList();
}

function removeItemStage(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.stage = '';
    saveItems();
    renderList();
}

function addItem() {
    const text = itemInput.value.trim();
    if (!text) return;
    const item = { id: generateId(), text, stage: '', posX: 0, posY: 0 };
    items.unshift(item);
    saveItems();
    itemInput.value = '';
    renderList();
}

function deleteItem(id) {
    if (editingItemId === id) editingItemId = null;
    const evolvedIds = items.filter(i => i.evolvedFrom === id).map(i => i.id);
    const removeIds = new Set([id, ...evolvedIds]);
    items = items.filter(i => !removeIds.has(i.id));
    links = links.filter(l => !removeIds.has(l.fromId) && !removeIds.has(l.toId));
    areas = areas.map(a => ({ ...a, itemIds: a.itemIds.filter(iid => !removeIds.has(iid)) })).filter(a => a.itemIds.length > 0);
    anchorLinks = anchorLinks.filter(aid => !removeIds.has(aid));
    saveItems();
    saveLinks();
    saveAreas();
    saveAnchor();
    renderList();
}

addBtn.addEventListener('click', addItem);
itemInput.addEventListener('keydown', e => { if (e.key === 'Enter') addItem(); });

// ===== ANCHOR INPUT =====
const anchorInput = document.getElementById('anchor-input');

function syncAnchorInput() {
    anchorInput.value = anchor;
}

function saveAnchorFromInput() {
    const text = anchorInput.value.trim();
    if (text === anchor) return;
    anchor = text;
    saveAnchor();
}

anchorInput.addEventListener('blur', saveAnchorFromInput);
anchorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); anchorInput.blur(); }
});

// ===== STAGE VIEW (horizontal targets) =====
const SNAP_DISTANCE = 80;
let stageTargetEls = [];
let stageDragActive = false;

function renderStageTargets() {
    const container = document.getElementById('stage-targets');
    container.innerHTML = '';
    stageTargetEls = [];
    STAGES.forEach(stage => {
        const el = document.createElement('div');
        el.className = 'stage-target';
        el.textContent = stage.label;
        el.dataset.stage = stage.key;
        container.appendChild(el);
        stageTargetEls.push({ el, stage: stage.key, color: stage.color });
    });
}

function resetStageTargets() {
    stageTargetEls.forEach(({ el }) => {
        el.classList.remove('hot');
        el.style.borderColor = '';
        el.style.background = '';
        el.style.color = '';
    });
}

function updateTargetProximity(ghostX, ghostY) {
    let closest = null, closestDist = Infinity;
    stageTargetEls.forEach(t => {
        const r = t.el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dist = Math.sqrt((ghostX - cx) ** 2 + (ghostY - cy) ** 2);
        const isHot = dist < SNAP_DISTANCE;
        t.el.classList.toggle('hot', isHot);
        if (isHot) {
            t.el.style.borderColor = t.color;
            t.el.style.background = t.color + '18';
            t.el.style.color = t.color;
        } else {
            t.el.style.borderColor = '';
            t.el.style.background = '';
            t.el.style.color = '';
        }
        if (dist < closestDist) { closestDist = dist; closest = t; }
    });
    return closestDist < SNAP_DISTANCE ? closest : null;
}

function showStageCard() {
    resetStageTargets();
    if (stageIndex >= unstaged.length) {
        sortCardWrap.style.display = 'none';
        document.getElementById('stage-targets').style.display = 'none';
        document.querySelector('.sort-footer').style.display = 'none';
        sortProgress.style.display = 'none';
        sortDone.style.display = '';
        return;
    }
    sortCardWrap.style.display = '';
    document.getElementById('stage-targets').style.display = '';
    document.querySelector('.sort-footer').style.display = '';
    sortProgress.style.display = '';
    sortDone.style.display = 'none';

    const item = unstaged[stageIndex];
    sortProgress.textContent = `${stageIndex + 1} of ${unstaged.length}`;
    sortCard.className = 'sort-card';
    sortCard.innerHTML = `<div class="sort-card-text">${escapeHtml(item.text)}</div>`;
}

let stageDragStartX = 0, stageDragStartY = 0;

function onStageDragStart(e) {
    if (stageIndex >= unstaged.length) return;
    e.preventDefault();
    stageDragActive = true;
    const pt = e.touches ? e.touches[0] : e;
    stageDragStartX = pt.clientX;
    stageDragStartY = pt.clientY;
    sortCard.style.transition = 'transform 0.15s ease';
    sortCard.style.transform = 'scale(0.7)';
    sortCard.style.zIndex = '30';
    sortCard.style.position = 'relative';
    setTimeout(() => { if (stageDragActive) sortCard.style.transition = 'none'; }, 150);
}

function onStageDragMove(e) {
    if (!stageDragActive) return;
    e.preventDefault();
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - stageDragStartX;
    const dy = pt.clientY - stageDragStartY;
    sortCard.style.transform = `translate(${dx}px, ${dy}px) scale(0.7)`;
    updateTargetProximity(pt.clientX, pt.clientY);
}

async function onStageDragEnd(e) {
    if (!stageDragActive) return;
    stageDragActive = false;

    const pt = e.changedTouches ? e.changedTouches[0] : e;
    const snapped = updateTargetProximity(pt.clientX, pt.clientY);
    resetStageTargets();

    if (snapped) {
        const item = unstaged[stageIndex];
        const i = items.find(x => x.id === item.id);
        if (i) {
            i.stage = snapped.stage;
            i.posX = STAGE_TO_X[snapped.stage] || 0.5;
            i.posY = nextPosYForStage(snapped.stage);
            saveItems();
        }

        sortCard.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        sortCard.style.opacity = '0';
        await new Promise(r => setTimeout(r, 250));

        // Reset, position next card off-screen right, then slide in horizontally
        sortCard.style.transition = 'none';
        sortCard.style.transform = 'translateX(120%)';
        sortCard.style.opacity = '1';
        sortCard.style.zIndex = '';
        sortCard.style.position = '';
        stageIndex++;
        showStageCard();
        sortCard.offsetHeight; // force reflow
        sortCard.style.transition = 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)';
        sortCard.style.transform = '';
        setTimeout(() => { sortCard.style.cssText = ''; }, 350);
    } else {
        // Bounce back
        sortCard.style.transition = 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
        sortCard.style.transform = '';
        setTimeout(() => { sortCard.style.cssText = ''; }, 350);
    }
}

sortCard.addEventListener('mousedown', onStageDragStart);
sortCard.addEventListener('touchstart', onStageDragStart, { passive: false });
window.addEventListener('mousemove', onStageDragMove);
window.addEventListener('touchmove', onStageDragMove, { passive: false });
window.addEventListener('mouseup', onStageDragEnd);
window.addEventListener('touchend', onStageDragEnd);

document.getElementById('btn-skip').addEventListener('click', () => { stageIndex++; showStageCard(); });

// ===== MAP VIEW =====
const GRID_SIZE = 40;
const PUSH_RADIUS = 80;
const PUSH_STRENGTH = 30;

function snapToGrid(val) { return Math.round(val * GRID_SIZE) / GRID_SIZE; }

// --- Connect mode state ---
let connectMode = false;
let connectFromId = null;
let connectMouseLine = null;

// --- Anchor connect mode state ---
let anchorConnectMode = false;
let anchorConnectMouseLine = null;
let anchorLinkElements = [];

function startConnect(itemId) {
    if (connectMode && connectFromId === itemId) { cancelConnect(); return; }
    cancelConnect();
    if (anchorConnectMode) cancelAnchorConnect();
    if (evolveMode) cancelEvolve();
    connectMode = true;
    connectFromId = itemId;
    const bubble = mapCanvas.querySelector(`.map-bubble[data-id="${CSS.escape(itemId)}"]`);
    if (bubble) bubble.classList.add('connecting');
    mapCanvas.classList.add('connect-active');
    mapCanvas.style.cursor = 'crosshair';

    const fromPos = getBubblePos(bubble);
    connectMouseLine = svgEl('line', {
        stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-dasharray': '6,4', opacity: 0.6,
        x1: fromPos.x, y1: fromPos.y, x2: fromPos.x, y2: fromPos.y,
    });
    connectMouseLine.style.vectorEffect = 'non-scaling-stroke';

    renderLinks();
}

function cancelConnect() {
    if (connectFromId) {
        const bubble = mapCanvas.querySelector(`.map-bubble[data-id="${CSS.escape(connectFromId)}"]`);
        if (bubble) bubble.classList.remove('connecting');
    }
    connectMode = false;
    connectFromId = null;
    connectMouseLine = null;
    mapCanvas.classList.remove('connect-active');
    mapCanvas.style.cursor = '';
    renderLinks();
    if (IS_MOBILE) updateMobileHint();
}

function completeConnect(toId) {
    if (!connectMode || !connectFromId || connectFromId === toId) { cancelConnect(); return; }
    const fromId = connectFromId;
    cancelConnect();
    const existing = links.find(l => (l.fromId === fromId && l.toId === toId) || (l.fromId === toId && l.toId === fromId));
    if (existing) { showError('Link already exists'); renderLinks(); return; }
    const link = { id: generateId(), fromId, toId, style: 'solid' };
    links.push(link);
    saveLinks();
    renderLinks();
}

mapCanvas.addEventListener('mousemove', (e) => {
    // Evolve ghost: follow mouse X only (Y is locked)
    if (evolveMode && evolveGhostEl) {
        const rect = mapCanvas.getBoundingClientRect();
        const pctX = (e.clientX - rect.left) / rect.width * 100;
        evolveGhostEl.style.left = Math.max(2, Math.min(98, pctX)) + '%';
        return;
    }
    if (anchorConnectMode && anchorConnectMouseLine) {
        const rect = mapCanvas.getBoundingClientRect();
        anchorConnectMouseLine.setAttribute('x2', (e.clientX - rect.left) / rect.width * 100);
        anchorConnectMouseLine.setAttribute('y2', (e.clientY - rect.top) / rect.height * 100);
        renderLinks();
        return;
    }
    if (!connectMode || !connectMouseLine) return;
    const rect = mapCanvas.getBoundingClientRect();
    connectMouseLine.setAttribute('x2', (e.clientX - rect.left) / rect.width * 100);
    connectMouseLine.setAttribute('y2', (e.clientY - rect.top) / rect.height * 100);
    renderLinks();
});

mapCanvas.addEventListener('click', (e) => {
    // Evolve mode: place ghost on click (not on a bubble)
    if (evolveMode && !e.target.closest('.map-bubble')) {
        e.stopPropagation();
        const rect = mapCanvas.getBoundingClientRect();
        const pctX = (e.clientX - rect.left) / rect.width * 100;
        completeEvolve(pctX);
        return;
    }
    if (anchorConnectMode && !e.target.closest('.map-bubble') && !e.target.closest('.map-anchor')) cancelAnchorConnect();
    if (connectMode && !e.target.closest('.map-bubble') && !e.target.closest('.map-anchor')) cancelConnect();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && evolveMode) cancelEvolve();
    if (e.key === 'Escape' && anchorConnectMode) cancelAnchorConnect();
    if (e.key === 'Escape' && connectMode) cancelConnect();
});

// --- Evolution placement mode ---
let evolveMode = false;
let evolveSourceItem = null;
let evolveGhostEl = null;

function startEvolve(item) {
    if (evolveMode) cancelEvolve();
    cancelConnect();
    cancelAnchorConnect();
    evolveMode = true;
    evolveSourceItem = item;
    mapCanvas.style.cursor = 'crosshair';

    // Create ghost element
    evolveGhostEl = document.createElement('div');
    evolveGhostEl.className = 'evolve-ghost';
    // Lock Y to same as source
    evolveGhostEl.style.top = ((1 - item.posY) * 100) + '%';
    evolveGhostEl.style.left = (item.posX * 100) + '%';
    evolveGhostEl.innerHTML = `
        <div class="map-bubble-label">${escapeHtml(item.text)}</div>
        <div class="map-bubble-circle"></div>
    `;
    mapCanvas.appendChild(evolveGhostEl);
}

function cancelEvolve() {
    if (!evolveMode) return;
    evolveMode = false;
    evolveSourceItem = null;
    if (evolveGhostEl) { evolveGhostEl.remove(); evolveGhostEl = null; }
    mapCanvas.style.cursor = '';
}

function completeEvolve(pctX) {
    if (!evolveMode || !evolveSourceItem) return;
    const source = evolveSourceItem;
    cancelEvolve();

    const newStage = stageFromX(pctX);
    const newPosX = pctX / 100;
    const newPosY = source.posY;

    const evolvedItem = { id: generateId(), text: source.text, stage: newStage, posX: newPosX, posY: newPosY, evolvedFrom: source.id };
    items.unshift(evolvedItem);
    saveItems();

    const evoLink = { id: generateId(), fromId: source.id, toId: evolvedItem.id, style: 'evolution' };
    links.push(evoLink);

    const sourceLinks = links.filter(l =>
        (l.fromId === source.id || l.toId === source.id) && l.id !== evoLink.id
    );
    for (const sl of sourceLinks) {
        const otherId = sl.fromId === source.id ? sl.toId : sl.fromId;
        if (otherId === evolvedItem.id) continue;
        const dashedLink = { id: generateId(), fromId: evolvedItem.id, toId: otherId, style: 'dashed' };
        links.push(dashedLink);
    }
    saveLinks();

    renderMap();
}

// --- Anchor connect helpers ---
function getAnchorSvgPos() {
    const anchorEl = mapCanvas.querySelector('.map-anchor');
    if (!anchorEl) return null;
    const canvasRect = mapCanvas.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    return {
        x: ((anchorRect.left + anchorRect.width / 2) - canvasRect.left) / canvasRect.width * 100,
        y: (anchorRect.bottom - canvasRect.top) / canvasRect.height * 100,
    };
}

function startAnchorConnect() {
    if (anchorConnectMode) { cancelAnchorConnect(); return; }
    if (connectMode) cancelConnect();
    anchorConnectMode = true;
    mapCanvas.classList.add('connect-active');
    mapCanvas.style.cursor = 'crosshair';

    const anchorEl = mapCanvas.querySelector('.map-anchor');
    if (anchorEl) anchorEl.classList.add('connecting');

    const anchorPos = getAnchorSvgPos();
    if (anchorPos) {
        anchorConnectMouseLine = svgEl('line', {
            stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-dasharray': '6,4', opacity: 0.6,
            x1: anchorPos.x, y1: anchorPos.y, x2: anchorPos.x, y2: anchorPos.y,
        });
        anchorConnectMouseLine.style.vectorEffect = 'non-scaling-stroke';
    }
    renderLinks();
}

function cancelAnchorConnect() {
    if (!anchorConnectMode) return;
    anchorConnectMode = false;
    anchorConnectMouseLine = null;
    const anchorEl = mapCanvas.querySelector('.map-anchor');
    if (anchorEl) anchorEl.classList.remove('connecting');
    mapCanvas.classList.remove('connect-active');
    mapCanvas.style.cursor = '';
    renderLinks();
}

function completeAnchorConnect(toId) {
    if (!anchorConnectMode) return;
    cancelAnchorConnect();
    if (anchorLinks.includes(toId)) return;
    anchorLinks.push(toId);
    saveAnchor();
    renderLinks();
}

// Item→Anchor direction: component "Connect" button was clicked, then user clicks anchor
function completeAnchorLinkFromItem(itemId) {
    if (!itemId) return;
    cancelConnect();
    if (anchorLinks.includes(itemId)) { renderLinks(); return; }
    anchorLinks.push(itemId);
    saveAnchor();
    renderLinks();
}

// --- Link rendering ---
let linkRenderPending = false;
let linkElements = []; // cached refs for lightweight position updates

function scheduleRenderLinks() {
    if (linkRenderPending) return;
    linkRenderPending = true;
    requestAnimationFrame(() => { renderLinks(); linkRenderPending = false; });
}

function getBubblePos(bubble) {
    return { x: parseFloat(bubble.style.left), y: parseFloat(bubble.style.top) };
}

function renderLinks() {
    const svg = document.getElementById('link-svg');
    const rect = mapCanvas.getBoundingClientRect();
    currentAreaHandles = [];
    hoveredAreaId = null;
    cancelHideAreaHandles();
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    linkElements = [];
    anchorLinkElements = [];

    // Arrow marker for evolution lines
    const defs = svgEl('defs', {});
    const marker = svgEl('marker', {
        id: 'evo-arrow', viewBox: '0 0 10 10', refX: 10, refY: 5,
        markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse',
        markerUnits: 'strokeWidth',
    });
    marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#000000' }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    const pxToVbX = 100 / rect.width;
    const pxToVbY = 100 / rect.height;

    // Areas (behind links)
    areaElements = [];
    const ar = rect.width / rect.height;
    areas.forEach((area, idx) => {
        const pathD = computeAreaPath(area, ar);
        if (!pathD) return;
        const color = AREA_COLORS[idx % AREA_COLORS.length];
        const pathEl = svgEl('path', { class: 'area-path', d: pathD, fill: color.fill, stroke: color.stroke });
        pathEl.dataset.areaId = area.id;
        svg.appendChild(pathEl);
        areaElements.push({ area, path: pathEl });

        pathEl.addEventListener('mouseenter', () => {
            cancelHideAreaHandles();
            if (hoveredAreaId !== area.id) showAreaHandles(area.id);
        });
        pathEl.addEventListener('mouseleave', scheduleHideAreaHandles);
    });

    // Links
    links.forEach(link => {
        const fromBubble = mapCanvas.querySelector(`.map-bubble[data-id="${CSS.escape(link.fromId)}"]`);
        const toBubble = mapCanvas.querySelector(`.map-bubble[data-id="${CSS.escape(link.toId)}"]`);
        if (!fromBubble || !toBubble) return;

        const from = getBubblePos(fromBubble);
        const to = getBubblePos(toBubble);
        const lineAttrs = { x1: from.x, y1: from.y, x2: to.x, y2: to.y };

        // Choose line class based on link style
        const lineClass = link.style === 'dashed' ? 'link-line-dashed'
            : link.style === 'evolution' ? 'link-line-evolution'
            : 'link-line';
        const line = svgEl('line', { class: lineClass, ...lineAttrs });
        if (link.style === 'evolution') line.setAttribute('marker-end', 'url(#evo-arrow)');
        svg.appendChild(line);

        const hitLine = svgEl('line', { class: 'link-hit-area', ...lineAttrs });
        svg.appendChild(hitLine);

        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;

        // Midpoint delete button (pixel-scale transform for consistent sizing)
        const group = svgEl('g', {
            class: 'link-midpoint',
            transform: `translate(${midX},${midY}) scale(${pxToVbX},${pxToVbY})`,
        });
        group.dataset.linkId = link.id;
        group.appendChild(svgEl('circle', {
            cx: 0, cy: 0, r: LINK_MIDPOINT_RADIUS,
            fill: 'var(--surface)', stroke: 'var(--down)', 'stroke-width': 1.5,
        }));
        group.appendChild(svgEl('line', {
            x1: -5, y1: 0, x2: 5, y2: 0,
            stroke: 'var(--down)', 'stroke-width': 2.5, 'stroke-linecap': 'round',
        }));
        svg.appendChild(group);

        const showGroup = () => { group.style.opacity = '1'; };
        const hideGroup = () => { group.style.opacity = '0'; };
        hitLine.addEventListener('mouseenter', showGroup);
        hitLine.addEventListener('mouseleave', hideGroup);
        group.addEventListener('mouseenter', showGroup);
        group.addEventListener('mouseleave', hideGroup);
        group.addEventListener('click', (e) => {
            e.stopPropagation();
            if (link.style === 'evolution') {
                const evolvedId = link.toId;
                const evolvedIds = items.filter(i => i.evolvedFrom === evolvedId).map(i => i.id);
                const removeIds = new Set([evolvedId, ...evolvedIds]);
                items = items.filter(i => !removeIds.has(i.id));
                links = links.filter(l => !removeIds.has(l.fromId) && !removeIds.has(l.toId));
                areas = areas.map(a => ({ ...a, itemIds: a.itemIds.filter(iid => !removeIds.has(iid)) })).filter(a => a.itemIds.length > 0);
                anchorLinks = anchorLinks.filter(aid => !removeIds.has(aid));
                saveItems(); saveLinks(); saveAreas(); saveAnchor();
                renderMap();
                return;
            }
            links = links.filter(l => l.id !== link.id);
            saveLinks();
            renderLinks();
        });

        linkElements.push({ fromBubble, toBubble, line, hitLine, group, pxToVbX, pxToVbY });
    });

    // Anchor links
    const anchorPos = getAnchorSvgPos();
    if (anchorPos && anchorLinks.length > 0) {
        anchorLinks.forEach(itemId => {
            const toBubble = mapCanvas.querySelector(`.map-bubble[data-id="${CSS.escape(itemId)}"]`);
            if (!toBubble) return;
            const to = getBubblePos(toBubble);
            const lineAttrs = { x1: anchorPos.x, y1: anchorPos.y, x2: to.x, y2: to.y };

            const line = svgEl('line', { class: 'link-line', ...lineAttrs });
            svg.appendChild(line);

            const hitLine = svgEl('line', { class: 'link-hit-area', ...lineAttrs });
            svg.appendChild(hitLine);

            const midX = (anchorPos.x + to.x) / 2;
            const midY = (anchorPos.y + to.y) / 2;

            const group = svgEl('g', {
                class: 'link-midpoint',
                transform: `translate(${midX},${midY}) scale(${pxToVbX},${pxToVbY})`,
            });
            group.appendChild(svgEl('circle', {
                cx: 0, cy: 0, r: LINK_MIDPOINT_RADIUS,
                fill: 'var(--surface)', stroke: 'var(--down)', 'stroke-width': 1.5,
            }));
            group.appendChild(svgEl('line', {
                x1: -5, y1: 0, x2: 5, y2: 0,
                stroke: 'var(--down)', 'stroke-width': 2.5, 'stroke-linecap': 'round',
            }));
            svg.appendChild(group);

            const showGroup = () => { group.style.opacity = '1'; };
            const hideGroup = () => { group.style.opacity = '0'; };
            hitLine.addEventListener('mouseenter', showGroup);
            hitLine.addEventListener('mouseleave', hideGroup);
            group.addEventListener('mouseenter', showGroup);
            group.addEventListener('mouseleave', hideGroup);
            group.addEventListener('click', (e) => {
                e.stopPropagation();
                anchorLinks = anchorLinks.filter(id => id !== itemId);
                saveAnchor();
                renderLinks();
            });

            anchorLinkElements.push({ anchorPos, toBubble, line, hitLine, group, pxToVbX, pxToVbY });
        });
    }

    if (connectMode && connectMouseLine) svg.appendChild(connectMouseLine);
    if (anchorConnectMode && anchorConnectMouseLine) svg.appendChild(anchorConnectMouseLine);
}

// Lightweight position update — moves existing SVG elements without rebuilding DOM
function updateLinkPositions() {
    if (linkElements.length === 0) return;
    linkElements.forEach(({ fromBubble, toBubble, line, hitLine, group, pxToVbX, pxToVbY }) => {
        const from = getBubblePos(fromBubble);
        const to = getBubblePos(toBubble);
        line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
        line.setAttribute('x2', to.x); line.setAttribute('y2', to.y);
        hitLine.setAttribute('x1', from.x); hitLine.setAttribute('y1', from.y);
        hitLine.setAttribute('x2', to.x); hitLine.setAttribute('y2', to.y);
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        group.setAttribute('transform', `translate(${midX},${midY}) scale(${pxToVbX},${pxToVbY})`);
    });
}

function updateAreaPositions() {
    if (areaElements.length === 0) return;
    const rect = mapCanvas.getBoundingClientRect();
    const ar = rect.width / rect.height;
    areaElements.forEach(({ area, path }) => {
        const pathD = computeAreaPath(area, ar);
        if (pathD) path.setAttribute('d', pathD);
    });
}

function updateAnchorLinkPositions() {
    if (anchorLinkElements.length === 0) return;
    anchorLinkElements.forEach(({ anchorPos, toBubble, line, hitLine, group, pxToVbX, pxToVbY }) => {
        const to = getBubblePos(toBubble);
        line.setAttribute('x2', to.x); line.setAttribute('y2', to.y);
        hitLine.setAttribute('x2', to.x); hitLine.setAttribute('y2', to.y);
        const midX = (anchorPos.x + to.x) / 2;
        const midY = (anchorPos.y + to.y) / 2;
        group.setAttribute('transform', `translate(${midX},${midY}) scale(${pxToVbX},${pxToVbY})`);
    });
}

let linkUpdatePending = false;
function scheduleUpdateLinkPositions() {
    if (linkUpdatePending) return;
    linkUpdatePending = true;
    requestAnimationFrame(() => { updateLinkPositions(); updateAnchorLinkPositions(); updateAreaPositions(); linkUpdatePending = false; });
}

// rAF loop for animating links during bounce-back transition
function animateLinksDuring(durationMs) {
    const start = performance.now();
    function tick() {
        updateLinkPositions();
        updateAreaPositions();
        if (performance.now() - start < durationMs) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// --- Resize handler (rebuild for midpoint pixel-scale and area aspect-ratio) ---
new ResizeObserver(() => {
    if (mapView.classList.contains('active')) requestAnimationFrame(() => renderLinks());
}).observe(mapCanvas);

// --- Map bubble rendering ---
function renderMap() {
    const unassignedCount = items.filter(i => !i.stage).length;
    const assignBtn = document.getElementById('btn-map-assign');
    if (unassignedCount > 0) {
        assignBtn.style.display = '';
        assignBtn.textContent = `${unassignedCount} unassigned component${unassignedCount === 1 ? '' : 's'} \u2014 Assign Stages`;
    } else {
        assignBtn.style.display = 'none';
    }

    mapCanvas.querySelectorAll('.map-bubble, .map-gridlines, .map-anchor, .evolve-ghost, .map-label').forEach(el => el.remove());

    // Anchor at center top
    if (anchor) {
        const anchorEl = document.createElement('div');
        anchorEl.className = 'map-anchor';
        anchorEl.innerHTML = `<span>${escapeHtml(anchor)}</span><button class="map-anchor-connect">Connect</button>`;

        // Click anchor text: start anchor→item connect, or complete item→anchor connect
        anchorEl.addEventListener('click', (e) => {
            if (e.target.closest('.map-anchor-connect')) return; // handled by button
            e.stopPropagation();
            if (areaSelectMode) return;
            // Item→Anchor: complete connection from an item to the anchor
            if (connectMode && connectFromId) {
                completeAnchorLinkFromItem(connectFromId);
                return;
            }
            // Toggle anchor→item connect mode
            if (anchorConnectMode) { cancelAnchorConnect(); return; }
            startAnchorConnect();
        });

        // Explicit connect button (hover)
        anchorEl.querySelector('.map-anchor-connect').addEventListener('click', (e) => {
            e.stopPropagation();
            if (areaSelectMode) return;
            if (anchorConnectMode) { cancelAnchorConnect(); return; }
            startAnchorConnect();
        });

        mapCanvas.appendChild(anchorEl);
    }

    const staged = items.filter(i => i.stage);
    if (staged.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);';
        empty.innerHTML = '<p>No staged components yet.<br>Assign stages first.</p>';
        empty.classList.add('map-bubble'); // for cleanup
        mapCanvas.appendChild(empty);
        renderLinks();
        return;
    }

    staged.forEach(item => {
        const stage = STAGES.find(s => s.key === item.stage);
        if (!stage) return;
        const isEvolved = !!item.evolvedFrom;

        const bubble = document.createElement('div');
        bubble.className = 'map-bubble' + (isEvolved ? ' evolved' : '');
        bubble.dataset.id = item.id;
        bubble.style.left = (item.posX * 100) + '%';
        bubble.style.top = ((1 - item.posY) * 100) + '%';

        bubble.innerHTML = `
            <div class="map-bubble-label">${escapeHtml(item.text)}</div>
            <div class="map-bubble-circle" style="border-color:#1a1a2e"></div>
            <button class="map-bubble-connect" data-id="${escapeHtml(item.id)}">Connect</button>
            ${isEvolved ? '' : '<button class="map-bubble-evolve" data-id="' + escapeHtml(item.id) + '">Evolve &rarr;</button>'}
        `;

        bubble.addEventListener('mousedown', (e) => {
            if (e.target.closest('.map-bubble-connect') || e.target.closest('.map-bubble-evolve')) return;
            if (areaSelectMode) { toggleAreaItem(item.id); return; }
            if (connectMode || anchorConnectMode || evolveMode) return;
            // On mobile, only drag in Move mode — other modes need taps to land as clicks.
            if (IS_MOBILE && mobileMode !== 'move') return;
            startMapDrag(e, item, bubble);
        });
        bubble.addEventListener('touchstart', (e) => {
            if (e.target.closest('.map-bubble-connect') || e.target.closest('.map-bubble-evolve')) return;
            if (areaSelectMode) {
                // preventDefault blocks the synthesized mousedown that would fire the
                // same toggle a second time on touch devices and net out to no change.
                e.preventDefault();
                toggleAreaItem(item.id);
                return;
            }
            // Mobile Evolve: long-press a bubble → ghost follows finger X → lift to place.
            if (IS_MOBILE && mobileEvolvePending && !evolveMode) {
                startMobileEvolveGesture(e, item);
                return;
            }
            if (connectMode || anchorConnectMode || evolveMode) return;
            if (IS_MOBILE && mobileMode !== 'move') return;
            startMapDrag(e, item, bubble);
        }, { passive: false });

        bubble.querySelector('.map-bubble-connect').addEventListener('click', (e) => {
            e.stopPropagation();
            if (areaSelectMode) return;
            startConnect(item.id);
        });

        const evolveBtn = bubble.querySelector('.map-bubble-evolve');
        if (evolveBtn) {
            evolveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (areaSelectMode) return;
                startEvolve(item);
            });
        }

        bubble.addEventListener('click', (e) => {
            if (areaSelectMode) { e.stopPropagation(); return; }
            if (evolveMode) { e.stopPropagation(); return; }
            if (anchorConnectMode) {
                e.stopPropagation();
                completeAnchorConnect(item.id);
                return;
            }
            // Mobile Link mode: first tap starts connect, second tap completes it.
            if (IS_MOBILE && mobileMode === 'link' && !connectMode) {
                e.stopPropagation();
                startConnect(item.id);
                updateMobileHint();
                return;
            }
            if (connectMode && connectFromId && connectFromId !== item.id) {
                e.stopPropagation();
                completeConnect(item.id);
                updateMobileHint();
            }
        });

        mapCanvas.appendChild(bubble);
    });

    // Render labels
    labels.forEach(label => {
        const el = document.createElement('div');
        el.className = 'map-label';
        el.textContent = label.text;
        el.style.left = (label.posX * 100) + '%';
        el.style.top = ((1 - label.posY) * 100) + '%';
        el.style.width = (label.width || 100) + 'px';

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'map-label-resize';
        resizeHandle.addEventListener('mousedown', (e) => startLabelResize(e, label, el));
        resizeHandle.addEventListener('touchstart', (e) => startLabelResize(e, label, el), { passive: false });
        el.appendChild(resizeHandle);

        el.addEventListener('mousedown', (e) => {
            if (e.target.closest('.map-label-resize')) return;
            if (e.button === 0) startLabelDrag(e, label, el);
        });
        el.addEventListener('touchstart', (e) => {
            if (e.target.closest('.map-label-resize')) return;
            startLabelDrag(e, label, el);
        }, { passive: false });
        el.addEventListener('contextmenu', (e) => showLabelCtx(e, label.id));

        mapCanvas.appendChild(el);
    });

    renderLinks();
}

// --- Map grid crosshair (horizontal only) ---
let mapGridEl = null, mapGridHLine = null, mapGridVLine = null;

function showMapGrid(byPct, bxPct) {
    removeMapGrid(true);
    const container = document.createElement('div');
    container.className = 'map-gridlines';

    // Horizontal crosshair
    const hLine = document.createElement('div');
    hLine.className = 'map-crosshair map-crosshair-h';
    hLine.style.top = byPct + '%';
    const hBar = document.createElement('div');
    hBar.style.cssText = 'position:absolute;left:0;right:0;top:0;height:1px;background:var(--accent);opacity:0.18;';
    hLine.appendChild(hBar);
    for (let i = 0; i <= GRID_SIZE; i++) {
        const pct = (i / GRID_SIZE) * 100;
        const tick = document.createElement('div');
        tick.style.cssText = `position:absolute;left:${pct}%;top:-3px;width:1px;height:6px;background:var(--accent);opacity:0.2;`;
        hLine.appendChild(tick);
    }
    hLine.style.clipPath = `inset(-20px ${100 - bxPct}% -20px ${bxPct}%)`;

    // Vertical crosshair
    const vLine = document.createElement('div');
    vLine.style.cssText = `position:absolute;top:0;bottom:0;left:${bxPct}%;width:0;overflow:visible;`;
    const vBar = document.createElement('div');
    vBar.style.cssText = 'position:absolute;top:0;bottom:0;left:0;width:1px;background:var(--accent);opacity:0.18;';
    vLine.appendChild(vBar);
    for (let i = 0; i <= GRID_SIZE; i++) {
        const pct = (i / GRID_SIZE) * 100;
        const tick = document.createElement('div');
        tick.style.cssText = `position:absolute;top:${pct}%;left:-3px;width:6px;height:1px;background:var(--accent);opacity:0.2;`;
        vLine.appendChild(tick);
    }
    vLine.style.clipPath = `inset(${byPct}% -20px ${100 - byPct}% -20px)`;

    container.appendChild(hLine);
    container.appendChild(vLine);
    mapCanvas.appendChild(container);

    mapGridEl = container;
    mapGridHLine = hLine;
    mapGridVLine = vLine;

    container.offsetHeight;
    hLine.style.transition = 'clip-path 0.4s cubic-bezier(0.22,1,0.36,1)';
    hLine.style.clipPath = 'inset(-20px 0% -20px 0%)';
    vLine.style.transition = 'clip-path 0.4s cubic-bezier(0.22,1,0.36,1)';
    vLine.style.clipPath = 'inset(0% -20px 0% -20px)';
}

function updateMapGrid(bxPct, byPct) {
    if (!mapGridHLine) return;
    mapGridHLine.style.transition = 'none';
    mapGridHLine.style.clipPath = 'inset(-20px 0% -20px 0%)';
    mapGridHLine.style.top = byPct + '%';
    mapGridVLine.style.transition = 'none';
    mapGridVLine.style.clipPath = 'inset(0% -20px 0% -20px)';
    mapGridVLine.style.left = bxPct + '%';
}

function removeMapGrid(instant) {
    if (!mapGridEl) return;
    if (instant) { mapGridEl.remove(); }
    else {
        mapGridEl.style.transition = 'opacity 0.25s';
        mapGridEl.style.opacity = '0';
        const el = mapGridEl;
        setTimeout(() => el.remove(), 250);
    }
    mapGridEl = null; mapGridHLine = null; mapGridVLine = null;
}

// --- Map gravity push ---
let mapOtherBubbles = [];

function collectMapBubbles(draggedId, canvasRect) {
    mapOtherBubbles = [];
    mapCanvas.querySelectorAll('.map-bubble').forEach(el => {
        if (el.dataset.id === draggedId) return;
        const cx = (parseFloat(el.style.left) / 100) * canvasRect.width;
        const cy = (parseFloat(el.style.top) / 100) * canvasRect.height;
        el.style.transition = 'transform 0.15s ease-out, opacity 0.2s ease-out';
        el.style.opacity = '0.5';
        mapOtherBubbles.push({ el, cx, cy });
    });
}

function updateMapGravityPush(dragPctX, dragPctY, canvasRect) {
    const dragCX = (dragPctX / 100) * canvasRect.width;
    const dragCY = (dragPctY / 100) * canvasRect.height;
    mapOtherBubbles.forEach(({ el, cx, cy }) => {
        const dx = cx - dragCX;
        const dy = cy - dragCY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < PUSH_RADIUS && dist > 1) {
            const factor = Math.pow(1 - dist / PUSH_RADIUS, 2);
            const pushMag = PUSH_STRENGTH * factor;
            const pushX = (dx / dist) * pushMag;
            const pushY = (dy / dist) * pushMag;
            el.style.transform = `translate(calc(-50% + ${pushX}px), calc(-50% + ${pushY}px))`;
        } else {
            el.style.transform = 'translate(-50%, -50%)';
        }
    });
}

function releaseMapGravityPush() {
    mapOtherBubbles.forEach(({ el }) => {
        el.style.transition = 'transform 0.4s cubic-bezier(0.18, 1.9, 0.4, 1), opacity 0.3s ease-out';
        el.style.transform = 'translate(-50%, -50%)';
        el.style.opacity = '';
        const cleanup = () => { el.style.transition = ''; el.style.transform = ''; el.removeEventListener('transitionend', cleanup); };
        el.addEventListener('transitionend', cleanup);
    });
    mapOtherBubbles = [];
    // Animate link positions during the bounce-back transition
    animateLinksDuring(BOUNCE_DURATION);
}

// --- Map drag (free X + Y, updates stage on drop) ---
function startMapDrag(e, item, bubble) {
    e.preventDefault();
    const pt = e.touches ? e.touches[0] : e;
    const rect = mapCanvas.getBoundingClientRect();
    const bubbleX = (parseFloat(bubble.style.left) / 100) * rect.width;
    const bubbleY = (parseFloat(bubble.style.top) / 100) * rect.height;
    const dragOffsetX = pt.clientX - rect.left - bubbleX;
    const dragOffsetY = pt.clientY - rect.top - bubbleY;
    bubble.classList.add('dragging');
    let moved = false;

    const bxPct = parseFloat(bubble.style.left);
    const byPct = parseFloat(bubble.style.top);
    showMapGrid(byPct, bxPct);
    collectMapBubbles(item.id, rect);

    function onMove(e2) {
        const p = e2.touches ? e2.touches[0] : e2;
        const rawX = (p.clientX - rect.left - dragOffsetX) / rect.width;
        const rawY = (p.clientY - rect.top - dragOffsetY) / rect.height;
        const sx = snapToGrid(Math.max(0.02, Math.min(0.98, rawX)));
        const sy = snapToGrid(Math.max(0.02, Math.min(0.98, rawY)));
        const pctX = sx * 100;
        const pctY = sy * 100;
        bubble.style.left = pctX + '%';
        bubble.style.top = pctY + '%';
        updateMapGrid(pctX, pctY);
        updateMapGravityPush(pctX, pctY, rect);
        scheduleUpdateLinkPositions();
        moved = true;
    }

    function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchend', onUp);
        bubble.classList.remove('dragging');
        removeMapGrid();
        releaseMapGravityPush();

        if (moved) {
            const finalX = parseFloat(bubble.style.left) / 100;
            const finalY = 1 - parseFloat(bubble.style.top) / 100;
            const newStage = stageFromX(parseFloat(bubble.style.left));

            const i = items.find(x => x.id === item.id);
            if (i) {
                if (newStage !== i.stage) i.stage = newStage;
                i.posX = finalX;
                i.posY = finalY;
                saveItems();
            }
            renderLinks();
        }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
}

// ===== MOBILE UI =====
// All wiring is installed unconditionally but gated on IS_MOBILE at call sites,
// so desktop is completely unaffected.

const mobileBar = document.getElementById('mobile-bar');
const mobileOverflow = document.getElementById('mobile-overflow');
const mobileHintEl = document.getElementById('mobile-bar-hint');

function updateMobileHint() {
    if (!IS_MOBILE || !mobileHintEl) return;
    if (mobileEvolvePending && !evolveMode) { mobileHintEl.textContent = 'Long-press a component to start evolving'; return; }
    if (evolveMode) { mobileHintEl.textContent = 'Slide to position, lift to place'; return; }
    if (mobileLabelPlaceMode) { mobileHintEl.textContent = 'Tap empty space to place the label'; return; }
    if (areaSelectMode) { mobileHintEl.textContent = ''; return; }
    if (mobileMode === 'move') mobileHintEl.textContent = 'Drag a component to move it';
    else if (mobileMode === 'link') mobileHintEl.textContent = connectMode ? 'Tap the target component' : 'Tap a component to start a link';
    else if (mobileMode === 'create') mobileHintEl.textContent = 'Long-press empty space to add a component';
    else mobileHintEl.textContent = '';
}

function paintMobileBar() {
    if (!mobileBar) return;
    mobileBar.querySelectorAll('.mobile-bar-btn[data-mode]').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mobileMode);
    });
}

function setMobileMode(mode) {
    // Tapping the active mode again drops back to neutral (reader) mode.
    if (mobileMode === mode) mode = null;
    // Exit any submodes owned by the previous mode.
    if (mobileMode === 'link' || mode !== 'link') {
        if (connectMode) cancelConnect();
    }
    if (mobileLabelPlaceMode && mode !== null) mobileLabelPlaceMode = false;
    if (mobileEvolvePending) mobileEvolvePending = false;
    mobileMode = mode;
    paintMobileBar();
    updateMobileHint();
}

if (mobileBar) {
    mobileBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.mobile-bar-btn[data-mode]');
        if (!btn) return;
        setMobileMode(btn.dataset.mode);
    });
}

// --- Overflow menu ---
const mobileMoreBtn = document.getElementById('mobile-bar-more');
if (mobileMoreBtn && mobileOverflow) {
    mobileMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const shareMenuEl = document.getElementById('share-menu');
        if (shareMenuEl) shareMenuEl.classList.remove('open');
        mobileOverflow.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
        if (!mobileOverflow.contains(e.target) && e.target !== mobileMoreBtn) {
            mobileOverflow.classList.remove('open');
        }
    });
    mobileOverflow.addEventListener('click', (e) => {
        const item = e.target.closest('.mobile-overflow-item');
        if (!item) return;
        const action = item.dataset.action;
        mobileOverflow.classList.remove('open');
        // Any overflow action resets the bar mode first.
        setMobileMode(null);
        if (action === 'add-label') startMobileLabelPlace();
        else if (action === 'create-area') enterAreaSelectMode();
        else if (action === 'evolve') startMobileEvolveFlow();
    });
}

// --- Subbar "Share Map" button — opens the existing share-menu, anchored below the button.
const subbarShareBtn = document.getElementById('map-subbar-share');
if (subbarShareBtn) {
    subbarShareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = document.getElementById('share-menu');
        if (!menu) return;
        mobileOverflow.classList.remove('open');
        if (menu.classList.contains('open')) { menu.classList.remove('open'); return; }
        const r = subbarShareBtn.getBoundingClientRect();
        menu.style.bottom = 'auto';
        menu.style.top = (r.bottom + 4) + 'px';
        menu.style.right = '0.5rem';
        menu.style.left = 'auto';
        menu.classList.add('open');
    });
}

// --- Zoom toggle (Full / Half / Quarter) — mobile only, widens the canvas so
//     the wrap scrolls horizontally. Zoom classes sit on <body> so CSS can target
//     both wrap (overflow) and canvas (width) with one media-style class switch. ---
const mapZoomToggle = document.getElementById('map-zoom-toggle');

const ZOOM_DURATION_MS = 100;
const ZOOM_WIDTH_MULTIPLIERS = { full: 1, half: 2, quarter: 4 };
let zoomScrollAnimRaf = null;

function animateScrollLeft(el, target, duration) {
    if (zoomScrollAnimRaf) cancelAnimationFrame(zoomScrollAnimRaf);
    const start = el.scrollLeft;
    const delta = target - start;
    if (Math.abs(delta) < 0.5) { el.scrollLeft = target; zoomScrollAnimRaf = null; return; }
    const t0 = performance.now();
    const step = (now) => {
        const t = Math.min(1, (now - t0) / duration);
        const eased = 1 - (1 - t) * (1 - t); // ease-out quadratic
        el.scrollLeft = start + delta * eased;
        if (t < 1) zoomScrollAnimRaf = requestAnimationFrame(step);
        else zoomScrollAnimRaf = null;
    };
    zoomScrollAnimRaf = requestAnimationFrame(step);
}

function setMapZoom(level) {
    const wrap = document.getElementById('map-canvas-wrap');

    // Capture the visible centre as a fraction of the current canvas width
    // BEFORE applying the new class. After the class change, the canvas width
    // changes immediately (the CSS transition only animates the visual), so we
    // can compute the target scrollLeft right away and animate to it in lockstep.
    let centerFraction = 0.5;
    if (wrap && wrap.scrollWidth > 0) {
        centerFraction = (wrap.scrollLeft + wrap.clientWidth / 2) / wrap.scrollWidth;
    }

    document.body.classList.remove('zoom-full', 'zoom-half', 'zoom-quarter');
    document.body.classList.add('zoom-' + level);
    if (mapZoomToggle) {
        mapZoomToggle.querySelectorAll('.map-zoom-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.zoom === level);
        });
    }

    if (wrap) {
        const mult = ZOOM_WIDTH_MULTIPLIERS[level] || 1;
        const targetScrollWidth = wrap.clientWidth * mult;
        const maxScroll = Math.max(0, targetScrollWidth - wrap.clientWidth);
        const rawTarget = centerFraction * targetScrollWidth - wrap.clientWidth / 2;
        const targetScrollLeft = Math.max(0, Math.min(rawTarget, maxScroll));
        animateScrollLeft(wrap, targetScrollLeft, ZOOM_DURATION_MS);
    }

    // Canvas width changed — rebuild link SVG once the transition has settled.
    if (mapView.classList.contains('active')) {
        setTimeout(renderLinks, ZOOM_DURATION_MS + 20);
    }
}

if (mapZoomToggle) {
    mapZoomToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.map-zoom-btn');
        if (!btn) return;
        setMapZoom(btn.dataset.zoom);
    });
}
setMapZoom('full');

// --- Share menu (mobile top-bar "Share as ...") ---
const shareBtn = document.getElementById('btn-map-share');
const shareMenu = document.getElementById('share-menu');
if (shareBtn && shareMenu) {
    shareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (shareMenu.classList.contains('open')) { shareMenu.classList.remove('open'); return; }
        // Anchor to the viewport's right edge regardless of where the button
        // ended up horizontally — on narrow mobile the header can wrap and the
        // button may not be near the right edge, which used to put the menu
        // off-screen when positioned relative to the button.
        const r = shareBtn.getBoundingClientRect();
        shareMenu.style.top = (r.bottom + 4) + 'px';
        shareMenu.style.right = '0.5rem';
        shareMenu.style.left = 'auto';
        shareMenu.classList.add('open');
    });
    document.addEventListener('click', (e) => {
        // shareBtn.contains covers clicks on child nodes of the button (text node etc).
        if (shareMenu.contains(e.target) || shareBtn.contains(e.target)) return;
        shareMenu.classList.remove('open');
    });
    shareMenu.addEventListener('click', async (e) => {
        const item = e.target.closest('.share-menu-item');
        if (!item) return;
        shareMenu.classList.remove('open');
        const kind = item.dataset.share;
        if (kind === 'link') shareAsLink();
        else if (kind === 'image') shareAsImage();
        else if (kind === 'qr') openShareQR();
    });
}

async function shareAsLink() {
    try {
        const url = await buildShareUrl();
        const shareData = { url, title: 'Kartmakare map', text: 'Open this Wardley map in Kartmakare' };
        if (navigator.share) {
            await navigator.share(shareData);
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            showError('Link copied to clipboard');
        } else {
            showError('Sharing not supported on this browser');
        }
    } catch (err) {
        if (err && err.name !== 'AbortError') showError('Could not share link: ' + (err.message || err));
    }
}

async function shareAsImage() {
    try {
        const blob = await buildMapPNGBlob(3);
        const file = new File([blob], 'wardley-map.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Kartmakare map' });
        } else {
            // Fallback: download the PNG
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'wardley-map.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    } catch (err) {
        if (err && err.name !== 'AbortError') showError('Could not share image: ' + (err.message || err));
    }
}

// --- Mobile Evolve: overflow action arms a pending state; long-press a bubble to start ---
const EVOLVE_LONG_PRESS_MS = 200;

function showEvolvePulse(item) {
    const pulse = document.createElement('div');
    pulse.className = 'evolve-pulse';
    pulse.style.left = (item.posX * 100) + '%';
    pulse.style.top = ((1 - item.posY) * 100) + '%';
    mapCanvas.appendChild(pulse);
    setTimeout(() => pulse.remove(), 800);
}

function startMobileEvolveFlow() {
    mobileEvolvePending = true;
    updateMobileHint();
}

function startMobileEvolveGesture(e, item) {
    // Called from bubble touchstart when mobileEvolvePending is true.
    e.preventDefault();
    const t = e.touches[0];
    const startX = t.clientX;
    const startY = t.clientY;
    let evolveStarted = false;

    const timer = setTimeout(() => {
        showEvolvePulse(item);
        startEvolve(item);
        evolveStarted = true;
        updateMobileHint();
    }, EVOLVE_LONG_PRESS_MS);

    function onMove(ev) {
        const mt = ev.touches[0];
        if (!mt) return;
        if (!evolveStarted) {
            const dx = mt.clientX - startX;
            const dy = mt.clientY - startY;
            if (Math.abs(dx) > LONG_PRESS_SLOP_PX || Math.abs(dy) > LONG_PRESS_SLOP_PX) {
                clearTimeout(timer);
                cleanup();
            }
            return;
        }
        const rect = mapCanvas.getBoundingClientRect();
        const pctX = (mt.clientX - rect.left) / rect.width * 100;
        if (evolveGhostEl) evolveGhostEl.style.left = Math.max(2, Math.min(98, pctX)) + '%';
    }

    function onEnd(ev) {
        clearTimeout(timer);
        if (evolveStarted) {
            const et = (ev.changedTouches && ev.changedTouches[0]) || null;
            if (et) {
                const rect = mapCanvas.getBoundingClientRect();
                const pctX = (et.clientX - rect.left) / rect.width * 100;
                completeEvolve(pctX);
            } else {
                cancelEvolve();
            }
        }
        cleanup();
    }

    function cleanup() {
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
        window.removeEventListener('touchcancel', onEnd);
        mobileEvolvePending = false;
        updateMobileHint();
    }

    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
}

// --- Create mode: long-press empty space ---
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;
let createPressTimer = null;
let createPressStart = null;

function cancelCreateLongPress() {
    if (createPressTimer) { clearTimeout(createPressTimer); createPressTimer = null; }
    createPressStart = null;
}

mapCanvas.addEventListener('touchstart', (e) => {
    if (!IS_MOBILE || mobileMode !== 'create') return;
    if (e.target.closest('.map-bubble') || e.target.closest('.map-label') || e.target.closest('.map-anchor')) return;
    const t = e.touches[0];
    createPressStart = { x: t.clientX, y: t.clientY };
    createPressTimer = setTimeout(() => {
        createPressTimer = null;
        if (!createPressStart) return;
        const rect = mapCanvas.getBoundingClientRect();
        const pctX = (createPressStart.x - rect.left) / rect.width;
        const pctY = (createPressStart.y - rect.top) / rect.height;
        createPressStart = null;
        const colIndex = Math.max(0, Math.min(3, Math.floor(pctX * 4)));
        openAddModal();
        modalPlacePosX = snapToGrid(Math.max(0.02, Math.min(0.98, pctX)));
        modalPlacePosY = snapToGrid(Math.max(0.02, Math.min(0.98, 1 - pctY)));
        selectModalStage(STAGES[colIndex].key);
        setMobileMode(null);
    }, LONG_PRESS_MS);
}, { passive: true });

mapCanvas.addEventListener('touchmove', (e) => {
    if (!createPressStart) return;
    const t = e.touches[0];
    const dx = t.clientX - createPressStart.x;
    const dy = t.clientY - createPressStart.y;
    if (Math.abs(dx) > LONG_PRESS_SLOP_PX || Math.abs(dy) > LONG_PRESS_SLOP_PX) cancelCreateLongPress();
}, { passive: true });

mapCanvas.addEventListener('touchend', cancelCreateLongPress);
mapCanvas.addEventListener('touchcancel', cancelCreateLongPress);

// --- Add Label via tap-to-place (from overflow menu) ---
function startMobileLabelPlace() {
    mobileLabelPlaceMode = true;
    mapCanvas.style.cursor = 'crosshair';
    updateMobileHint();
}

mapCanvas.addEventListener('click', (e) => {
    if (!mobileLabelPlaceMode) return;
    if (e.target.closest('.map-bubble') || e.target.closest('.map-label') || e.target.closest('.map-anchor')) return;
    mobileLabelPlaceMode = false;
    mapCanvas.style.cursor = '';
    ctxClickX = e.clientX;
    ctxClickY = e.clientY;
    addLabelAtClick();
    updateMobileHint();
}, true); // capture so it runs before the canvas cancel-connect click

// --- Suppress native long-press context menu and the desktop ctx menu on mobile ---
if (IS_MOBILE) {
    mapCanvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation(); // block the desktop ctx-menu handler from opening
    }, true);
}

// ===== CONSENT =====
const consentOverlay = document.getElementById('consent-overlay');
const consentAsk = document.getElementById('consent-ask');
const consentDeclined = document.getElementById('consent-declined');

function checkConsent() {
    try { return localStorage.getItem('kartmakare-consent') === 'yes'; } catch { return false; }
}

function grantConsent() {
    try { localStorage.setItem('kartmakare-consent', 'yes'); } catch {}
    consentOverlay.classList.add('hidden');
    init();
}

if (checkConsent()) {
    consentOverlay.classList.add('hidden');
} else {
    document.getElementById('consent-yes').addEventListener('click', grantConsent);
    document.getElementById('consent-no').addEventListener('click', () => {
        consentAsk.style.display = 'none';
        consentDeclined.style.display = '';
    });
    document.getElementById('consent-letsgo').addEventListener('click', grantConsent);
}

// ===== INIT =====
async function init() {
    loadItems();
    loadLinks();
    loadAreas();
    loadLabels();
    loadAnchor();
    syncAnchorInput();
    const imported = await tryHashImport();
    if (!imported) renderList();
}
if (checkConsent()) init();

// ===== PWA / SERVICE WORKER =====
// Registers sw.js (only possible over https or localhost). When a new service
// worker is detected, we tell it to skipWaiting, then reload once it takes
// control so users always run the freshest code after a deploy. The cache
// version string lives in sw.js and is bumped on each release.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                if (!newWorker) return;
                newWorker.addEventListener('statechange', () => {
                    // Only skipWaiting if there's already an active SW controlling
                    // this page — otherwise this is the first install and we don't
                    // need to force-activate.
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        newWorker.postMessage({ type: 'SKIP_WAITING' });
                    }
                });
            });
            // Check for a fresh sw.js whenever the tab becomes visible again.
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') reg.update();
            });
        }).catch(() => { /* SW unsupported or blocked — continue online-only */ });

        // When the controlling SW changes (new version took over), reload once so
        // the page runs against the fresh cache.
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloading) return;
            reloading = true;
            window.location.reload();
        });
    });
}
