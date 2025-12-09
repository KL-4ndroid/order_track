// ============================================================
// 1. 初始化與設定 (Configuration)
// ============================================================
const SUPABASE_URL = 'https://lixcurjoarfyjdmvdepr.supabase.co';
// 請確認這組 Key 是正確的 (若有更換請自行填入)
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpeGN1cmpvYXJmeWpkbXZkZXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyMTU5MDgsImV4cCI6MjA4MDc5MTkwOH0.M_2aLW055JSkwoE3LlsyRv6jy1IfYXq-nZ4H1oDKkNA';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 全域變數狀態
let session = null;
let profile = null; // 當前使用者檔案
let brand = null;   // 當前品牌資訊
let teamMembers = []; // 團隊成員列表
let tasks = []; // 任務列表

// 預設資料
const DEFAULT_PLATFORMS = [
    { id: 'ig', label: 'IG', icon: '📸', isDefault: true },
    { id: 'fb', label: 'FB', icon: '📘', isDefault: true },
    { id: 'line', label: 'Line', icon: '💬', isDefault: true }
];
const DEFAULT_TYPES = [
    { id: 'order', label: '訂製', icon: '🛒', isDefault: true, color: '#E3F2FD' },
    { id: 'repair', label: '維修', icon: '🔧', isDefault: true, color: '#FFF3E0' },
    { id: 'market', label: '市集', icon: '👋', isDefault: true, color: '#E8F5E9' }
];
const TAG_COLORS = [
    '#E3F2FD', '#FFF3E0', '#E8F5E9', '#F3E5F5', 
    '#FFEBEE', '#E0F7FA', '#F9FBE7', '#ECEFF1'
];
const statusMap = {
    making: "🔨 製作中", waiting_pay: "💰 待匯款", to_ship: "📦 待寄出",
    waiting_package: "📫 等包裹", repairing: "🔧 維修中", pending: "⏳ 待回覆",
    done: "✅ 已完成", cancel: "❌ 已取消"
};
const COMMON_EMOJIS = ["💍", "💎", "👂", "✨", "🎁", "📦", "📸", "📘", "💬", "📕", "🛒", "🛍️", "✅", "❌", "❓"];

// 動態資料容器
let platforms = [...DEFAULT_PLATFORMS];
let types = [...DEFAULT_TYPES];
let templates = {};

// 篩選與 UI 狀態
let currentFilter = 'all';
let selectedPlatformId = 'ig';
let selectedTypeId = 'order';
let selectedAssigneeId = null;
let editingTaskId = null;
let creatingItemContext = ''; 
let selectedEmoji = '🌐';
let selectedColor = TAG_COLORS[0];

// ============================================================
// 2. 身份驗證與初始化 (Auth & Init)
// ============================================================

async function initApp() {
    // 檢查當前 Session
    const { data } = await sb.auth.getSession();
    session = data.session;
    
    // 處理 Session 狀態
    handleSessionState();

    // 監聽登入/登出變化
    sb.auth.onAuthStateChange((_event, _session) => {
        session = _session;
        handleSessionState();
    });
}

async function handleSessionState() {
    if (session) {
        document.getElementById('auth-overlay').style.display = 'none';
        
        // 嘗試讀取 Profile (確認是否已完成品牌設定)
        const { data: pData, error: pError } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
        
        if (pData) {
            // 正常狀態：已登入且有資料 (Onboarding 已完成)
            profile = pData;
            document.getElementById('onboarding-overlay').style.display = 'none';
            
            // 讀取品牌資訊
            const { data: bData } = await sb.from('brands').select('*').eq('id', profile.brand_id).single();
            brand = bData;
            
            // UI 更新：標題與身份
            document.getElementById('appHeaderTitle').innerText = `📓 ${brand ? brand.name : 'OrderTrack'}`;
            document.getElementById('settingRole').innerText = profile.role === 'owner' ? '品牌負責人' : '團隊夥伴';
            
            // 權限控制：只有老闆能看某些設定
            if(profile.role !== 'owner') {
                document.getElementById('ownerSettings').style.display = 'none';
            } else {
                document.getElementById('ownerSettings').style.display = 'block';
            }

            // 載入應用資料
            await loadSettings();
            await loadTeam();
            await loadTasks();
        } else {
            // 特殊狀態：已登入 (Email 已驗證) 但資料庫無資料 -> 顯示 Onboarding (初始設定)
            document.getElementById('onboarding-overlay').style.display = 'flex';
        }
    } else {
        // 未登入狀態
        document.getElementById('auth-overlay').style.display = 'flex';
        document.getElementById('onboarding-overlay').style.display = 'none';
        tasks = []; profile = null; brand = null;
    }
}

