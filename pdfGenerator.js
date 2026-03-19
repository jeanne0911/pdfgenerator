/**
 * PDF 生成模块
 * 使用 pdf-lib 将用户填写的内容写入 PDF 并生成下载
 */

const { PDFDocument, StandardFonts, rgb, PDFName, PDFString } = PDFLib;

// 完整CJK字体URL（非子集，支持简繁体中文）
const CJK_FONT_URLS = [
    'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf',
    'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',
    'https://raw.githubusercontent.com/googlefonts/noto-cjk/main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf',
];

let cachedFont = null;

/**
 * 带超时的 fetch
 */
function fetchWithTimeout(url, timeout = 30000) {
    return Promise.race([
        fetch(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Font download timeout')), timeout))
    ]);
}

/**
 * 加载完整CJK中文字体（多 URL 备选 + 超时控制 + 大小验证）
 */
async function loadCJKFont() {
    if (cachedFont) return cachedFont;
    for (const url of CJK_FONT_URLS) {
        try {
            console.log('尝试加载CJK字体:', url);
            const response = await fetchWithTimeout(url, 30000);
            if (!response.ok) throw new Error('Font download failed: ' + response.status);
            const fontData = await response.arrayBuffer();
            // 验证字体文件大小：完整CJK字体应大于1MB，子集通常只有几十KB
            if (fontData.byteLength > 500000) {
                cachedFont = fontData;
                console.log('CJK字体加载成功，大小:', fontData.byteLength, 'bytes');
                return cachedFont;
            } else {
                console.warn('字体文件过小（可能是子集），跳过:', url, fontData.byteLength, 'bytes');
            }
        } catch (e) {
            console.warn('字体源加载失败:', url, e.message);
        }
    }
    console.warn('所有CJK字体源加载失败，将使用默认字体');
    return null;
}

/**
 * 检测文本是否包含中文字符（简体+繁体+CJK扩展）
 */
function hasChinese(text) {
    return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u2e80-\u2eff\u3000-\u303f\u31c0-\u31ef\ufe30-\ufe4f]/.test(text);
}

/**
 * 将填写内容写入 PDF 并返回生成的 PDF Blob
 * @param {ArrayBuffer} originalBuffer - 原始PDF的ArrayBuffer
 * @param {Array} fields - 带有用户填写值的字段数组
 * @returns {Promise<Blob>} 生成的PDF Blob
 */
export async function generateFilledPDF(originalBuffer, fields) {
    const pdfDoc = await PDFDocument.load(originalBuffer, { 
        ignoreEncryption: true,
        updateMetadata: false
    });

    // 注册 fontkit 用于自定义字体（安全检查）
    if (typeof fontkit !== 'undefined') {
        try {
            pdfDoc.registerFontkit(fontkit);
        } catch (e) {
            console.warn('fontkit 注册失败:', e);
        }
    } else {
        console.warn('fontkit 未加载，中文字体支持将不可用');
    }

    // 检查是否需要中文字体
    const needsCJK = fields.some(f => hasChinese(String(f.value || '')));
    let customFont = null;
    
    if (needsCJK) {
        const fontBytes = await loadCJKFont();
        if (fontBytes) {
            try {
                customFont = await pdfDoc.embedFont(fontBytes);
            } catch (e) {
                console.warn('嵌入中文字体失败:', e);
            }
        }
    }

    // 获取默认字体作为后备
    const defaultFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // 获取表单
    const form = pdfDoc.getForm();
    
    // 计数器：记录已成功填写的字段数和通过文本覆盖的字段数
    let formFieldsFilled = 0;
    let textOverlayFields = 0;

    for (const field of fields) {
        if (field.value === '' || field.value === undefined || field.value === null) continue;
        if (field.type === 'checkbox' && field.value === false) continue;

        try {
            // 先尝试通过表单字段填写
            if (field.originalName) {
                const filled = await fillFormField(form, field, customFont || defaultFont);
                if (filled) {
                    formFieldsFilled++;
                    continue;
                }
            }

            // 如果字段是自动检测的、框选的或者没有原始表单字段，使用文本覆盖
            if (field.isAutoDetected || field.isRegionField || !field.originalName) {
                await addTextOverlay(pdfDoc, field, customFont || defaultFont);
                textOverlayFields++;
            }
        } catch (err) {
            console.warn(`填写字段 "${field.name}" 时出错:`, err);
            // 尝试使用文本覆盖作为后备
            try {
                await addTextOverlay(pdfDoc, field, customFont || defaultFont);
                textOverlayFields++;
            } catch (e) {
                console.warn(`后备文本覆盖也失败:`, e);
            }
        }
    }

    // 尝试扁平化表单（使字段不可编辑）
    try {
        form.flatten();
    } catch (e) {
        // 某些PDF可能没有表单，忽略错误
    }

    console.log(`表单字段填写: ${formFieldsFilled}, 文本覆盖: ${textOverlayFields}`);

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
}

