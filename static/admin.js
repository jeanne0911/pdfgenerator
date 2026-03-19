// admin.js - 管理者后台逻辑

const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ==================== State ====================
const state = {
  templates: [],
  currentTemplate: null,
  pdfDoc: null,
  currentPage: 1,
  totalPages: 1,
  scale: 1.0,
  userZoom: null,       // null = auto-fit, number = manual zoom
  baseScale: 1.0,       // auto-fit scale for reference
  fields: [],          // { id, field_def_id, custom_label, page_num, x, y, width, height, font_size, sort_order, _label, _type }
  parsedFields: [],    // 从PDF解析出的原生字段（未保存）
  parseStatus: 'idle', // idle | parsing | done | error | none
  fieldDefs: [],
  drawMode: true,
  isDrawing: false,
  drawStart: null,
  pendingRect: null,   // { x, y, width, height } in PDF coords
  // Drag & Resize state for field regions
  dragTarget: null,     // { fieldIdx, startX, startY, origX, origY }
  resizeTarget: null,   // { fieldIdx, startX, startY, origW, origH, origX, origY, handle }
  editingFieldIdx: null, // 当前正在编辑的字段索引
};

// ==================== DOM ====================
const dom = {
  uploadZone: document.getElementById('upload-zone'),
  pdfUploadInput: document.getElementById('pdf-upload-input'),
  templateList: document.getElementById('template-list'),
  editorToolbar: document.getElementById('editor-toolbar'),
  currentTemplateName: document.getElementById('current-template-name'),
  pdfCanvasWrap: document.getElementById('pdf-canvas-wrap'),
  pdfCanvas: document.getElementById('pdf-canvas'),
  overlaySvg: document.getElementById('overlay-svg'),
  drawLayer: document.getElementById('draw-layer'),
  selectionBox: document.getElementById('selection-box'),
  emptyState: document.getElementById('empty-state'),
  curPage: document.getElementById('cur-page'),
  totalPages: document.getElementById('total-pages'),
  btnPrevPage: document.getElementById('btn-prev-page'),
  btnNextPage: document.getElementById('btn-next-page'),
  btnSaveFields: document.getElementById('btn-save-fields'),
  btnDrawMode: document.getElementById('btn-draw-mode'),
  btnViewMode: document.getElementById('btn-view-mode'),
  fieldsList: document.getElementById('fields-list'),
  fieldsEmpty: document.getElementById('fields-empty'),
  // Upload modal
  uploadModal: document.getElementById('upload-modal'),
  btnNewTemplate: document.getElementById('btn-new-template'),
  newTemplateName: document.getElementById('new-template-name'),
  newTemplateDesc: document.getElementById('new-template-desc'),
  modalUploadZone: document.getElementById('modal-upload-zone'),
  modalPdfInput: document.getElementById('modal-pdf-input'),
  modalFileName: document.getElementById('modal-file-name'),
  btnCancelUpload: document.getElementById('btn-cancel-upload'),
  btnConfirmUpload: document.getElementById('btn-confirm-upload'),
  // Field modal
  fieldModal: document.getElementById('field-modal'),
  fieldDefSelect: document.getElementById('field-def-select'),
  fieldCustomLabel: document.getElementById('field-custom-label'),
  fieldFontSize: document.getElementById('field-font-size'),
  fieldPageNum: document.getElementById('field-page-num'),
  fieldXDisplay: document.getElementById('field-x-display'),
  fieldYDisplay: document.getElementById('field-y-display'),
  fieldWDisplay: document.getElementById('field-w-display'),
  fieldHDisplay: document.getElementById('field-h-display'),
  btnCancelField: document.getElementById('btn-cancel-field'),
  btnConfirmField: document.getElementById('btn-confirm-field'),
  // Field manager modal
  fieldMgrModal: document.getElementById('field-mgr-modal'),
  btnFieldMgr: document.getElementById('btn-field-mgr'),
  btnCloseFieldMgr: document.getElementById('btn-close-field-mgr'),
  newFieldName: document.getElementById('new-field-name'),
  newFieldLabel: document.getElementById('new-field-label'),
  newFieldType: document.getElementById('new-field-type'),
  btnAddFieldDef: document.getElementById('btn-add-field-def'),
  fieldDefList: document.getElementById('field-def-list'),
  // Storage modal
  storageModal: document.getElementById('storage-modal'),
  btnStorageStatus: document.getElementById('btn-storage-status'),
  btnCloseStorage: document.getElementById('btn-close-storage'),
  storageStatusContent: document.getElementById('storage-status-content'),
  btnTriggerMigrate: document.getElementById('btn-trigger-migrate'),
  btnRefreshStorage: document.getElementById('btn-refresh-storage'),
  toast: document.getElementById('toast'),
  toastInner: document.getElementById('toast-inner'),
};

let modalPdfFile = null;

/** 同步弹窗内文件上传区的视觉状态，显示已选PDF文件名和预览 */
function syncModalFileInput(file) {
  if (!file) return;
  const zone = dom.modalUploadZone;
  zone.innerHTML = `
    <div class="flex flex-col items-center gap-2">
      <div class="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
        <i class="fa-solid fa-file-pdf text-2xl text-purple-500"></i>
      </div>
      <p class="text-sm font-medium text-purple-700" id="modal-file-name">${file.name}</p>
      <p class="text-xs text-gray-400">${(file.size / 1024).toFixed(1)} KB</p>
      <button type="button" id="btn-reselect-pdf" class="text-xs text-purple-600 hover:text-purple-800 underline mt-1">重新选择</button>
      <input type="file" id="modal-pdf-input" accept=".pdf" class="hidden" />
    </div>
  `;
  // 重新绑定引用
  dom.modalPdfInput = document.getElementById('modal-pdf-input');
  dom.modalFileName = document.getElementById('modal-file-name');
  // 重新选择按钮事件
  const btnReselect = document.getElementById('btn-reselect-pdf');
  if (btnReselect) {
    btnReselect.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.modalPdfInput.click();
    });
  }
  // 重新绑定 input change
  dom.modalPdfInput.addEventListener('change', e => {
    if (e.target.files[0]) {
      modalPdfFile = e.target.files[0];
      dom.modalFileName.textContent = modalPdfFile.name;
      if (!dom.newTemplateName.value) dom.newTemplateName.value = modalPdfFile.name.replace('.pdf', '');
      syncModalFileInput(modalPdfFile);
    }
  });
  // 点击zone也能重新选择
  zone.addEventListener('click', () => dom.modalPdfInput.click());
}

/** 重置弹窗内上传区域为初始状态 */
function resetModalUploadZone() {
  const zone = dom.modalUploadZone;
  zone.innerHTML = `
    <i class="fa-solid fa-file-pdf text-3xl text-gray-300 mb-2"></i>
    <p class="text-sm text-gray-500" id="modal-file-name">点击选择PDF文件</p>
    <input type="file" id="modal-pdf-input" accept=".pdf" class="hidden" />
  `;
  dom.modalPdfInput = document.getElementById('modal-pdf-input');
  dom.modalFileName = document.getElementById('modal-file-name');
  // 重新绑定
  dom.modalUploadZone.addEventListener('click', () => dom.modalPdfInput.click());
  dom.modalPdfInput.addEventListener('change', e => {
    if (e.target.files[0]) {
      modalPdfFile = e.target.files[0];
      if (!dom.newTemplateName.value) dom.newTemplateName.value = modalPdfFile.name.replace('.pdf', '');
      syncModalFileInput(modalPdfFile);
    }
  });
}

// ==================== Toast ====================
function showToast(msg, type = 'success') {
  const colors = { success: 'bg-green-500 text-white', error: 'bg-red-500 text-white', info: 'bg-blue-500 text-white' };
  const icons = { success: 'fa-check-circle', error: 'fa-circle-xmark', info: 'fa-circle-info' };
  dom.toastInner.className = `px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${colors[type]}`;
  dom.toastInner.innerHTML = `<i class="fa-solid ${icons[type]}"></i>${msg}`;
  dom.toast.classList.remove('hidden');
  setTimeout(() => dom.toast.classList.add('hidden'), 3000);
}

