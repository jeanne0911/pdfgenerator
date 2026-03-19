// user.js - 用户填写界面逻辑

const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const { PDFDocument, rgb, StandardFonts } = PDFLib;

// ==================== State ====================
const state = {
  templates: [],
  selectedTemplate: null,
  templateFields: [],
  pdfDoc: null,
  pdfBytes: null,
  currentPage: 1,
  totalPages: 1,
  scale: 1.0,
  userZoom: null,       // null = auto-fit, number = manual zoom
  baseScale: 1.0,       // auto-fit scale for reference
  generatedPdfBytes: null,
};

// ==================== DOM ====================
const dom = {
  step1: document.getElementById('step1'),
  step2: document.getElementById('step2'),
  step3: document.getElementById('step3'),
  step1Indicator: document.getElementById('step1-indicator'),
  step2Indicator: document.getElementById('step2-indicator'),
  step3Indicator: document.getElementById('step3-indicator'),
  templateGrid: document.getElementById('template-grid'),
  previewTemplateName: document.getElementById('preview-template-name'),
  pdfPreviewCanvas: document.getElementById('pdf-preview-canvas'),
  userPdfWrap: document.getElementById('user-pdf-wrap'),
  regionOverlays: document.getElementById('region-overlays'),
  userCurPage: document.getElementById('user-cur-page'),
  userTotalPages: document.getElementById('user-total-pages'),
  btnPrevPageUser: document.getElementById('btn-prev-page-user'),
  btnNextPageUser: document.getElementById('btn-next-page-user'),
  btnBackToStep1: document.getElementById('btn-back-to-step1'),
  btnZoomInUser: document.getElementById('btn-zoom-in-user'),
  btnZoomOutUser: document.getElementById('btn-zoom-out-user'),
  btnZoomFitUser: document.getElementById('btn-zoom-fit-user'),
  zoomLevelUser: document.getElementById('zoom-level-user'),
  userFieldsList: document.getElementById('user-fields-list'),
  fillProgress: document.getElementById('fill-progress'),
  fillProgressText: document.getElementById('fill-progress-text'),
  btnGeneratePdf: document.getElementById('btn-generate-pdf'),
  btnDownloadAgain: document.getElementById('btn-download-again'),
  btnFillAnother: document.getElementById('btn-fill-another'),
  loadingOverlay: document.getElementById('loading-overlay'),
  loadingText: document.getElementById('loading-text'),
  toast: document.getElementById('toast'),
  toastInner: document.getElementById('toast-inner'),
};

// ==================== Toast ====================
function showToast(msg, type = 'success') {
  const colors = { success: 'bg-green-500 text-white', error: 'bg-red-500 text-white', info: 'bg-blue-500 text-white' };
  const icons = { success: 'fa-check-circle', error: 'fa-circle-xmark', info: 'fa-circle-info' };
  dom.toastInner.className = `px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${colors[type]}`;
  dom.toastInner.innerHTML = `<i class="fa-solid ${icons[type]}"></i>${msg}`;
  dom.toast.classList.remove('hidden');
  setTimeout(() => dom.toast.classList.add('hidden'), 3000);
}

function showLoading(text = '处理中...') {
  dom.loadingText.textContent = text;
  dom.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  dom.loadingOverlay.classList.add('hidden');
}

// ==================== Step Navigation ====================
function goToStep(n) {
  dom.step1.classList.add('hidden');
  dom.step2.classList.add('hidden');
  dom.step3.classList.add('hidden');
  document.getElementById(`step${n}`).classList.remove('hidden');

  [dom.step1Indicator, dom.step2Indicator, dom.step3Indicator].forEach((el, i) => {
    const active = i + 1 <= n;
    const current = i + 1 === n;
    el.className = `step-indicator flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${current ? 'bg-blue-600 text-white' : active ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`;
    const dot = el.querySelector('span');
    dot.className = `w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${current ? 'bg-white text-blue-600' : active ? 'bg-blue-300 text-white' : 'bg-gray-300 text-white'}`;
  });
}

