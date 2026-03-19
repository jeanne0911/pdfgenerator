/**
 * 主入口文件
 * 管理整个应用的状态和UI交互
 */
import { parsePDF, renderPage } from './pdfParser.js';
import { generateFilledPDF, downloadPDF } from './pdfGenerator.js';

// ===== 应用状态 =====
const state = {
    currentStep: 1,
    pdfDoc: null,
    originalBuffer: null,
    fields: [],
    currentPage: 1,
    totalPages: 0,
    fileName: '',
    generatedBlob: null,
    // 框选模式状态
    selectMode: false,
    isSelecting: false,
    selectionStart: null,
    regions: [],          // 所有页的框选区域 [{page, rect, fieldId, ...}]
    currentViewport: null // 当前页的 viewport 信息
};

// ===== DOM 元素引用 =====
const dom = {};

function initDom() {
    dom.sectionUpload = document.getElementById('section-upload');
    dom.sectionFill = document.getElementById('section-fill');
    dom.sectionDone = document.getElementById('section-done');
    dom.uploadArea = document.getElementById('upload-area');
    dom.fileInput = document.getElementById('file-input');
    dom.btnSelectFile = document.getElementById('btn-select-file');
    dom.btnReset = document.getElementById('btn-reset');
    dom.pdfCanvas = document.getElementById('pdf-canvas');
    dom.pageInfo = document.getElementById('page-info');
    dom.btnPrevPage = document.getElementById('btn-prev-page');
    dom.btnNextPage = document.getElementById('btn-next-page');
    dom.formFields = document.getElementById('form-fields');
    dom.noFieldsHint = document.getElementById('no-fields-hint');
    dom.fieldCount = document.getElementById('field-count');
    dom.btnClearAll = document.getElementById('btn-clear-all');
    dom.btnGenerate = document.getElementById('btn-generate');
    dom.btnDownloadAgain = document.getElementById('btn-download-again');
    dom.btnFillAgain = document.getElementById('btn-fill-again');
    dom.btnNewFile = document.getElementById('btn-new-file');
    dom.downloadFilename = document.getElementById('download-filename');
    dom.loadingOverlay = document.getElementById('loading-overlay');
    dom.loadingText = document.getElementById('loading-text');
    dom.toastContainer = document.getElementById('toast-container');
    dom.stepItems = document.querySelectorAll('.step-item');
    dom.stepLines = document.querySelectorAll('.step-line');
    // 框选模式DOM
    dom.btnSelectMode = document.getElementById('btn-select-mode');
    dom.selectOverlay = document.getElementById('select-mode-overlay');
    dom.selectionRect = document.getElementById('selection-rect');
    dom.regionMarkers = document.getElementById('region-markers-container');
    dom.pdfPreviewWrapper = document.getElementById('pdf-preview-wrapper');
}