// ==================== API ====================
async function api(method, path, body = null, isForm = false) {
  const opts = { method, headers: {} };
  if (body) {
    if (isForm) { opts.body = body; }
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ==================== Field Definitions ====================
async function loadFieldDefs() {
  const res = await api('GET', '/api/field-definitions');
  state.fieldDefs = res.data || [];
  renderFieldDefSelect();
  renderFieldDefList();
}

function renderFieldDefSelect() {
  dom.fieldDefSelect.innerHTML = '<option value="">-- 选择已有字段 --</option>';
  state.fieldDefs.forEach(fd => {
    const opt = document.createElement('option');
    opt.value = fd.id;
    opt.textContent = `${fd.label}（${fd.name}）`;
    opt.dataset.type = fd.field_type;
    dom.fieldDefSelect.appendChild(opt);
  });
}

// 编辑状态追踪
let editingFieldDefId = null;

// ==================== COS Storage Status ====================
async function loadStorageStatus() {
  if (!dom.storageStatusContent) return;
  dom.storageStatusContent.innerHTML = `<div class="text-center py-6 text-gray-400"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2 block"></i>加载中...</div>`;
  try {
    const resp = await fetch('/api/storage/status');
    const data = await resp.json();
    const s = data.data;
    const cosPercent = s.total_templates > 0 ? Math.round((s.stored_in_cos / s.total_templates) * 100) : 0;
    dom.storageStatusContent.innerHTML = `
      <div class="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-4">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
            <i class="fa-solid fa-cloud text-orange-600 text-lg"></i>
          </div>
          <div>
            <div class="text-sm font-bold text-gray-800">COS 存储概况</div>
            <div class="text-xs text-gray-500">共 ${s.total_templates} 个模板</div>
          </div>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-2.5 mb-3">
          <div class="bg-green-500 h-2.5 rounded-full transition-all" style="width:${cosPercent}%"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="bg-white rounded-lg p-3 border border-gray-100">
            <div class="flex items-center gap-2 mb-1">
              <i class="fa-solid fa-cloud text-green-500"></i>
              <span class="text-xs font-semibold text-gray-600">COS对象存储</span>
            </div>
            <div class="text-lg font-bold text-green-600">${s.stored_in_cos}</div>
            <div class="text-xs text-gray-400">${s.cos_usage_mb} MB 存储占用</div>
          </div>
          <div class="bg-white rounded-lg p-3 border border-gray-100">
            <div class="flex items-center gap-2 mb-1">
              <i class="fa-solid fa-database text-blue-500"></i>
              <span class="text-xs font-semibold text-gray-600">数据库BLOB</span>
            </div>
            <div class="text-lg font-bold text-blue-600">${s.stored_in_database}</div>
            <div class="text-xs text-gray-400">${s.stored_in_database > 0 ? '待迁移' : '已全部迁移'}</div>
          </div>
        </div>
      </div>
      <div class="bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
        <div class="flex items-center gap-2 mb-1">
          <i class="fa-solid fa-cloud text-gray-400"></i>
          <span class="font-medium">COS 配置</span>
        </div>
        <div class="space-y-1 mt-1.5">
          <div>Bucket: <code class="text-purple-600 bg-purple-50 px-2 py-0.5 rounded text-xs">${s.cos_bucket || '未配置'}</code></div>
          <div>Region: <code class="text-purple-600 bg-purple-50 px-2 py-0.5 rounded text-xs">${s.cos_region || '未配置'}</code></div>
          <div>Prefix: <code class="text-purple-600 bg-purple-50 px-2 py-0.5 rounded text-xs">${s.cos_prefix || '/'}</code>
            <span class="ml-2">共 ${s.cos_objects_count} 个对象</span>
          </div>
        </div>
      </div>
      ${s.stored_in_database > 0 ? `
      <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 flex items-start gap-2">
        <i class="fa-solid fa-triangle-exclamation mt-0.5"></i>
        <span>有 ${s.stored_in_database} 个PDF仍存储在数据库BLOB中，建议点击下方按钮迁移到COS以减轻数据库压力。</span>
      </div>` : `
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700 flex items-center gap-2">
        <i class="fa-solid fa-circle-check"></i>
        <span>所有PDF模板已存储在COS对象存储中，数据库BLOB字段已清空。</span>
      </div>`}
    `;
  } catch (e) {
    dom.storageStatusContent.innerHTML = `<div class="text-center py-6 text-red-400"><i class="fa-solid fa-circle-xmark text-2xl mb-2 block"></i>加载失败: ${e.message}</div>`;
  }
}

function renderFieldDefList() {
  // 更新计数
  const countEl = document.getElementById('field-def-count');
  if (countEl) countEl.textContent = `${state.fieldDefs.length} 个`;

  if (!state.fieldDefs.length) {
    dom.fieldDefList.innerHTML = '<div class="text-center text-gray-400 text-sm py-4"><i class="fa-solid fa-inbox text-2xl mb-2 block text-gray-300"></i>暂无字段定义<br><span class="text-xs">请在上方添加字段</span></div>';
    return;
  }
  const typeLabels = { text: '文本', textarea: '多行', date: '日期', number: '数字', checkbox: '复选' };
  const typeColors = { text: 'bg-blue-100 text-blue-700', textarea: 'bg-green-100 text-green-700', date: 'bg-yellow-100 text-yellow-700', number: 'bg-orange-100 text-orange-700', checkbox: 'bg-purple-100 text-purple-700' };
  const typeIcons = { text: 'fa-font', textarea: 'fa-align-left', date: 'fa-calendar', number: 'fa-hashtag', checkbox: 'fa-square-check' };

  dom.fieldDefList.innerHTML = state.fieldDefs.map(fd => {
    const isEditing = editingFieldDefId === fd.id;
    if (isEditing) {
      // 编辑模式：内联编辑表单
      return `
        <div class="field-def-item p-3 bg-purple-50 rounded-xl border-2 border-purple-400 shadow-sm" data-id="${fd.id}">
          <div class="flex items-center gap-1 mb-2">
            <i class="fa-solid fa-pen text-purple-500 text-xs"></i>
            <span class="text-xs font-semibold text-purple-600">编辑字段定义</span>
          </div>
          <div class="space-y-2">
            <div class="flex gap-2">
              <div class="flex-1">
                <label class="block text-xs text-gray-500 mb-0.5">字段标识</label>
                <input id="edit-field-name-${fd.id}" type="text" value="${_escapeAttr(fd.name)}" class="w-full border border-purple-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
              </div>
              <div class="flex-1">
                <label class="block text-xs text-gray-500 mb-0.5">显示名称</label>
                <input id="edit-field-label-${fd.id}" type="text" value="${_escapeAttr(fd.label)}" class="w-full border border-purple-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
              </div>
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-0.5">字段类型</label>
              <select id="edit-field-type-${fd.id}" class="w-full border border-purple-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white">
                <option value="text" ${fd.field_type === 'text' ? 'selected' : ''}>文本</option>
                <option value="textarea" ${fd.field_type === 'textarea' ? 'selected' : ''}>多行</option>
                <option value="date" ${fd.field_type === 'date' ? 'selected' : ''}>日期</option>
                <option value="number" ${fd.field_type === 'number' ? 'selected' : ''}>数字</option>
                <option value="checkbox" ${fd.field_type === 'checkbox' ? 'selected' : ''}>复选</option>
              </select>
            </div>
          </div>
          <div class="flex gap-2 mt-3">
            <button class="btn-save-field-def flex-1 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors flex items-center justify-center gap-1" data-id="${fd.id}">
              <i class="fa-solid fa-check text-xs"></i> 保存
            </button>
            <button class="btn-cancel-edit-field-def flex-1 px-3 py-1.5 bg-white border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-1" data-id="${fd.id}">
              <i class="fa-solid fa-xmark text-xs"></i> 取消
            </button>
          </div>
        </div>`;
    } else {
      // 查看模式
      return `
        <div class="field-def-item flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200 hover:border-purple-300 hover:bg-white transition-all group" data-id="${fd.id}">
          <div class="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 group-hover:border-purple-300 transition-colors">
            <i class="fa-solid ${typeIcons[fd.field_type] || 'fa-font'} text-sm ${typeColors[fd.field_type] ? typeColors[fd.field_type].split(' ')[1] : 'text-gray-400'}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-gray-800 text-sm truncate">${fd.label}</span>
              <span class="text-xs px-2 py-0.5 rounded-full ${typeColors[fd.field_type] || 'bg-gray-100 text-gray-600'}">${typeLabels[fd.field_type] || fd.field_type}</span>
            </div>
            <div class="text-xs text-gray-400 mt-0.5 truncate">${fd.name}</div>
          </div>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button class="btn-edit-field-def w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-all" data-id="${fd.id}" title="编辑">
              <i class="fa-solid fa-pen text-xs"></i>
            </button>
            <button class="btn-del-field-def w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all" data-id="${fd.id}" title="删除">
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </div>
        </div>`;
    }
  }).join('');
}

/** 转义HTML属性值中的特殊字符 */
function _escapeAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 进入编辑模式 */
function startEditFieldDef(id) {
  editingFieldDefId = id;
  renderFieldDefList();
  // 聚焦到编辑表单的第一个输入框
  setTimeout(() => {
    const nameInput = document.getElementById(`edit-field-name-${id}`);
    if (nameInput) nameInput.focus();
  }, 50);
}

/** 取消编辑 */
function cancelEditFieldDef() {
  editingFieldDefId = null;
  renderFieldDefList();
}

/** 保存编辑 */
async function saveEditFieldDef(id) {
  const nameEl = document.getElementById(`edit-field-name-${id}`);
  const labelEl = document.getElementById(`edit-field-label-${id}`);
  const typeEl = document.getElementById(`edit-field-type-${id}`);
  if (!nameEl || !labelEl || !typeEl) return;

  const name = nameEl.value.trim();
  const label = labelEl.value.trim();
  const field_type = typeEl.value;

  if (!name || !label) {
    showToast('字段标识和显示名称不能为空', 'error');
    return;
  }

  // 查找保存按钮并设为loading
  const saveBtn = dom.fieldDefList.querySelector(`.btn-save-field-def[data-id="${id}"]`);
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i> 保存中';
  }

  try {
    await api('PUT', `/api/field-definitions/${id}`, { name, label, field_type });
    editingFieldDefId = null;
    await loadFieldDefs();
    showToast('字段定义已更新');
  } catch (e) {
    showToast('更新失败：' + e.message, 'error');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-check text-xs"></i> 保存';
    }
  }
}

// ==================== Templates ====================
async function loadTemplates() {
  const res = await api('GET', '/api/templates');
  state.templates = res.data || [];
  renderTemplateList();
}

function renderTemplateList() {
  if (!state.templates.length) {
    dom.templateList.innerHTML = `<div class="text-center text-gray-400 text-sm py-8"><i class="fa-solid fa-folder-open text-3xl mb-2 block"></i>暂无模板</div>`;
    return;
  }
  dom.templateList.innerHTML = state.templates.map(t => `
    <div class="template-item p-3 rounded-xl border-2 cursor-pointer transition-all hover:border-purple-300 hover:bg-purple-50 ${state.currentTemplate?.id === t.id ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-white'}" data-id="${t.id}">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 mb-1">
            <i class="fa-solid fa-file-pdf text-red-400 text-sm"></i>
            <span class="font-medium text-gray-800 text-sm truncate">${t.name}</span>
          </div>
          <div class="text-xs text-gray-400 truncate">${t.pdf_filename}</div>
          <div class="text-xs text-gray-400 mt-1">${t.page_count}页</div>
        </div>
        <button class="btn-del-template text-gray-300 hover:text-red-500 transition-colors flex-shrink-0" data-id="${t.id}">
          <i class="fa-solid fa-trash text-xs"></i>
        </button>
      </div>
      <div class="flex gap-1.5 mt-2">
        <button class="btn-download-excel flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-100 transition-colors" title="下载Excel批量填写模板" data-id="${t.id}">
          <i class="fa-solid fa-file-excel text-xs"></i> 下载Excel模板
        </button>
      </div>
    </div>
  `).join('');
}

async function selectTemplate(id) {
  const t = state.templates.find(x => x.id === id);
  if (!t) return;
  state.currentTemplate = t;
  state.parsedFields = [];
  state.parseStatus = 'idle';
  renderTemplateList();
  dom.editorToolbar.classList.remove('hidden');
  dom.currentTemplateName.textContent = t.name;
  dom.emptyState.classList.add('hidden');
  dom.pdfCanvasWrap.classList.remove('hidden');
  // 显示重新解析按钮
  const btnReparse = document.getElementById('btn-reparse');
  if (btnReparse) btnReparse.classList.remove('hidden');

  // Load PDF
  const res = await api('GET', `/api/templates/${id}/pdf`);
  const pdfBytes = Uint8Array.from(atob(res.data.pdf_base64), c => c.charCodeAt(0));
  state.pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
  state.totalPages = state.pdfDoc.numPages;
  state.currentPage = 1;
  dom.totalPages.textContent = state.totalPages;

  // Load saved fields
  const fRes = await api('GET', `/api/templates/${id}/fields`);
  state.fields = (fRes.data || []).map(f => ({
    ...f,
    _label: f.custom_label || f.field_label || f.field_name || '未命名',
    _type: f.field_type || 'text',
  }));

  await renderPage();
  renderFieldsList();

  // 如果没有已保存字段，自动解析PDF原生表单字段
  if (state.fields.length === 0) {
    await autoParseFields(id);
  } else {
    renderParseStatus('saved');
  }
}

// ==================== Auto Parse PDF Fields ====================
async function autoParseFields(templateId) {
  state.parseStatus = 'parsing';
  renderParseStatus('parsing');
  try {
    const res = await api('GET', `/api/templates/${templateId}/parse-fields`);
    const parsed = res.data?.fields || [];
    state.parsedFields = parsed;
    if (parsed.length > 0) {
      state.parseStatus = 'done';
      renderParseStatus('done', parsed.length);
      // 将解析到的字段预填充到fields列表（待用户确认）
      renderParsedFieldsPanel(parsed);
      renderOverlay();
    } else {
      state.parseStatus = 'none';
      renderParseStatus('none');
    }
  } catch (e) {
    state.parseStatus = 'error';
    renderParseStatus('error');
    console.error('Parse fields error:', e);
  }
}

