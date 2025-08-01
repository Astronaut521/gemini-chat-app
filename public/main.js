const ui = {};
let appState = {};
let isLoading = false;
let imageData = null;
const UNLIMITED_SENTINEL = -1; // Make frontend aware of the new standard

// --- 全局API请求函数 ---
async function apiRequest(endpoint, options = {}) {
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    
    const response = await fetch(`/api${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '请求失败，无法解析错误信息。' }));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    return response.json();
}

// --- 初始化与状态管理 ---
document.addEventListener('DOMContentLoaded', async () => {
    Object.assign(ui, {
        appContainer: document.querySelector('.app-container'), body: document.body, chatContainer: document.getElementById('chat-container'),
        textInput: document.getElementById('text-input'), sendBtn: document.getElementById('send-btn'),
        settingsBtn: document.getElementById('settings-btn'), closeSettingsBtn: document.getElementById('close-settings-btn'),
        settingsOverlay: document.getElementById('settings-overlay'), modelSelect: document.getElementById('model-select'),
        themeToggle: document.getElementById('theme-toggle'), webSearchToggle: document.getElementById('web-search-toggle'),
        usageCount: document.getElementById('usage-count'), uploadBtn: document.getElementById('upload-btn'),
        imageInput: document.getElementById('image-input'), imagePreviewContainer: document.getElementById('image-preview-container'),
        previewImg: document.getElementById('image-preview'), removeImgBtn: document.getElementById('remove-img-btn'),
        redeemBtn: document.getElementById('redeem-btn'), redeemCodeInput: document.getElementById('redeem-code'),
        sidebar: document.getElementById('sidebar'), menuBtn: document.getElementById('menu-btn'), closeSidebarBtn: document.getElementById('close-sidebar-btn'),
        conversationList: document.getElementById('conversation-list'), headerTitle: document.getElementById('header-title'),
        addConversationBtn: document.getElementById('add-conversation-btn'),
        usageInfo: document.getElementById('usage-info'), unlimitedInfo: document.getElementById('unlimited-info'),
        importDataBtn: document.getElementById('import-data-btn'), exportDataBtn: document.getElementById('export-data-btn'),
        importFileInput: document.getElementById('import-file-input'),
        apiKeyInput: document.getElementById('api-key-input'),
    });
    
    setupEventListeners();
    await loadInitialState();
    adjustHeight();
    window.addEventListener('resize', adjustHeight);
});

async function loadInitialState() {
    try {
        const state = await apiRequest('state');
        updateAppState(state);
    } catch (error) {
        console.error("无法从服务器加载状态:", error);
        alert(`初始化失败: ${error.message}`);
    }
}

function updateAppState(newState) {
    appState = newState;
    
    if (!appState.activeConversationId || !appState.conversations[appState.activeConversationId]) {
        createNewConversation(false);
    } else {
        ui.body.dataset.theme = appState.theme;
        ui.modelSelect.value = appState.model;
        ui.apiKeyInput.value = appState.apiKey || '';
        updateUsageDisplay();
        renderConversation();
        renderConversationList();
    }
}

function adjustHeight() { document.querySelector('.app-container').style.height = window.innerHeight + 'px'; }

function setupEventListeners() {
    ui.sendBtn.addEventListener('click', sendMessage);
    ui.textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    ui.addConversationBtn.addEventListener('click', () => createNewConversation(true));
    ui.settingsBtn.addEventListener('click', () => ui.settingsOverlay.style.display = 'flex');
    ui.closeSettingsBtn.addEventListener('click', () => {
        // When closing settings, if the API key was changed, save it.
        if (ui.apiKeyInput.value.trim() !== (appState.apiKey || '')) {
            saveSettings();
        }
        ui.settingsOverlay.style.display = 'none';
    });
    ui.menuBtn.addEventListener('click', () => ui.sidebar.classList.toggle('open'));
    ui.closeSidebarBtn.addEventListener('click', () => ui.sidebar.classList.remove('open'));
    ui.themeToggle.addEventListener('click', toggleTheme);
    ui.modelSelect.addEventListener('change', saveSettings);
    ui.apiKeyInput.addEventListener('blur', saveSettings); // Save when user clicks away
    ui.redeemBtn.addEventListener('click', redeemCode);
    ui.uploadBtn.addEventListener('click', () => ui.imageInput.click());
    ui.imageInput.addEventListener('change', handleImageUpload);
    ui.removeImgBtn.addEventListener('click', removeImage);
    ui.exportDataBtn.addEventListener('click', exportData);
    ui.importDataBtn.addEventListener('click', () => ui.importFileInput.click());
    ui.importFileInput.addEventListener('change', importData);
}

async function saveSettings() {
    try {
        const apiKey = ui.apiKeyInput.value.trim();
        // Prevent saving if it's the same as the current state
        if (apiKey === (appState.apiKey || '') &&
            ui.modelSelect.value === appState.model &&
            ui.body.dataset.theme === appState.theme) {
            return;
        }

        const response = await apiRequest('settings', {
            method: 'POST',
            body: JSON.stringify({
                theme: ui.body.dataset.theme,
                model: ui.modelSelect.value,
                apiKey: apiKey,
            })
        });
        updateAppState(response.newState);
        const originalColor = ui.apiKeyInput.style.borderColor;
        ui.apiKeyInput.style.borderColor = '#34c759';
        setTimeout(() => { ui.apiKeyInput.style.borderColor = originalColor; }, 2000);

    } catch (error) {
        alert(`设置保存失败: ${error.message}`);
        const originalColor = ui.apiKeyInput.style.borderColor;
        ui.apiKeyInput.style.borderColor = '#d93025';
        setTimeout(() => { ui.apiKeyInput.style.borderColor = originalColor; }, 2000);
    }
}

async function toggleTheme() {
    ui.body.dataset.theme = ui.body.dataset.theme === 'dark' ? 'light' : 'dark';
    await saveSettings();
}

async function redeemCode() {
    const code = ui.redeemCodeInput.value.trim();
    if (!code) return;
    try {
        const result = await apiRequest('redeem', {
            method: 'POST',
            body: JSON.stringify({ code })
        });
        alert(result.message);
        if (result.success) {
            updateAppState(result.newState);
            ui.redeemCodeInput.value = '';
        }
    } catch (error) {
        alert(`兑换失败: ${error.message}`);
    }
}

// FIX: Complete logic overhaul using UNLIMITED_SENTINEL (-1)
function updateUsageDisplay() { 
    if (appState.apiKey) {
        ui.usageInfo.style.display = 'none';
        ui.unlimitedInfo.style.display = 'block';
        ui.unlimitedInfo.querySelector('p').innerHTML = '✓ 使用您自己的 API Key';

    } else if (appState.trialCount === UNLIMITED_SENTINEL) {
        ui.usageInfo.style.display = 'none';
        ui.unlimitedInfo.style.display = 'block';
        ui.unlimitedInfo.querySelector('p').innerHTML = '✓ 已解锁无限使用权限';
    } else {
        ui.usageInfo.style.display = 'block';
        ui.unlimitedInfo.style.display = 'none';
        ui.usageCount.textContent = `剩余次数: ${appState.trialCount}`; 
    }
}

async function handleConversationAction(action, payload = {}) {
    try {
        const newState = await apiRequest('conversations', { method: 'POST', body: JSON.stringify({ action, ...payload }) });
        updateAppState(newState);
        ui.sidebar.classList.remove('open');
    } catch (error) {
        alert(`操作失败: ${error.message}`);
    }
}

function createNewConversation(askConfirmation = true) {
    const currentConv = appState.conversations[appState.activeConversationId];
    if (askConfirmation && currentConv && currentConv.history.length > 0) {
         if (!confirm('您想保存当前对话到列表，并开始一个新对话吗？')) { return; }
    }
    handleConversationAction('create');
}

function deleteConversation(id, event) {
    event.stopPropagation();
    if (confirm(`确定要删除对话 "${appState.conversations[id].title}" 吗？此操作无法撤销。`)) {
        handleConversationAction('delete', { convId: id });
    }
}

function renameConversation(id, event) {
    event.stopPropagation();
    const currentTitle = appState.conversations[id].title;
    const newTitle = prompt("请输入新的对话标题:", currentTitle);
    if (newTitle && newTitle.trim() !== "") {
        handleConversationAction('rename', { convId: id, newTitle: newTitle.trim() });
    }
}

function setActiveConversation(id) {
    if (appState.activeConversationId === id) return;
    handleConversationAction('switch', { convId: id });
}

function renderConversation() {
    const conversation = appState.conversations[appState.activeConversationId];
    if (!conversation) {
        ui.chatContainer.innerHTML = '';
        ui.headerTitle.textContent = '请选择或创建对话';
        return;
    }
    ui.chatContainer.innerHTML = '';
    conversation.history.forEach(msg => addMessage(msg.role, msg.parts, false));
    ui.headerTitle.textContent = conversation.title;
    ui.chatContainer.scrollTop = ui.chatContainer.scrollHeight;
}

function renderConversationList() {
    const listEl = ui.conversationList;
    listEl.innerHTML = '';
    if (!appState.conversations) return;
    const sortedConversations = Object.values(appState.conversations).sort((a, b) => b.id.split('_')[1] - a.id.split('_')[1]);

    sortedConversations.forEach(conv => {
        const itemEl = document.createElement('div');
        itemEl.className = 'conversation-item';
        if (conv.id === appState.activeConversationId) itemEl.classList.add('active');
        itemEl.innerHTML = `<span class="title">${conv.title}</span><div><button class="icon-btn" title="重命名"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="icon-btn delete-btn" title="删除对话"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></div>`;
        itemEl.querySelector('.icon-btn[title="重命名"]').onclick = (event) => renameConversation(conv.id, event);
        itemEl.querySelector('.icon-btn.delete-btn').onclick = (event) => deleteConversation(conv.id, event);
        itemEl.onclick = () => setActiveConversation(conv.id);
        listEl.appendChild(itemEl);
    });
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            imageData = { mime_type: file.type, data: e.target.result.split(',')[1] };
            ui.previewImg.src = e.target.result;
            ui.imagePreviewContainer.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

function removeImage() {
    imageData = null; ui.imageInput.value = '';
    ui.imagePreviewContainer.style.display = 'none';
}

function addMessage(role, parts, shouldScroll = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    let contentHTML = '';
    const textPart = parts.find(p => p.text);
    if (textPart) contentHTML = marked.parse(textPart.text);
    const imagePart = parts.find(p => p.inline_data);
    if (imagePart) contentHTML += `<img src="data:${imagePart.mime_type};base64,${imagePart.data}" style="max-width:100%; border-radius: 8px;" alt="image">`;
    messageDiv.innerHTML = `<div class="avatar">${role === 'user' ? '你' : 'G'}</div><div class="content">${contentHTML}</div>`;
    ui.chatContainer.appendChild(messageDiv);
    if(shouldScroll) ui.chatContainer.scrollTop = ui.chatContainer.scrollHeight;
    
    if (role === 'model') {
        messageDiv.querySelectorAll('pre').forEach(pre => {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn'; copyBtn.textContent = '复制';
            copyBtn.onclick = () => { navigator.clipboard.writeText(pre.querySelector('code').textContent); copyBtn.textContent = '已复制!'; setTimeout(() => copyBtn.textContent = '复制', 2000); };
            pre.appendChild(copyBtn);
        });
        if (typeof hljs !== 'undefined' && hljs.highlightElement) { messageDiv.querySelectorAll('pre code').forEach(hljs.highlightElement); }
    }
}

async function sendMessage() {
    if (isLoading) return;
    const text = ui.textInput.value.trim();
    if (!text && !imageData) return;

    isLoading = true; ui.sendBtn.disabled = true;
    
    const userParts = [];
    if (imageData) userParts.push({ inline_data: imageData });
    if (text) userParts.push({ text });
    const userMessage = { role: 'user', parts: userParts };

    addMessage(userMessage.role, userMessage.parts);
    
    const currentConversation = appState.conversations[appState.activeConversationId];
    const historyToSend = [...currentConversation.history, userMessage];

    ui.textInput.value = ''; removeImage();
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'message bot';
    thinkingDiv.innerHTML = `<div class="avatar">G</div><div class="content">思考中...</div>`;
    ui.chatContainer.appendChild(thinkingDiv);
    ui.chatContainer.scrollTop = ui.chatContainer.scrollHeight;
    
    try {
        const modelToUse = imageData ? 'gemini-1.5-flash-latest' : appState.model;
        const tools = ui.webSearchToggle.checked ? [{ "google_search_retrieval": {} }] : [];
        
        const responseData = await apiRequest('chat', {
            method: 'POST',
            body: JSON.stringify({ contents: historyToSend, model: modelToUse, tools: tools })
        });
        
        thinkingDiv.remove();

        if (responseData.candidates && responseData.candidates[0].content) {
             const botMessage = responseData.candidates[0].content;
             addMessage(botMessage.role, botMessage.parts);
        } else {
             const feedback = responseData.promptFeedback;
             const reason = feedback ? `原因: ${feedback.blockReason}` : "未知原因或无内容返回。";
             throw new Error(`模型返回了无效的响应。${reason}`);
        }
       
        await loadInitialState();

    } catch (error) {
        thinkingDiv.remove();
        addMessage('model', [{ text: `出错了: ${error.message}` }]);
    } finally {
        isLoading = false; ui.sendBtn.disabled = false;
    }
}

function exportData() {
    const dataStr = JSON.stringify(appState, null, 2);
    const dataBlob = new Blob([dataStr], {type: "application/json"});
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gemini-chat-data-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    alert('数据已导出！');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const importedState = JSON.parse(e.target.result);
            if (confirm('确定要用导入的数据覆盖云端的所有对话和设置吗？此操作不可逆！')) {
                await apiRequest('restore', {
                    method: 'POST',
                    body: JSON.stringify(importedState)
                });
                alert('数据恢复成功！页面即将刷新以应用更改。');
                location.reload();
            }
        } catch (error) {
            alert(`导入失败：${error.message}`);
        }
    };
    reader.readAsText(file);
}

marked.setOptions({ gfm: true, breaks: true });
if (typeof hljs !== 'undefined') { hljs.configure({ ignoreUnescapedHTML: true }); }