// ===== Toast 通知系统 =====
function showToast(message, type = 'info', duration = 3000) {
    const icons = {
        success: 'ri-check-line',
        error: 'ri-error-warning-line',
        info: 'ri-information-line'
    };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="${icons[type] || icons.info}"></i><span>${message}</span>`;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ===== 加载状态 =====
function showLoading(text = '处理中...') {
    dom.loadingText.textContent = text;
    dom.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    dom.loadingOverlay.classList.add('hidden');
}

// ===== 步骤管理 =====
function setStep(step) {
    state.currentStep = step;
    dom.stepItems.forEach((item, idx) => {
        const stepNum = idx + 1;
        item.classList.remove('active', 'completed');
        if (stepNum === step) item.classList.add('active');
        else if (stepNum < step) item.classList.add('completed');
    });
    dom.stepLines.forEach((line, idx) => {
        line.classList.toggle('active', idx < step - 1);
    });
    dom.sectionUpload.classList.toggle('hidden', step !== 1);
    dom.sectionFill.classList.toggle('hidden', step !== 2);
    dom.sectionDone.classList.toggle('hidden', step !== 3);
    dom.btnReset.classList.toggle('hidden', step === 1);
}

// ===== 文件上传处理 =====
function handleFileSelect(file) {
    if (!file) return;
    if (file.type !== 'application/pdf') {
        showToast('请上传 PDF 格式的文件', 'error');
        return;
    }
    if (file.size > 50 * 1024 * 1024) {
        showToast('文件大小不能超过 50MB', 'error');
        return;
    }

    state.fileName = file.name;
    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            showLoading('正在解析 PDF 文件...');
            const buffer = e.target.result;
            // 保存一份副本用于后续 pdf-lib 生成，因为 PDF.js 解析会 transfer 原始 ArrayBuffer 导致其 detached
            state.originalBuffer = buffer.slice(0);

            const result = await parsePDF(buffer);
            state.pdfDoc = result.pdfDoc;
            state.fields = result.fields;
            state.totalPages = result.pageCount;
            state.currentPage = 1;
            state.regions = [];

            // 渲染第一页预览
            const viewport = await renderPage(state.pdfDoc, 1, dom.pdfCanvas);
            state.currentViewport = viewport;
            updatePageInfo();

            // 生成表单
            buildForm(state.fields);

            hideLoading();
            setStep(2);

            if (state.fields.length > 0) {
                showToast(`成功解析到 ${state.fields.length} 个可填写字段`, 'success');
            } else {
                showToast('未检测到表单字段，请使用「框选填写区」在PDF上标记需要填写的位置', 'info', 5000);
            }
        } catch (err) {
            hideLoading();
            console.error('PDF解析错误:', err);
            showToast('PDF 解析失败，请确认文件是否损坏', 'error');
        }
    };

    reader.onerror = () => {
        showToast('文件读取失败，请重试', 'error');
    };

    reader.readAsArrayBuffer(file);
}

// ===== PDF 页面导航 =====
function updatePageInfo() {
    dom.pageInfo.textContent = `${state.currentPage} / ${state.totalPages}`;
    dom.btnPrevPage.disabled = state.currentPage <= 1;
    dom.btnNextPage.disabled = state.currentPage >= state.totalPages;
    dom.btnPrevPage.classList.toggle('opacity-30', state.currentPage <= 1);
    dom.btnNextPage.classList.toggle('opacity-30', state.currentPage >= state.totalPages);
}

async function goToPage(pageNum) {
    if (pageNum < 1 || pageNum > state.totalPages) return;
    state.currentPage = pageNum;
    const viewport = await renderPage(state.pdfDoc, pageNum, dom.pdfCanvas);
    state.currentViewport = viewport;
    updatePageInfo();
    renderRegionMarkers();
}

// ===== 构建表单 =====
function buildForm(fields) {
    dom.formFields.innerHTML = '';

    if (!fields || fields.length === 0) {
        dom.noFieldsHint.classList.remove('hidden');
        dom.fieldCount.textContent = '0 个字段';
        addManualAnnotationButton();
        return;
    }

    dom.noFieldsHint.classList.add('hidden');
    dom.fieldCount.textContent = `${fields.length} 个字段`;

    // 按页分组
    const groupedByPage = {};
    fields.forEach(field => {
        const page = field.page || 1;
        if (!groupedByPage[page]) groupedByPage[page] = [];
        groupedByPage[page].push(field);
    });

    Object.keys(groupedByPage).sort((a, b) => a - b).forEach(page => {
        if (state.totalPages > 1) {
            const header = document.createElement('div');
            header.className = 'form-group-header';
            header.innerHTML = `<i class="ri-pages-line text-lg"></i><span>第 ${page} 页</span>`;
            dom.formFields.appendChild(header);
        }
        groupedByPage[page].forEach(field => {
            const card = createFieldCard(field);
            dom.formFields.appendChild(card);
        });
    });

    addManualAnnotationButton();
}

/**
 * 重新构建表单（保留已填写的值）
 */
function rebuildForm() {
    // 先收集当前值
    collectFormData();
    buildForm(state.fields);
}

/**
 * 创建单个字段的卡片UI
 */
function createFieldCard(field) {
    const card = document.createElement('div');
    let extraClass = '';
    if (field.isRegionField) extraClass = 'region-field-card';
    else if (field.isAutoDetected) extraClass = 'annotation-field';
    card.className = `form-field-card ${extraClass}`;
    card.dataset.fieldId = field.id;

    const typeLabels = {
        text: { label: '文本', icon: 'ri-text' },
        textarea: { label: '多行文本', icon: 'ri-file-text-line' },
        checkbox: { label: '复选框', icon: 'ri-checkbox-line' },
        dropdown: { label: '下拉选择', icon: 'ri-arrow-down-s-line' },
        list: { label: '列表', icon: 'ri-list-unordered' },
        radio: { label: '单选', icon: 'ri-radio-button-line' },
        date: { label: '日期', icon: 'ri-calendar-line' },
        signature: { label: '签名', icon: 'ri-pen-nib-line' },
        button: { label: '按钮', icon: 'ri-cursor-line' }
    };

    const typeInfo = typeLabels[field.type] || typeLabels.text;
    const badgeClass = field.type === 'checkbox' ? 'checkbox' :
                       field.type === 'dropdown' || field.type === 'list' ? 'dropdown' :
                       field.type === 'radio' ? 'radio' :
                       field.type === 'date' ? 'date' :
                       field.type === 'signature' ? 'signature' : 'text';

    let inputHtml = '';

    switch (field.type) {
        case 'text':
            inputHtml = `<input type="text" class="form-input" data-field-id="${field.id}" 
                value="${escapeHtml(field.value || '')}" 
                placeholder="请输入${field.displayName || field.name}"
                ${field.maxLength > 0 ? `maxlength="${field.maxLength}"` : ''}>`;
            break;
        case 'textarea':
            inputHtml = `<textarea class="form-input form-textarea" data-field-id="${field.id}" 
                placeholder="请输入${field.displayName || field.name}">${escapeHtml(field.value || '')}</textarea>`;
            break;
        case 'checkbox':
            inputHtml = `<label class="form-checkbox-wrapper">
                <input type="checkbox" class="form-checkbox" data-field-id="${field.id}" ${field.value ? 'checked' : ''}>
                <span class="text-sm text-slate-600">选中</span>
            </label>`;
            break;
        case 'dropdown':
        case 'list': {
            const options = (field.options || []).map(opt => {
                const label = typeof opt === 'string' ? opt : opt.label;
                const value = typeof opt === 'string' ? opt : opt.value;
                const selected = value === field.value ? 'selected' : '';
                return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(label)}</option>`;
            }).join('');
            inputHtml = `<select class="form-input form-select" data-field-id="${field.id}">
                <option value="">请选择</option>${options}</select>`;
            break;
        }
        case 'radio': {
            const radioOptions = (field.options || []).map(opt => {
                const label = typeof opt === 'string' ? opt : opt.label;
                const value = typeof opt === 'string' ? opt : opt.value;
                return `<label class="form-checkbox-wrapper">
                    <input type="radio" name="radio_${field.id}" class="form-checkbox" 
                        data-field-id="${field.id}" value="${escapeHtml(value)}"
                        ${value === field.value ? 'checked' : ''}>
                    <span class="text-sm text-slate-600">${escapeHtml(label)}</span>
                </label>`;
            }).join('');
            inputHtml = `<div class="flex flex-wrap gap-4">${radioOptions}</div>`;
            break;
        }
        case 'date':
            inputHtml = `<input type="date" class="form-input" data-field-id="${field.id}" value="${field.value || ''}">`;
            break;
        case 'signature':
            inputHtml = `<div class="relative">
                <canvas class="signature-canvas w-full border border-slate-200 rounded-lg bg-white" 
                    data-field-id="${field.id}" height="100" style="cursor: crosshair;"></canvas>
                <button class="absolute top-2 right-2 text-xs text-slate-400 hover:text-red-500 clear-signature" data-field-id="${field.id}">
                    <i class="ri-eraser-line mr-1"></i>清除</button>
                <input type="hidden" data-field-id="${field.id}" class="signature-data">
            </div>`;
            break;
        default:
            inputHtml = `<input type="text" class="form-input" data-field-id="${field.id}" 
                value="${escapeHtml(field.value || '')}" placeholder="请输入内容">`;
    }

    // 区域字段显示位置标签
    const regionTag = field.isRegionField
        ? `<span class="region-position-tag"><i class="ri-focus-3-line"></i>框选区域</span>`
        : '';
    const autoDetectedTag = field.isAutoDetected && !field.isRegionField
        ? '<p class="text-xs text-amber-500 mb-2"><i class="ri-magic-line mr-1"></i>自动识别的字段</p>'
        : '';

    // 框选字段支持删除
    const deleteBtn = field.isRegionField
        ? `<button class="text-slate-300 hover:text-red-500 transition-colors ml-2" data-remove-region="${field.id}"><i class="ri-close-circle-line"></i></button>`
        : '';

    card.innerHTML = `
        <div class="flex items-center justify-between mb-1">
            <label>${escapeHtml(field.displayName || field.name)}${regionTag}${field.required ? '<span class="text-red-400 ml-1">*</span>' : ''}</label>
            <div class="flex items-center">
                <span class="field-badge ${badgeClass}"><i class="${typeInfo.icon}"></i>${typeInfo.label}</span>
                ${deleteBtn}
            </div>
        </div>
        ${autoDetectedTag}
        ${inputHtml}
    `;

    return card;
}

