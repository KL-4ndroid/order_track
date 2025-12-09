// 1. Config
const SUPABASE_URL = 'https://lixcurjoarfyjdmvdepr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpeGN1cmpvYXJmeWpkbXZkZXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyMTU5MDgsImV4cCI6MjA4MDc5MTkwOH0.M_2aLW055JSkwoE3LlsyRv6jy1IfYXq-nZ4H1oDKkNA';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// State
let session = null;
let profile = null; // Current user profile
let brand = null;   // Current brand info
let teamMembers = []; // List of staff
let tasks = [];

// Defaults
const DEFAULT_PLATFORMS = [{ id: 'ig', label: 'IG', icon: '📸', isDefault: true }, { id: 'fb', label: 'FB', icon: '📘', isDefault: true }, { id: 'line', label: 'Line', icon: '💬', isDefault: true }];
const DEFAULT_TYPES = [
    { id: 'order', label: '訂製', icon: '🛒', isDefault: true, color: '#E3F2FD' },
    { id: 'repair', label: '維修', icon: '🔧', isDefault: true, color: '#FFF3E0' },
    { id: 'market', label: '市集', icon: '👋', isDefault: true, color: '#E8F5E9' }
];
const TAG_COLORS = ['#E3F2FD', '#FFF3E0', '#E8F5E9', '#F3E5F5', '#FFEBEE', '#E0F7FA', '#F9FBE7', '#ECEFF1'];
const statusMap = { making: "🔨 製作中", waiting_pay: "💰 待匯款", to_ship: "📦 待寄出", waiting_package: "📫 等包裹", repairing: "🔧 維修中", pending: "⏳ 待回覆", done: "✅ 已完成", cancel: "❌ 已取消" };
const COMMON_EMOJIS = ["💍", "💎", "👂", "✨", "🎁", "📦", "📸", "📘", "💬", "📕", "🛒", "🛍️", "✅", "❌", "❓"];

let platforms = [...DEFAULT_PLATFORMS];
let types = [...DEFAULT_TYPES];
let templates = {};

let currentFilter = 'all';
let selectedPlatformId = 'ig';
let selectedTypeId = 'order';
let selectedAssigneeId = null;
let editingTaskId = null;
let creatingItemContext = ''; 
let selectedEmoji = '🌐';
let selectedColor = TAG_COLORS[0];

// 2. Init & Auth
async function initApp() {
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (session) {
        await loadProfile();
        if(profile) {
            document.getElementById('auth-overlay').style.display = 'none';
            await loadSettings();
            await loadTeam();
            await loadTasks();
        } else {
            // Logged in but no profile (rare error state or mid-creation)
            sb.auth.signOut();
        }
    } else {
        document.getElementById('auth-overlay').style.display = 'flex';
    }

    sb.auth.onAuthStateChange((_event, _session) => {
        session = _session;
        if (!session) {
            document.getElementById('auth-overlay').style.display = 'flex';
            tasks = []; profile = null; brand = null;
        } else if (!profile) {
            // Reload if session exists but profile not loaded yet
            initApp();
        }
    });
}

// 2.1 Load User Profile & Brand
async function loadProfile() {
    // Fetch profile
    const { data: pData, error: pError } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
    if(pError || !pData) return;
    profile = pData;

    // Fetch brand
    const { data: bData } = await sb.from('brands').select('*').eq('id', profile.brand_id).single();
    brand = bData;

    // Update UI
    document.getElementById('appHeaderTitle').innerText = `📓 ${brand ? brand.name : 'OrderTrack'}`;
    document.getElementById('settingRole').innerText = profile.role === 'owner' ? '品牌負責人' : '團隊夥伴';
    
    // Permission check for settings
    if(profile.role !== 'owner') {
        document.getElementById('ownerSettings').style.display = 'none';
    } else {
        document.getElementById('ownerSettings').style.display = 'block';
    }
}

async function loadTeam() {
    const { data } = await sb.from('profiles').select('id, username, role').eq('brand_id', profile.brand_id);
    if(data) {
        teamMembers = data;
        renderStaffList();
    }
}

// 2.2 Auth Actions
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