// 切換登入/註冊分頁
function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    if(tab === 'login') {
        document.getElementById('view-login').style.display = 'block';
        document.getElementById('view-register').style.display = 'none';
    } else {
        document.getElementById('view-login').style.display = 'none';
        document.getElementById('view-register').style.display = 'block';
    }
    setAuthMsg('');
}

// 切換登入角色 (老闆/員工)
function toggleLoginMode() {
    const role = document.querySelector('input[name="loginRole"]:checked').value;
    if(role === 'owner') {
        document.getElementById('login-owner-fields').style.display = 'block';
        document.getElementById('login-staff-fields').style.display = 'none';
    } else {
        document.getElementById('login-owner-fields').style.display = 'none';
        document.getElementById('login-staff-fields').style.display = 'block';
    }
}

function setAuthMsg(msg, type = 'error') {
    const el = document.getElementById('auth-msg');
    el.innerText = msg;
    el.className = 'auth-message ' + (type === 'success' ? 'msg-success' : 'msg-error');
}

// 產生員工虛擬 Email
function getVirtualEmail(teamCode, username) {
    return `${username}@${teamCode}.ordertrack.local`.toLowerCase();
}

// --- 登入處理 ---
async function handleLogin() {
    const role = document.querySelector('input[name="loginRole"]:checked').value;
    let email, password;

    if(role === 'owner') {
        email = document.getElementById('loginEmail').value.trim();
        password = document.getElementById('loginPassword').value.trim();
    } else {
        const teamCode = document.getElementById('loginTeamCode').value.trim();
        const username = document.getElementById('loginUsername').value.trim();
        password = document.getElementById('loginPassword').value.trim();
        if(!teamCode || !username) return setAuthMsg('請輸入團隊代號與帳號');
        email = getVirtualEmail(teamCode, username);
    }

    if(!email || !password) return setAuthMsg('請輸入完整資訊');
    
    showLoading(true, '登入中...');
    const { error } = await sb.auth.signInWithPassword({ email, password });
    showLoading(false);
    
    if (error) {
        if(error.message.includes('Email not confirmed')) {
            setAuthMsg('Email 尚未驗證，請至信箱收取驗證信。');
        } else {
            setAuthMsg('登入失敗，請檢查資訊是否正確。');
        }
    }
}

// --- 註冊處理 (v11.0: 僅建立 Auth) ---
async function handleRegister() {
    const inviteCode = document.getElementById('regInviteCode').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value.trim();

    if(!inviteCode || !email || !password) return setAuthMsg('所有欄位皆為必填');
    if(password.length < 6) return setAuthMsg('密碼至少6位');

    showLoading(true, '檢查邀請碼...');
    // 1. 檢查邀請碼有效性 (RPC)
    const { data: isValid, error: rpcError } = await sb.rpc('check_invite_code', { code_input: inviteCode });
    
    if(rpcError || !isValid) {
        showLoading(false);
        return setAuthMsg('邀請碼無效或已被使用');
    }

    // 2. 註冊 (等待 Email 驗證)
    showLoading(true, '註冊中...');
    const { error: authError } = await sb.auth.signUp({ email, password });
    
    showLoading(false);
    if(authError) {
        return setAuthMsg(authError.message);
    } else {
        // 切換 UI 提示去收信
        setAuthMsg('註冊成功！請前往信箱點擊驗證連結，驗證後即可登入設定品牌。', 'success');
        document.getElementById('regPassword').value = '';
    }
}