/**
 * 添加手动添加注释按钮
 */
function addManualAnnotationButton() {
    const addBtn = document.createElement('div');
    addBtn.className = 'mt-4 p-4 border-2 border-dashed border-slate-200 rounded-xl text-center hover:border-primary-300 hover:bg-primary-50/30 transition-all cursor-pointer';
    addBtn.innerHTML = `
        <i class="ri-add-circle-line text-2xl text-slate-300"></i>
        <p class="text-sm text-slate-400 mt-1">手动添加填写字段</p>
    `;
    addBtn.addEventListener('click', () => addManualField());
    dom.formFields.appendChild(addBtn);
}

/**
 * 手动添加字段
 */
function addManualField() {
    const fieldId = `manual_${Date.now()}`;
    const field = {
        id: fieldId,
        name: '自定义字段',
        displayName: '自定义字段',
        page: state.currentPage,
        type: 'text',
        value: '',
        options: [],
        required: false,
        maxLength: 0,
        rect: [0, 0, 0, 0],
        isAutoDetected: false,
        isManual: true
    };

    state.fields.push(field);

    const card = document.createElement('div');
    card.className = 'form-field-card';
    card.dataset.fieldId = fieldId;
    card.innerHTML = `
        <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2 flex-1">
                <input type="text" class="text-sm font-semibold text-slate-700 bg-transparent border-b border-dashed border-slate-300 focus:border-primary-500 outline-none px-1 py-0.5 flex-1" 
                    value="自定义字段" placeholder="输入字段名称" data-name-input="${fieldId}">
            </div>
            <div class="flex items-center gap-2">
                <select class="text-xs border border-slate-200 rounded-lg px-2 py-1 outline-none" data-type-select="${fieldId}">
                    <option value="text">文本</option>
                    <option value="textarea">多行文本</option>
                    <option value="date">日期</option>
                </select>
                <button class="text-slate-300 hover:text-red-500 transition-colors" data-remove-field="${fieldId}">
                    <i class="ri-close-circle-line"></i>
                </button>
            </div>
        </div>
        <input type="text" class="form-input" data-field-id="${fieldId}" placeholder="请输入内容">
    `;

    const addBtn = dom.formFields.lastElementChild;
    dom.formFields.insertBefore(card, addBtn);

    const nameInput = card.querySelector(`[data-name-input="${fieldId}"]`);
    nameInput.addEventListener('input', (e) => {
        const f = state.fields.find(f => f.id === fieldId);
        if (f) { f.name = e.target.value; f.displayName = e.target.value; }
    });

    const typeSelect = card.querySelector(`[data-type-select="${fieldId}"]`);
    typeSelect.addEventListener('change', (e) => {
        const f = state.fields.find(f => f.id === fieldId);
        if (f) {
            f.type = e.target.value;
            const inputContainer = card.querySelector('.form-input');
            if (e.target.value === 'textarea') {
                const textarea = document.createElement('textarea');
                textarea.className = 'form-input form-textarea';
                textarea.dataset.fieldId = fieldId;
                textarea.placeholder = '请输入内容';
                inputContainer.replaceWith(textarea);
            } else if (e.target.value === 'date') {
                const dateInput = document.createElement('input');
                dateInput.type = 'date';
                dateInput.className = 'form-input';
                dateInput.dataset.fieldId = fieldId;
                inputContainer.replaceWith(dateInput);
            } else {
                const textInput = document.createElement('input');
                textInput.type = 'text';
                textInput.className = 'form-input';
                textInput.dataset.fieldId = fieldId;
                textInput.placeholder = '请输入内容';
                inputContainer.replaceWith(textInput);
            }
        }
    });

    const removeBtn = card.querySelector(`[data-remove-field="${fieldId}"]`);
    removeBtn.addEventListener('click', () => {
        state.fields = state.fields.filter(f => f.id !== fieldId);
        card.remove();
        updateFieldCount();
    });

    updateFieldCount();
    dom.noFieldsHint.classList.add('hidden');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('已添加新字段', 'success');
}

