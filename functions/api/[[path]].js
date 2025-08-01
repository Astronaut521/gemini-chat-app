// --- 后端配置 ---
const MAX_TRIAL_COUNT = 3;
const REDEEM_CODES = {
    "GEMINI-FOR-ALL": Infinity,
    'BLUE-GEM-A8C5': 5, 'BLUE-GEM-F2B9': 5, 'BLUE-GEM-7D4E': 5, 'BLUE-GEM-9C1A': 5, 'BLUE-GEM-3E8F': 5,
    'CYAN-ROCK-B6D2': 5, 'CYAN-ROCK-5A9E': 5, 'CYAN-ROCK-E3C7': 5, 'CYAN-ROCK-4F8B': 5, 'CYAN-ROCK-1D6A': 5,
};

// --- 主处理函数 ---
export async function onRequest(context) {
    if (context.request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }
    try {
        const url = new URL(context.request.url);
        // Robust way to get the last part of the path as the endpoint
        const pathParts = url.pathname.split('/');
        const apiEndpoint = pathParts[pathParts.length - 1];
        
        let response = await handleApiRequest(apiEndpoint, context);
        response.headers.set('Access-Control-Allow-Origin', '*');
        return response;
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

async function handleApiRequest(endpoint, context) {
    const { request, env } = context;
    const { userId, responseHeaders } = await getUserIdFromCookie(request);
    let userState = await env.CHAT_DATA.get(userId, { type: 'json' });
    if (!userState) {
        userState = getInitialUserState();
    }
    let response;
    switch (endpoint) {
        case 'state': response = new Response(JSON.stringify(userState), { headers: { 'Content-Type': 'application/json' } }); break;
        case 'chat': response = await handleChat(request, env, userId, userState); break;
        case 'conversations': response = await handleConversations(request, env, userId, userState); break;
        case 'settings': response = await handleSettings(request, env, userId, userState); break;
        case 'redeem': response = await handleRedeem(request, env, userId, userState); break;
        case 'restore': response = await handleRestore(request, env, userId); break;
        default: response = new Response(JSON.stringify({ error: 'API Endpoint Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    for (const [key, value] of Object.entries(responseHeaders)) {
        response.headers.set(key, value);
    }
    return response;
}

// --- API 处理函数 ---
async function handleChat(request, env, userId, userState) {
    if (userState.trialCount !== Infinity && userState.trialCount <= 0) {
        return new Response(JSON.stringify({ error: '您的试用次数已用完！请输入兑换码。' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    const requestBody = await request.json();
    const { contents, model, tools } = requestBody;
    
    // Determine endpoint based on model
    const isGenerativeModel = model.startsWith('imagen') || model.startsWith('veo');
    const endpoint = isGenerativeModel ? 'generate' : 'generateContent';
    const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${env.GEMINI_API_KEY}`;

    const geminiRequest = new Request(targetUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents, generationConfig: { "maxOutputTokens": 8192 },
            safetySettings: [
                { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" }, { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
                { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" }, { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
            ],
            tools: tools || []
        }),
    });
    const geminiResponse = await fetch(geminiRequest);
    if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        return new Response(JSON.stringify({ error: `API 错误: ${geminiResponse.status} - ${errorText}` }), { status: geminiResponse.status, headers: { 'Content-Type': 'application/json' } });
    }
    const responseData = await geminiResponse.json();
    if (userState.trialCount !== Infinity) userState.trialCount--;
    const lastUserMessage = contents[contents.length - 1];
    const activeConvId = userState.activeConversationId;
    if (activeConvId && userState.conversations[activeConvId]) {
        userState.conversations[activeConvId].history.push(lastUserMessage);
        if (responseData.candidates && responseData.candidates[0].content) {
             userState.conversations[activeConvId].history.push(responseData.candidates[0].content);
        }
    }
    await env.CHAT_DATA.put(userId, JSON.stringify(userState));
    return new Response(JSON.stringify(responseData), { headers: { 'Content-Type': 'application/json' }});
}

async function handleConversations(request, env, userId, userState) {
    const { action, convId, newTitle } = await request.json();
    switch (action) {
        case 'create':
            const newId = `conv_${Date.now()}`;
            userState.conversations[newId] = { id: newId, title: `新对话 ${Object.keys(userState.conversations).length + 1}`, history: [] };
            userState.activeConversationId = newId;
            break;
        case 'delete':
            if (userState.conversations[convId]) {
                delete userState.conversations[convId];
                if (userState.activeConversationId === convId) {
                    const remainingIds = Object.keys(userState.conversations).sort((a,b) => b.split('_')[1] - a.split('_')[1]);
                    userState.activeConversationId = remainingIds.length > 0 ? remainingIds[0] : null;
                }
            }
            break;
        case 'rename': if(userState.conversations[convId] && newTitle) { userState.conversations[convId].title = newTitle; } break;
        case 'switch': if (userState.conversations[convId]) { userState.activeConversationId = convId; } break;
    }
    await env.CHAT_DATA.put(userId, JSON.stringify(userState));
    return new Response(JSON.stringify(userState), { headers: { 'Content-Type': 'application/json' } });
}

async function handleSettings(request, env, userId, userState) {
    const settings = await request.json();
    userState.theme = settings.theme || userState.theme;
    userState.model = settings.model || userState.model;
    await env.CHAT_DATA.put(userId, JSON.stringify(userState));
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}

async function handleRedeem(request, env, userId, userState) {
    const { code } = await request.json();
    const upperCaseCode = code.trim().toUpperCase();
    const headers = { 'Content-Type': 'application/json' };
    if (!upperCaseCode) return new Response(JSON.stringify({ success: false, message: '兑换码不能为空。' }), { status: 400, headers });
    if (userState.redeemedCodes.includes(upperCaseCode)) return new Response(JSON.stringify({ success: false, message: '此兑换码已被当前账户使用。' }), { status: 400, headers });
    if (REDEEM_CODES[upperCaseCode]) {
        const amount = REDEEM_CODES[upperCaseCode];
        let message;
        if (amount === Infinity) {
            userState.trialCount = Infinity;
            message = '兑换成功！您已解锁无限使用权限。';
        } else {
            if (userState.trialCount === Infinity) {
                return new Response(JSON.stringify({ success: false, message: '您已是无限权限，无需增加次数。' }), { status: 400, headers });
            }
            userState.trialCount = (Number(userState.trialCount) || 0) + amount;
            message = `兑换成功！已增加 ${amount} 次使用次数。`;
        }
        userState.redeemedCodes.push(upperCaseCode);
        await env.CHAT_DATA.put(userId, JSON.stringify(userState));
        return new Response(JSON.stringify({ success: true, message, newState: userState }), { headers });
    } else {
        return new Response(JSON.stringify({ success: false, message: '无效的兑换码。' }), { status: 400, headers });
    }
}

async function handleRestore(request, env, userId) {
    const importedState = await request.json();
    if (importedState && typeof importedState.conversations === 'object' && typeof importedState.trialCount === 'number') {
        await env.CHAT_DATA.put(userId, JSON.stringify(importedState));
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ success: false, message: '文件格式不正确。'}), { status: 400 });
}

// --- 辅助函数 ---
function getInitialUserState() {
    const initialId = `conv_${Date.now()}`;
    return {
        theme: 'light', model: 'gemini-1.5-flash-latest',
        trialCount: MAX_TRIAL_COUNT, redeemedCodes: [],
        conversations: { [initialId]: { id: initialId, title: "新对话 1", history: [] } },
        activeConversationId: initialId
    };
}

async function getUserIdFromCookie(request) {
    const cookieHeader = request.headers.get('Cookie');
    const cookies = cookieHeader ? cookieHeader.split(';').map(c => c.trim()) : [];
    let userId = cookies.find(c => c.startsWith('userID='))?.split('=')[1];
    const responseHeaders = {};
    if (!userId) {
        userId = crypto.randomUUID();
        responseHeaders['Set-Cookie'] = `userID=${userId}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
    }
    return { userId, responseHeaders };
}