// --- 初始設定處理 (v11.0: 建立品牌資料) ---
async function handleOnboarding() {
    const brandName = document.getElementById('setupBrandName').value.trim();
    const teamCode = document.getElementById('setupTeamCode').value.trim();
    const inviteCode = document.getElementById('setupInviteCode').value.trim();

    if(!brandName || !teamCode || !inviteCode) return alert('所有欄位皆為必填');

    showLoading(true, '建立品牌中...');

    // 1. 再次檢查邀請碼 (避免被其他人用掉)
    const { data: isValid, error: rpcError } = await sb.rpc('check_invite_code', { code_input: inviteCode });
    if(!isValid) {
        showLoading(false);
        return alert('邀請碼無效或已被使用');
    }

    // 2. 建立 Brand
    const userId = session.user.id;
    const { data: brandData, error: brandError } = await sb.from('brands').insert([{
        name: brandName, team_code: teamCode, owner_id: userId
    }]).select().single();

    if(brandError) {
        showLoading(false);
        if(brandError.code === '23505') return alert('團隊代號已被使用，請換一個');
        return alert('品牌建立失敗: ' + brandError.message);
    }

    // 3. 建立 Profile (Owner)
    const { error: profError } = await sb.from('profiles').insert([{
        id: userId, brand_id: brandData.id, role: 'owner', username: 'Admin',
        permissions: { view_stats: true, manage_tags: true, delete_task: true }
    }]);

    if(profError) {
        showLoading(false);
        return alert('設定檔建立失敗: ' + profError.message);
    }

    // 4. 初始化設定
    const templates = {
        making: "親愛的，您的飾品正在製作中囉，請耐心等候 ❤️",
        waiting_pay: "匯款帳號：(822) 1234-5678，金額 $___，匯款後請通知我喔！",
        to_ship: "您的商品已包裝完成，將於明天為您寄出！📦",
        done: "親愛的，您的飾品已經完成囉！這裡是成品照片 ✨",
        cancel: "好的，已為您取消訂單。"
    };
    const config = { platforms: DEFAULT_PLATFORMS, types: DEFAULT_TYPES };
    await sb.from('user_settings').insert([{ user_id: userId, config, templates }]);

    // 5. 消耗邀請碼
    await sb.rpc('consume_invite_code', { code_input: inviteCode });

    showLoading(false);
    // 重整頁面進入系統
    window.location.reload();
}

async function signOut() { if(confirm('確定要登出嗎？')) await sb.auth.signOut(); }

// ============================================================
// 3. 團隊與權限管理 (Team Management)
// ============================================================

async function loadTeam() {
    const { data } = await sb.from('profiles').select('id, username, role').eq('brand_id', profile.brand_id);
    if(data) {
        teamMembers = data;
        renderStaffList();
    }
}

function renderStaffList() {
    const container = document.getElementById('staffList');
    let html = '';
    teamMembers.forEach(m => {
        const isOwner = m.role === 'owner';
        html += `
            <div class="custom-item-row">
                <span>${isOwner ? '👑' : '👤'} ${m.username}</span>
                ${!isOwner ? `<button class="custom-item-btn" onclick="removeStaff('${m.id}')">移除</button>` : ''}
            </div>
        `;
    });
    container.innerHTML = html;
    document.getElementById('staffCountBadge').innerText = `${teamMembers.length}/3`; 
}

async function removeStaff(id) {
    if(!confirm('確定要移除此員工？')) return;
    showLoading(true);
    // 這裡我們只刪除 profile，因為後端沒有設定自動刪除 auth user 的 edge function
    // 刪除 profile 後，該員工就會失去所有權限 (RLS 會擋下)
    await sb.from('profiles').delete().eq('id', id);
    await loadTeam();
    showLoading(false);
}

function openStaffModal() {
    if(teamMembers.length >= 3) return alert('目前方案限制最多 3 位成員 (含老闆)');
    document.getElementById('staffUsername').value = '';
    document.getElementById('staffPassword').value = '';
    document.getElementById('staffModal').style.display = 'flex';
}