function updateFieldCount() {
    dom.fieldCount.textContent = `${state.fields.length} 个字段`;
}

// ================================================================
// ===== 框选模式功能 =====
// ================================================================

/**
 * 切换框选模式
 */
function toggleSelectMode() {
    state.selectMode = !state.selectMode;
    dom.btnSelectMode.classList.toggle('active', state.selectMode);

    if (state.selectMode) {
        dom.selectOverlay.style.display = 'block';
        dom.selectOverlay.classList.add('active');
        dom.btnSelectMode.innerHTML = '<i class="ri-close-line"></i><span>退出框选</span>';
        showToast('框选模式已开启，在PDF上拖拽鼠标框出需要填写的区域', 'info', 4000);
        // 显示框选模式提示条
        showSelectModeToolbar();
    } else {
        dom.selectOverlay.style.display = 'none';
        dom.selectOverlay.classList.remove('active');
        dom.btnSelectMode.innerHTML = '<i class="ri-drag-move-line"></i><span>框选填写区</span>';
        hideSelectModeToolbar();
    }
}

/**
 * 显示框选模式提示条（在表单区域顶部）
 */
function showSelectModeToolbar() {
    const existing = document.getElementById('select-toolbar');
    if (existing) return;

    const toolbar = document.createElement('div');
    toolbar.id = 'select-toolbar';
    toolbar.className = 'select-mode-toolbar';
    toolbar.innerHTML = `
        <div class="toolbar-icon"><i class="ri-drag-move-line"></i></div>
        <div class="toolbar-text">
            <strong>框选模式已开启</strong><br>
            在左侧PDF预览上拖拽鼠标，框出需要填写的区域，松开后设置字段信息
        </div>
    `;
    dom.formFields.parentElement.insertBefore(toolbar, dom.formFields);
}

