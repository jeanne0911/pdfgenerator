/**
 * PDF 解析模块
 * 使用 PDF.js 解析 PDF 文件，提取表单字段信息
 */

// 设置 PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/**
 * 解析PDF文件并返回文档信息和表单字段
 * @param {ArrayBuffer} fileBuffer - PDF文件的ArrayBuffer
 * @returns {Promise<Object>} 解析结果
 */
export async function parsePDF(fileBuffer) {
    const loadingTask = pdfjsLib.getDocument({ data: fileBuffer });
    const pdfDoc = await loadingTask.promise;

    const result = {
        pageCount: pdfDoc.numPages,
        fields: [],
        pdfDoc: pdfDoc,
        originalBuffer: fileBuffer
    };

    // 遍历每一页提取表单字段
    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const annotations = await page.getAnnotations();

        annotations.forEach((annot, idx) => {
            if (annot.subtype === 'Widget') {
                const field = parseAnnotation(annot, i, idx);
                if (field) {
                    result.fields.push(field);
                }
            }
        });
    }

    // 如果没有表单字段，尝试提取文本内容辅助用户
    if (result.fields.length === 0) {
        result.textContent = await extractTextContent(pdfDoc);
        result.fields = generateFieldsFromText(result.textContent);
    }

    return result;
}

/**
 * 解析单个注解为表单字段
 */
function parseAnnotation(annot, pageNum, idx) {
    const fieldInfo = {
        id: `field_${pageNum}_${idx}`,
        name: annot.fieldName || `字段_${pageNum}_${idx}`,
        page: pageNum,
        type: 'text',
        value: annot.fieldValue || '',
        options: [],
        required: !!(annot.fieldFlags & 2),
        maxLength: annot.maxLen || 0,
        rect: annot.rect || [0, 0, 0, 0],
        originalName: annot.fieldName || ''
    };

    // 判断字段类型
    switch (annot.fieldType) {
        case 'Tx': // 文本字段
            fieldInfo.type = 'text';
            if (annot.multiLine) {
                fieldInfo.type = 'textarea';
            }
            break;
        case 'Btn': // 按钮/复选框/单选
            if (annot.checkBox) {
                fieldInfo.type = 'checkbox';
                fieldInfo.value = annot.fieldValue === annot.exportValue;
            } else if (annot.radioButton) {
                fieldInfo.type = 'radio';
                fieldInfo.options = annot.options || [];
            } else {
                fieldInfo.type = 'button';
            }
            break;
        case 'Ch': // 选择/下拉
            fieldInfo.type = annot.combo ? 'dropdown' : 'list';
            fieldInfo.options = (annot.options || []).map(opt => ({
                label: opt.displayValue || opt.exportValue || opt,
                value: opt.exportValue || opt.displayValue || opt
            }));
            break;
        case 'Sig': // 签名
            fieldInfo.type = 'signature';
            break;
        default:
            fieldInfo.type = 'text';
    }

    // 尝试生成更友好的显示名称
    fieldInfo.displayName = generateDisplayName(fieldInfo.name);

    return fieldInfo;
}

/**
 * 生成更友好的字段显示名称
 */
function generateDisplayName(name) {
    if (!name) return '未命名字段';

    // 移除常见前缀
    let displayName = name
        .replace(/^(form|field|txt|chk|cmb|rb|sig|btn)[_\-.]?/i, '')
        .replace(/[_\-\.]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim();

    if (!displayName) return name;

    // 首字母大写
    return displayName.charAt(0).toUpperCase() + displayName.slice(1);
}

/**
 * 提取PDF文本内容
 */
async function extractTextContent(pdfDoc) {
    const pages = [];

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        pages.push({
            page: i,
            text: pageText,
            items: textContent.items
        });
    }

    return pages;
}

/**
 * 从文本内容中智能生成填写字段
 * 识别常见的表单标签模式
 */