function renderParseStatus(status, count = 0) {
  const banner = document.getElementById('parse-status-banner');
  if (!banner) return;
  const configs = {
    parsing: {
      cls: 'bg-blue-50 border-blue-200 text-blue-700',
      icon: 'fa-spinner fa-spin',
      text: '正在自动解析PDF表单字段...',
      actions: '',
    },
    done: {
      cls: 'bg-green-50 border-green-200 text-green-700',
      icon: 'fa-circle-check',
      text: `自动识别到 <strong>${count}</strong> 个表单字段，已预览在右侧，点击「导入全部」一键添加`,
      actions: `<button id="btn-import-all-parsed" class="ml-3 px-3 py-1 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"><i class="fa-solid fa-file-import mr-1"></i>导入全部</button>
                <button id="btn-dismiss-parse" class="ml-1 px-3 py-1 bg-white border border-green-300 text-green-700 rounded-lg text-xs font-medium hover:bg-green-50 transition-colors">忽略</button>`,
    },
    none: {
      cls: 'bg-yellow-50 border-yellow-200 text-yellow-700',
      icon: 'fa-triangle-exclamation',
      text: '未检测到PDF原生表单字段，请使用「框选模式」手动标注填写区域',
      actions: `<button id="btn-dismiss-parse" class="ml-3 px-3 py-1 bg-white border border-yellow-300 text-yellow-700 rounded-lg text-xs font-medium hover:bg-yellow-50 transition-colors">知道了</button>`,
    },
    error: {
      cls: 'bg-red-50 border-red-200 text-red-700',
      icon: 'fa-circle-xmark',
      text: '解析失败，请使用「框选模式」手动标注填写区域',
      actions: `<button id="btn-dismiss-parse" class="ml-3 px-3 py-1 bg-white border border-red-300 text-red-700 rounded-lg text-xs font-medium hover:bg-red-50 transition-colors">知道了</button>`,
    },
    saved: {
      cls: 'hidden',
      icon: '',
      text: '',
      actions: '',
    },
  };
  const cfg = configs[status] || configs.none;
  if (cfg.cls === 'hidden') {
    banner.classList.add('hidden');
    return;
  }
  banner.className = `border rounded-xl px-4 py-3 flex items-center text-sm mb-0 ${cfg.cls}`;
  banner.innerHTML = `<i class="fa-solid ${cfg.icon} mr-2 flex-shrink-0"></i><span class="flex-1">${cfg.text}</span>${cfg.actions}`;
  banner.classList.remove('hidden');

  // 绑定按钮事件
  const btnImport = document.getElementById('btn-import-all-parsed');
  if (btnImport) {
    btnImport.addEventListener('click', importAllParsedFields);
  }
  const btnDismiss = document.getElementById('btn-dismiss-parse');
  if (btnDismiss) {
    btnDismiss.addEventListener('click', () => {
      state.parsedFields = [];
      banner.classList.add('hidden');
      renderOverlay();
      renderFieldsList();
    });
  }
}

function renderParsedFieldsPanel(parsed) {
  // 在右侧面板显示解析到的字段（带"导入"按钮）
  const typeIcons = { text: 'fa-font', textarea: 'fa-align-left', date: 'fa-calendar', number: 'fa-hashtag', checkbox: 'fa-square-check', select: 'fa-list', signature: 'fa-signature', radio: 'fa-circle-dot' };
  const typeColors = { text: 'text-blue-500', textarea: 'text-green-500', date: 'text-yellow-500', number: 'text-orange-500', checkbox: 'text-purple-500', select: 'text-indigo-500', signature: 'text-pink-500', radio: 'text-teal-500' };
  const typeLabels = { text: '文本', textarea: '多行', date: '日期', number: '数字', checkbox: '复选', select: '下拉', signature: '签名', radio: '单选' };

  const parsedSection = `
    <div id="parsed-fields-section" class="mb-3">
      <div class="flex items-center justify-between mb-2 px-1">
        <span class="text-xs font-semibold text-blue-600 flex items-center gap-1">
          <i class="fa-solid fa-wand-magic-sparkles"></i> 自动识别字段（${parsed.length}个）
        </span>
        <button id="btn-import-all-parsed-panel" class="text-xs text-blue-600 hover:text-blue-800 font-medium">全部导入</button>
      </div>
      ${parsed.map((f, idx) => {
        const fieldDefOptions = state.fieldDefs.map(fd =>
          `<option value="${fd.id}">${fd.label}（${fd.name}）</option>`
        ).join('');
        return `
        <div class="parsed-field-card border border-blue-200 rounded-xl p-3 bg-blue-50 mb-2 hover:border-blue-400 transition-all" data-idx="${idx}">
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <i class="fa-solid ${typeIcons[f.field_type] || 'fa-font'} ${typeColors[f.field_type] || 'text-gray-400'} text-sm flex-shrink-0"></i>
              <div class="min-w-0 flex-1">
                <div class="font-medium text-gray-800 text-sm truncate parsed-field-label" data-idx="${idx}">${f.label}</div>
                <div class="text-xs text-gray-500">第${f.page_num}页 · <span class="px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded text-xs">${typeLabels[f.field_type] || f.field_type}</span></div>
              </div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              <button class="btn-edit-parsed-field w-6 h-6 flex items-center justify-center rounded text-blue-400 hover:text-blue-600 hover:bg-blue-100 transition-all" data-idx="${idx}" title="修改字段名">
                <i class="fa-solid fa-pen text-xs"></i>
              </button>
              <button class="btn-import-single-parsed px-2 py-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 transition-colors" data-idx="${idx}">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
          </div>
          <!-- 编辑区域（默认隐藏） -->
          <div class="parsed-field-edit-area hidden mt-2 p-2 bg-white rounded-lg border border-blue-200" data-idx="${idx}">
            <label class="block text-xs text-gray-500 mb-1">选择字段定义或输入自定义名称</label>
            <select class="parsed-field-def-select w-full border border-blue-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white mb-2" data-idx="${idx}">
              <option value="">-- 使用自定义名称 --</option>
              ${fieldDefOptions}
            </select>
            <input type="text" class="parsed-field-custom-name w-full border border-blue-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" data-idx="${idx}" value="${_escapeAttr(f.label)}" placeholder="输入自定义字段名" />
            <div class="flex gap-2 mt-2">
              <button class="btn-save-parsed-edit flex-1 px-2 py-1 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors" data-idx="${idx}">确定</button>
              <button class="btn-cancel-parsed-edit flex-1 px-2 py-1 bg-white border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors" data-idx="${idx}">取消</button>
            </div>
          </div>
          <div class="mt-1.5 text-xs text-gray-400 bg-white rounded px-2 py-1">
            x:${f.x.toFixed(0)} y:${f.y.toFixed(0)} ${f.width.toFixed(0)}×${f.height.toFixed(0)}
          </div>
        </div>
      `;}).join('')}
      <div class="border-t border-gray-200 my-3"></div>
    </div>
  `;

  const existingSection = document.getElementById('parsed-fields-section');
  if (existingSection) existingSection.remove();

  dom.fieldsList.insertAdjacentHTML('afterbegin', parsedSection);

  // 绑定事件
  document.getElementById('btn-import-all-parsed-panel')?.addEventListener('click', importAllParsedFields);
  dom.fieldsList.querySelectorAll('.btn-import-single-parsed').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.currentTarget.dataset.idx);
      importSingleParsedField(idx);
    });
  });

  // 编辑解析字段名按钮
  dom.fieldsList.querySelectorAll('.btn-edit-parsed-field').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.currentTarget.dataset.idx);
      const editArea = dom.fieldsList.querySelector(`.parsed-field-edit-area[data-idx="${idx}"]`);
      if (editArea) {
        editArea.classList.toggle('hidden');
        if (!editArea.classList.contains('hidden')) {
          editArea.querySelector('.parsed-field-custom-name')?.focus();
        }
      }
    });
  });

  // 下拉选择字段定义时同步输入框
  dom.fieldsList.querySelectorAll('.parsed-field-def-select').forEach(sel => {
    sel.addEventListener('change', e => {
      const idx = parseInt(e.currentTarget.dataset.idx);
      const defId = parseInt(e.currentTarget.value);
      const customInput = dom.fieldsList.querySelector(`.parsed-field-custom-name[data-idx="${idx}"]`);
      if (defId && customInput) {
        const def = state.fieldDefs.find(d => d.id === defId);
        if (def) {
          customInput.value = def.label;
          customInput.disabled = true;
          customInput.classList.add('bg-gray-100', 'text-gray-500');
        }
      } else if (customInput) {
        customInput.disabled = false;
        customInput.classList.remove('bg-gray-100', 'text-gray-500');
      }
    });
  });

  // 保存解析字段编辑
  dom.fieldsList.querySelectorAll('.btn-save-parsed-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.currentTarget.dataset.idx);
      const defSelect = dom.fieldsList.querySelector(`.parsed-field-def-select[data-idx="${idx}"]`);
      const customInput = dom.fieldsList.querySelector(`.parsed-field-custom-name[data-idx="${idx}"]`);
      if (!defSelect || !customInput) return;
      const defId = defSelect.value ? parseInt(defSelect.value) : null;
      const customName = customInput.value.trim();
      if (!defId && !customName) {
        showToast('请选择字段定义或输入名称', 'error');
        return;
      }
      const def = defId ? state.fieldDefs.find(d => d.id === defId) : null;
      const pf = state.parsedFields[idx];
      if (pf) {
        pf.label = def ? def.label : customName;
        pf.name = def ? def.name : customName;
        pf.field_type = def ? def.field_type : pf.field_type;
        pf._matchedDefId = defId; // 记录关联的字段定义ID
      }
      // 更新显示
      const labelEl = dom.fieldsList.querySelector(`.parsed-field-label[data-idx="${idx}"]`);
      if (labelEl) labelEl.textContent = pf.label;
      const editArea = dom.fieldsList.querySelector(`.parsed-field-edit-area[data-idx="${idx}"]`);
      if (editArea) editArea.classList.add('hidden');
      showToast(`字段名已修改为「${pf.label}」`);
      renderOverlay();
    });
  });

  // 取消解析字段编辑
  dom.fieldsList.querySelectorAll('.btn-cancel-parsed-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.currentTarget.dataset.idx);
      const editArea = dom.fieldsList.querySelector(`.parsed-field-edit-area[data-idx="${idx}"]`);
      if (editArea) editArea.classList.add('hidden');
    });
  });
}

function importSingleParsedField(idx) {
  const f = state.parsedFields[idx];
  if (!f) return;
  // 优先使用用户手动关联的字段定义，否则自动匹配
  let matchDef = null;
  if (f._matchedDefId) {
    matchDef = state.fieldDefs.find(d => d.id === f._matchedDefId);
  }
  if (!matchDef) {
    matchDef = state.fieldDefs.find(d =>
      d.name === f.name || d.label === f.label ||
      d.name.toLowerCase() === f.name.toLowerCase()
    );
  }
  const field = {
    _tempId: Date.now() + idx,
    field_def_id: matchDef ? matchDef.id : null,
    custom_label: matchDef ? null : f.label,
    page_num: f.page_num,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    font_size: f.font_size || 12,
    sort_order: state.fields.length,
    _label: f.label,
    _type: f.field_type,
    field_label: matchDef ? matchDef.label : f.label,
    field_name: matchDef ? matchDef.name : f.name,
    field_type: f.field_type,
  };
  state.fields.push(field);
  // 从parsedFields中移除
  state.parsedFields.splice(idx, 1);
  renderOverlay();
  renderFieldsList();
  if (state.parsedFields.length > 0) {
    renderParsedFieldsPanel(state.parsedFields);
  } else {
    document.getElementById('parsed-fields-section')?.remove();
    document.getElementById('parse-status-banner')?.classList.add('hidden');
  }
  showToast(`字段「${f.label}」已导入`);
}