function setAuthMsg(msg, type = 'error') {
    const el = document.getElementById('auth-msg');
    el.innerText = msg;
    el.className = 'auth-message ' + (type === 'success' ? 'msg-success' : 'msg-error');
}

// Generate Virtual Email for Staff
function getVirtualEmail(teamCode, username) {
    return `${username}@${teamCode}.ordertrack.local`.toLowerCase();
}

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
    if (error) setAuthMsg('登入失敗，請檢查資訊是否正確');
}

async function handleRegister() {
    const brandName = document.getElementById('regBrandName').value.trim();
    const teamCode = document.getElementById('regTeamCode').value.trim();
    const inviteCode = document.getElementById('regInviteCode').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value.trim();

    if(!brandName || !teamCode || !inviteCode || !email || !password) return setAuthMsg('所有欄位皆為必填');
    if(password.length < 6) return setAuthMsg('密碼至少6位');

    showLoading(true, '驗證與創建中...');

    // 1. Validate Invite Code (Using RPC)
    const { data: isValid, error: rpcError } = await sb.rpc('validate_invite_code', { code_input: inviteCode });
    
    if(rpcError || !isValid) {
        showLoading(false);
        return setAuthMsg('邀請碼無效或已被使用');
    }

    // 2. Create Auth User
    const { data: authData, error: authError } = await sb.auth.signUp({ email, password });
    if(authError) {
        showLoading(false);
        return setAuthMsg(authError.message);
    }

    const userId = authData.user.id;

    // 3. Create Brand
    const { data: brandData, error: brandError } = await sb.from('brands').insert([{
        name: brandName,
        team_code: teamCode,
        owner_id: userId
    }]).select().single();

    if(brandError) {
        showLoading(false);
        return setAuthMsg('團隊代號重複或創建失敗');
    }

    // 4. Create Owner Profile
    const { error: profileError } = await sb.from('profiles').insert([{
        id: userId,
        brand_id: brandData.id,
        role: 'owner',
        username: 'Admin', // Default name
        permissions: { view_stats: true, manage_tags: true, delete_task: true }
    }]);

    // 5. Init Default Settings
    const templates = {
        making: "親愛的，您的飾品正在製作中囉，請耐心等候 ❤️",
        waiting_pay: "匯款帳號：(822) 1234-5678，金額 $___，匯款後請通知我喔！",
        to_ship: "您的商品已包裝完成，將於明天為您寄出！📦",
        done: "親愛的，您的飾品已經完成囉！這裡是成品照片 ✨",
        cancel: "好的，已為您取消訂單。"
    };
    const config = { platforms: DEFAULT_PLATFORMS, types: DEFAULT_TYPES };
    await sb.from('user_settings').insert([{ user_id: userId, config, templates }]);

    showLoading(false);
    setAuthMsg('註冊成功！系統將自動登入...', 'success');
    
    // Auto login check handled by onAuthStateChange
}

async function signOut() { if(confirm('確定要登出嗎？')) await sb.auth.signOut(); }

// 3. Staff Management (Create User)
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
    
    // Construct virtual email
    const email = getVirtualEmail(brand.team_code, username);
    
    showLoading(true, '建立員工帳號...');

    // Use a secondary client to create user without logging out current session
    // Hack: Supabase client-side creation usually requires session switch. 
    // We use a temp client with no persistence to perform the signup action.
    const tempClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false } // Don't save this session
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
            loadTeam(); // Refresh list
        } else {
            alert('Profile 建立失敗');
        }
    }
    showLoading(false);
}