/**
 * 填写表单字段
 */
async function fillFormField(form, field, font) {
    try {
        switch (field.type) {
            case 'text':
            case 'textarea':
            case 'date': {
                const textField = form.getTextField(field.originalName);
                if (textField) {
                    textField.setText(String(field.value));
                    try {
                        textField.updateAppearances(font);
                    } catch (e) { /* 忽略外观更新错误 */ }
                    return true;
                }
                break;
            }
            case 'checkbox': {
                const checkBox = form.getCheckBox(field.originalName);
                if (checkBox) {
                    if (field.value) {
                        checkBox.check();
                    } else {
                        checkBox.uncheck();
                    }
                    return true;
                }
                break;
            }
            case 'dropdown':
            case 'list': {
                const dropdown = form.getDropdown(field.originalName);
                if (dropdown) {
                    dropdown.select(String(field.value));
                    return true;
                }
                break;
            }
            case 'radio': {
                const radioGroup = form.getRadioGroup(field.originalName);
                if (radioGroup) {
                    radioGroup.select(String(field.value));
                    return true;
                }
                break;
            }
        }
    } catch (e) {
        // 字段类型不匹配等错误
        return false;
    }
    return false;
}

/**
 * 在PDF页面上添加文本覆盖（用于没有表单字段的情况）
 */
async function addTextOverlay(pdfDoc, field, font) {
    const pages = pdfDoc.getPages();
    const pageIndex = (field.page || 1) - 1;
    
    if (pageIndex < 0 || pageIndex >= pages.length) return;
    
    const page = pages[pageIndex];
    const { width, height } = page.getSize();

    // 如果有矩形位置信息，使用它
    if (field.rect && field.rect.some(v => v !== 0)) {
        const [x1, y1, x2, y2] = field.rect;

        // 确定字体大小
        let fontSize;
        if (field.fontSize && field.fontSize !== 'auto') {
            fontSize = parseInt(field.fontSize);
        } else {
            // 自动计算：根据区域高度，取合理大小
            const rectHeight = Math.abs(y2 - y1);
            fontSize = Math.min(14, Math.max(8, rectHeight * 0.55));
        }

        const textValue = String(field.value);
        const bottomY = Math.min(y1, y2);
        const leftX = Math.min(x1, x2);
        const rectHeight = Math.abs(y2 - y1);

        // 垂直居中文本
        const textY = bottomY + (rectHeight - fontSize) / 2;

        page.drawText(textValue, {
            x: leftX + 3,
            y: textY,
            size: fontSize,
            font: font,
            color: rgb(0, 0, 0)
        });
    }
}

/**
 * 下载PDF文件
 * @param {Blob} blob - PDF Blob对象
 * @param {string} filename - 文件名
 */
export function downloadPDF(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // 延迟释放URL
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default { generateFilledPDF, downloadPDF };