function importAllParsedFields() {
  const toImport = [...state.parsedFields];
  toImport.forEach((f, idx) => {
    let matchDef = null;
    if (f._matchedDefId) {
      matchDef = state.fieldDefs.find(d => d.id === f._matchedDefId);
    }
    if (!matchDef) {
      matchDef = state.fieldDefs.find(d =>
        d.name === f.name || d.label === f.label ||
        d.name.toLowerCase() === f.name.toLowerCase()
      );
    }
    state.fields.push({
      _tempId: Date.now() + idx,
      field_def_id: matchDef ? matchDef.id : null,
      custom_label: matchDef ? null : f.label,
      page_num: f.page_num,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      font_size: f.font_size || 12,
      sort_order: state.fields.length + idx,
      _label: f.label,
      _type: f.field_type,
      field_label: matchDef ? matchDef.label : f.label,
      field_name: matchDef ? matchDef.name : f.name,
      field_type: f.field_type,
    });
  });
  state.parsedFields = [];
  document.getElementById('parse-status-banner')?.classList.add('hidden');
  renderOverlay();
  renderFieldsList();
  showToast(`已导入 ${toImport.length} 个字段，请点击「保存模板」保存`);
}

// ==================== PDF Rendering ====================
async function renderPage() {
  if (!state.pdfDoc) return;
  const page = await state.pdfDoc.getPage(state.currentPage);
  const viewport = page.getViewport({ scale: 1 });

  // Auto scale to fit container
  const container = document.getElementById('canvas-container');
  const maxW = container.clientWidth - 48;
  const maxH = container.clientHeight - 48;
  const fitScaleW = maxW / viewport.width;
  const fitScaleH = maxH / viewport.height;
  state.baseScale = Math.min(fitScaleW, fitScaleH, 2.0);

  // Use manual zoom if set, otherwise auto-fit
  if (state.userZoom !== null) {
    state.scale = state.userZoom;
  } else {
    state.scale = state.baseScale;
  }
  const vp = page.getViewport({ scale: state.scale });

  dom.pdfCanvas.width = vp.width;
  dom.pdfCanvas.height = vp.height;
  dom.drawLayer.width = vp.width;
  dom.drawLayer.height = vp.height;
  dom.overlaySvg.setAttribute('width', vp.width);
  dom.overlaySvg.setAttribute('height', vp.height);
  dom.overlaySvg.style.width = vp.width + 'px';
  dom.overlaySvg.style.height = vp.height + 'px';

  const ctx = dom.pdfCanvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;

  dom.curPage.textContent = state.currentPage;
  updateAdminZoomDisplay();
  renderOverlay();
}

function updateAdminZoomDisplay() {
  const el = document.getElementById('zoom-level-admin');
  if (el) {
    const pct = Math.round(state.scale / state.baseScale * 100);
    el.textContent = pct + '%';
  }
}

function adminZoomIn() {
  const currentZoom = state.userZoom !== null ? state.userZoom : state.baseScale;
  state.userZoom = Math.min(currentZoom * 1.2, state.baseScale * 3);
  renderPage();
}

function adminZoomOut() {
  const currentZoom = state.userZoom !== null ? state.userZoom : state.baseScale;
  state.userZoom = Math.max(currentZoom / 1.2, state.baseScale * 0.3);
  renderPage();
}

function adminZoomFit() {
  state.userZoom = null;
  renderPage();
}

// ==================== Overlay (field regions) ====================
function renderOverlay() {
  dom.overlaySvg.innerHTML = '';
  // 渲染已保存/已添加字段（紫色实线 + 可拖拽/调整大小）
  const pageFields = state.fields.filter(f => f.page_num === state.currentPage);
  pageFields.forEach((f) => {
    const globalIdx = state.fields.indexOf(f);
    const displayLabel = getFieldDisplayLabel(f, globalIdx);
    const screen = pdfToScreen(f.x, f.y, f.width, f.height);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'field-region-group');
    g.dataset.fieldIdx = globalIdx;

    // Main rect (draggable)
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', screen.x);
    rect.setAttribute('y', screen.y);
    rect.setAttribute('width', screen.w);
    rect.setAttribute('height', screen.h);
    rect.setAttribute('class', 'region-rect draggable-region');
    rect.dataset.fieldIdx = globalIdx;
    // 无论框选模式还是查看模式，都允许拖拽已有区域
    rect.style.cursor = 'move';
    rect.style.pointerEvents = 'all';
    g.appendChild(rect);

    // Label
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', screen.x + 4);
    label.setAttribute('y', screen.y + 14);
    label.setAttribute('class', 'region-label');
    label.textContent = displayLabel;
    g.appendChild(label);

    // Delete button (top-right corner)
    const delG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    delG.setAttribute('class', 'region-del');
    delG.dataset.fieldIdx = globalIdx;
    const delCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    delCircle.setAttribute('cx', screen.x + screen.w - 8);
    delCircle.setAttribute('cy', screen.y + 8);
    delCircle.setAttribute('r', 8);
    delCircle.setAttribute('fill', '#ef4444');
    delG.appendChild(delCircle);
    const delText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    delText.setAttribute('x', screen.x + screen.w - 8);
    delText.setAttribute('y', screen.y + 12);
    delText.setAttribute('text-anchor', 'middle');
    delText.setAttribute('fill', 'white');
    delText.setAttribute('font-size', '10');
    delText.textContent = '×';
    delG.appendChild(delText);
    g.appendChild(delG);

    // Resize handles (small squares at corners and edges) - only in view mode or always
    const handleSize = 6;
    const handles = [
      { name: 'nw', cx: screen.x, cy: screen.y, cursor: 'nw-resize' },
      { name: 'ne', cx: screen.x + screen.w, cy: screen.y, cursor: 'ne-resize' },
      { name: 'sw', cx: screen.x, cy: screen.y + screen.h, cursor: 'sw-resize' },
      { name: 'se', cx: screen.x + screen.w, cy: screen.y + screen.h, cursor: 'se-resize' },
      { name: 'n', cx: screen.x + screen.w / 2, cy: screen.y, cursor: 'n-resize' },
      { name: 's', cx: screen.x + screen.w / 2, cy: screen.y + screen.h, cursor: 's-resize' },
      { name: 'w', cx: screen.x, cy: screen.y + screen.h / 2, cursor: 'w-resize' },
      { name: 'e', cx: screen.x + screen.w, cy: screen.y + screen.h / 2, cursor: 'e-resize' },
    ];
    handles.forEach(h => {
      const hr = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hr.setAttribute('x', h.cx - handleSize / 2);
      hr.setAttribute('y', h.cy - handleSize / 2);
      hr.setAttribute('width', handleSize);
      hr.setAttribute('height', handleSize);
      hr.setAttribute('class', 'resize-handle');
      hr.setAttribute('fill', '#7c3aed');
      hr.setAttribute('stroke', 'white');
      hr.setAttribute('stroke-width', '1');
      hr.style.cursor = h.cursor;
      hr.style.pointerEvents = 'all';
      hr.dataset.handle = h.name;
      hr.dataset.fieldIdx = globalIdx;
      g.appendChild(hr);
    });

    dom.overlaySvg.appendChild(g);
  });

  // 渲染解析预览字段（蓝色虚线，半透明）
  const parsedPageFields = state.parsedFields.filter(f => f.page_num === state.currentPage);
  parsedPageFields.forEach((f, idx) => {
    const screen = pdfToScreen(f.x, f.y, f.width, f.height);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'parsed-field-overlay');

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', screen.x);
    rect.setAttribute('y', screen.y);
    rect.setAttribute('width', screen.w);
    rect.setAttribute('height', screen.h);
    rect.setAttribute('fill', 'rgba(59,130,246,0.10)');
    rect.setAttribute('stroke', '#3b82f6');
    rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('stroke-dasharray', '5,3');
    rect.setAttribute('rx', '2');
    g.appendChild(rect);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', screen.x + 4);
    label.setAttribute('y', screen.y + 13);
    label.setAttribute('font-size', '10');
    label.setAttribute('fill', '#1d4ed8');
    label.setAttribute('font-weight', '500');
    label.textContent = f.label;
    g.appendChild(label);

    // 导入按钮（+号）
    const importG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    importG.setAttribute('style', 'cursor:pointer');
    importG.dataset.parsedIdx = idx;
    importG.setAttribute('class', 'parsed-import-btn');
    const importCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    importCircle.setAttribute('cx', screen.x + screen.w - 8);
    importCircle.setAttribute('cy', screen.y + 8);
    importCircle.setAttribute('r', 8);
    importCircle.setAttribute('fill', '#3b82f6');
    importG.appendChild(importCircle);
    const importText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    importText.setAttribute('x', screen.x + screen.w - 8);
    importText.setAttribute('y', screen.y + 12);
    importText.setAttribute('text-anchor', 'middle');
    importText.setAttribute('fill', 'white');
    importText.setAttribute('font-size', '11');
    importText.setAttribute('font-weight', 'bold');
    importText.textContent = '+';
    importG.appendChild(importText);
    g.appendChild(importG);

    dom.overlaySvg.appendChild(g);
  });
}

// ==================== Coordinate Conversion ====================
function screenToPdf(sx, sy, sw, sh) {
  const canvas = dom.pdfCanvas;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = sx * scaleX;
  const cy = sy * scaleY;
  const cw = sw * scaleX;
  const ch = sh * scaleY;
  // PDF coords: origin bottom-left, y flipped
  const pdfX = cx / state.scale;
  const pdfH = ch / state.scale;
  const pdfW = cw / state.scale;
  const pdfY = (canvas.height - cy - ch) / state.scale;
  return { x: pdfX, y: pdfY, width: pdfW, height: pdfH };
}

function pdfToScreen(px, py, pw, ph) {
  const canvas = dom.pdfCanvas;
  const sx = px * state.scale;
  const sw = pw * state.scale;
  const sh = ph * state.scale;
  const sy = canvas.height - (py * state.scale) - sh;
  return { x: sx, y: sy, w: sw, h: sh };
}

// ==================== Draw Mode + Drag/Resize ====================
function setupDrawLayer() {
  const layer = dom.drawLayer;
  let startX, startY, drawing = false;

  layer.addEventListener('mousedown', e => {
    if (!state.drawMode) return;
    // If a drag/resize is active, ignore draw
    if (state.dragTarget || state.resizeTarget) return;
    const rect = layer.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    drawing = true;
    dom.selectionBox.style.display = 'block';
    dom.selectionBox.style.left = startX + 'px';
    dom.selectionBox.style.top = startY + 'px';
    dom.selectionBox.style.width = '0px';
    dom.selectionBox.style.height = '0px';
  });

  layer.addEventListener('mousemove', e => {
    if (!drawing) return;
    const rect = layer.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    dom.selectionBox.style.left = x + 'px';
    dom.selectionBox.style.top = y + 'px';
    dom.selectionBox.style.width = w + 'px';
    dom.selectionBox.style.height = h + 'px';
  });

  layer.addEventListener('mouseup', e => {
    if (!drawing) return;
    drawing = false;
    dom.selectionBox.style.display = 'none';
    const rect = layer.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    if (w < 10 || h < 10) return;
    const pdfCoords = screenToPdf(x, y, w, h);
    state.pendingRect = { ...pdfCoords, page_num: state.currentPage };
    openFieldModal();
  });

  // ===== Drag & Resize on SVG overlay =====
  setupDragResize();
}