// 4. Tasks Logic
async function loadTasks() {
    showLoading(true, '載入任務...');
    const { data, error } = await sb.from('tasks').select('*').order('timestamp', { ascending: false });
    if (!error && data) {
        tasks = data;
        renderTasks();
    }
    showLoading(false);
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

    if (fileInput.files.length > 0) {
        try {
            const compressedBlob = await compressImage(fileInput.files[0]);
            const fileName = `${Date.now()}.webp`;
            const filePath = `${brand.id}/${fileName}`; // Use brand ID folder
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

    // Default assignee is current user if not selected
    const assignee = selectedAssigneeId || session.user.id;

    const taskData = {
        brand_id: brand.id, // Linked to brand
        created_by: session.user.id,
        assigned_to: assignee,
        platform: selectedPlatformId,
        type: selectedTypeId,
        ig, note, timestamp, img_url,
        price: price,
        status: editingTaskId ? tasks.find(t=>t.id===editingTaskId).status : (selectedTypeId==='order'?'waiting_pay':'pending')
    };

    if (editingTaskId) {
        const { error } = await sb.from('tasks').update(taskData).eq('id', editingTaskId);
        if (!error) await loadTasks();
    } else {
        const { error } = await sb.from('tasks').insert([taskData]);
        if (!error) await loadTasks();
    }
    showLoading(false);
    closeModal('taskModal');
}

// ... (CompressImage, DeleteTask, UpdateStatus same as v8.4 but using brand context if needed)
function compressImage(file) {
    return new Promise((resolve, reject) => {
        if (file.size > 10 * 1024 * 1024) { alert('圖片過大'); return reject('File too large'); }
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image(); img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800; const MAX_HEIGHT = 800;
                let width = img.width; let height = img.height;
                if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } 
                else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => { resolve(blob); }, 'image/webp', 0.7); 
            };
        };
        reader.onerror = error => reject(error);
    });
}

async function deleteTask() {
    if (!editingTaskId) return;
    // Permission check
    if (profile.role !== 'owner' && !profile.permissions.delete_task) return alert('權限不足');
    
    if (!confirm('確定要刪除？')) return;
    showLoading(true);
    const { error } = await sb.from('tasks').delete().eq('id', editingTaskId);
    if (!error) { await loadTasks(); closeModal('taskModal'); }
    showLoading(false);
}

async function updateStatus(id, newStatus) {
    const tIndex = tasks.findIndex(x => x.id === id);
    if(tIndex > -1) { tasks[tIndex].status = newStatus; renderTasks(); }
    await sb.from('tasks').update({ status: newStatus }).eq('id', id);
}

// 5. Settings & Stats (Owner Only Check)
async function loadSettings() {
    // Load Owner's settings (which are Brand settings)
    const { data, error } = await sb.from('user_settings').select('*').eq('user_id', brand.owner_id).single();
    if (data) {
        if (data.config) {
            platforms = data.config.platforms || [...DEFAULT_PLATFORMS];
            let loadedTypes = data.config.types || [...DEFAULT_TYPES];
            types = loadedTypes.map(t => {
                if(t.id === 'order' && !t.color) return { ...t, color: '#E3F2FD' };
                if(t.id === 'repair' && !t.color) return { ...t, color: '#FFF3E0' };
                if(t.id === 'market' && !t.color) return { ...t, color: '#E8F5E9' };
                return t;
            });
        }
        if (data.templates) templates = data.templates;
    }
    renderTopFilters();
}

// Render Staff List in Settings
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
    document.getElementById('staffCountBadge').innerText = `${teamMembers.length}/3`; // Limit 3
}

async function removeStaff(id) {
    if(!confirm('確定要移除此員工？')) return;
    // Just delete profile, cascading delete in auth is tricky without edge function.
    // For now, we delete profile, they lose access.
    await sb.from('profiles').delete().eq('id', id);
    loadTeam();
}

function openStats() {
    if(profile.role !== 'owner' && !profile.permissions.view_stats) return alert('權限不足');
    // ... (rest of stats logic same as v9.1)
    const date = new Date();
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const toDateStr = (d) => { const offset = d.getTimezoneOffset() * 60000; return new Date(d - offset).toISOString().split('T')[0]; };
    document.getElementById('statsStart').value = toDateStr(firstDay);
    document.getElementById('statsEnd').value = toDateStr(lastDay);
    const sel = document.getElementById('statsTypeSelect'); sel.innerHTML = '<option value="all">全部類型</option>';
    types.forEach(t => sel.innerHTML += `<option value="${t.id}">${t.label}</option>`);
    calculateStats();
    document.getElementById('statsModal').style.display = 'flex';
}