function hideSelectModeToolbar() {
    const existing = document.getElementById('select-toolbar');
    if (existing) existing.remove();
}

/**
 * 框选模式 - 鼠标按下
 */
function onSelectMouseDown(e) {
    if (!state.selectMode) return;
    e.preventDefault();
    e.stopPropagation();

    const wrapperRect = dom.pdfPreviewWrapper.getBoundingClientRect();
    state.isSelecting = true;
    state.selectionStart = {
        x: e.clientX - wrapperRect.left,
        y: e.clientY - wrapperRect.top
    };

    dom.selectionRect.style.display = 'block';
    dom.selectionRect.style.left = state.selectionStart.x + 'px';
    dom.selectionRect.style.top = state.selectionStart.y + 'px';
    dom.selectionRect.style.width = '0px';
    dom.selectionRect.style.height = '0px';
}

/**
 * 框选模式 - 鼠标移动
 */
function onSelectMouseMove(e) {
    if (!state.isSelecting || !state.selectionStart) return;
    e.preventDefault();

    const wrapperRect = dom.pdfPreviewWrapper.getBoundingClientRect();
    const currentX = e.clientX - wrapperRect.left;
    const currentY = e.clientY - wrapperRect.top;

    const x = Math.min(state.selectionStart.x, currentX);
    const y = Math.min(state.selectionStart.y, currentY);
    const w = Math.abs(currentX - state.selectionStart.x);
    const h = Math.abs(currentY - state.selectionStart.y);

    dom.selectionRect.style.left = x + 'px';
    dom.selectionRect.style.top = y + 'px';
    dom.selectionRect.style.width = w + 'px';
    dom.selectionRect.style.height = h + 'px';
}

/**
 * 框选模式 - 鼠标松开
 */
function onSelectMouseUp(e) {
    if (!state.isSelecting) return;
    e.preventDefault();
    state.isSelecting = false;

    const wrapperRect = dom.pdfPreviewWrapper.getBoundingClientRect();
    const endX = e.clientX - wrapperRect.left;
    const endY = e.clientY - wrapperRect.top;

    const x = Math.min(state.selectionStart.x, endX);
    const y = Math.min(state.selectionStart.y, endY);
    const w = Math.abs(endX - state.selectionStart.x);
    const h = Math.abs(endY - state.selectionStart.y);

    dom.selectionRect.style.display = 'none';

    // 最小框选区域 15x15 像素
    if (w < 15 || h < 15) {
        state.selectionStart = null;
        return;
    }

    // 将屏幕坐标转换为 PDF 坐标
    const canvas = dom.pdfCanvas;
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / canvasRect.width;
    const scaleY = canvas.height / canvasRect.height;

    // 相对于canvas的偏移
    const canvasOffsetX = canvasRect.left - wrapperRect.left;
    const canvasOffsetY = canvasRect.top - wrapperRect.top;

    const pdfPixelRect = {
        x: (x - canvasOffsetX) * scaleX,
        y: (y - canvasOffsetY) * scaleY,
        w: w * scaleX,
        h: h * scaleY
    };

    // 转换为PDF坐标系（原点在左下角）
    const viewport = state.currentViewport;
    if (viewport) {
        const pdfScale = viewport.scale;
        const pdfX1 = pdfPixelRect.x / pdfScale;
        const pdfY2 = (canvas.height - pdfPixelRect.y) / pdfScale;
        const pdfX2 = (pdfPixelRect.x + pdfPixelRect.w) / pdfScale;
        const pdfY1 = (canvas.height - pdfPixelRect.y - pdfPixelRect.h) / pdfScale;

        // 显示弹窗让用户定义字段
        showRegionDialog({
            screenRect: { x, y, w, h },
            pdfRect: [pdfX1, pdfY1, pdfX2, pdfY2],
            page: state.currentPage
        });
    }

    state.selectionStart = null;
}

/**
 * 显示框选区域定义弹窗
 */