async function saveStaff() {
    const username = document.getElementById('staffUsername').value.trim();
    const password = document.getElementById('staffPassword').value.trim();
    
    if(!username || !password) return alert('請輸入帳號密碼');
    
    // 建立員工虛擬 Email
    const email = getVirtualEmail(brand.team_code, username);
    
    showLoading(true, '建立員工帳號...');

    // 使用臨時 Client 建立，避免登出目前使用者
    const tempClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false } 
    });

    const { data: newData, error: newError } = await tempClient.auth.signUp({ email, password });

    if(newError) {
        showLoading(false);
        return alert('建立失敗: ' + newError.message);
    }

    if(newData.user) {
        // Create Profile for new user
        const perms = {
            view_stats: document.getElementById('permStats').checked,
            manage_tags: document.getElementById('permTags').checked,
            delete_task: document.getElementById('permDelete').checked
        };

        const { error: profError } = await sb.from('profiles').insert([{
            id: newData.user.id,
            brand_id: brand.id,
            role: 'staff',
            username: username,
            permissions: perms
        }]);

        if(!profError) {
            alert('員工帳號建立成功！\n登入代號: ' + brand.team_code + '\n帳號: ' + username);
            closeModal('staffModal');
            loadTeam(); 
        } else {
            alert('Profile 建立失敗');
        }
    }
    showLoading(false);
}

// ============================================================
// 4. 任務管理 (Task CRUD)
// ============================================================

async function loadTasks() {
    showLoading(true, '載入任務...');
    const { data, error } = await sb.from('tasks').select('*').order('timestamp', { ascending: false });
    if (!error && data) {
        tasks = data;
        renderTasks();
    }
    showLoading(false);
}

// 圖片壓縮邏輯
function compressImage(file) {
    return new Promise((resolve, reject) => {
        if (file.size > 10 * 1024 * 1024) { 
            alert('圖片過大 (超過10MB)，請選擇較小的圖片');
            return reject('File too large');
        }
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                const MAX_HEIGHT = 800;
                let width = img.width;
                let height = img.height;
                if (width > height) {
                    if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                } else {
                    if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => { resolve(blob); }, 'image/webp', 0.7); 
            };
        };
        reader.onerror = error => reject(error);
    });
}

async function saveTask() {
    const ig = document.getElementById('inputIg').value;
    const note = document.getElementById('inputNote').value;
    const price = document.getElementById('inputPrice').value || 0; 
    const fileInput = document.getElementById('fileInput');
    const timeVal = document.getElementById('inputTime').value;
    
    if (!ig || !timeVal) return alert('請填寫完整資訊');
    
    showLoading(true, '處理中...');
    const timestamp = new Date(timeVal).getTime();
    let img_url = null;

    // 上傳圖片
    if (fileInput.files.length > 0) {
        try {
            const compressedBlob = await compressImage(fileInput.files[0]);
            const fileName = `${Date.now()}.webp`;
            // 存到 brand ID 資料夾下，避免不同品牌檔名衝突
            const filePath = `${brand.id}/${fileName}`; 
            
            const { error: uploadError } = await sb.storage.from('jewel-images').upload(filePath, compressedBlob);
            
            if (!uploadError) {
                const { data } = sb.storage.from('jewel-images').getPublicUrl(filePath);
                img_url = data.publicUrl;
            }
        } catch (e) { showLoading(false); return; }
    } else if (editingTaskId) {
        const oldTask = tasks.find(t => t.id === editingTaskId);
        img_url = oldTask.img_url;
    }

    // 指派人員 (預設自己)
    const assignee = selectedAssigneeId || session.user.id;

    const taskData = {
        brand_id: brand.id,
        created_by: session.user.id,
        assigned_to: assignee,
        platform: selectedPlatformId,
        type: selectedTypeId,
        ig, note, timestamp, img_url,
        price: price,
        status: editingTaskId ? tasks.find(t=>t.id===editingTaskId).status : (selectedTypeId==='order'?'waiting_pay':'pending')
    };

    if (editingTaskId) {
        // 更新
        const { error } = await sb.from('tasks').update(taskData).eq('id', editingTaskId);
        if (!error) await loadTasks();
    } else {
        // 新增
        const { error } = await sb.from('tasks').insert([taskData]);
        if (!error) await loadTasks();
    }
    
    showLoading(false);
    closeModal('taskModal');
}

async function deleteTask() {
    if (!editingTaskId) return;
    // 權限檢查
    if (profile.role !== 'owner' && !profile.permissions.delete_task) return alert('權限不足，無法刪除任務');
    
    if (!confirm('確定要刪除這個任務嗎？此動作無法復原。')) return;
    
    showLoading(true);
    const { error } = await sb.from('tasks').delete().eq('id', editingTaskId);
    if (!error) { await loadTasks(); closeModal('taskModal'); } 
    else { alert('刪除失敗'); }
    showLoading(false);
}