// ... (calculateStats same as v9.1) ...
function calculateStats() {
    const startStr = document.getElementById('statsStart').value;
    const endStr = document.getElementById('statsEnd').value;
    const typeId = document.getElementById('statsTypeSelect').value;
    if(!startStr || !endStr) return;
    const startTs = new Date(startStr).getTime();
    const endTs = new Date(endStr).getTime() + (24 * 60 * 60 * 1000) - 1;
    let totalIncome = 0; let count = 0;
    tasks.forEach(t => {
        if (t.status === 'cancel') return;
        if (t.timestamp < startTs || t.timestamp > endTs) return;
        if (typeId !== 'all' && t.type !== typeId) return;
        totalIncome += parseInt(t.price || 0); count++;
    });
    document.getElementById('statIncome').innerText = '$' + totalIncome.toLocaleString();
    document.getElementById('statCount').innerText = count;
}

// 6. Render Logic (Updated with Assignee)
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
            if (timeFilter === 'today') { if (tDate.getDate() !== today.getDate() || tDate.getMonth() !== today.getMonth()) return false; } 
            else if (timeFilter === 'week') { if (diffDays > 7) return false; } 
            else if (timeFilter === 'month') { if (tDate.getMonth() !== today.getMonth()) return false; }
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
        const imgHtml = t.img_url ? `<img src="${t.img_url}" class="card-img" onclick="openLightbox('${t.img_url}')">` : `<div class="card-no-img">📷</div>`;
        const priceHtml = (t.price && t.price > 0) ? `<span class="price-text">$${t.price}</span>` : `<span></span>`;
        
        // Find Assignee Name
        const assignee = teamMembers.find(m => m.id === t.assigned_to);
        const assigneeName = assignee ? assignee.username : '未知';

        let opts = ''; for(let k in statusMap) opts += `<option value="${k}" ${t.status===k?'selected':''}>${statusMap[k]}</option>`;

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

// Assignee Select Render (In Modal)
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

// ... (Rest of Helpers: copyText, showToast, showLoading, openLightbox, openModal - update with new renderAssigneeSelect, renderSelectors, etc.)
// ... (Include all previous helper functions from v9.1, just ensure openModal calls renderAssigneeSelect)

// Updated openModal for v10.0
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
        selectedAssigneeId = t.assigned_to; // Set existing assignee
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
        selectedAssigneeId = session.user.id; // Default to self
        btnDelete.style.display = 'none';
    }
    renderSelectors('platformSelectorContainer', platforms, selectedPlatformId, 'setPlatform', 'platform');
    renderSelectors('typeSelectorContainer', types, selectedTypeId, 'setType', 'type');
    renderAssigneeSelect(selectedAssigneeId); // Render Staff
    modal.style.display = 'flex';
}

// (Include rest of previous functions: renderSelectors, setPlatform, setType, openCustomItemModal, etc.)
// Make sure to include saveSettingsDB (modified to save to user_settings where user_id = brand.owner_id)
async function saveSettingsDB() {
    if(profile.role !== 'owner') return alert('只有負責人可修改設定');
    const config = { platforms, types };
    await sb.from('user_settings').upsert({ user_id: session.user.id, config, templates });
}

// ... (Rest of formatTime, copyTemplate, previewFile, closeModal, toggleSection) ...
// Ensure initApp is called at the end.