function setupDragResize() {
  const svg = dom.overlaySvg;
  // Make SVG receive pointer events for drag/resize
  svg.style.pointerEvents = 'none'; // default off, children opt-in

  // We use document-level mousemove/mouseup for smooth dragging
  let activeOp = null; // 'drag' | 'resize'

  svg.addEventListener('mousedown', e => {
    // Check resize handle first
    const handleEl = e.target.closest('.resize-handle');
    if (handleEl) {
      e.preventDefault();
      e.stopPropagation();
      const fieldIdx = parseInt(handleEl.dataset.fieldIdx);
      const handle = handleEl.dataset.handle;
      const field = state.fields[fieldIdx];
      if (!field) return;
      const screenCoords = pdfToScreen(field.x, field.y, field.width, field.height);
      state.resizeTarget = {
        fieldIdx,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        origScreenX: screenCoords.x,
        origScreenY: screenCoords.y,
        origScreenW: screenCoords.w,
        origScreenH: screenCoords.h,
        origX: field.x,
        origY: field.y,
        origW: field.width,
        origH: field.height,
      };
      activeOp = 'resize';
      document.body.style.cursor = handleEl.style.cursor;
      return;
    }

    // Check draggable region rect (支持在框选模式和查看模式下拖拽)
    const regionRect = e.target.closest('.draggable-region');
    if (regionRect) {
      e.preventDefault();
      e.stopPropagation();
      const fieldIdx = parseInt(regionRect.dataset.fieldIdx);
      const field = state.fields[fieldIdx];
      if (!field) return;
      state.dragTarget = {
        fieldIdx,
        startX: e.clientX,
        startY: e.clientY,
        origX: field.x,
        origY: field.y,
      };
      activeOp = 'drag';
      document.body.style.cursor = 'grabbing';
      return;
    }
  });

  document.addEventListener('mousemove', e => {
    if (activeOp === 'drag' && state.dragTarget) {
      const dx = e.clientX - state.dragTarget.startX;
      const dy = e.clientY - state.dragTarget.startY;
      // Convert screen delta to PDF delta
      const pdfDx = dx / state.scale;
      const pdfDy = -dy / state.scale; // Y is flipped in PDF coords
      const field = state.fields[state.dragTarget.fieldIdx];
      if (!field) return;
      field.x = Math.max(0, state.dragTarget.origX + pdfDx);
      field.y = state.dragTarget.origY + pdfDy;
      renderOverlay();
      updateFieldCoordInList(state.dragTarget.fieldIdx);
    }

    if (activeOp === 'resize' && state.resizeTarget) {
      const rt = state.resizeTarget;
      const dx = (e.clientX - rt.startX) / state.scale;
      const dy = -(e.clientY - rt.startY) / state.scale; // screen Y down = PDF Y down (inverted)
      const field = state.fields[rt.fieldIdx];
      if (!field) return;

      let newX = rt.origX, newY = rt.origY, newW = rt.origW, newH = rt.origH;

      switch (rt.handle) {
        case 'se':
          newW = Math.max(10 / state.scale, rt.origW + dx);
          newH = Math.max(10 / state.scale, rt.origH - dy);
          break;
        case 'sw':
          newX = rt.origX + dx;
          newW = Math.max(10 / state.scale, rt.origW - dx);
          newH = Math.max(10 / state.scale, rt.origH - dy);
          break;
        case 'ne':
          newW = Math.max(10 / state.scale, rt.origW + dx);
          newY = rt.origY + dy;
          newH = Math.max(10 / state.scale, rt.origH + dy);
          break;
        case 'nw':
          newX = rt.origX + dx;
          newW = Math.max(10 / state.scale, rt.origW - dx);
          newY = rt.origY + dy;
          newH = Math.max(10 / state.scale, rt.origH + dy);
          break;
        case 'n':
          newY = rt.origY + dy;
          newH = Math.max(10 / state.scale, rt.origH + dy);
          break;
        case 's':
          newH = Math.max(10 / state.scale, rt.origH - dy);
          break;
        case 'e':
          newW = Math.max(10 / state.scale, rt.origW + dx);
          break;
        case 'w':
          newX = rt.origX + dx;
          newW = Math.max(10 / state.scale, rt.origW - dx);
          break;
      }

      field.x = newX;
      field.y = newY;
      field.width = newW;
      field.height = newH;
      renderOverlay();
      updateFieldCoordInList(rt.fieldIdx);
    }
  });

  document.addEventListener('mouseup', e => {
    if (activeOp === 'drag' && state.dragTarget) {
      state.dragTarget = null;
      activeOp = null;
      document.body.style.cursor = '';
      renderFieldsList();
    }
    if (activeOp === 'resize' && state.resizeTarget) {
      state.resizeTarget = null;
      activeOp = null;
      document.body.style.cursor = '';
      renderFieldsList();
    }
  });
}

/** Update coordinates display in the field list for a specific field (live during drag) */
function updateFieldCoordInList(idx) {
  const card = dom.fieldsList.querySelector(`.field-card[data-idx="${idx}"]`);
  if (!card) return;
  const f = state.fields[idx];
  if (!f) return;
  const coordEl = card.querySelector('.mt-2.text-xs');
  if (coordEl) {
    coordEl.textContent = `x:${f.x.toFixed(0)} y:${f.y.toFixed(0)} ${f.width.toFixed(0)}×${f.height.toFixed(0)} · 字号${f.font_size}`;
  }
}

// ==================== Field Modal ====================
function openFieldModal() {
  const r = state.pendingRect;
  dom.fieldXDisplay.textContent = r.x.toFixed(1);
  dom.fieldYDisplay.textContent = r.y.toFixed(1);
  dom.fieldWDisplay.textContent = r.width.toFixed(1);
  dom.fieldHDisplay.textContent = r.height.toFixed(1);
  dom.fieldPageNum.value = r.page_num;
  dom.fieldCustomLabel.value = '';
  dom.fieldDefSelect.value = '';
  dom.fieldFontSize.value = 12;
  dom.fieldModal.classList.remove('hidden');
}

function confirmField() {
  const defId = dom.fieldDefSelect.value ? parseInt(dom.fieldDefSelect.value) : null;
  const customLabel = dom.fieldCustomLabel.value.trim();
  const fontSize = parseInt(dom.fieldFontSize.value) || 12;

  if (!defId && !customLabel) {
    showToast('请选择字段定义或填写自定义标签', 'error');
    return;
  }

  const def = defId ? state.fieldDefs.find(d => d.id === defId) : null;
  const label = customLabel || (def ? def.label : '未命名');
  const type = def ? def.field_type : 'text';

  const field = {
    _tempId: Date.now(),
    field_def_id: defId,
    custom_label: customLabel || null,
    page_num: state.pendingRect.page_num,
    x: state.pendingRect.x,
    y: state.pendingRect.y,
    width: state.pendingRect.width,
    height: state.pendingRect.height,
    font_size: fontSize,
    sort_order: state.fields.length,
    _label: label,
    _type: type,
    field_label: def ? def.label : null,
    field_name: def ? def.name : null,
    field_type: type,
  };

  state.fields.push(field);
  dom.fieldModal.classList.add('hidden');
  renderOverlay();
  renderFieldsList();
  showToast(`字段「${label}」已添加`);
}

// ==================== Fields List (right panel) ====================

/** 检测重复字段并返回 { label: count } 映射 */
function detectDuplicateFields() {
  const labelCounts = {};
  state.fields.forEach(f => {
    const label = f._label || f.custom_label || f.field_label || '未命名';
    labelCounts[label] = (labelCounts[label] || 0) + 1;
  });
  return labelCounts;
}

/** 获取字段的显示标签（含编号） */
function getFieldDisplayLabel(field, idx) {
  const label = field._label || field.custom_label || field.field_label || '未命名';
  const labelCounts = detectDuplicateFields();
  if (labelCounts[label] > 1) {
    // 计算该字段在同名字段中的序号
    let order = 0;
    for (let i = 0; i <= idx; i++) {
      const fLabel = state.fields[i]._label || state.fields[i].custom_label || state.fields[i].field_label || '未命名';
      if (fLabel === label) order++;
    }
    return `${label} #${order}`;
  }
  return label;
}

/** 检查并提示重复字段 */
function checkDuplicateFieldsAndWarn() {
  const labelCounts = detectDuplicateFields();
  const duplicates = Object.entries(labelCounts).filter(([_, count]) => count > 1);
  const banner = document.getElementById('duplicate-fields-banner');
  
  if (duplicates.length > 0) {
    const dupInfo = duplicates.map(([label, count]) => `「${label}」×${count}`).join('、');
    if (!banner) {
      const bannerHtml = `
        <div id="duplicate-fields-banner" class="border border-amber-200 bg-amber-50 rounded-xl px-3 py-2.5 flex items-start gap-2 text-xs mb-2">
          <i class="fa-solid fa-triangle-exclamation text-amber-500 mt-0.5 flex-shrink-0"></i>
          <div class="flex-1">
            <span class="text-amber-700 font-medium">检测到重复字段：</span>
            <span class="text-amber-600 duplicate-info">${dupInfo}</span>
            <div class="text-amber-500 mt-0.5">已自动添加编号（如 #1、#2），拖拽可调整顺序，编号将按顺序显示在Excel模板中</div>
          </div>
        </div>
      `;
      dom.fieldsList.insertAdjacentHTML('afterbegin', bannerHtml);
    } else {
      banner.querySelector('.duplicate-info').textContent = dupInfo;
    }
  } else {
    if (banner) banner.remove();
  }
}

// 拖拽排序相关状态
let dragState = {
  dragging: false,
  dragIdx: -1,
  overIdx: -1,
  placeholder: null,
};