async function updateStatus(id, newStatus) {
    // 樂觀更新 (先改畫面再送請求)
    const tIndex = tasks.findIndex(x => x.id === id);
    if(tIndex > -1) {
        tasks[tIndex].status = newStatus;
        renderTasks();
    }
    await sb.from('tasks').update({ status: newStatus }).eq('id', id);
}

// ============================================================
// 5. 設定、統計與 UI 渲染
// ============================================================

async function loadSettings() {
    // 讀取老闆(品牌)的設定
    const { data, error } = await sb.from('user_settings').select('*').eq('user_id', brand.owner_id).single();
    if (data) {
        if (data.config) {
            platforms = data.config.platforms || [...DEFAULT_PLATFORMS];
            let loadedTypes = data.config.types || [...DEFAULT_TYPES];
            // 補上顏色 (相容舊資料)
            types = loadedTypes.map(t => {
                if(t.id === 'order' && !t.color) return { ...t, color: '#E3F2FD' };
                if(t.id === 'repair' && !t.color) return { ...t, color: '#FFF3E0' };
                if(t.id === 'market' && !t.color) return { ...t, color: '#E8F5E9' };
                return t;
            });
        }
        if (data.templates) {
            templates = data.templates;
        }
    }
    renderTopFilters();
}

async function saveSettingsDB() {
    if(profile.role !== 'owner') return alert('只有負責人可修改設定');
    const config = { platforms, types };
    await sb.from('user_settings').upsert({ user_id: session.user.id, config, templates });
}

// 統計報表
function openStats() {
    if(profile.role !== 'owner' && !profile.permissions.view_stats) return alert('權限不足，無法查看報表');
    
    const date = new Date();
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    
    const toDateStr = (d) => {
        const offset = d.getTimezoneOffset() * 60000;
        return new Date(d - offset).toISOString().split('T')[0];
    };

    document.getElementById('statsStart').value = toDateStr(firstDay);
    document.getElementById('statsEnd').value = toDateStr(lastDay);

    const sel = document.getElementById('statsTypeSelect');
    sel.innerHTML = '<option value="all">全部類型</option>';
    types.forEach(t => {
        sel.innerHTML += `<option value="${t.id}">${t.label}</option>`;
    });

    calculateStats();
    document.getElementById('statsModal').style.display = 'flex';
}

function calculateStats() {
    const startStr = document.getElementById('statsStart').value;
    const endStr = document.getElementById('statsEnd').value;
    const typeId = document.getElementById('statsTypeSelect').value;

    if(!startStr || !endStr) return;

    const startTs = new Date(startStr).getTime();
    const endTs = new Date(endStr).getTime() + (24 * 60 * 60 * 1000) - 1;

    let totalIncome = 0;
    let count = 0;

    tasks.forEach(t => {
        if (t.status === 'cancel') return;
        if (t.timestamp < startTs || t.timestamp > endTs) return;
        if (typeId !== 'all' && t.type !== typeId) return;

        totalIncome += parseInt(t.price || 0);
        count++;
    });

    document.getElementById('statIncome').innerText = '$' + totalIncome.toLocaleString();
    document.getElementById('statCount').innerText = count;
}