// Full helper function block to ensure completeness:
function formatTime(ts) { const d=new Date(ts); return `${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; }
function copyTemplate(s) { copyText(templates[s]||'無文案'); }
function previewFile() { const p=document.getElementById('previewImage'); const f=document.getElementById('fileInput').files[0]; const r=new FileReader(); r.onload=e=>{ p.src=e.target.result; p.style.display='block'; }; if(f) r.readAsDataURL(f); }
function closeModal(id) { document.getElementById(id).style.display='none'; }
function toggleSection(id, header) { const body = document.getElementById(id); const chevron = header.querySelector('.chevron'); if (body.style.display === 'none' || body.style.display === '') { body.style.display = 'block'; chevron.classList.add('rotate'); } else { body.style.display = 'none'; chevron.classList.remove('rotate'); } }
function openSettings() { 
    if(profile.role !== 'owner') { 
        // Staff view: only show account section
        document.getElementById('ownerSettings').style.display = 'none';
        document.getElementById('settingsModal').style.display='flex';
        return; 
    }
    // Owner view
    const list=document.getElementById('templatesList'); list.innerHTML='';
    ['waiting_pay','to_ship','making','repairing','done','cancel'].forEach(k => { list.innerHTML += `<div class="template-item"><div class="template-desc">${statusMap[k]}</div><input class="template-input" value="${templates[k]||''}" onchange="saveTemplate('${k}',this.value)"></div>`; });
    renderCustomList('customPlatformsList', platforms, 'deletePlatform'); renderCustomList('customTypesList', types, 'deleteType'); 
    renderStaffList(); // Render staff list
    document.getElementById('settingsModal').style.display='flex'; 
}
async function saveTemplate(k,v) { templates[k]=v; await saveSettingsDB(); }
function renderCustomList(cid, items, fnName) { const c=document.getElementById(cid); let h=''; items.filter(i=>!i.isDefault).forEach(i => h+=`<div class="custom-item-row"><span>${i.icon} ${i.label}</span><button class="custom-item-btn" onclick="${fnName}('${i.id}')">刪除</button></div>`); c.innerHTML=h||'<div style="color:#ccc;font-size:12px;padding:8px;">無自定義項目</div>'; }
async function deletePlatform(id) { if(confirm('刪除?')) { platforms=platforms.filter(p=>p.id!==id); await saveSettingsDB(); openSettings(); renderTasks(); } }
async function deleteType(id) { if(confirm('刪除?')) { types=types.filter(t=>t.id!==id); await saveSettingsDB(); renderTopFilters(); openSettings(); renderTasks(); } }
function renderTopFilters() { const c=document.getElementById('topFilterContainer'); let h=`<button class="filter-btn ${currentFilter==='all'?'active':''}" onclick="setFilter('all')">全部</button>`; types.forEach(t=>h+=`<button class="filter-btn ${currentFilter===t.id?'active':''}" onclick="setFilter('${t.id}')">${t.label}</button>`); c.innerHTML=h; }
function setFilter(t) { currentFilter=t; renderTopFilters(); renderTasks(); }
function openCustomItemModal(ctx) { creatingItemContext = ctx; document.getElementById('customName').value=''; updateEmojiPreview('🌐'); renderEmojiGrid(); const colorSection = document.getElementById('colorPickerSection'); if (ctx === 'type') { colorSection.style.display = 'block'; renderColorGrid(); selectColor(TAG_COLORS[0]); } else { colorSection.style.display = 'none'; } document.getElementById('customItemModal').style.display='flex'; }
function renderEmojiGrid() { let h=''; COMMON_EMOJIS.forEach(e=>h+=`<div class="emoji-btn" onclick="updateEmojiPreview('${e}')">${e}</div>`); document.getElementById('emojiGrid').innerHTML=h; }
function updateEmojiPreview(e) { selectedEmoji=e; document.getElementById('emojiPreviewDisplay').innerText=e; }
function renderColorGrid() { let h = ''; TAG_COLORS.forEach(c => { h += `<div class="color-btn" style="background-color:${c}" onclick="selectColor('${c}')" id="color-${c}"></div>`; }); document.getElementById('colorGrid').innerHTML = h; }
function selectColor(color) { selectedColor = color; document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected')); document.getElementById(`color-${color}`).classList.add('selected'); }
async function saveCustomItem() { const label=document.getElementById('customName').value; if(!label) return; const newId='custom_'+Date.now(); const item={id:newId, label, icon:selectedEmoji, isDefault:false}; if(creatingItemContext === 'type') item.color = selectedColor; showLoading(true); if(creatingItemContext==='platform') { platforms.push(item); await saveSettingsDB(); setPlatform(newId); } else { types.push(item); await saveSettingsDB(); setType(newId); renderTopFilters(); } showLoading(false); closeModal('customItemModal'); }
function showLoading(show, text='處理中...') { const el = document.getElementById('loading'); if(show) { el.querySelector('.loading-text').innerText=text; el.style.display='flex'; } else el.style.display='none'; }
function showToast(msg) { const t=document.getElementById('toast'); t.innerText=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2000); }
document.querySelectorAll('.modal-overlay').forEach(e => e.addEventListener('click', ev => { if(ev.target===e) e.style.display='none'; }));

initApp();