function renderFieldsList() {
  // 先移除旧的解析字段区域（如果需要保留则跳过）
  const parsedSection = document.getElementById('parsed-fields-section');
  const parsedHtml = parsedSection ? parsedSection.outerHTML : '';

  if (!state.fields.length) {
    dom.fieldsList.innerHTML = (parsedHtml || '') + `<div id="fields-empty" class="text-center text-gray-400 text-sm py-8"><i class="fa-solid fa-draw-polygon text-3xl mb-2 block text-gray-300"></i>在PDF上框选区域<br/>添加填写字段</div>`;
    return;
  }
  const typeIcons = { text: 'fa-font', textarea: 'fa-align-left', date: 'fa-calendar', number: 'fa-hashtag', checkbox: 'fa-square-check' };
  const typeColors = { text: 'text-blue-500', textarea: 'text-green-500', date: 'text-yellow-500', number: 'text-orange-500', checkbox: 'text-purple-500' };

  const fieldsHtml = state.fields.map((f, idx) => {
    const displayLabel = getFieldDisplayLabel(f, idx);
    const baseLabel = f._label || f.custom_label || f.field_label || '未命名';
    const labelCounts = detectDuplicateFields();
    const isDuplicate = labelCounts[baseLabel] > 1;
    const isEditing = state.editingFieldIdx === idx;

    if (isEditing) {
      // 编辑模式：内联编辑表单
      const fieldDefOptions = state.fieldDefs.map(fd =>
        `<option value="${fd.id}" ${f.field_def_id === fd.id ? 'selected' : ''}>${fd.label}（${fd.name}）</option>`
      ).join('');
      return `
      <div class="field-card border-2 border-purple-400 rounded-xl p-3 bg-purple-50 shadow-sm" data-idx="${idx}">
        <div class="flex items-center gap-1 mb-2">
          <i class="fa-solid fa-pen text-purple-500 text-xs"></i>
          <span class="text-xs font-semibold text-purple-600">编辑字段</span>
        </div>
        <div class="space-y-2">
          <div>
            <label class="block text-xs text-gray-500 mb-0.5">关联字段定义</label>
            <select id="edit-field-def-${idx}" class="w-full border border-purple-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white">
              <option value="">-- 不关联 / 自定义 --</option>
              ${fieldDefOptions}
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-0.5">自定义标签</label>
            <input id="edit-field-label-${idx}" type="text" value="${_escapeAttr(f.custom_label || '')}" placeholder="留空则使用字段定义的标签" class="w-full border border-purple-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs text-gray-500 mb-0.5">字号</label>
              <input id="edit-field-fontsize-${idx}" type="number" value="${f.font_size || 12}" min="6" max="48" class="w-full border border-purple-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-0.5">页码</label>
              <input id="edit-field-page-${idx}" type="number" value="${f.page_num || 1}" min="1" max="${state.totalPages}" class="w-full border border-purple-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
            </div>
          </div>
          <div class="bg-white rounded-lg px-2 py-1.5 text-xs text-gray-400 border border-gray-200">
            x:${f.x.toFixed(0)} y:${f.y.toFixed(0)} ${f.width.toFixed(0)}×${f.height.toFixed(0)}
          </div>
        </div>
        <div class="flex gap-2 mt-3">
          <button class="btn-save-edit-field flex-1 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors flex items-center justify-center gap-1" data-idx="${idx}">
            <i class="fa-solid fa-check text-xs"></i> 保存
          </button>
          <button class="btn-cancel-edit-field flex-1 px-3 py-1.5 bg-white border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-1" data-idx="${idx}">
            <i class="fa-solid fa-xmark text-xs"></i> 取消
          </button>
        </div>
      </div>`;
    }

    // 查看模式
    return `
    <div class="field-card border border-gray-200 rounded-xl p-3 bg-white cursor-grab hover:border-purple-300 transition-all ${isDuplicate ? 'ring-1 ring-amber-200' : ''}" 
         data-idx="${idx}" draggable="true">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <div class="drag-handle flex flex-col gap-0.5 cursor-grab mr-0.5 flex-shrink-0 text-gray-300 hover:text-purple-400" title="拖拽排序">
            <i class="fa-solid fa-grip-vertical text-xs"></i>
          </div>
          <i class="fa-solid ${typeIcons[f._type] || 'fa-font'} ${typeColors[f._type] || 'text-gray-400'} text-sm flex-shrink-0"></i>
          <div class="min-w-0 flex-1">
            <div class="font-medium text-gray-800 text-sm truncate flex items-center gap-1.5">
              ${displayLabel}
              ${isDuplicate ? '<span class="inline-flex items-center px-1.5 py-0 bg-amber-100 text-amber-600 rounded text-xs font-normal">重复</span>' : ''}
            </div>
            <div class="text-xs text-gray-400">第${f.page_num}页 · ${f._type} · 排序 #${idx + 1}</div>
          </div>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
          <button class="btn-edit-field w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-purple-500 hover:bg-purple-50 transition-all" data-idx="${idx}" title="编辑">
            <i class="fa-solid fa-pen text-xs"></i>
          </button>
          <button class="btn-copy-field w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition-all" data-idx="${idx}" title="复制区域">
            <i class="fa-solid fa-copy text-xs"></i>
          </button>
          <button class="btn-move-up w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-purple-500 hover:bg-purple-50 transition-all ${idx === 0 ? 'invisible' : ''}" data-idx="${idx}" title="上移">
            <i class="fa-solid fa-chevron-up text-xs"></i>
          </button>
          <button class="btn-move-down w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-purple-500 hover:bg-purple-50 transition-all ${idx === state.fields.length - 1 ? 'invisible' : ''}" data-idx="${idx}" title="下移">
            <i class="fa-solid fa-chevron-down text-xs"></i>
          </button>
          <button class="btn-del-field w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all" data-idx="${idx}" title="删除">
            <i class="fa-solid fa-trash text-xs"></i>
          </button>
        </div>
      </div>
      <div class="mt-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-2 py-1">
        x:${f.x.toFixed(0)} y:${f.y.toFixed(0)} ${f.width.toFixed(0)}×${f.height.toFixed(0)} · 字号${f.font_size}
      </div>
    </div>
  `;
  }).join('');

  dom.fieldsList.innerHTML = (parsedHtml || '') + fieldsHtml;
  
  // 检测重复字段并显示提示
  checkDuplicateFieldsAndWarn();
  
  // 绑定拖拽排序事件
  bindDragSortEvents();

  // 重新绑定解析面板按钮事件
  if (parsedHtml) {
    document.getElementById('btn-import-all-parsed-panel')?.addEventListener('click', importAllParsedFields);
    dom.fieldsList.querySelectorAll('.btn-import-single-parsed').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.currentTarget.dataset.idx);
        importSingleParsedField(idx);
      });
    });
  }
}

/** 绑定拖拽排序事件 */
function bindDragSortEvents() {
  const cards = dom.fieldsList.querySelectorAll('.field-card[draggable="true"]');
  
  cards.forEach(card => {
    card.addEventListener('dragstart', e => {
      dragState.dragging = true;
      dragState.dragIdx = parseInt(card.dataset.idx);
      card.classList.add('opacity-40', 'scale-95');
      card.style.transition = 'none';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.idx);
    });

    card.addEventListener('dragend', e => {
      dragState.dragging = false;
      card.classList.remove('opacity-40', 'scale-95');
      card.style.transition = '';
      // 移除所有拖拽视觉效果
      dom.fieldsList.querySelectorAll('.field-card').forEach(c => {
        c.classList.remove('border-t-2', 'border-b-2', 'border-purple-500', 'mt-1', 'mb-1');
        c.style.transform = '';
      });
      const placeholder = dom.fieldsList.querySelector('.drag-placeholder');
      if (placeholder) placeholder.remove();
      dragState.dragIdx = -1;
      dragState.overIdx = -1;
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!dragState.dragging) return;
      
      const overIdx = parseInt(card.dataset.idx);
      if (overIdx === dragState.dragIdx) return;
      
      // 清除之前的指示器
      dom.fieldsList.querySelectorAll('.field-card').forEach(c => {
        c.classList.remove('border-t-2', 'border-b-2', 'border-purple-500');
      });

      // 显示放置位置指示器
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        card.classList.add('border-t-2', 'border-purple-500');
        dragState.overIdx = overIdx;
      } else {
        card.classList.add('border-b-2', 'border-purple-500');
        dragState.overIdx = overIdx + 1;
      }
    });

    card.addEventListener('dragleave', e => {
      card.classList.remove('border-t-2', 'border-b-2', 'border-purple-500');
    });

    card.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragState.dragging) return;
      
      const fromIdx = dragState.dragIdx;
      let toIdx = dragState.overIdx;
      
      if (fromIdx === toIdx || toIdx === -1) return;
      
      // 执行数组重排
      const [moved] = state.fields.splice(fromIdx, 1);
      if (toIdx > fromIdx) toIdx--;
      state.fields.splice(toIdx, 0, moved);

      // 更新sort_order
      state.fields.forEach((f, i) => f.sort_order = i);
      
      renderOverlay();
      renderFieldsList();
      showToast(`字段已移动到第 ${toIdx + 1} 位`);
    });
  });
}

/** 移动字段位置（上移/下移按钮） */
function moveField(fromIdx, direction) {
  const toIdx = direction === 'up' ? fromIdx - 1 : fromIdx + 1;
  if (toIdx < 0 || toIdx >= state.fields.length) return;
  
  // 交换位置
  const temp = state.fields[fromIdx];
  state.fields[fromIdx] = state.fields[toIdx];
  state.fields[toIdx] = temp;
  
  // 更新sort_order
  state.fields.forEach((f, i) => f.sort_order = i);
  
  renderOverlay();
  renderFieldsList();
}

/** 开始编辑已有字段 */
function startEditField(idx) {
  state.editingFieldIdx = idx;
  renderFieldsList();
  // 聚焦到编辑表单
  setTimeout(() => {
    const select = document.getElementById(`edit-field-def-${idx}`);
    if (select) select.focus();
  }, 50);
}

/** 取消编辑字段 */
function cancelEditField() {
  state.editingFieldIdx = null;
  renderFieldsList();
}

/** 保存编辑字段 */
function saveEditField(idx) {
  const field = state.fields[idx];
  if (!field) return;

  const defSelect = document.getElementById(`edit-field-def-${idx}`);
  const labelInput = document.getElementById(`edit-field-label-${idx}`);
  const fontSizeInput = document.getElementById(`edit-field-fontsize-${idx}`);
  const pageInput = document.getElementById(`edit-field-page-${idx}`);
  if (!defSelect || !labelInput || !fontSizeInput || !pageInput) return;

  const defId = defSelect.value ? parseInt(defSelect.value) : null;
  const customLabel = labelInput.value.trim();
  const fontSize = parseInt(fontSizeInput.value) || 12;
  const pageNum = parseInt(pageInput.value) || field.page_num;

  if (!defId && !customLabel) {
    showToast('请选择字段定义或填写自定义标签', 'error');
    return;
  }

  const def = defId ? state.fieldDefs.find(d => d.id === defId) : null;
  const label = customLabel || (def ? def.label : (field._label || '未命名'));
  const type = def ? def.field_type : (field._type || 'text');

  // 更新字段属性
  field.field_def_id = defId;
  field.custom_label = customLabel || null;
  field.font_size = fontSize;
  field.page_num = pageNum;
  field._label = label;
  field._type = type;
  field.field_label = def ? def.label : field.field_label;
  field.field_name = def ? def.name : field.field_name;
  field.field_type = type;

  state.editingFieldIdx = null;
  renderOverlay();
  renderFieldsList();
  showToast(`字段「${label}」已更新`);
}

/** 复制字段（保持相同的位置参数，偏移一点便于区分） */
function copyField(idx) {
  const src = state.fields[idx];
  if (!src) return;

  const offset = 10; // PDF坐标偏移量
  const copy = {
    _tempId: Date.now(),
    field_def_id: src.field_def_id,
    custom_label: src.custom_label,
    page_num: src.page_num,
    x: src.x + offset,
    y: src.y - offset,
    width: src.width,
    height: src.height,
    font_size: src.font_size,
    sort_order: state.fields.length,
    _label: src._label,
    _type: src._type,
    field_label: src.field_label,
    field_name: src.field_name,
    field_type: src.field_type || src._type,
  };

  // 插入到源字段后面
  state.fields.splice(idx + 1, 0, copy);
  // 更新sort_order
  state.fields.forEach((f, i) => f.sort_order = i);

  renderOverlay();
  renderFieldsList();
  showToast(`已复制字段「${src._label}」`);
}