// 核心渲染邏輯
function renderTasks() {
    const container = document.getElementById('cardContainer');
    const searchVal = document.getElementById('searchInput').value.toLowerCase();
    const showCompleted = document.getElementById('showCompleted').checked;
    const sortOrder = document.getElementById('sortOrder').value;
    const timeFilter = document.getElementById('timeFilter').value;

    container.innerHTML = '';

    let filtered = tasks.filter(t => {
        if (currentFilter !== 'all' && t.type !== currentFilter) return false;
        if (!t.ig.toLowerCase().includes(searchVal) && !t.note.toLowerCase().includes(searchVal)) return false;
        if (!showCompleted && (t.status === 'done' || t.status === 'cancel')) return false;
        
        if (timeFilter !== 'all') {
            const tDate = new Date(t.timestamp);
            const today = new Date();
            const diffTime = today - tDate;
            const diffDays = diffTime / (1000 * 60 * 60 * 24);
            if (timeFilter === 'today') {
                if (tDate.getDate() !== today.getDate() || tDate.getMonth() !== today.getMonth()) return false;
            } else if (timeFilter === 'week') {
                if (diffDays > 7) return false;
            } else if (timeFilter === 'month') {
                if (tDate.getMonth() !== today.getMonth()) return false;
            }
        }
        return true;
    });

    filtered.sort((a, b) => {
        if (sortOrder === 'newest') return b.timestamp - a.timestamp;
        return a.timestamp - b.timestamp;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state"><span class="empty-icon">📭</span><br>目前沒有任務<br>點擊右下角 + 新增</div>`;
        return;
    }

    filtered.forEach(t => {
        const isOverdue = (t.status !== 'done' && t.status !== 'cancel' && (Date.now() - t.timestamp > 3*24*60*60*1000));
        const platformObj = platforms.find(p => p.id === t.platform) || { icon: '❓', label: '未知' };
        const typeObj = types.find(x => x.id === t.type) || { icon: '❓', label: '未知', color: '#EEE' };
        const timeStr = formatTime(t.timestamp);
        
        const imgHtml = t.img_url 
            ? `<img src="${t.img_url}" class="card-img" onclick="openLightbox('${t.img_url}')">` 
            : `<div class="card-no-img">📷</div>`;
        
        const priceHtml = (t.price && t.price > 0) ? `<span class="price-text">$${t.price}</span>` : `<span></span>`;
        
        // 查找指派人員名稱
        const assignee = teamMembers.find(m => m.id === t.assigned_to);
        const assigneeName = assignee ? assignee.username : '未知';

        let opts = '';
        for(let k in statusMap) opts += `<option value="${k}" ${t.status===k?'selected':''}>${statusMap[k]}</option>`;

        const div = document.createElement('div');
        div.className = `card ${isOverdue?'overdue':''} ${t.status==='cancel'?'cancel':''}`;
        
        const tagColor = typeObj.color || '#EEE';

        div.innerHTML = `
            ${isOverdue ? '<div class="overdue-badge">⚠️ 逾期</div>' : ''}
            
            <div class="card-left-col">
                <span class="type-tag" style="background-color: ${tagColor}">${typeObj.label}</span>
                <div class="card-img-box">${imgHtml}</div>
            </div>

            <div class="card-content">
                <div class="user-id-row">
                    <span class="platform-icon">${platformObj.icon}</span>
                    <span class="ig-link" onclick="copyText('${t.ig}')">${t.ig}</span>
                    <span class="assignee-badge">👤 ${assigneeName}</span>
                </div>
                
                <div class="meta-row">
                    ${priceHtml}
                    <div class="time-display" onclick="openModal(${t.id})">🕒 ${timeStr}</div>
                </div>

                <div class="note">${t.note}</div>
                
                <div class="action-row">
                    <select class="status-select" onchange="updateStatus(${t.id}, this.value)">${opts}</select>
                    <button class="btn-action btn-edit" onclick="openModal(${t.id})">✎</button>
                    <button class="btn-action" onclick="copyTemplate('${t.status}')">📋</button>
                </div>
            </div>
        `;
        container.appendChild(div);
    });
}

// ----------------------------------------
// Helpers & Modal UI
// ----------------------------------------

function renderAssigneeSelect(currentId) {
    const container = document.getElementById('assigneeSelector');
    let html = '';
    teamMembers.forEach(m => {
        const active = (m.id === currentId) ? 'active' : '';
        html += `
            <div class="selector-option ${active}" onclick="setAssignee('${m.id}')" id="assign-${m.id}">
                <span class="opt-icon">👤</span>
                <span class="opt-text">${m.username}</span>
            </div>
        `;
    });
    container.innerHTML = html;
}
function setAssignee(id) {
    selectedAssigneeId = id;
    document.querySelectorAll('#assigneeSelector .selector-option').forEach(el => el.classList.remove('active'));
    document.getElementById(`assign-${id}`).classList.add('active');
}

function openModal(editId = null) {
    editingTaskId = editId;
    const modal = document.getElementById('taskModal');
    document.getElementById('fileInput').value = '';
    const btnDelete = document.getElementById('btnDeleteTask');

    if (editId) {
        const t = tasks.find(x => x.id === editId);
        document.getElementById('modalTitle').innerText = "編輯任務";
        document.getElementById('modalSubmitBtn').innerText = "保存";
        document.getElementById('inputIg').value = t.ig;
        document.getElementById('inputNote').value = t.note;
        document.getElementById('inputPrice').value = t.price || ''; 
        
        const localDate = new Date(t.timestamp - (new Date().getTimezoneOffset()*60000));
        document.getElementById('inputTime').value = localDate.toISOString().slice(0,16);
        selectedPlatformId = t.platform;
        selectedTypeId = t.type;
        selectedAssigneeId = t.assigned_to;
        const p = document.getElementById('previewImage');
        if(t.img_url) { p.src=t.img_url; p.style.display='block'; } else { p.style.display='none'; }
        btnDelete.style.display = 'block';
    } else {
        document.getElementById('modalTitle').innerText = "新增任務";
        document.getElementById('modalSubmitBtn').innerText = "建立";
        document.getElementById('inputIg').value = '';
        document.getElementById('inputNote').value = '';
        document.getElementById('inputPrice').value = ''; 
        
        const now = new Date(Date.now() - (new Date().getTimezoneOffset()*60000));
        document.getElementById('inputTime').value = now.toISOString().slice(0,16);
        document.getElementById('previewImage').style.display='none';
        selectedPlatformId = platforms[0].id;
        selectedTypeId = types[0].id;
        selectedAssigneeId = session.user.id;
        btnDelete.style.display = 'none';
    }
    renderSelectors('platformSelectorContainer', platforms, selectedPlatformId, 'setPlatform', 'platform');
    renderSelectors('typeSelectorContainer', types, selectedTypeId, 'setType', 'type');
    renderAssigneeSelect(selectedAssigneeId);
    modal.style.display = 'flex';
}

function renderSelectors(cid, items, activeId, fnName, context) {
    const c = document.getElementById(cid); let h='';
    items.forEach(i => h += `<div class="selector-option ${i.id===activeId?'active':''}" onclick="${fnName}('${i.id}')"><span class="opt-icon">${i.icon}</span><span class="opt-text">${i.label}</span></div>`);
    h += `<div class="selector-option add-new" onclick="openCustomItemModal('${context}')"><span class="opt-icon">➕</span><span class="opt-text">新增</span></div>`;
    c.innerHTML = h;
}
function setPlatform(id) { selectedPlatformId=id; renderSelectors('platformSelectorContainer', platforms, id, 'setPlatform', 'platform'); }
function setType(id) { selectedTypeId=id; renderSelectors('typeSelectorContainer', types, id, 'setType', 'type'); }

function openCustomItemModal(ctx) { 
    creatingItemContext = ctx; 
    document.getElementById('customName').value=''; 
    updateEmojiPreview('🌐'); 
    renderEmojiGrid(); 
    
    const colorSection = document.getElementById('colorPickerSection');
    if (ctx === 'type') {
        colorSection.style.display = 'block';
        renderColorGrid();
        selectColor(TAG_COLORS[0]); 
    } else {
        colorSection.style.display = 'none';
    }
    
    document.getElementById('customItemModal').style.display='flex'; 
}
function renderEmojiGrid() { let h=''; COMMON_EMOJIS.forEach(e=>h+=`<div class="emoji-btn" onclick="updateEmojiPreview('${e}')">${e}</div>`); document.getElementById('emojiGrid').innerHTML=h; }
function updateEmojiPreview(e) { selectedEmoji=e; document.getElementById('emojiPreviewDisplay').innerText=e; }
function renderColorGrid() { let h=''; TAG_COLORS.forEach(c=>h+=`<div class="color-btn" style="background-color:${c}" onclick="selectColor('${c}')" id="color-${c}"></div>`); document.getElementById('colorGrid').innerHTML=h; }
function selectColor(c) { selectedColor=c; document.querySelectorAll('.color-btn').forEach(b=>b.classList.remove('selected')); document.getElementById(`color-${c}`).classList.add('selected'); }

async function saveCustomItem() {
    const label=document.getElementById('customName').value; if(!label) return;
    const newId='custom_'+Date.now(); 
    const item={id:newId, label, icon:selectedEmoji, isDefault:false};
    if(creatingItemContext === 'type') item.color = selectedColor;

    showLoading(true);
    if(creatingItemContext==='platform') { platforms.push(item); await saveSettingsDB(); setPlatform(newId); }
    else { types.push(item); await saveSettingsDB(); setType(newId); renderTopFilters(); }
    showLoading(false); closeModal('customItemModal');
}

// Settings Toggle
function toggleSection(id, header) {
    const body = document.getElementById(id);
    const chevron = header.querySelector('.chevron');
    if (body.style.display === 'none' || body.style.display === '') {
        body.style.display = 'block';
        chevron.classList.add('rotate');
    } else {
        body.style.display = 'none';
        chevron.classList.remove('rotate');
    }
}

function openSettings() {
    if(profile.role !== 'owner') { 
        document.getElementById('ownerSettings').style.display = 'none';
        document.getElementById('settingsModal').style.display='flex';
        return; 
    }
    const list=document.getElementById('templatesList'); list.innerHTML='';
    ['waiting_pay','to_ship','making','repairing','done','cancel'].forEach(k => {
        list.innerHTML += `<div class="template-item"><div class="template-desc">${statusMap[k]}</div><input class="template-input" value="${templates[k]||''}" onchange="saveTemplate('${k}',this.value)"></div>`;
    });
    renderCustomList('customPlatformsList', platforms, 'deletePlatform');
    renderCustomList('customTypesList', types, 'deleteType');
    renderStaffList(); 
    document.getElementById('settingsModal').style.display='flex';
}

async function saveTemplate(k,v) { templates[k]=v; await saveSettingsDB(); }
function renderCustomList(cid, items, fnName) {
    const c=document.getElementById(cid); let h='';
    items.filter(i=>!i.isDefault).forEach(i => h+=`<div class="custom-item-row"><span>${i.icon} ${i.label}</span><button class="custom-item-btn" onclick="${fnName}('${i.id}')">刪除</button></div>`);
    c.innerHTML=h||'<div style="color:#ccc;font-size:12px;padding:8px;">無自定義項目</div>';
}
async function deletePlatform(id) { if(confirm('刪除?')) { platforms=platforms.filter(p=>p.id!==id); await saveSettingsDB(); openSettings(); renderTasks(); } }
async function deleteType(id) { if(confirm('刪除?')) { types=types.filter(t=>t.id!==id); await saveSettingsDB(); renderTopFilters(); openSettings(); renderTasks(); } }

function renderTopFilters() {
    const c=document.getElementById('topFilterContainer');
    let h=`<button class="filter-btn ${currentFilter==='all'?'active':''}" onclick="setFilter('all')">全部</button>`;
    types.forEach(t=>h+=`<button class="filter-btn ${currentFilter===t.id?'active':''}" onclick="setFilter('${t.id}')">${t.label}</button>`);
    c.innerHTML=h;
}
function setFilter(t) { currentFilter=t; renderTopFilters(); renderTasks(); }
function formatTime(ts) {
    const d=new Date(ts);
    return `${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}
function copyTemplate(s) { copyText(templates[s]||'無文案'); }
function copyText(txt) { navigator.clipboard.writeText(txt); showToast('已複製'); }
function showToast(msg) { const t=document.getElementById('toast'); t.innerText=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2000); }
function showLoading(show, text='處理中...') { const el = document.getElementById('loading'); if(show) { el.querySelector('.loading-text').innerText=text; el.style.display='flex'; } else el.style.display='none'; }
function openLightbox(url) { document.getElementById('lightboxImg').src = url; document.getElementById('lightbox').style.display = 'flex'; }
function closeLightbox() { document.getElementById('lightbox').style.display = 'none'; }
function previewFile() { const p=document.getElementById('previewImage'); const f=document.getElementById('fileInput').files[0]; const r=new FileReader(); r.onload=e=>{ p.src=e.target.result; p.style.display='block'; }; if(f) r.readAsDataURL(f); }
function closeModal(id) { document.getElementById(id).style.display='none'; }
document.querySelectorAll('.modal-overlay').forEach(e => e.addEventListener('click', ev => { if(ev.target===e) e.style.display='none'; }));

// Start
initApp();

// PWA Logic (Optional)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.log('PWA Failed', err));
    });
}