// ==================== API ====================
async function api(method, path) {
  const res = await fetch(path, { method });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ==================== Step 1: Load Templates ====================
async function loadTemplates() {
  try {
    const res = await api('GET', '/api/templates');
    state.templates = res.data || [];
    renderTemplateGrid();
  } catch (e) {
    dom.templateGrid.innerHTML = `<div class="col-span-full text-center py-16 text-red-400"><i class="fa-solid fa-circle-exclamation text-3xl mb-3 block"></i>加载失败，请刷新重试</div>`;
  }
}

function renderTemplateGrid() {
  if (!state.templates.length) {
    dom.templateGrid.innerHTML = `
      <div class="col-span-full text-center py-16 text-gray-400">
        <i class="fa-solid fa-folder-open text-5xl mb-4 block text-gray-300"></i>
        <p class="text-lg font-medium mb-2">暂无可用模板</p>
        <p class="text-sm">请联系管理员上传PDF模板</p>
        <a href="/static/admin.html" class="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm">
          <i class="fa-solid fa-gear"></i> 前往管理后台
        </a>
      </div>`;
    return;
  }

  dom.templateGrid.innerHTML = state.templates.map(t => `
    <div class="template-card border-2 border-gray-200 rounded-2xl p-5 bg-white" data-id="${t.id}">
      <div class="flex items-start gap-3 mb-3">
        <div class="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <i class="fa-solid fa-file-pdf text-2xl text-red-400"></i>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-bold text-gray-800 text-base truncate">${t.name}</h3>
          <p class="text-xs text-gray-400 mt-0.5 truncate">${t.pdf_filename}</p>
        </div>
      </div>
      ${t.description ? `<p class="text-sm text-gray-500 mb-3 line-clamp-2">${t.description}</p>` : ''}
      <div class="flex items-center justify-between">
        <span class="text-xs text-gray-400"><i class="fa-solid fa-file-lines mr-1"></i>${t.page_count} 页</span>
        <button class="btn-select-template px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors" data-id="${t.id}">
          选择此模板 <i class="fa-solid fa-arrow-right ml-1"></i>
        </button>
      </div>
    </div>
  `).join('');
}

// ==================== Step 2: Fill Form ====================
async function selectTemplate(id) {
  const t = state.templates.find(x => x.id === id);
  if (!t) return;
  state.selectedTemplate = t;

  showLoading('加载模板...');
  try {
    // Load PDF
    const pdfRes = await api('GET', `/api/templates/${id}/pdf`);
    state.pdfBytes = Uint8Array.from(atob(pdfRes.data.pdf_base64), c => c.charCodeAt(0)).buffer;
    state.pdfDoc = await pdfjsLib.getDocument({ data: state.pdfBytes.slice(0) }).promise;
    state.totalPages = state.pdfDoc.numPages;
    state.currentPage = 1;
    dom.userTotalPages.textContent = state.totalPages;
    dom.previewTemplateName.textContent = t.name;

    // Load fields
    const fieldsRes = await api('GET', `/api/templates/${id}/fields`);
    state.templateFields = (fieldsRes.data || []).map(f => ({
      ...f,
      _label: f.custom_label || f.field_label || f.field_name || '未命名',
      _type: f.field_type || 'text',
      _value: '',
    }));

    goToStep(2);
    await renderPreviewPage();
    renderUserForm();
  } catch (e) {
    showToast('加载模板失败：' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

async function renderPreviewPage() {
  if (!state.pdfDoc) return;
  const page = await state.pdfDoc.getPage(state.currentPage);

  const container = document.getElementById('user-canvas-container');
  const maxW = container.clientWidth - 48;
  const maxH = container.clientHeight - 48;
  const vp0 = page.getViewport({ scale: 1 });
  const fitScaleW = maxW / vp0.width;
  const fitScaleH = maxH / vp0.height;
  state.baseScale = Math.min(fitScaleW, fitScaleH, 2.0);

  // Use manual zoom if set, otherwise auto-fit
  if (state.userZoom !== null) {
    state.scale = state.userZoom;
  } else {
    state.scale = state.baseScale;
  }
  const vp = page.getViewport({ scale: state.scale });

  dom.pdfPreviewCanvas.width = vp.width;
  dom.pdfPreviewCanvas.height = vp.height;
  dom.userPdfWrap.style.width = vp.width + 'px';
  dom.userPdfWrap.style.height = vp.height + 'px';

  const ctx = dom.pdfPreviewCanvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;

  dom.userCurPage.textContent = state.currentPage;
  updateZoomDisplay();
  renderRegionOverlays();
}

function updateZoomDisplay() {
  if (dom.zoomLevelUser) {
    const pct = Math.round(state.scale / state.baseScale * 100);
    dom.zoomLevelUser.textContent = pct + '%';
  }
}

function zoomIn() {
  const currentZoom = state.userZoom !== null ? state.userZoom : state.baseScale;
  state.userZoom = Math.min(currentZoom * 1.2, state.baseScale * 3);
  renderPreviewPage();
}

function zoomOut() {
  const currentZoom = state.userZoom !== null ? state.userZoom : state.baseScale;
  state.userZoom = Math.max(currentZoom / 1.2, state.baseScale * 0.3);
  renderPreviewPage();
}

function zoomFit() {
  state.userZoom = null;
  renderPreviewPage();
}

function pdfToScreen(px, py, pw, ph) {
  const canvas = dom.pdfPreviewCanvas;
  const sx = px * state.scale;
  const sw = pw * state.scale;
  const sh = ph * state.scale;
  const sy = canvas.height - (py * state.scale) - sh;
  return { x: sx, y: sy, w: sw, h: sh };
}

function renderRegionOverlays() {
  dom.regionOverlays.innerHTML = '';
  const pageFields = state.templateFields.filter(f => f.page_num === state.currentPage);
  pageFields.forEach(f => {
    const s = pdfToScreen(f.x, f.y, f.width, f.height);
    const div = document.createElement('div');
    div.className = `region-overlay ${f._value ? 'filled' : ''}`;
    div.style.cssText = `left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px;`;
    div.title = f._label;
    // Show filled value preview
    if (f._value) {
      const span = document.createElement('span');
      span.style.cssText = `position:absolute;left:3px;top:2px;font-size:${Math.min(f.font_size || 12, s.h - 4)}px;color:#065f46;white-space:nowrap;overflow:hidden;max-width:${s.w - 6}px;`;
      span.textContent = f._value;
      div.appendChild(span);
    }
    dom.regionOverlays.appendChild(div);
  });
}

function renderUserForm() {
  if (!state.templateFields.length) {
    dom.userFieldsList.innerHTML = `<div class="text-center text-gray-400 text-sm py-8"><i class="fa-solid fa-circle-info text-3xl mb-2 block text-gray-300"></i>此模板暂无填写字段<br/>请联系管理员配置</div>`;
    return;
  }

  // 检测重复字段并添加编号
  const labelCounts = {};
  state.templateFields.forEach(f => {
    const label = f._label || '未命名';
    labelCounts[label] = (labelCounts[label] || 0) + 1;
  });
  const labelSeen = {};

  const typeIcons = { text: 'fa-font', textarea: 'fa-align-left', date: 'fa-calendar', number: 'fa-hashtag', checkbox: 'fa-square-check' };
  const typeColors = { text: 'text-blue-500', textarea: 'text-green-500', date: 'text-yellow-500', number: 'text-orange-500', checkbox: 'text-purple-500' };

  dom.userFieldsList.innerHTML = state.templateFields.map((f, idx) => {
    const baseLabel = f._label || '未命名';
    let displayLabel = baseLabel;
    if (labelCounts[baseLabel] > 1) {
      labelSeen[baseLabel] = (labelSeen[baseLabel] || 0) + 1;
      displayLabel = `${baseLabel} #${labelSeen[baseLabel]}`;
    }
    
    const icon = typeIcons[f._type] || 'fa-font';
    const color = typeColors[f._type] || 'text-gray-400';
    let inputHtml = '';

    if (f._type === 'textarea') {
      inputHtml = `<textarea class="form-input w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" rows="3" placeholder="请输入${displayLabel}" data-idx="${idx}"></textarea>`;
    } else if (f._type === 'date') {
      inputHtml = `<input type="date" class="form-input w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" data-idx="${idx}" />`;
    } else if (f._type === 'number') {
      inputHtml = `<input type="number" class="form-input w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" placeholder="请输入${displayLabel}" data-idx="${idx}" />`;
    } else if (f._type === 'checkbox') {
      inputHtml = `<label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" class="form-input w-4 h-4 rounded" data-idx="${idx}" data-type="checkbox" /><span class="text-sm text-gray-600">勾选此项</span></label>`;
    } else {
      inputHtml = `<input type="text" class="form-input w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" placeholder="请输入${displayLabel}" data-idx="${idx}" />`;
    }

    return `
      <div class="field-item" data-idx="${idx}">
        <div class="flex items-center gap-2 mb-1.5">
          <i class="fa-solid ${icon} ${color} text-sm"></i>
          <label class="text-sm font-medium text-gray-700">${displayLabel}</label>
          <span class="text-xs text-gray-400 ml-auto">第${f.page_num}页</span>
        </div>
        ${inputHtml}
      </div>
    `;
  }).join('');

  updateProgress();
}

function updateProgress() {
  const total = state.templateFields.length;
  const filled = state.templateFields.filter(f => f._value && f._value !== '').length;
  const pct = total ? Math.round(filled / total * 100) : 0;
  dom.fillProgress.style.width = pct + '%';
  dom.fillProgressText.textContent = `${filled} / ${total} 已填写`;
}

// ==================== Generate PDF ====================
async function generatePdf() {
  const filledFields = state.templateFields.filter(f => f._value);
  if (!filledFields.length) {
    showToast('请至少填写一个字段', 'error');
    return;
  }

  showLoading('生成PDF中...');
  try {
    const pdfDoc = await PDFDocument.load(state.pdfBytes.slice(0));

    // Try to embed CJK font
    let font = null;
    let useCustomFont = false;
    if (typeof fontkit !== 'undefined') {
      try {
        pdfDoc.registerFontkit(fontkit);
        // 使用完整的CJK字体（非子集），支持简繁体中文
        const fontUrls = [
          'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf',
          'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',
          'https://raw.githubusercontent.com/googlefonts/noto-cjk/main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf',
        ];
        let fontBytes = null;
        for (const url of fontUrls) {
          try {
            console.log('尝试加载CJK字体:', url);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30000);
            const resp = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);
            if (resp.ok) {
              const buf = await resp.arrayBuffer();
              // 验证字体文件大小：完整CJK字体应大于1MB
              if (buf.byteLength > 500000) {
                fontBytes = buf;
                console.log('CJK字体加载成功:', url, '大小:', buf.byteLength);
                break;
              } else {
                console.warn('字体文件过小，可能是子集:', url, buf.byteLength);
              }
            }
          } catch (e) { console.warn('字体加载失败:', url, e.message); }
        }
        if (fontBytes) {
          font = await pdfDoc.embedFont(fontBytes);
          useCustomFont = true;
        }
      } catch (e) { console.warn('字体处理异常:', e); }
    }
    if (!font) {
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    const pages = pdfDoc.getPages();

    for (const f of state.templateFields) {
      if (!f._value) continue;
      const pageIdx = (f.page_num || 1) - 1;
      if (pageIdx >= pages.length) continue;
      const page = pages[pageIdx];
      const { height: pageHeight } = page.getSize();

      const fontSize = f.font_size || 12;
      const x = f.x + 2;
      const y = f.y + (f.height - fontSize) / 2;

      let displayValue = f._value;
      if (f._type === 'checkbox') {
        displayValue = f._value === 'true' || f._value === true ? '☑' : '☐';
      }

      try {
        page.drawText(String(displayValue), {
          x: x,
          y: y,
          size: fontSize,
          font: font,
          color: rgb(0, 0, 0),
          maxWidth: f.width - 4,
        });
      } catch (drawErr) {
        // Fallback: try with standard font
        try {
          const fallbackFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
          page.drawText(String(displayValue), {
            x: x, y: y, size: fontSize, font: fallbackFont,
            color: rgb(0, 0, 0), maxWidth: f.width - 4,
          });
        } catch {}
      }
    }

    state.generatedPdfBytes = await pdfDoc.save();
    downloadPdf();
    goToStep(3);
  } catch (e) {
    console.error('PDF生成失败:', e);
    showToast('PDF生成失败：' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

function getHolderName() {
  // 从已填写的字段中查找"保单持有人"相关字段
  const holderKeywords = ['保单持有人', '持有人', '投保人', '被保险人', '保单持有人名', '姓名', 'Name', 'name', 'Holder', 'holder', 'PolicyHolder'];
  for (const keyword of holderKeywords) {
    const field = state.templateFields.find(f => {
      const label = (f._label || '').toLowerCase();
      const fieldName = (f.field_name || '').toLowerCase();
      const kw = keyword.toLowerCase();
      return (label === kw || label.includes(kw) || fieldName === kw || fieldName.includes(kw)) && f._value;
    });
    if (field && field._value) return field._value.trim();
  }
  // 如果没找到，取第一个有值的文本字段
  const firstFilled = state.templateFields.find(f => f._value && f._type === 'text');
  return firstFilled ? firstFilled._value.trim() : '未知';
}

function downloadPdf() {
  if (!state.generatedPdfBytes) return;
  const blob = new Blob([state.generatedPdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const holderName = getHolderName();
  const templateName = state.selectedTemplate?.name || 'filled';
  const timestamp = Date.now().toString().slice(-6);
  a.download = `${holderName}_${templateName}_${timestamp}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ==================== Events ====================
function bindEvents() {
  // Template selection
  dom.templateGrid.addEventListener('click', e => {
    const btn = e.target.closest('.btn-select-template');
    if (btn) selectTemplate(parseInt(btn.dataset.id));
  });

  // Back to step 1
  dom.btnBackToStep1.addEventListener('click', () => {
    goToStep(1);
    state.selectedTemplate = null;
    state.templateFields = [];
    state.pdfDoc = null;
  });

  // Page navigation
  dom.btnPrevPageUser.addEventListener('click', () => {
    if (state.currentPage > 1) { state.currentPage--; renderPreviewPage(); }
  });
  dom.btnNextPageUser.addEventListener('click', () => {
    if (state.currentPage < state.totalPages) { state.currentPage++; renderPreviewPage(); }
  });

  // Zoom controls
  dom.btnZoomInUser.addEventListener('click', zoomIn);
  dom.btnZoomOutUser.addEventListener('click', zoomOut);
  dom.btnZoomFitUser.addEventListener('click', zoomFit);

  // Mouse wheel zoom on PDF preview
  const canvasContainer = document.getElementById('user-canvas-container');
  canvasContainer.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    }
  }, { passive: false });

  // Form input changes
  dom.userFieldsList.addEventListener('input', e => {
    const el = e.target;
    const idx = el.dataset.idx;
    if (idx === undefined) return;
    const i = parseInt(idx);
    if (el.type === 'checkbox') {
      state.templateFields[i]._value = el.checked ? 'true' : '';
    } else {
      state.templateFields[i]._value = el.value;
    }
    updateProgress();
    renderRegionOverlays();
  });

  dom.userFieldsList.addEventListener('change', e => {
    const el = e.target;
    const idx = el.dataset.idx;
    if (idx === undefined) return;
    const i = parseInt(idx);
    if (el.type === 'checkbox') {
      state.templateFields[i]._value = el.checked ? 'true' : '';
      updateProgress();
      renderRegionOverlays();
    }
  });

  // Generate PDF
  dom.btnGeneratePdf.addEventListener('click', generatePdf);

  // Step 3 buttons
  dom.btnDownloadAgain.addEventListener('click', downloadPdf);
  dom.btnFillAnother.addEventListener('click', () => {
    goToStep(1);
    state.selectedTemplate = null;
    state.templateFields = [];
    state.generatedPdfBytes = null;
  });
}

// ==================== Batch Upload (Unified Template) ====================
const batchState = {
  selectedFile: null,
};

function initBatchUpload() {
  const btnOpenBatch = document.getElementById('btn-open-batch');
  const batchModal = document.getElementById('batch-modal');
  const btnCloseBatch = document.getElementById('btn-close-batch');
  const batchUploadZone = document.getElementById('batch-upload-zone');
  const btnDownloadExcelTpl = document.getElementById('btn-download-excel-tpl');
  const btnBatchGenerate = document.getElementById('btn-batch-generate');
  const batchUploadProgress = document.getElementById('batch-upload-progress');
  const batchProgressText = document.getElementById('batch-progress-text');
  const batchProgressBar = document.getElementById('batch-progress-bar');
  const batchResult = document.getElementById('batch-result');
  const batchTemplateTags = document.getElementById('batch-template-tags');

  // 创建一个持久化的隐藏 file input，放在 batchUploadZone 外面避免被innerHTML替换
  const persistentFileInput = document.createElement('input');
  persistentFileInput.type = 'file';
  persistentFileInput.accept = '.xlsx,.xls';
  persistentFileInput.style.display = 'none';
  persistentFileInput.id = 'batch-excel-input-persistent';
  batchModal.appendChild(persistentFileInput);

  if (!btnOpenBatch) return;

  // 打开弹窗
  btnOpenBatch.addEventListener('click', () => {
    batchModal.style.display = 'flex';
    batchState.selectedFile = null;
    resetBatchUploadZone();
    renderBatchTemplateTags();
  });

  // 关闭弹窗
  btnCloseBatch.addEventListener('click', () => {
    batchModal.style.display = 'none';
  });
  batchModal.addEventListener('click', e => {
    if (e.target === batchModal) batchModal.style.display = 'none';
  });

  // 渲染模板标签
  function renderBatchTemplateTags() {
    if (!batchTemplateTags) return;
    if (!state.templates.length) {
      batchTemplateTags.innerHTML = '<span class="text-xs text-gray-400">暂无可用模板</span>';
      return;
    }
    const tagColors = [
      'bg-blue-100 text-blue-700',
      'bg-green-100 text-green-700',
      'bg-purple-100 text-purple-700',
      'bg-orange-100 text-orange-700',
      'bg-pink-100 text-pink-700',
      'bg-teal-100 text-teal-700',
    ];
    batchTemplateTags.innerHTML = state.templates.map((t, i) =>
      `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${tagColors[i % tagColors.length]}">
        <i class="fa-solid fa-file-pdf text-xs opacity-60"></i>${t.name}
      </span>`
    ).join('');
  }

  // 下载统一Excel模板
  btnDownloadExcelTpl.addEventListener('click', async () => {
    btnDownloadExcelTpl.disabled = true;
    btnDownloadExcelTpl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 下载中...';
    try {
      const resp = await fetch('/api/unified-excel-template');
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || `下载失败 ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '统一批量填写模板.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast('统一Excel模板下载成功', 'success');
    } catch (e) {
      showToast('下载失败：' + e.message, 'error');
    } finally {
      btnDownloadExcelTpl.disabled = false;
      btnDownloadExcelTpl.innerHTML = '<i class="fa-solid fa-download"></i> 下载Excel模板';
    }
  });

  // 上传区域点击 - 只绑定一次，通过事件委托处理
  batchUploadZone.addEventListener('click', (e) => {
    // 如果点击的是"重新选择"按钮，则打开文件选择器
    if (e.target.closest('#btn-reselect-excel')) {
      e.stopPropagation();
      persistentFileInput.value = '';
      persistentFileInput.click();
      return;
    }
    // 如果还没选中文件（处于上传区初始状态），点击打开文件选择器
    if (!batchState.selectedFile) {
      persistentFileInput.value = '';
      persistentFileInput.click();
    }
  });

  // 拖拽上传
  batchUploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    batchUploadZone.classList.add('border-emerald-400', 'bg-emerald-50');
  });
  batchUploadZone.addEventListener('dragleave', () => {
    batchUploadZone.classList.remove('border-emerald-400', 'bg-emerald-50');
  });
  batchUploadZone.addEventListener('drop', e => {
    e.preventDefault();
    batchUploadZone.classList.remove('border-emerald-400', 'bg-emerald-50');
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      handleBatchFileSelect(file);
    } else {
      showToast('请上传Excel文件（.xlsx格式）', 'error');
    }
  });

  // 持久化文件 input 的 change 事件 - 只绑定一次
  persistentFileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleBatchFileSelect(e.target.files[0]);
  });

  function handleBatchFileSelect(file) {
    batchState.selectedFile = file;
    batchUploadZone.innerHTML = `
      <div class="flex flex-col items-center gap-2">
        <div class="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
          <i class="fa-solid fa-file-excel text-2xl text-green-500"></i>
        </div>
        <p class="text-sm font-medium text-green-700">${file.name}</p>
        <p class="text-xs text-gray-400">${(file.size / 1024).toFixed(1)} KB</p>
        <button type="button" id="btn-reselect-excel" class="text-xs text-emerald-600 hover:text-emerald-800 underline mt-1">重新选择</button>
      </div>
    `;
    btnBatchGenerate.disabled = false;
    batchResult.classList.add('hidden');
  }

  function resetBatchUploadZone() {
    batchState.selectedFile = null;
    persistentFileInput.value = '';
    batchUploadZone.innerHTML = `
      <i class="fa-solid fa-file-arrow-up text-3xl text-gray-300 mb-2"></i>
      <p class="text-sm text-gray-500">点击或拖拽上传Excel文件</p>
      <p class="text-xs text-gray-400 mt-1">支持 .xlsx 格式，每行可选不同模板，最多100行数据</p>
    `;
    btnBatchGenerate.disabled = true;
    batchUploadProgress.classList.add('hidden');
    batchResult.classList.add('hidden');
  }

  // 批量生成PDF（调用统一API）
  btnBatchGenerate.addEventListener('click', async () => {
    if (!batchState.selectedFile) return;

    btnBatchGenerate.disabled = true;
    batchUploadProgress.classList.remove('hidden');
    batchResult.classList.add('hidden');

    // 模拟进度动画
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress = Math.min(progress + Math.random() * 15, 85);
      batchProgressBar.style.width = progress + '%';
      batchProgressText.textContent = `正在生成PDF... ${Math.round(progress)}%`;
    }, 300);

    try {
      const formData = new FormData();
      formData.append('excel_file', batchState.selectedFile);

      const response = await fetch('/api/unified-batch-upload', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);
      batchProgressBar.style.width = '100%';
      batchProgressText.textContent = '生成完成！';

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `服务器错误 ${response.status}`);
      }

      const generatedCount = response.headers.get('X-Generated-Count') || '?';
      const errorCount = parseInt(response.headers.get('X-Error-Count') || '0');
      let errorsDetail = [];
      try {
        const errorsJson = response.headers.get('X-Errors');
        if (errorsJson) errorsDetail = JSON.parse(errorsJson);
      } catch {}

      // 下载ZIP
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `批量PDF_${generatedCount}份.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      // 显示结果
      batchResult.classList.remove('hidden');
      const errorHtml = errorCount > 0
        ? `<div class="text-xs text-orange-500 mt-2 space-y-0.5">
            <div><i class="fa-solid fa-triangle-exclamation mr-1"></i>${errorCount} 行数据生成失败：</div>
            ${errorsDetail.map(e => `<div class="ml-4 text-orange-400">• ${e}</div>`).join('')}
           </div>`
        : '';

      batchResult.innerHTML = `
        <div class="p-4 bg-green-50 border border-green-200 rounded-xl">
          <div class="flex items-start gap-3">
            <i class="fa-solid fa-circle-check text-green-500 text-xl flex-shrink-0 mt-0.5"></i>
            <div class="flex-1">
              <div class="font-semibold text-green-700 mb-1">批量生成成功！</div>
              <div class="text-sm text-green-600">已生成 <strong>${generatedCount}</strong> 份PDF（可能包含多个模板），已打包为ZIP文件下载</div>
              ${errorHtml}
              <button id="btn-batch-download-again" class="mt-3 flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors">
                <i class="fa-solid fa-download"></i> 重新下载
              </button>
            </div>
          </div>
        </div>
      `;

      // 重新下载按钮
      document.getElementById('btn-batch-download-again')?.addEventListener('click', () => {
        const a2 = document.createElement('a');
        a2.href = url;
        a2.download = `批量PDF_${generatedCount}份.zip`;
        a2.click();
      });

      showToast(`批量生成成功！共 ${generatedCount} 份PDF`, 'success');

    } catch (e) {
      clearInterval(progressInterval);
      batchUploadProgress.classList.add('hidden');
      batchResult.classList.remove('hidden');
      batchResult.innerHTML = `
        <div class="p-4 bg-red-50 border border-red-200 rounded-xl">
          <div class="flex items-start gap-3">
            <i class="fa-solid fa-circle-xmark text-red-500 text-xl flex-shrink-0 mt-0.5"></i>
            <div>
              <div class="font-semibold text-red-700 mb-1">生成失败</div>
              <div class="text-sm text-red-600">${e.message}</div>
              <div class="text-xs text-gray-400 mt-1">请检查Excel文件格式是否正确，确保B列选择了正确的模板名</div>
            </div>
          </div>
        </div>
      `;
      showToast('批量生成失败：' + e.message, 'error');
    } finally {
      btnBatchGenerate.disabled = false;
    }
  });
}

// ==================== Init ====================
async function init() {
  bindEvents();
  initBatchUpload();
  await loadTemplates();
  goToStep(1);
  // 如果URL带有#batch，自动打开批量上传弹窗
  if (window.location.hash === '#batch') {
    setTimeout(() => {
      const btnOpenBatch = document.getElementById('btn-open-batch');
      if (btnOpenBatch) btnOpenBatch.click();
    }, 500);
  }
}

init();