function showRegionDialog(regionInfo) {
    const overlay = document.createElement('div');
    overlay.className = 'region-dialog-overlay';

    overlay.innerHTML = `
        <div class="region-dialog">
            <h3><i class="ri-focus-3-line text-primary-500"></i> 定义填写字段</h3>
            <label>字段名称</label>
            <input type="text" class="dialog-input" id="region-field-name" placeholder="例如：姓名、联系电话..." autofocus>
            <label>字段类型</label>
            <select class="dialog-input" id="region-field-type">
                <option value="text">文本输入</option>
                <option value="textarea">多行文本</option>
                <option value="date">日期</option>
                <option value="checkbox">复选框</option>
            </select>
            <label>字体大小</label>
            <select class="dialog-input" id="region-font-size">
                <option value="auto">自动</option>
                <option value="8">8pt</option>
                <option value="10">10pt</option>
                <option value="12">12pt</option>
                <option value="14">14pt</option>
                <option value="16">16pt</option>
            </select>
            <div class="dialog-actions">
                <button class="btn-cancel" id="region-cancel">取消</button>
                <button class="btn-confirm" id="region-confirm"><i class="ri-check-line mr-1"></i>确认添加</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector('#region-field-name');
    const typeSelect = overlay.querySelector('#region-field-type');
    const fontSizeSelect = overlay.querySelector('#region-font-size');
    const cancelBtn = overlay.querySelector('#region-cancel');
    const confirmBtn = overlay.querySelector('#region-confirm');

    // 聚焦
    setTimeout(() => nameInput.focus(), 100);

    // 回车确认
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmBtn.click();
        if (e.key === 'Escape') cancelBtn.click();
    });

    cancelBtn.addEventListener('click', () => {
        overlay.remove();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    confirmBtn.addEventListener('click', () => {
        const name = nameInput.value.trim() || `区域字段_${state.regions.length + 1}`;
        const type = typeSelect.value;
        const fontSize = fontSizeSelect.value;

        const fieldId = `region_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

        const region = {
            id: fieldId,
            page: regionInfo.page,
            screenRect: regionInfo.screenRect,
            pdfRect: regionInfo.pdfRect,
            fontSize: fontSize
        };
        state.regions.push(region);

        // 创建字段
        const field = {
            id: fieldId,
            name: name,
            displayName: name,
            page: regionInfo.page,
            type: type,
            value: '',
            options: [],
            required: false,
            maxLength: 0,
            rect: regionInfo.pdfRect,
            isAutoDetected: false,
            isManual: false,
            isRegionField: true,
            fontSize: fontSize
        };
        state.fields.push(field);

        overlay.remove();

        // 刷新表单和标记
        rebuildForm();
        renderRegionMarkers();
        updateFieldCount();

        showToast(`已添加框选字段「${name}」`, 'success');

        // 滚动到新字段
        setTimeout(() => {
            const newCard = document.querySelector(`[data-field-id="${fieldId}"]`);
            if (newCard) newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    });
}

/**
 * 在PDF预览上渲染当前页的框选区域标记
 */
function renderRegionMarkers() {
    dom.regionMarkers.innerHTML = '';

    const canvas = dom.pdfCanvas;
    const canvasRect = canvas.getBoundingClientRect();
    const wrapperRect = dom.pdfPreviewWrapper.getBoundingClientRect();
    const canvasOffsetX = canvasRect.left - wrapperRect.left;
    const canvasOffsetY = canvasRect.top - wrapperRect.top;

    const viewport = state.currentViewport;
    if (!viewport) return;

    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;

    state.regions.filter(r => r.page === state.currentPage).forEach(region => {
        const [pdfX1, pdfY1, pdfX2, pdfY2] = region.pdfRect;
        const pdfScale = viewport.scale;

        // PDF坐标→canvas像素→屏幕像素
        const pixelX = pdfX1 * pdfScale * scaleX + canvasOffsetX;
        const pixelY = (canvas.height - pdfY2 * pdfScale) * scaleY + canvasOffsetY;
        const pixelW = (pdfX2 - pdfX1) * pdfScale * scaleX;
        const pixelH = (pdfY2 - pdfY1) * pdfScale * scaleY;

        const field = state.fields.find(f => f.id === region.id);
        const label = field ? (field.displayName || field.name) : '未命名';

        const marker = document.createElement('div');
        marker.className = 'region-marker';
        marker.style.left = pixelX + 'px';
        marker.style.top = pixelY + 'px';
        marker.style.width = pixelW + 'px';
        marker.style.height = pixelH + 'px';
        marker.innerHTML = `
            <span class="region-label">${escapeHtml(label)}</span>
            <button class="region-delete" data-delete-region="${region.id}" title="删除此区域">×</button>
        `;

        // 点击标记高亮对应表单
        marker.addEventListener('click', (e) => {
            if (e.target.closest('.region-delete')) return;
            const card = document.querySelector(`[data-field-id="${region.id}"]`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.style.transition = 'box-shadow 0.3s';
                card.style.boxShadow = '0 0 0 3px rgba(65, 120, 245, 0.3)';
                setTimeout(() => { card.style.boxShadow = ''; }, 1500);
            }
        });

        dom.regionMarkers.appendChild(marker);
    });
}