function generateFieldsFromText(textContent) {
    const fields = [];
    const patterns = [
        // 中文表单标签模式
        { regex: /(?:姓\s*名|名\s*字)[：:\s]*$/i, name: '姓名', type: 'text' },
        { regex: /(?:性\s*别)[：:\s]*$/i, name: '性别', type: 'dropdown', options: [{ label: '男', value: '男' }, { label: '女', value: '女' }] },
        { regex: /(?:出生日期|出生年月|生日)[：:\s]*$/i, name: '出生日期', type: 'date' },
        { regex: /(?:身份证|身份证号|证件号)[：:\s]*$/i, name: '身份证号', type: 'text' },
        { regex: /(?:手机|电话|联系方式|联系电话|手机号)[：:\s]*$/i, name: '联系电话', type: 'text' },
        { regex: /(?:邮箱|电子邮件|E-?mail)[：:\s]*$/i, name: '电子邮箱', type: 'text' },
        { regex: /(?:地址|住址|通讯地址)[：:\s]*$/i, name: '地址', type: 'textarea' },
        { regex: /(?:公司|单位|工作单位)[：:\s]*$/i, name: '工作单位', type: 'text' },
        { regex: /(?:职位|职务)[：:\s]*$/i, name: '职位', type: 'text' },
        { regex: /(?:学历|教育|教育程度)[：:\s]*$/i, name: '学历', type: 'dropdown', options: [{ label: '高中', value: '高中' }, { label: '大专', value: '大专' }, { label: '本科', value: '本科' }, { label: '硕士', value: '硕士' }, { label: '博士', value: '博士' }] },
        { regex: /(?:签名|签字)[：:\s]*$/i, name: '签名', type: 'signature' },
        { regex: /(?:日期|填表日期)[：:\s]*$/i, name: '日期', type: 'date' },
        { regex: /(?:备注|说明|其他)[：:\s]*$/i, name: '备注', type: 'textarea' },
        // 英文表单标签
        { regex: /(?:first\s*name)[：:\s]*$/i, name: 'First Name', type: 'text' },
        { regex: /(?:last\s*name|surname|family\s*name)[：:\s]*$/i, name: 'Last Name', type: 'text' },
        { regex: /(?:full\s*name|name)[：:\s]*$/i, name: 'Name', type: 'text' },
        { regex: /(?:address)[：:\s]*$/i, name: 'Address', type: 'textarea' },
        { regex: /(?:phone|telephone|tel)[：:\s]*$/i, name: 'Phone', type: 'text' },
        { regex: /(?:email|e-mail)[：:\s]*$/i, name: 'Email', type: 'text' },
        { regex: /(?:date\s*of\s*birth|dob|birthday)[：:\s]*$/i, name: 'Date of Birth', type: 'date' },
        { regex: /(?:signature)[：:\s]*$/i, name: 'Signature', type: 'signature' },
        { regex: /(?:date)[：:\s]*$/i, name: 'Date', type: 'date' },
    ];

    const seenNames = new Set();
    let fieldIdx = 0;

    textContent.forEach(pageData => {
        const text = pageData.text;
        
        patterns.forEach(pattern => {
            // 使用全局正则搜索
            const globalRegex = new RegExp(pattern.regex.source, 'gi');
            let match;
            while ((match = globalRegex.exec(text)) !== null) {
                if (!seenNames.has(pattern.name)) {
                    seenNames.add(pattern.name);
                    const field = {
                        id: `auto_${pageData.page}_${fieldIdx++}`,
                        name: pattern.name,
                        displayName: pattern.name,
                        page: pageData.page,
                        type: pattern.type,
                        value: '',
                        options: pattern.options || [],
                        required: false,
                        maxLength: 0,
                        rect: [0, 0, 0, 0],
                        isAutoDetected: true
                    };
                    fields.push(field);
                }
            }
        });
    });

    return fields;
}

/**
 * 渲染PDF页面到Canvas
 * @param {Object} pdfDoc - PDF文档对象
 * @param {number} pageNum - 页码
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {number} scale - 缩放比例
 */
export async function renderPage(pdfDoc, pageNum, canvas, scale = 1.5) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const ctx = canvas.getContext('2d');

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
        canvasContext: ctx,
        viewport: viewport
    };

    await page.render(renderContext).promise;
    return viewport;
}

export default { parsePDF, renderPage };