// ==================== Save Fields ====================
async function saveFields() {
  if (!state.currentTemplate) return;
  const payload = {
    fields: state.fields.map((f, i) => ({
      field_def_id: f.field_def_id || null,
      custom_label: f.custom_label || null,
      page_num: f.page_num,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      font_size: f.font_size || 12,
      sort_order: i,
    }))
  };
  try {
    const res = await api('POST', `/api/templates/${state.currentTemplate.id}/fields`, payload);
    state.fields = (res.data || []).map(f => ({
      ...f,
      _label: f.custom_label || f.field_label || f.field_name || '未命名',
      _type: f.field_type || 'text',
    }));
    renderOverlay();
    renderFieldsList();
    showToast('模板字段已保存！');
  } catch (e) {
    showToast('保存失败：' + e.message, 'error');
  }
}

// ==================== Upload Template ====================
async function uploadTemplate() {
  const name = dom.newTemplateName.value.trim();
  const desc = dom.newTemplateDesc.value.trim();
  if (!name) { showToast('请填写模板名称', 'error'); return; }
  if (!modalPdfFile) { showToast('请选择PDF文件', 'error'); return; }

  const formData = new FormData();
  formData.append('name', name);
  formData.append('description', desc);
  formData.append('pdf_file', modalPdfFile);

  try {
    dom.btnConfirmUpload.disabled = true;
    dom.btnConfirmUpload.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>上传中...';
    const res = await api('POST', '/api/templates', formData, true);
    state.templates.unshift(res.data);
    renderTemplateList();
    dom.uploadModal.classList.add('hidden');
    dom.newTemplateName.value = '';
    dom.newTemplateDesc.value = '';
    modalPdfFile = null;
    resetModalUploadZone();
    showToast('模板上传成功！');
    selectTemplate(res.data.id);
  } catch (e) {
    showToast('上传失败：' + e.message, 'error');
  } finally {
    dom.btnConfirmUpload.disabled = false;
    dom.btnConfirmUpload.innerHTML = '<i class="fa-solid fa-upload mr-1"></i>上传模板';
  }
}