/**
 * 删除框选区域
 */
function deleteRegion(regionId) {
    state.regions = state.regions.filter(r => r.id !== regionId);
    state.fields = state.fields.filter(f => f.id !== regionId);
    rebuildForm();
    renderRegionMarkers();
    updateFieldCount();
    showToast('已删除框选区域', 'info');
}

// ===== 收集表单数据 =====
function collectFormData() {
    state.fields.forEach(field => {
        let input;
        switch (field.type) {
            case 'checkbox':
                input = document.querySelector(`.form-checkbox[data-field-id="${field.id}"]`);
                if (input) field.value = input.checked;
                break;
            case 'radio': {
                const checked = document.querySelector(`input[name="radio_${field.id}"]:checked`);
                field.value = checked ? checked.value : '';
                break;
            }
            case 'signature': {
                const sigData = document.querySelector(`.signature-data[data-field-id="${field.id}"]`);
                field.value = sigData ? sigData.value : '';
                break;
            }
            default:
                // 精确选择 input/textarea/select 元素，排除外层卡片 div
                input = document.querySelector(`input.form-input[data-field-id="${field.id}"], textarea.form-input[data-field-id="${field.id}"], select.form-input[data-field-id="${field.id}"], input[type="date"][data-field-id="${field.id}"]`);
                if (input) {
                    field.value = input.value;
                }
        }
    });
    return state.fields;
}

// ===== 生成PDF =====
async function handleGenerate() {
    console.log('开始生成PDF...');
    
    let fields;
    try {
        fields = collectFormData();
        console.log('收集到的字段数据:', fields.map(f => ({ id: f.id, name: f.name, value: f.value, type: f.type })));
    } catch (e) {
        console.error('收集表单数据出错:', e);
        showToast('收集表单数据出错: ' + e.message, 'error');
        return;
    }

    const emptyRequired = fields.filter(f => f.required && !f.value);
    if (emptyRequired.length > 0) {
        showToast(`请填写必填字段: ${emptyRequired.map(f => f.displayName || f.name).join(', ')}`, 'error');
        return;
    }

    const filledFields = fields.filter(f => {
        if (f.type === 'checkbox') return f.value === true;
        return f.value && String(f.value).trim() !== '';
    });

    console.log('已填写的字段数:', filledFields.length);

    if (filledFields.length === 0) {
        showToast('请至少填写一个字段', 'error');
        return;
    }

    if (!state.originalBuffer) {
        showToast('原始PDF数据丢失，请重新上传文件', 'error');
        return;
    }

    try {
        showLoading('正在生成 PDF 文件...');
        console.log('调用 generateFilledPDF...');
        
        const blob = await generateFilledPDF(state.originalBuffer, fields);
        console.log('PDF生成完成, blob大小:', blob.size);
        
        state.generatedBlob = blob;

        const outputName = state.fileName.replace(/\.pdf$/i, '') + '_filled.pdf';
        dom.downloadFilename.innerHTML = `<i class="ri-file-pdf-2-line mr-1 text-red-400"></i>文件名：${outputName}`;

        downloadPDF(blob, outputName);

        hideLoading();
        setStep(3);
        showToast('PDF 生成成功！', 'success');
    } catch (err) {
        hideLoading();
        console.error('PDF生成错误:', err);
        console.error('错误堆栈:', err.stack);
        showToast('PDF 生成失败: ' + (err.message || '未知错误'), 'error', 5000);
    }
}

// ===== 签名画布 =====
function initSignatureCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    canvas.width = canvas.offsetWidth;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    }

    function startDraw(e) {
        e.preventDefault();
        isDrawing = true;
        const pos = getPos(e);
        lastX = pos.x;
        lastY = pos.y;
    }

    function draw(e) {
        if (!isDrawing) return;
        e.preventDefault();
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        lastX = pos.x;
        lastY = pos.y;
        const sigData = canvas.parentElement.querySelector('.signature-data');
        if (sigData) sigData.value = canvas.toDataURL();
    }

    function endDraw() { isDrawing = false; }

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', endDraw);
}