// ==================== Events ====================
function bindEvents() {
  // Upload zone
  dom.uploadZone.addEventListener('click', () => dom.pdfUploadInput.click());
  dom.pdfUploadInput.addEventListener('change', e => {
    if (e.target.files[0]) {
      modalPdfFile = e.target.files[0];
      dom.newTemplateName.value = dom.newTemplateName.value || modalPdfFile.name.replace('.pdf', '');
      dom.modalFileName.textContent = modalPdfFile.name;
      dom.modalFileName.classList.add('text-purple-700', 'font-medium');
      dom.modalFileName.classList.remove('text-gray-500');
      // 同步设置弹窗内 input 的 file
      syncModalFileInput(modalPdfFile);
      dom.uploadModal.classList.remove('hidden');
    }
  });
  dom.uploadZone.addEventListener('dragover', e => { e.preventDefault(); dom.uploadZone.classList.add('drag-over'); });
  dom.uploadZone.addEventListener('dragleave', () => dom.uploadZone.classList.remove('drag-over'));
  dom.uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    dom.uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      modalPdfFile = file;
      dom.newTemplateName.value = file.name.replace('.pdf', '');
      dom.modalFileName.textContent = modalPdfFile.name;
      dom.modalFileName.classList.add('text-purple-700', 'font-medium');
      dom.modalFileName.classList.remove('text-gray-500');
      syncModalFileInput(modalPdfFile);
      dom.uploadModal.classList.remove('hidden');
    }
  });

  // New template button
  dom.btnNewTemplate.addEventListener('click', () => {
    // 如果没有预选文件，重置上传区域
    if (!modalPdfFile) {
      resetModalUploadZone();
    }
    dom.uploadModal.classList.remove('hidden');
  });

  // Modal upload zone
  dom.modalUploadZone.addEventListener('click', () => dom.modalPdfInput.click());
  dom.modalPdfInput.addEventListener('change', e => {
    if (e.target.files[0]) {
      modalPdfFile = e.target.files[0];
      if (!dom.newTemplateName.value) dom.newTemplateName.value = modalPdfFile.name.replace('.pdf', '');
      syncModalFileInput(modalPdfFile);
    }
  });

  // Upload modal buttons
  dom.btnCancelUpload.addEventListener('click', () => { dom.uploadModal.classList.add('hidden'); modalPdfFile = null; resetModalUploadZone(); });
  dom.btnConfirmUpload.addEventListener('click', uploadTemplate);

  // Template list click
  dom.templateList.addEventListener('click', e => {
    const item = e.target.closest('.template-item');
    const delBtn = e.target.closest('.btn-del-template');
    const downloadExcelBtn = e.target.closest('.btn-download-excel');
    if (delBtn) {
      e.stopPropagation();
      deleteTemplate(parseInt(delBtn.dataset.id));
      return;
    }
    if (downloadExcelBtn) {
      e.stopPropagation();
      const tid = downloadExcelBtn.dataset.id;
      const tmpl = state.templates.find(x => x.id === parseInt(tid));
      downloadExcelBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i> 下载中...';
      downloadExcelBtn.disabled = true;
      fetch(`/api/templates/${tid}/excel-template`)
        .then(resp => {
          if (!resp.ok) return resp.json().then(d => { throw new Error(d.detail || '下载失败'); });
          return resp.blob();
        })
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${tmpl ? tmpl.name : 'template'}_批量填写模板.xlsx`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          showToast('Excel模板下载成功');
        })
        .catch(err => showToast('下载失败：' + err.message, 'error'))
        .finally(() => {
          downloadExcelBtn.innerHTML = '<i class="fa-solid fa-file-excel text-xs"></i> 下载Excel模板';
          downloadExcelBtn.disabled = false;
        });
      return;
    }
    if (item) selectTemplate(parseInt(item.dataset.id));
  });

  // Page navigation
  dom.btnPrevPage.addEventListener('click', () => {
    if (state.currentPage > 1) { state.currentPage--; renderPage(); }
  });
  dom.btnNextPage.addEventListener('click', () => {
    if (state.currentPage < state.totalPages) { state.currentPage++; renderPage(); }
  });

  // Zoom controls
  const btnZoomIn = document.getElementById('btn-zoom-in-admin');
  const btnZoomOut = document.getElementById('btn-zoom-out-admin');
  const btnZoomFit = document.getElementById('btn-zoom-fit-admin');
  if (btnZoomIn) btnZoomIn.addEventListener('click', adminZoomIn);
  if (btnZoomOut) btnZoomOut.addEventListener('click', adminZoomOut);
  if (btnZoomFit) btnZoomFit.addEventListener('click', adminZoomFit);

  // Mouse wheel zoom on canvas container
  const canvasContainer = document.getElementById('canvas-container');
  canvasContainer.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) adminZoomIn();
      else adminZoomOut();
    }
  }, { passive: false });

  // Draw/View mode
  dom.btnDrawMode.addEventListener('click', () => {
    state.drawMode = true;
    dom.btnDrawMode.classList.add('active');
    dom.btnViewMode.classList.remove('active');
    dom.btnViewMode.classList.add('text-gray-600');
    dom.drawLayer.style.cursor = 'crosshair';
    dom.drawLayer.style.pointerEvents = 'all';
    renderOverlay(); // Update pointer-events on region rects
  });
  dom.btnViewMode.addEventListener('click', () => {
    state.drawMode = false;
    dom.btnViewMode.classList.add('active');
    dom.btnDrawMode.classList.remove('active');
    dom.btnDrawMode.classList.add('text-gray-600');
    dom.drawLayer.style.cursor = 'default';
    dom.drawLayer.style.pointerEvents = 'none';
    renderOverlay(); // Update pointer-events on region rects
  });

  // Save fields
  dom.btnSaveFields.addEventListener('click', saveFields);

  // Field modal
  dom.btnCancelField.addEventListener('click', () => dom.fieldModal.classList.add('hidden'));
  dom.btnConfirmField.addEventListener('click', confirmField);

  // Overlay delete
  dom.overlaySvg.addEventListener('click', e => {
    const delG = e.target.closest('.region-del');
    if (delG) {
      const idx = parseInt(delG.dataset.fieldIdx);
      state.fields.splice(idx, 1);
      renderOverlay();
      renderFieldsList();
    }
    // 解析字段导入按钮
    const importBtn = e.target.closest('.parsed-import-btn');
    if (importBtn) {
      const idx = parseInt(importBtn.dataset.parsedIdx);
      importSingleParsedField(idx);
    }
  });

  // Fields list: delete, move up, move down, edit, copy
  dom.fieldsList.addEventListener('click', e => {
    const delBtn = e.target.closest('.btn-del-field');
    if (delBtn) {
      const idx = parseInt(delBtn.dataset.idx);
      if (state.editingFieldIdx === idx) state.editingFieldIdx = null;
      state.fields.splice(idx, 1);
      state.fields.forEach((f, i) => f.sort_order = i);
      renderOverlay();
      renderFieldsList();
      return;
    }
    const moveUpBtn = e.target.closest('.btn-move-up');
    if (moveUpBtn) {
      const idx = parseInt(moveUpBtn.dataset.idx);
      moveField(idx, 'up');
      return;
    }
    const moveDownBtn = e.target.closest('.btn-move-down');
    if (moveDownBtn) {
      const idx = parseInt(moveDownBtn.dataset.idx);
      moveField(idx, 'down');
      return;
    }
    // 编辑字段
    const editBtn = e.target.closest('.btn-edit-field');
    if (editBtn) {
      const idx = parseInt(editBtn.dataset.idx);
      startEditField(idx);
      return;
    }
    // 保存编辑字段
    const saveEditBtn = e.target.closest('.btn-save-edit-field');
    if (saveEditBtn) {
      const idx = parseInt(saveEditBtn.dataset.idx);
      saveEditField(idx);
      return;
    }
    // 取消编辑字段
    const cancelEditBtn = e.target.closest('.btn-cancel-edit-field');
    if (cancelEditBtn) {
      cancelEditField();
      return;
    }
    // 复制字段
    const copyBtn = e.target.closest('.btn-copy-field');
    if (copyBtn) {
      const idx = parseInt(copyBtn.dataset.idx);
      copyField(idx);
      return;
    }
  });

  // Field manager
  dom.btnFieldMgr.addEventListener('click', () => {
    dom.fieldMgrModal.classList.remove('hidden');
    renderFieldDefList();
  });
  dom.btnCloseFieldMgr.addEventListener('click', () => dom.fieldMgrModal.classList.add('hidden'));

  // Storage status
  if (dom.btnStorageStatus) {
    dom.btnStorageStatus.addEventListener('click', () => {
      dom.storageModal.classList.remove('hidden');
      loadStorageStatus();
    });
  }
  if (dom.btnCloseStorage) {
    dom.btnCloseStorage.addEventListener('click', () => dom.storageModal.classList.add('hidden'));
  }
  if (dom.btnRefreshStorage) {
    dom.btnRefreshStorage.addEventListener('click', loadStorageStatus);
  }
  if (dom.btnTriggerMigrate) {
    dom.btnTriggerMigrate.addEventListener('click', async () => {
      dom.btnTriggerMigrate.disabled = true;
      dom.btnTriggerMigrate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 迁移中...';
      try {
        const resp = await fetch('/api/storage/migrate', { method: 'POST' });
        const data = await resp.json();
        showToast(data.message || '迁移完成', 'success');
        await loadStorageStatus();
      } catch (e) {
        showToast('迁移失败: ' + e.message, 'error');
      } finally {
        dom.btnTriggerMigrate.disabled = false;
        dom.btnTriggerMigrate.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> 迁移数据库中的PDF到COS';
      }
    });
  }

  // Reparse button
  const btnReparse = document.getElementById('btn-reparse');
  if (btnReparse) {
    btnReparse.addEventListener('click', async () => {
      if (!state.currentTemplate) return;
      state.parsedFields = [];
      state.fields = [];
      renderFieldsList();
      renderOverlay();
      await autoParseFields(state.currentTemplate.id);
    });
  }

  // 从COS导入已有模板
  const btnImportFromCos = document.getElementById('btn-import-from-cos');
  if (btnImportFromCos) {
    btnImportFromCos.addEventListener('click', () => openCosImportModal());
  }

  dom.btnAddFieldDef.addEventListener('click', async () => {
    const name = dom.newFieldName.value.trim();
    const label = dom.newFieldLabel.value.trim();
    const type = dom.newFieldType.value;
    if (!name || !label) { showToast('请填写字段标识和显示名称', 'error'); return; }
    try {
      await api('POST', '/api/field-definitions', { name, label, field_type: type, description: '' });
      dom.newFieldName.value = '';
      dom.newFieldLabel.value = '';
      await loadFieldDefs();
      showToast('字段定义已添加');
    } catch (e) {
      showToast('添加失败：' + e.message, 'error');
    }
  });

  dom.fieldDefList.addEventListener('click', async e => {
    // 编辑按钮
    const editBtn = e.target.closest('.btn-edit-field-def');
    if (editBtn) {
      const id = parseInt(editBtn.dataset.id);
      startEditFieldDef(id);
      return;
    }
    // 保存编辑按钮
    const saveBtn = e.target.closest('.btn-save-field-def');
    if (saveBtn) {
      const id = parseInt(saveBtn.dataset.id);
      await saveEditFieldDef(id);
      return;
    }
    // 取消编辑按钮
    const cancelBtn = e.target.closest('.btn-cancel-edit-field-def');
    if (cancelBtn) {
      cancelEditFieldDef();
      return;
    }
    // 删除按钮
    const delBtn = e.target.closest('.btn-del-field-def');
    if (delBtn) {
      const id = parseInt(delBtn.dataset.id);
      if (!confirm('确定删除此字段定义？已关联此字段的模板将不受影响。')) return;
      try {
        await api('DELETE', `/api/field-definitions/${id}`);
        if (editingFieldDefId === id) editingFieldDefId = null;
        await loadFieldDefs();
        showToast('字段定义已删除');
      } catch (e) {
        showToast('删除失败：' + e.message, 'error');
      }
    }
  });
}

async function deleteTemplate(id) {
  if (!confirm('确定删除此模板？')) return;
  try {
    await api('DELETE', `/api/templates/${id}`);
    state.templates = state.templates.filter(t => t.id !== id);
    if (state.currentTemplate?.id === id) {
      state.currentTemplate = null;
      state.fields = [];
      dom.editorToolbar.classList.add('hidden');
      dom.pdfCanvasWrap.classList.add('hidden');
      dom.emptyState.classList.remove('hidden');
    }
    renderTemplateList();
    showToast('模板已删除');
  } catch (e) {
    showToast('删除失败：' + e.message, 'error');
  }
}

// ==================== Admin Login ====================
const ADMIN_PASSWORD = 'rich';
const SESSION_KEY = 'pdf_admin_authenticated';

function checkAdminAuth() {
  return sessionStorage.getItem(SESSION_KEY) === 'true';
}

function setupLoginGate() {
  const gate = document.getElementById('admin-login-gate');
  const passwordInput = document.getElementById('admin-password-input');
  const btnLogin = document.getElementById('btn-admin-login');
  const toggleBtn = document.getElementById('toggle-password-visibility');
  const errorMsg = document.getElementById('login-error-msg');

  if (!gate || !passwordInput || !btnLogin) return;

  // 如果已经登录过（同一会话内），直接跳过
  if (checkAdminAuth()) {
    gate.style.display = 'none';
    initAdmin();
    return;
  }

  // 密码可见性切换
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      toggleBtn.innerHTML = `<i class="fa-solid fa-eye${isPassword ? '-slash' : ''} text-sm"></i>`;
    });
  }

  // 登录验证
  function attemptLogin() {
    const pwd = passwordInput.value.trim();
    if (pwd === ADMIN_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, 'true');
      errorMsg.classList.add('hidden');
      // 添加淡出动画
      gate.style.transition = 'opacity 0.3s ease';
      gate.style.opacity = '0';
      setTimeout(() => {
        gate.style.display = 'none';
        initAdmin();
      }, 300);
    } else {
      errorMsg.classList.remove('hidden');
      passwordInput.classList.add('border-red-400', 'ring-2', 'ring-red-100');
      passwordInput.value = '';
      passwordInput.focus();
      // 抖动效果
      passwordInput.style.animation = 'shake 0.4s ease';
      setTimeout(() => {
        passwordInput.style.animation = '';
        passwordInput.classList.remove('border-red-400', 'ring-2', 'ring-red-100');
      }, 1500);
    }
  }

  btnLogin.addEventListener('click', attemptLogin);
  passwordInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptLogin();
    // 输入时隐藏错误提示
    errorMsg.classList.add('hidden');
  });

  // 自动聚焦
  passwordInput.focus();
}

// ==================== Init ====================
async function initAdmin() {
  await Promise.all([loadTemplates(), loadFieldDefs()]);
  setupDrawLayer();
  bindEvents();
}

// 启动：先检查登录
setupLoginGate();

// ==================== COS导入功能 ====================

/**
 * 打开从COS导入模板的弹窗
 */
async function openCosImportModal() {
  // 创建弹窗
  const overlay = document.createElement('div');
  overlay.id = 'cos-import-modal';
  overlay.className = 'modal-bg';
  overlay.innerHTML = `
    <div class="modal-box" style="width:600px;max-width:95vw;">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2">
          <i class="fa-solid fa-cloud-arrow-down text-orange-500"></i>
          从腾讯云COS导入模板
        </h3>
        <button id="cos-import-close" class="text-gray-400 hover:text-gray-600 text-xl">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <p class="text-sm text-gray-500 mb-4">
        以下是COS存储桶中的PDF文件，选择文件后可直接导入为模板，无需重新上传。
      </p>
      <!-- 搜索框 -->
      <div class="flex gap-2 mb-3">
        <input id="cos-search-input" type="text" placeholder="搜索文件名（可选）..." 
          class="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300">
        <button id="cos-search-btn" class="px-4 py-2 bg-orange-50 text-orange-600 rounded-lg text-sm hover:bg-orange-100 transition-colors border border-orange-200">
          <i class="fa-solid fa-search mr-1"></i>搜索
        </button>
      </div>
      <!-- 文件列表 -->
      <div id="cos-file-list" class="border border-gray-200 rounded-xl overflow-auto" style="max-height:300px;">
        <div class="text-center py-8 text-gray-400">
          <i class="fa-solid fa-spinner fa-spin text-2xl mb-2 block text-orange-400"></i>
          正在加载COS文件列表...
        </div>
      </div>
      <!-- 导入配置 -->
      <div id="cos-import-form" class="hidden mt-4 p-4 bg-orange-50 rounded-xl border border-orange-200">
        <p class="text-xs text-orange-600 font-semibold mb-3">
          <i class="fa-solid fa-file-pdf mr-1"></i>
          已选择：<span id="cos-selected-key" class="font-mono text-orange-700"></span>
        </p>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">模板名称 <span class="text-red-400">*</span></label>
            <input id="cos-template-name" type="text" placeholder="输入模板名称..."
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300">
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">模板描述</label>
            <input id="cos-template-desc" type="text" placeholder="可选..."
              class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300">
          </div>
        </div>
        <button id="cos-import-confirm" class="mt-3 w-full py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 transition-colors flex items-center justify-center gap-2">
          <i class="fa-solid fa-cloud-arrow-down"></i> 导入此模板
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let selectedKey = '';

  // 关闭弹窗
  overlay.querySelector('#cos-import-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // 加载文件列表
  async function loadCosList(prefix = '') {
    const listEl = overlay.querySelector('#cos-file-list');
    listEl.innerHTML = '<div class="text-center py-8 text-gray-400"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2 block text-orange-400"></i>正在加载...</div>';
    try {
      const resp = await fetch(`/api/cos/list?prefix=${encodeURIComponent(prefix)}`);
      const data = await resp.json();
      const files = data.data || [];
      if (files.length === 0) {
        listEl.innerHTML = '<div class="text-center py-8 text-gray-400"><i class="fa-solid fa-folder-open text-2xl mb-2 block"></i>未找到PDF文件</div>';
        return;
      }
      listEl.innerHTML = files.map(f => `
        <div class="cos-file-item flex items-center justify-between px-4 py-3 hover:bg-orange-50 cursor-pointer transition-colors border-b border-gray-100 last:border-b-0"
          data-key="${f.key}" data-name="${f.name}">
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <i class="fa-solid fa-file-pdf text-red-400 flex-shrink-0"></i>
            <div class="min-w-0">
              <p class="text-sm font-medium text-gray-800 truncate" title="${f.key}">${f.name}</p>
              <p class="text-xs text-gray-400 truncate">${f.key}</p>
            </div>
          </div>
          <span class="text-xs text-gray-400 flex-shrink-0 ml-2">${(f.size / 1024).toFixed(1)} KB</span>
        </div>
      `).join('');

      // 点击文件
      listEl.querySelectorAll('.cos-file-item').forEach(item => {
        item.addEventListener('click', () => {
          listEl.querySelectorAll('.cos-file-item').forEach(i => i.classList.remove('bg-orange-100'));
          item.classList.add('bg-orange-100');
          selectedKey = item.dataset.key;
          const form = overlay.querySelector('#cos-import-form');
          form.classList.remove('hidden');
          overlay.querySelector('#cos-selected-key').textContent = selectedKey;
          // 自动填充模板名
          const nameInput = overlay.querySelector('#cos-template-name');
          if (!nameInput.value) {
            nameInput.value = item.dataset.name.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ');
          }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div class="text-center py-8 text-red-400"><i class="fa-solid fa-triangle-exclamation text-2xl mb-2 block"></i>加载失败：${e.message}</div>`;
    }
  }

  // 搜索
  overlay.querySelector('#cos-search-btn').addEventListener('click', () => {
    const keyword = overlay.querySelector('#cos-search-input').value.trim();
    loadCosList(keyword);
  });
  overlay.querySelector('#cos-search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') overlay.querySelector('#cos-search-btn').click();
  });

  // 确认导入
  overlay.querySelector('#cos-import-confirm').addEventListener('click', async () => {
    const name = overlay.querySelector('#cos-template-name').value.trim();
    const desc = overlay.querySelector('#cos-template-desc').value.trim();
    if (!name) { showToast('请输入模板名称', 'error'); return; }
    if (!selectedKey) { showToast('请先选择文件', 'error'); return; }

    const btn = overlay.querySelector('#cos-import-confirm');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>导入中...';

    try {
      const resp = await fetch('/api/cos/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cos_key: selectedKey, name, description: desc }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || '导入失败');
      showToast(`模板「${name}」导入成功！`, 'success');
      overlay.remove();
      await loadTemplates();
      // 自动选中刚导入的模板
      if (data.data && data.data.id) {
        const tmpl = state.templates.find(t => t.id === data.data.id);
        if (tmpl) selectTemplate(tmpl);
      }
    } catch (e) {
      showToast('导入失败：' + e.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down mr-1"></i>导入此模板';
    }
  });

  // 初始加载
  await loadCosList();
}