// ===== 工具函数 =====
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== 重置 =====
function resetApp() {
    state.pdfDoc = null;
    state.originalBuffer = null;
    state.fields = [];
    state.currentPage = 1;
    state.totalPages = 0;
    state.fileName = '';
    state.generatedBlob = null;
    state.selectMode = false;
    state.isSelecting = false;
    state.selectionStart = null;
    state.regions = [];
    state.currentViewport = null;
    dom.fileInput.value = '';
    dom.formFields.innerHTML = '';
    dom.regionMarkers.innerHTML = '';
    dom.selectOverlay.style.display = 'none';
    dom.btnSelectMode.classList.remove('active');
    dom.btnSelectMode.innerHTML = '<i class="ri-drag-move-line"></i><span>框选填写区</span>';
    hideSelectModeToolbar();
    setStep(1);
}

// ===== 事件绑定 =====
function bindEvents() {
    // 文件选择
    dom.btnSelectFile.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.fileInput.click();
    });
    dom.uploadArea.addEventListener('click', () => dom.fileInput.click());
    dom.fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFileSelect(file);
    });

    // 拖拽上传
    dom.uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.uploadArea.classList.add('drag-over');
    });
    dom.uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dom.uploadArea.classList.remove('drag-over');
    });
    dom.uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.uploadArea.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
    });

    // 页面导航
    dom.btnPrevPage.addEventListener('click', () => goToPage(state.currentPage - 1));
    dom.btnNextPage.addEventListener('click', () => goToPage(state.currentPage + 1));

    // 清空所有字段
    dom.btnClearAll.addEventListener('click', () => {
        document.querySelectorAll('.form-input').forEach(input => {
            if (input.tagName === 'SELECT') input.selectedIndex = 0;
            else if (input.type === 'checkbox') input.checked = false;
            else input.value = '';
        });
        document.querySelectorAll('.form-checkbox').forEach(cb => { cb.checked = false; });
        showToast('已清空所有字段', 'info');
    });

    // 生成PDF
    dom.btnGenerate.addEventListener('click', handleGenerate);

    // 完成步骤的按钮
    dom.btnDownloadAgain.addEventListener('click', () => {
        if (state.generatedBlob) {
            const outputName = state.fileName.replace(/\.pdf$/i, '') + '_filled.pdf';
            downloadPDF(state.generatedBlob, outputName);
            showToast('开始下载', 'success');
        }
    });
    dom.btnFillAgain.addEventListener('click', () => {
        setStep(2);
        // 重新渲染框选标记
        setTimeout(() => renderRegionMarkers(), 100);
    });
    dom.btnNewFile.addEventListener('click', resetApp);
    dom.btnReset.addEventListener('click', resetApp);

    // ===== 框选模式事件 =====
    dom.btnSelectMode.addEventListener('click', toggleSelectMode);

    // 框选覆盖层的鼠标事件
    dom.selectOverlay.addEventListener('mousedown', onSelectMouseDown);
    dom.selectOverlay.addEventListener('mousemove', onSelectMouseMove);
    dom.selectOverlay.addEventListener('mouseup', onSelectMouseUp);
    dom.selectOverlay.addEventListener('mouseleave', (e) => {
        if (state.isSelecting) onSelectMouseUp(e);
    });

    // 使用事件委托处理删除区域和签名清除
    document.addEventListener('click', (e) => {
        // 删除框选区域
        const deleteBtn = e.target.closest('[data-delete-region]');
        if (deleteBtn) {
            e.stopPropagation();
            deleteRegion(deleteBtn.dataset.deleteRegion);
            return;
        }
        // 删除框选字段（表单卡片中的删除按钮）
        const removeRegionBtn = e.target.closest('[data-remove-region]');
        if (removeRegionBtn) {
            e.stopPropagation();
            deleteRegion(removeRegionBtn.dataset.removeRegion);
            return;
        }
        // 清除签名
        const clearBtn = e.target.closest('.clear-signature');
        if (clearBtn) {
            const fieldId = clearBtn.dataset.fieldId;
            const canvas = document.querySelector(`.signature-canvas[data-field-id="${fieldId}"]`);
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                const sigData = canvas.parentElement.querySelector('.signature-data');
                if (sigData) sigData.value = '';
            }
        }
    });

    // 监听窗口resize，重新渲染标记
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => renderRegionMarkers(), 200);
    });

    // 监听表单字段渲染完成后初始化签名画布
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                const canvases = node.querySelectorAll ? node.querySelectorAll('.signature-canvas') : [];
                canvases.forEach(canvas => initSignatureCanvas(canvas));
            });
        });
    });
    observer.observe(dom.formFields, { childList: true, subtree: true });
}

// ===== 初始化 =====
function init() {
    initDom();
    bindEvents();
    setStep(1);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
