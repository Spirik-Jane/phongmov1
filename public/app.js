// ============ STATE ============
let _currentUser = null;
let _duLieuPhanTich = null;
let _caDaChon = null;
let _refreshInterval = null;
let _danhSachNhanSu = [];
let _modeChot = 'dashboard'; // 'dashboard' | 'upload'

// Gọi Lucide icons
function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

document.addEventListener('DOMContentLoaded', refreshIcons);

// ============ GIAO DIỆN SÁNG / TỐI ============
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('pm_theme', theme); } catch { /* ignore */ }
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.innerHTML = `<i data-lucide="${theme === 'dark' ? 'sun' : 'moon'}"></i>`;
  });
  refreshIcons();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('pm_theme'); } catch { /* ignore */ }
  if (!saved) {
    saved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  applyTheme(saved);
})();

['btn-theme-toggle', 'btn-theme-toggle-login'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', toggleTheme);
});

// ============ KHỞI ĐỘNG: KIỂM TRA ĐĂNG NHẬP ============
(async function init() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (data.success && data.loggedIn) {
      _currentUser = data.user;
      hienThiManHinhChinh();
    } else {
      hienView('login');
    }
  } catch {
    hienView('login');
  }
})();

// ============ VIEW MANAGEMENT ============
function hienView(name) {
  ['view-login', 'view-main'].forEach(id => {
    const el = document.getElementById(id);
    if (id === `view-${name}` || (name !== 'login' && id === 'view-main')) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
  if (name === 'login') showAuthPanel('login');
  refreshIcons();
}

function switchInnerView(name) {
  ['view-dashboard', 'view-upload', 'view-admin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === `view-${name}`) {
        el.classList.remove('hidden');
        el.classList.add('active');
      } else {
        el.classList.add('hidden');
        el.classList.remove('active');
      }
    }
  });
  refreshIcons();
}

function hienThiManHinhChinh() {
  hienView('main');
  document.getElementById('user-display').textContent = _currentUser.hoTen || _currentUser.username;
  
  // Phân quyền nút Upload
  const btnUpload = document.getElementById('btn-show-upload');
  if (_currentUser.vaiTro === 'NV_KHOA_TRAI') {
    btnUpload.classList.add('hidden');
  } else {
    btnUpload.classList.remove('hidden');
  }
  
  // Phân quyền nút Admin
  const btnAdmin = document.getElementById('btn-admin');
  if (_currentUser.vaiTro === 'Admin') {
    btnAdmin.classList.remove('hidden');
  } else {
    btnAdmin.classList.add('hidden');
  }
  
  switchInnerView('dashboard');
  initDashboard();
}

// ============ LOGIN / QUÊN MẬT KHẨU / REGISTER (3 cửa sổ riêng) ============
function showAuthPanel(name) {
  ['login', 'forgot', 'register'].forEach((n) => {
    const wrap = document.getElementById(`${n}-form-wrap`);
    if (wrap) wrap.classList.toggle('hidden', n !== name);
    const tab = document.getElementById(`tab-${n}`);
    if (tab) tab.classList.toggle('active', n === name);
  });
  hienThongBao('login-msg', '', '');
  hienThongBao('reg-msg', '', '');
  hienThongBao('forgot-msg', '', '');
}

document.getElementById('btn-show-forgot').addEventListener('click', () => showAuthPanel('forgot'));
document.getElementById('btn-forgot-back').addEventListener('click', () => showAuthPanel('login'));

document.getElementById('btn-forgot-submit').addEventListener('click', async () => {
  const identifier = document.getElementById('forgot-identifier').value.trim();
  if (!identifier) {
    hienThongBao('forgot-msg', 'Vui lòng nhập tên đăng nhập hoặc email.', 'error');
    return;
  }
  const btn = document.getElementById('btn-forgot-submit');
  btn.disabled = true;
  hienThongBao('forgot-msg', 'Đang gửi yêu cầu...', '');
  try {
    const res = await fetch('/api/quen-mat-khau', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier })
    });
    const data = await res.json();
    hienThongBao('forgot-msg', data.message || 'Yêu cầu đã được gửi. Vui lòng chờ Quản trị viên hỗ trợ.', data.success === false ? 'error' : 'success');
  } catch (err) {
    hienThongBao('forgot-msg', 'Chưa thể gửi yêu cầu tự động. Vui lòng liên hệ trực tiếp Quản trị viên để được đặt lại mật khẩu.', 'error');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btn-login').addEventListener('click', async () => {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!username || !password) {
    hienThongBao('login-msg', 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.', 'error');
    return;
  }
  hienThongBao('login-msg', 'Đang đăng nhập...', '');
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
      _currentUser = data.user;
      hienThiManHinhChinh();
    } else {
      hienThongBao('login-msg', data.message, 'error');
    }
  } catch (err) {
    hienThongBao('login-msg', 'Lỗi kết nối: ' + err.message, 'error');
  }
});

document.getElementById('login-pass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-login').click();
});

document.getElementById('btn-show-register').addEventListener('click', () => showAuthPanel('register'));
document.getElementById('btn-show-login').addEventListener('click', () => showAuthPanel('login'));

document.getElementById('btn-register').addEventListener('click', async () => {
  const data = {
    username: document.getElementById('reg-user').value.trim(),
    password: document.getElementById('reg-pass').value,
    hoTen: document.getElementById('reg-hoten').value.trim(),
    khoaPhong: document.getElementById('reg-khoa').value.trim(),
    email: document.getElementById('reg-email').value.trim(),
    vaiTro: document.getElementById('reg-vaitro').value
  };
  if (!data.username || !data.password) {
    hienThongBao('reg-msg', 'Vui lòng nhập đầy đủ.', 'error');
    return;
  }
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    hienThongBao('reg-msg', result.message, result.success ? 'success' : 'error');
    if (result.success) {
      setTimeout(() => {
        showAuthPanel('login');
        hienThongBao('login-msg', 'Đăng ký thành công! Chờ Admin duyệt.', 'success');
      }, 1500);
    }
  } catch (err) {
    hienThongBao('reg-msg', 'Lỗi: ' + err.message, 'error');
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  _currentUser = null;
  stopAutoRefresh();
  hienView('login');
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  hienThongBao('login-msg', '', '');
});

// ============ DASHBOARD ============
const dashDate = document.getElementById('dash-date');
dashDate.valueAsDate = new Date();

function initDashboard() {
  loadDashboard();
  startAutoRefresh();
}

async function loadDashboard() {
  const dateStr = dashDate.value;
  if (!dateStr) return;
  const dashboardList = document.getElementById('dashboard-list');
  
  try {
    const res = await fetch(`/api/dashboard?date=${dateStr}`);
    const result = await res.json();
    
    if (result.success) {
      renderDashboard(result.data);
    } else {
      dashboardList.innerHTML = `<div class="msg error">Lỗi: ${result.message}</div>`;
    }
  } catch (err) {
    dashboardList.innerHTML = `<div class="msg error">Mất kết nối: ${err.message}</div>`;
  }
}

// Chuyển trạng thái không dấu sang có dấu tiếng Việt
function chuanHoaTrangThai(raw) {
  if (!raw) return 'Chưa cập nhật';
  const lower = raw.toLowerCase().trim();
  if (lower === 'da chot' || lower === 'đã chốt' || lower.includes('da chot')) return 'Đã chốt';
  if (lower === 'dang cap nhat' || lower === 'đang cập nhật' || lower.includes('dang cap nhat')) return 'Đang cập nhật';
  if (lower === 'chua cap nhat' || lower === 'chưa cập nhật' || lower.includes('chua cap nhat')) return 'Chưa cập nhật';
  if (lower === 'da xac nhan day du' || lower.includes('da xac nhan')) return 'Đã xác nhận đầy đủ';
  return raw; // giữ nguyên nếu không khớp
}

function renderDashboard(data) {
  const dashboardList = document.getElementById('dashboard-list');
  dashboardList.innerHTML = '';
  renderDashStats(data);

  if (!data || data.length === 0) {
    dashboardList.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i>Không có lịch mổ nào trong ngày này.</div>`;
    refreshIcons();
    return;
  }

  data.forEach(ca => {
    let statusClass = 'status-pending';
    let statusText = chuanHoaTrangThai(ca.trangThai);
    
    if (statusText.includes('chốt') || statusText.includes('xác nhận')) {
      statusClass = 'status-done';
    } else if (statusText.includes('cập nhật') || ca.lanUpload > 0) {
      statusClass = 'status-warn';
      if (ca.lanUpload > 0 && statusText === 'Chưa cập nhật') statusText = 'Đang cập nhật';
    }
    
    const uploadInfo = ca.lanUpload > 0 ? `Đã upload ${ca.lanUpload} lần` : '';

    const canChot = ca.lanUpload > 0 && !statusText.includes('chốt') && !statusText.includes('xác nhận')
      && _currentUser && _currentUser.vaiTro !== 'NV_KHOA_TRAI';

    const div = document.createElement('div');
    div.className = 'dash-card' + (ca.lanUpload > 0 ? ' clickable' : '');
    if (ca.lanUpload > 0) {
      div.onclick = (e) => {
        if (e.target.closest('button')) return;
        moChiTietCa(ca.maBN, ca.thoiGianMo, ca.hoTen);
      };
    }
    div.innerHTML = `
      <div class="info">
        <div class="ten">${escapeHtml(ca.hoTen)} <span class="sub-label">(${escapeHtml(ca.maBN)})</span></div>
        <div class="chi-tiet"><i data-lucide="map-pin"></i> ${escapeHtml(ca.khoa)} · <i data-lucide="stethoscope"></i> ${escapeHtml(ca.chanDoan)}</div>
        ${uploadInfo ? `<div class="chi-tiet" style="margin-top:4px; font-size:12px;"><i data-lucide="clock"></i> ${uploadInfo}</div>` : ''}
        ${taoThongBaoCard(ca)}
      </div>
      <div class="dash-card-side">
        <div class="status-row">
          <div class="status-badge ${statusClass}">${escapeHtml(statusText)}</div>
          ${canChot ? `<button class="btn-chot-mini" data-mabn="${escapeHtml(ca.maBN)}" data-ngaymo="${escapeHtml(ca.thoiGianMo)}" data-hoten="${escapeHtml(ca.hoTen)}">Chốt</button>` : ''}
        </div>
        ${ca.nguoiXacNhan ? `<div class="finalizer-info">👤 <b>${escapeHtml(ca.nguoiXacNhan)}</b><br/>${escapeHtml(ca.lastUpdated)}</div>` : ''}
      </div>
    `;
    dashboardList.appendChild(div);
  });

  document.querySelectorAll('.btn-chot-mini').forEach(btn => {
    btn.addEventListener('click', () => {
      _modeChot = 'dashboard';
      // Tìm ca trong mảng data để lấy thông tin dsLapLai
      const ca = data.find(c => c.maBN === btn.dataset.mabn && String(c.thoiGianMo) === btn.dataset.ngaymo);
      const hasAbnormal = ca && ca.dsLapLai && ca.dsLapLai.length > 0;
      moModalChot(btn.dataset.mabn, btn.dataset.ngaymo, btn.dataset.hoten, hasAbnormal);
    });
  });
  
  refreshIcons();
}

// Thanh thống kê nhanh phía trên dashboard (Tổng ca / Chưa cập nhật / Đang cập nhật / Đã chốt / Có vật tư mắc tiền)
function renderDashStats(data) {
  const wrap = document.getElementById('dash-stats');
  if (!wrap) return;
  if (!data || !data.length) {
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
    return;
  }
  let soDaChot = 0, soDangCapNhat = 0, soChuaCapNhat = 0, soMacTien = 0, soLapLai = 0;
  data.forEach((ca) => {
    const st = (ca.trangThai || '').toLowerCase();
    if (st.includes('chot') || st.includes('chốt')) soDaChot++;
    else if (st.includes('cap nhat') || st.includes('cập nhật') || ca.lanUpload > 0) soDangCapNhat++;
    else soChuaCapNhat++;
    if (Array.isArray(ca.dsMacTien) && ca.dsMacTien.length) soMacTien++;
    if (Array.isArray(ca.dsLapLai) && ca.dsLapLai.length) soLapLai++;
  });

  wrap.classList.remove('hidden');
  wrap.innerHTML = `
    <div class="stat-chip"><div class="stat-num">${data.length}</div><div class="stat-label">Tổng ca mổ</div></div>
    <div class="stat-chip stat-pending"><div class="stat-num">${soChuaCapNhat}</div><div class="stat-label">Chưa cập nhật</div></div>
    <div class="stat-chip stat-warn"><div class="stat-num">${soDangCapNhat}</div><div class="stat-label">Đang cập nhật</div></div>
    <div class="stat-chip stat-done"><div class="stat-num">${soDaChot}</div><div class="stat-label">Đã chốt</div></div>
    <div class="stat-chip stat-expensive"><div class="stat-num">${soMacTien}</div><div class="stat-label">Có vật tư mắc tiền</div></div>
  `;
}

// Hiển thị thông báo trực tiếp trên card: Note (nội dung), Vật tư mắc tiền, Chỉ định lặp lại
function taoThongBaoCard(ca) {
  const parts = [];

  // Note: hiện nội dung luôn
  if (ca.noteChung) {
    parts.push(`
      <div class="card-alert alert-note">
        <i data-lucide="message-square-text"></i>
        <span>${escapeHtml(ca.noteChung)}</span>
      </div>`);
  }

  // Vật tư mắc tiền: hiện danh sách luôn
  if (Array.isArray(ca.dsMacTien) && ca.dsMacTien.length) {
    const items = ca.dsMacTien.map(m => `<b>${escapeHtml(m.tenMuc)}</b> × ${escapeHtml(m.sl)}`).join(' · ');
    parts.push(`
      <div class="card-alert alert-expensive">
        <i data-lucide="gem"></i>
        <span>Vật tư mắc tiền: ${items}</span>
      </div>`);
  }

  // Chỉ định lặp lại: hiện cảnh báo nhắc nhở luôn
  if (Array.isArray(ca.dsLapLai) && ca.dsLapLai.length) {
    const items = ca.dsLapLai.map(m => `<b>${escapeHtml(m.tenMuc)}</b> (×${m.soLan} lần)`).join(' · ');
    parts.push(`
      <div class="card-alert alert-repeat">
        <i data-lucide="alert-triangle"></i>
        <span>⚠ Chỉ định lặp lại: ${items} — Cần kiểm tra lại!</span>
      </div>`);
  }

  if (!parts.length) return '';
  return `<div class="card-alerts-wrap">${parts.join('')}</div>`;
}

dashDate.addEventListener('change', loadDashboard);

function startAutoRefresh() {
  if (_refreshInterval) clearInterval(_refreshInterval);
  _refreshInterval = setInterval(loadDashboard, 30000);
}
function stopAutoRefresh() {
  if (_refreshInterval) clearInterval(_refreshInterval);
}

// ============ UPLOAD VIEW ============
document.getElementById('btn-show-upload').addEventListener('click', () => {
  const dropZone = document.getElementById('drop-zone');
  dropZone.classList.remove('hidden');
  document.getElementById('ket-qua').classList.add('hidden');
  document.getElementById('upload-msg').textContent = '';
  document.getElementById('save-msg').textContent = '';
  document.getElementById('file-input').value = '';
  _duLieuPhanTich = null;
  _caDaChon = null;
  stopAutoRefresh();
  switchInnerView('upload');
});

document.getElementById('btn-back-dashboard').addEventListener('click', () => {
  switchInnerView('dashboard');
  loadDashboard();
  startAutoRefresh();
});

// KÉO THẢ FILE
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) xuLyFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) xuLyFile(fileInput.files[0]);
});

async function xuLyFile(file) {
  document.getElementById('ket-qua').classList.add('hidden');
  hienThongBao('upload-msg', `Đang đọc & phân tích "${file.name}"...`, '');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/phan-tich', { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.success) {
      hienThongBao('upload-msg', data.message, 'error');
      return;
    }
    hienThongBao('upload-msg', '', '');
    dropZone.classList.add('hidden');
    _duLieuPhanTich = data;
    _caDaChon = null;
    renderKetQua(data);
  } catch (err) {
    hienThongBao('upload-msg', 'Lỗi kết nối: ' + err.message, 'error');
  }
}

function renderKetQua(data) {
  document.getElementById('ket-qua').classList.remove('hidden');
  document.getElementById('kq-mabn').textContent = data.dauPhieu.maBN;
  document.getElementById('kq-hoten').textContent = data.dauPhieu.hoTen;
  document.getElementById('kq-ngayvaovien').textContent = data.dauPhieu.ngayVaoVien;

  const elCa = document.getElementById('danh-sach-ca');
  elCa.innerHTML = '';
  if (!data.cacCa.length) {
    elCa.innerHTML = '<div class="msg error"><i data-lucide="alert-circle"></i> Không tìm thấy ca đăng ký nào với Mã BN này.</div>';
  } else {
    data.cacCa.forEach((ca, idx) => {
      const div = document.createElement('div');
      div.className = 'candidate-card';
      div.id = 'ca-' + idx;
      div.onclick = () => chonCa(idx);
      div.innerHTML = `
        <div class="ten">${escapeHtml(ca.hoTen)}</div>
        <div class="dong-phu"><i data-lucide="stethoscope" style="width:14px; height:14px"></i> CĐ: ${escapeHtml(ca.chanDoan || '-')}</div>
        <div class="dong-phu"><i data-lucide="user" style="width:14px; height:14px"></i> PTV: ${escapeHtml(ca.ptv || '-')} · <i data-lucide="clock" style="width:14px; height:14px"></i> Giờ mổ: ${escapeHtml(String(ca.thoiGianMo || '-'))} · <i data-lucide="door-open" style="width:14px; height:14px"></i> Phòng: ${escapeHtml(ca.khu || '-')}</div>`;
      elCa.appendChild(div);
    });
    if (data.cacCa.length === 1) chonCa(0);
  }

  renderDanhSachMuc(data);
  capNhatNutLuu();
  refreshIcons();
}

function renderDanhSachMuc(data) {
  const dsTheoNhom = {};
  data.danhSachMuc.forEach((m) => {
    if (!dsTheoNhom[m.nhom]) dsTheoNhom[m.nhom] = [];
    dsTheoNhom[m.nhom].push(m);
  });
  Object.keys(dsTheoNhom).forEach((nhom) => {
    dsTheoNhom[nhom].sort((a, b) => {
      if (a.coMacTien !== b.coMacTien) return a.coMacTien ? -1 : 1;
      return a.tenMuc.localeCompare(b.tenMuc, 'vi');
    });
  });

  const thuTuNhom = ['Chỉ định', 'Vật tư y tế', 'Thuốc, dịch truyền', 'Chưa phân nhóm'];
  const elNhom = document.getElementById('cac-nhom-muc');
  elNhom.innerHTML = '';
  thuTuNhom.forEach((nhom) => {
    if (!dsTheoNhom[nhom]) return;
    const block = document.createElement('div');
    block.className = 'group-block';
    let html = `<div class="group-title">${escapeHtml(nhom)} <span class="sub-label" style="text-transform:none; letter-spacing:normal;">(${dsTheoNhom[nhom].length} mục)</span></div>`;
    let stt = 0;
    
    dsTheoNhom[nhom].forEach((m) => {
      stt++;
      const isExp = m.coMacTien;
      // Khi click vào row (trừ input/textarea), toggle drawer ghi chú bên dưới
      html += `
        <div class="item-container" id="item-cnt-${nhom}-${stt}">
          <div class="item-row${isExp ? ' mac-tien' : ''}" onclick="document.getElementById('item-cnt-${nhom}-${stt}').classList.toggle('expanded')">
            <div style="color:var(--text-secondary); font-weight:500;">${stt}</div>
            <div style="font-weight:500;">${escapeHtml(m.tenMuc)}${isExp ? '<span class="badge badge-expensive">MẮC TIỀN</span>' : ''}</div>
            <div style="color:var(--text-secondary);">${escapeHtml(m.dvt)}</div>
            <div style="font-weight:600;">${escapeHtml(m.sl)}</div>
            <div style="color:var(--text-secondary);">${escapeHtml(m.duongDung)}</div>
          </div>
          <div class="item-note-drawer">
            <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;"><i data-lucide="edit-3" style="width:12px;height:12px"></i> Ghi chú tường trình cho mục này:</div>
            <textarea class="apple-input full inline-note-input" rows="2" placeholder="Nhập ghi chú..." data-nhom="${escapeHtml(nhom)}" data-idx="${stt-1}">${escapeHtml(m.ghiChu)}</textarea>
          </div>
        </div>`;
    });
    block.innerHTML = html;
    elNhom.appendChild(block);
  });

  document.querySelectorAll('.inline-note-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const n = e.target.getAttribute('data-nhom');
      const i = parseInt(e.target.getAttribute('data-idx'), 10);
      if (dsTheoNhom[n] && dsTheoNhom[n][i]) {
        dsTheoNhom[n][i].ghiChu = e.target.value;
      }
    });
    // Ngăn sự kiện click sụp drawer khi click vào textarea
    input.addEventListener('click', (e) => e.stopPropagation());
  });
  
  refreshIcons();
}

async function chonCa(idx) {
  document.querySelectorAll('.candidate-card').forEach((c) => c.classList.remove('selected'));
  document.getElementById('ca-' + idx).classList.add('selected');
  _caDaChon = _duLieuPhanTich.cacCa[idx];
  
  const btnLuu = document.getElementById('btn-luu');
  btnLuu.disabled = true;
  btnLuu.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Đang kiểm tra...';
  refreshIcons();
  
  document.getElementById('khu-vuc-diff-container').classList.add('hidden');
  
  try {
    const res = await fetch('/api/kiem-tra-cap-nhat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maBN: _duLieuPhanTich.dauPhieu.maBN,
        ngayMo: _caDaChon.thoiGianMo,
        danhSachMucMoi: _duLieuPhanTich.danhSachMuc
      })
    });
    const data = await res.json();
    
    if (data.success && data.coDuLieuCu) {
      hienThiDiff(data.chiTietDiff, data.soLanUploadTruoc);
    }
  } catch (err) {
    // ignore
  }
  
  capNhatNutLuu();
}

function hienThiDiff(diff, lanUploadTruoc) {
  const container = document.getElementById('khu-vuc-diff');
  container.innerHTML = `<div class="diff-box">
    <div style="margin-bottom: 12px; font-weight: 500; font-size:14px; color:var(--text-secondary);">Dữ liệu đã upload trước đây (Lần ${lanUploadTruoc}):</div>
    ${diff.them.length ? `<div class="diff-section-title">Thêm mới (${diff.them.length})</div>` : ''}
    ${diff.them.map(m => `<div class="diff-item diff-them"><b>${escapeHtml(m.tenMuc)}</b><div style="font-size:13px; color:var(--text-secondary); margin-top:2px;">SL: ${escapeHtml(m.sl)} ${escapeHtml(m.dvt)}</div></div>`).join('')}
    
    ${diff.doi.length ? `<div class="diff-section-title">Thay đổi (${diff.doi.length})</div>` : ''}
    ${diff.doi.map(m => `<div class="diff-item diff-doi"><b>${escapeHtml(m.moi.tenMuc)}</b><div style="font-size:13px; color:var(--text-secondary); margin-top:2px;">SL: <span style="text-decoration:line-through">${escapeHtml(m.cu.sl)}</span> ➔ <b>${escapeHtml(m.moi.sl)}</b></div></div>`).join('')}
    
    ${diff.xoa.length ? `<div class="diff-section-title">Bị xóa (${diff.xoa.length})</div>` : ''}
    ${diff.xoa.map(m => `<div class="diff-item diff-xoa"><b>${escapeHtml(m.tenMuc)}</b><div style="font-size:13px; color:var(--text-secondary); margin-top:2px;">SL: ${escapeHtml(m.sl)}</div></div>`).join('')}
    
    ${(!diff.them.length && !diff.doi.length && !diff.xoa.length) ? '<div class="diff-item diff-giu">Không thay đổi so với lần trước.</div>' : ''}
  </div>`;
  document.getElementById('khu-vuc-diff-container').classList.remove('hidden');
}

function capNhatNutLuu() {
  const btnLuu = document.getElementById('btn-luu');
  btnLuu.disabled = !(_duLieuPhanTich && _caDaChon);
  btnLuu.innerHTML = '<i data-lucide="save"></i> Xác nhận Lưu & Chốt Vật Tư';
  refreshIcons();
}

// BẤM NÚT LƯU TRONG UPLOAD -> MỞ MODAL CHỐT (Mode Upload)
document.getElementById('btn-luu').addEventListener('click', () => {
  if (!_caDaChon) return;
  _modeChot = 'upload';
  
  // Kiểm tra bất thường trong dữ liệu upload
  let hasAbnormal = false;
  const countMap = {};
  if (_duLieuPhanTich && _duLieuPhanTich.danhSachMuc) {
    _duLieuPhanTich.danhSachMuc.forEach(m => {
      const nhomNorm = (m.nhom || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd');
      if (nhomNorm.includes('chi dinh')) {
        const key = m.tenMuc.toLowerCase().trim();
        if (!countMap[key]) countMap[key] = { count: 0 };
        countMap[key].count += parseInt(m.sl, 10) || 1;
      }
    });
    hasAbnormal = Object.values(countMap).some(v => v.count >= 2);
  }
  
  moModalChot(_duLieuPhanTich.dauPhieu.maBN, _caDaChon.thoiGianMo, _caDaChon.hoTen, hasAbnormal);
});

// ============ CHỐT VẬT TƯ MODAL ============
let _chotMaBN = '', _chotNgayMo = '', _chotHoTen = '';
let _currentHasAbnormal = false;

async function moModalChot(maBN, ngayMo, hoTen, hasAbnormal = false) {
  _chotMaBN = maBN;
  _chotNgayMo = ngayMo;
  _chotHoTen = hoTen;
  _currentHasAbnormal = hasAbnormal;

  const warnEl = document.getElementById('chot-abnormal-warning');
  if (warnEl) {
    if (_currentHasAbnormal) warnEl.classList.remove('hidden');
    else warnEl.classList.add('hidden');
  }

  // Load danh sách nhân viên nếu chưa có
  if (!_danhSachNhanSu.length) {
    try {
      const res = await fetch('/api/nhan-su');
      const data = await res.json();
      if (data.success) _danhSachNhanSu = data.data;
    } catch { /* ignore */ }
  }

  const select = document.getElementById('chot-nguoi');
  select.innerHTML = '';
  
  if (_modeChot === 'upload') {
    // Nếu gọi từ upload, cho phép tùy chọn "Chỉ lưu, chưa chốt"
    const optNone = document.createElement('option');
    optNone.value = '';
    optNone.textContent = '-- Chỉ Lưu Dữ Liệu (Chưa Chốt) --';
    select.appendChild(optNone);
  }

  _danhSachNhanSu.forEach(ns => {
    const opt = document.createElement('option');
    opt.value = ns.tenDayDu;
    opt.textContent = `${ns.tenDayDu} (${ns.nhom})`;
    select.appendChild(opt);
  });

  // Auto-select current user nếu có trong danh sách và đang ở mode dashboard
  if (_currentUser && _modeChot === 'dashboard') {
    const match = _danhSachNhanSu.find(ns => ns.tenDayDu === _currentUser.hoTen);
    if (match) select.value = match.tenDayDu;
  } else if (_modeChot === 'upload') {
    select.value = ''; // mặc định Chưa chốt
  }

  document.getElementById('chot-password').value = '';
  document.getElementById('chot-ghichu').value = '';
  hienThongBao('chot-msg', '', '');
  kiemTraCanPassword();

  // Load gợi ý vật tư
  document.getElementById('chot-vattu-goiy').classList.add('hidden');
  document.getElementById('chot-vattu-list').innerHTML = '<div style="font-size:12px; color:var(--text-secondary)"><i data-lucide="loader-2" class="spin"></i> Đang tìm gợi ý...</div>';
  refreshIcons();
  
  try {
    const resVT = await fetch(`/api/vat-tu/goi-y-chi-dinh?maBN=${encodeURIComponent(maBN)}&ngayMo=${encodeURIComponent(ngayMo)}`);
    const dataVT = await resVT.json();
    if (dataVT.success && dataVT.data && dataVT.data.length > 0) {
      document.getElementById('chot-vattu-goiy').classList.remove('hidden');
      let vtHtml = '';
      dataVT.data.forEach(nhom => {
        vtHtml += `<div style="font-weight:600; font-size:13px; margin: 10px 0 6px 0;">${nhom.tenVatTuYeuCau}:</div>`;
        if (nhom.danhSachCay && nhom.danhSachCay.length > 0) {
          nhom.danhSachCay.forEach((cay, idx) => {
            // Tự động check cây đầu tiên (cây có daDung cao nhất vì BE đã sort)
            const checkedStr = idx === 0 ? 'checked' : '';
            vtHtml += `
              <label class="vt-select-item">
                <input type="checkbox" name="vattu-chon" value="${cay.maQL}" ${checkedStr}>
                <div class="vt-select-info">
                  <div class="vt-select-title">${cay.maQL}</div>
                  <div class="vt-select-desc">Đã dùng: ${cay.daDung}/${cay.gioiHan} lần</div>
                </div>
              </label>
            `;
          });
        } else {
          vtHtml += `<div style="font-size:12px; color:var(--apple-red); margin-left:12px;">⚠ Không tìm thấy cây nào sẵn sàng.</div>`;
        }
      });
      document.getElementById('chot-vattu-list').innerHTML = vtHtml;
    } else {
      document.getElementById('chot-vattu-list').innerHTML = '<div style="font-size:12px; color:var(--text-secondary); font-style:italic;">Không phát hiện chỉ định vật tư tiêu hao nào cho ca này.</div>';
      document.getElementById('chot-vattu-goiy').classList.remove('hidden');
    }
  } catch (e) {
    document.getElementById('chot-vattu-list').innerHTML = '<div style="font-size:12px; color:var(--apple-red);">Lỗi tải dữ liệu vật tư.</div>';
  }

  document.getElementById('modal-chot').classList.remove('hidden');
}

function kiemTraCanPassword() {
  const nguoiChon = document.getElementById('chot-nguoi').value;
  const canPass = nguoiChon !== '' && _currentUser && _currentUser.hoTen !== nguoiChon;
  const wrap = document.getElementById('chot-password-wrap');
  if (canPass) {
    wrap.classList.remove('hidden');
  } else {
    wrap.classList.add('hidden');
  }
}

document.getElementById('chot-nguoi').addEventListener('change', kiemTraCanPassword);

document.getElementById('btn-chot-huy').addEventListener('click', () => {
  document.getElementById('modal-chot').classList.add('hidden');
});
document.getElementById('btn-chot-close').addEventListener('click', () => {
  document.getElementById('modal-chot').classList.add('hidden');
});

document.getElementById('btn-chot-xacnhan').addEventListener('click', async () => {
  const nguoiXacNhan = document.getElementById('chot-nguoi').value;
  const passwordXacNhan = document.getElementById('chot-password').value;
  const ghiChuChung = document.getElementById('chot-ghichu').value.trim();
  
  if (_currentHasAbnormal && nguoiXacNhan !== '' && ghiChuChung === '') {
    hienThongBao('chot-msg', '⚠ Bắt buộc phải có Tường trình (Ghi chú chung) do có Chỉ định lặp lại bất thường!', 'error');
    return;
  }

  const btnXacNhan = document.getElementById('btn-chot-xacnhan');
  btnXacNhan.disabled = true;
  btnXacNhan.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Đang xử lý...';
  refreshIcons();
  hienThongBao('chot-msg', '', '');

  try {
    // Nếu đang ở mode upload, phải lưu dữ liệu trước
    if (_modeChot === 'upload') {
      const resLuu = await fetch('/api/luu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maBN: _duLieuPhanTich.dauPhieu.maBN,
          hoTen: _caDaChon.hoTen,
          ngayMo: _caDaChon.thoiGianMo,
          tenFile: _duLieuPhanTich.tenFile,
          danhSachMuc: _duLieuPhanTich.danhSachMuc,
          nguoiUpload: _currentUser ? _currentUser.username : 'unknown'
        })
      });
      const dataLuu = await resLuu.json();
      if (!dataLuu.success) {
        hienThongBao('chot-msg', 'Lỗi lưu dữ liệu: ' + dataLuu.message, 'error');
        btnXacNhan.disabled = false;
        btnXacNhan.innerHTML = '<i data-lucide="check"></i> Xác nhận Chốt';
        refreshIcons();
        return;
      }
    }

    if (nguoiXacNhan !== '') {
      // Lấy danh sách vật tư đã chọn
      const danhSachVatTuChon = Array.from(document.querySelectorAll('input[name="vattu-chon"]:checked')).map(cb => cb.value);

      const resChot = await fetch('/api/chot-vat-tu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maBN: _chotMaBN,
          ngayMo: _chotNgayMo,
          nguoiXacNhan,
          ghiChuChung,
          passwordXacNhan: passwordXacNhan || undefined,
          danhSachVatTuChon
        })
      });
      const dataChot = await resChot.json();
      
      if (dataChot.needPassword) {
        document.getElementById('chot-password-wrap').classList.remove('hidden');
        hienThongBao('chot-msg', dataChot.message, 'error');
        btnXacNhan.disabled = false;
        btnXacNhan.innerHTML = '<i data-lucide="check"></i> Xác nhận Chốt';
        refreshIcons();
        return;
      }
      
      if (!dataChot.success) {
        hienThongBao('chot-msg', dataChot.message, 'error');
        btnXacNhan.disabled = false;
        btnXacNhan.innerHTML = '<i data-lucide="check"></i> Xác nhận Chốt';
        refreshIcons();
        return;
      }
    }

    hienThongBao('chot-msg', 'Xử lý thành công!', 'success');
    setTimeout(() => {
      document.getElementById('modal-chot').classList.add('hidden');
      btnXacNhan.disabled = false;
      btnXacNhan.innerHTML = '<i data-lucide="check"></i> Xác nhận Chốt';
      
      if (_modeChot === 'upload') {
        switchInnerView('dashboard');
      }
      loadDashboard();
      startAutoRefresh();
    }, 1000);
    
  } catch (err) {
    hienThongBao('chot-msg', 'Lỗi: ' + err.message, 'error');
    btnXacNhan.disabled = false;
    btnXacNhan.innerHTML = '<i data-lucide="check"></i> Xác nhận Chốt';
    refreshIcons();
  }
});

// ============ XEM CHI TIẾT CA ============
async function moChiTietCa(maBN, ngayMo, hoTen) {
  const modal = document.getElementById('modal-chitiet');
  if (!modal) return;
  document.getElementById('ct-hoten').textContent = hoTen;
  document.getElementById('ct-mabn').textContent = maBN;
  const listEl = document.getElementById('ct-list');
  listEl.innerHTML = '<div style="text-align:center; padding:40px;"><i data-lucide="loader-2" class="spin"></i> Đang tải dữ liệu...</div>';
  modal.classList.remove('hidden');
  refreshIcons();

  try {
    const res = await fetch(`/api/chi-tiet-ca?maBN=${encodeURIComponent(maBN)}&ngayMo=${encodeURIComponent(ngayMo)}`);
    const data = await res.json();
    if (!data.success) {
      listEl.innerHTML = `<div class="msg error">${data.message}</div>`;
      return;
    }
    
    let html = '';

    // Summary info
    if (data.data.summary) {
      const s = data.data.summary;
      const trangThaiVN = chuanHoaTrangThai(s.trangThai);
      html += `<div class="ct-summary-bar">`;
      html += `<span>Trạng thái: <b>${escapeHtml(trangThaiVN)}</b></span>`;
      if (s.nguoiXacNhan) html += ` · Người chốt: <b>${escapeHtml(s.nguoiXacNhan)}</b>`;
      if (s.lastUpdated) html += ` · ${escapeHtml(s.lastUpdated)}`;
      html += `</div>`;
    }
    // Compute repeat and expensive for modal
    let alertsHtml = '';
    let dsLapLai = [];
    if (data.data.danhSachMuc && data.data.danhSachMuc.length) {
      const dsMacTien = [];
      const countMap = {};
      
      data.data.danhSachMuc.forEach(m => {
        if (m.coMacTien) dsMacTien.push({ tenMuc: m.tenMuc, sl: m.sl });
        const nhomNorm = (m.nhom || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd');
        if (nhomNorm.includes('chi dinh')) {
          const key = m.tenMuc.toLowerCase().trim();
          if (!countMap[key]) countMap[key] = { tenMuc: m.tenMuc, count: 0 };
          countMap[key].count += parseInt(m.sl, 10) || 1;
        }
      });
      
      Object.values(countMap).forEach(v => {
        if (v.count >= 2) dsLapLai.push({ tenMuc: v.tenMuc, soLan: v.count });
      });
      
      const fakeCa = {
        noteChung: data.data.summary ? data.data.summary.noteChung : '',
        dsMacTien,
        dsLapLai
      };
      const thongBao = taoThongBaoCard(fakeCa);
      if (thongBao) {
        alertsHtml = `<div style="margin-bottom:16px;">${thongBao}</div>`;
      }
    }
    html += alertsHtml;

    if (!data.data.danhSachMuc || !data.data.danhSachMuc.length) {
      html += '<div class="msg">Chưa có dữ liệu vật tư.</div>';
    } else {
      // Gom theo nhóm giống upload view
      const dsTheoNhom = {};
      data.data.danhSachMuc.forEach(m => {
        const nhom = m.nhom || 'Chưa phân nhóm';
        if (!dsTheoNhom[nhom]) dsTheoNhom[nhom] = [];
        dsTheoNhom[nhom].push(m);
      });

      const thuTuNhom = ['Chỉ định', 'Vật tư y tế', 'Thuốc, dịch truyền', 'Chưa phân nhóm'];
      thuTuNhom.forEach(nhom => {
        if (!dsTheoNhom[nhom]) return;
        html += `<div class="group-block">`;
        html += `<div class="group-title">${escapeHtml(nhom)} <span class="sub-label" style="text-transform:none; letter-spacing:normal;">(${dsTheoNhom[nhom].length} mục)</span></div>`;
        let stt = 0;
        dsTheoNhom[nhom].forEach(m => {
          stt++;
          const isExp = m.coMacTien;
          const isAbnormal = dsLapLai.some(l => l.tenMuc === m.tenMuc);
          const hasNote = m.ghiChu && m.ghiChu.trim();
          html += `
            <div class="item-container${hasNote || isAbnormal ? ' expanded' : ''}">
              <div class="item-row${isExp ? ' mac-tien' : ''}${isAbnormal ? ' lap-lai' : ''}">
                <div style="color:var(--text-secondary); font-weight:500;">${stt}</div>
                <div style="font-weight:500;">${escapeHtml(m.tenMuc)}${isExp ? '<span class="badge badge-expensive">MẮC TIỀN</span>' : ''}</div>
                <div style="color:var(--text-secondary);">${escapeHtml(m.dvt)}</div>
                <div style="font-weight:600;">${escapeHtml(m.sl)}</div>
                <div style="color:var(--text-secondary);">${escapeHtml(m.duongDung || '')}</div>
              </div>
              ${hasNote || isAbnormal ? `<div class="item-note-drawer" style="display:block;">
                  ${isAbnormal ? `<div class="abnormal-text"><i data-lucide="alert-triangle" style="width:12px;height:12px;margin-right:4px;vertical-align:-2px;"></i>⚠ Bất thường: Chỉ định lặp lại nhiều lần</div>` : ''}
                  ${hasNote ? `<div style="font-size:12.5px; color:var(--text-secondary); padding:8px 12px; background:var(--surface-alt); border-left:3px solid var(--apple-blue); border-radius:4px; margin-top:4px;"><i data-lucide="edit-3" style="width:12px;height:12px;margin-right:4px;"></i>${escapeHtml(m.ghiChu)}</div>` : ''}
              </div>` : ''}
            </div>`;
        });
        html += `</div>`;
      });
    }
    listEl.innerHTML = html;
    refreshIcons();
  } catch (err) {
    listEl.innerHTML = `<div class="msg error">Lỗi: ${err.message}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('btn-ct-close');
  if (closeBtn) closeBtn.addEventListener('click', () => {
    document.getElementById('modal-chitiet').classList.add('hidden');
  });
});

// ============ ADMIN PANEL ============
document.getElementById('btn-admin').addEventListener('click', () => {
  stopAutoRefresh();
  switchInnerView('admin');
  loadAdminUsers();
});

document.getElementById('btn-admin-back').addEventListener('click', () => {
  switchInnerView('dashboard');
  loadDashboard();
  startAutoRefresh();
});

async function loadAdminUsers() {
  const container = document.getElementById('admin-user-list');
  container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-secondary);"><i data-lucide="loader-2" class="spin"></i> Đang tải...</div>';
  refreshIcons();

  try {
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    if (!data.success) {
      container.innerHTML = `<div class="msg error">${data.message}</div>`;
      return;
    }

    let html = `<div style="overflow-x:auto;"><table class="admin-table">
      <thead><tr>
        <th>Username</th><th>Họ tên</th><th>Vai trò</th><th>Khoa/Phòng</th><th>Trạng thái</th><th>Thao tác</th>
      </tr></thead><tbody>`;

    data.users.forEach(u => {
      let statusBadge = '';
      if (u.trangThai === 'Active') statusBadge = '<span class="status-badge status-done">Active</span>';
      else if (u.trangThai === 'Cho duyet') statusBadge = '<span class="status-badge status-warn">Chờ duyệt</span>';
      else statusBadge = '<span class="status-badge status-pending">Khóa</span>';

      let actions = '';
      if (u.trangThai === 'Cho duyet') {
        actions = `<button class="btn-sm-green" onclick="adminDuyet('${escapeHtml(u.username)}')">Duyệt</button>`;
      } else if (u.trangThai === 'Active' && u.vaiTro !== 'Admin') {
        actions = `<button class="btn-sm-red" onclick="adminKhoa('${escapeHtml(u.username)}')">Khóa</button>`;
      }

      html += `<tr>
        <td style="font-weight:500;">${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.hoTen)}</td>
        <td>${escapeHtml(u.vaiTro)}</td>
        <td>${escapeHtml(u.khoaPhong)}</td>
        <td>${statusBadge}</td>
        <td>${actions}</td>
      </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="msg error">Lỗi: ${err.message}</div>`;
  }
}

async function adminDuyet(username) {
  try {
    const res = await fetch('/api/admin/duyet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (data.success) loadAdminUsers();
    else alert(data.message);
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

async function adminKhoa(username) {
  if (!confirm(`Khóa tài khoản "${username}"?`)) return;
  try {
    const res = await fetch('/api/admin/khoa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (data.success) loadAdminUsers();
    else alert(data.message);
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

// ============ UTILITIES ============
function hienThongBao(idMsg, text, loai) {
  const el = document.getElementById(idMsg);
  if (!el) return;
  el.textContent = text || '';
  el.className = 'msg' + (loai ? ' ' + loai : '');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
// ============ TAB NAVIGATION ============
if (document.getElementById('nav-dashboard')) {
  document.getElementById('nav-dashboard').addEventListener('click', () => {
    document.getElementById('nav-dashboard').classList.add('active');
    document.getElementById('nav-vattu').classList.remove('active');
    document.getElementById('view-dashboard').classList.remove('hidden');
    document.getElementById('view-vattu').classList.add('hidden');
    if (document.getElementById('view-upload')) document.getElementById('view-upload').classList.add('hidden');
    loadDashboard();
  });
  
  document.getElementById('nav-vattu').addEventListener('click', () => {
    document.getElementById('nav-vattu').classList.add('active');
    document.getElementById('nav-dashboard').classList.remove('active');
    document.getElementById('view-vattu').classList.remove('hidden');
    document.getElementById('view-dashboard').classList.add('hidden');
    if (document.getElementById('view-upload')) document.getElementById('view-upload').classList.add('hidden');
    loadVatTuTongQuan();
    loadVatTuTonKho();
  });
}

// ============ QUẢN LÝ VẬT TƯ TIÊU HAO ============
async function loadVatTuTongQuan() {
  const statsEl = document.getElementById('vattu-stats');
  if (!statsEl) return;
  statsEl.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px;"><i data-lucide="loader-2" class="spin"></i></div>';
  refreshIcons();

  try {
    const res = await fetch('/api/vat-tu/tong-quan');
    const data = await res.json();
    if (!data.success) {
      statsEl.innerHTML = `<div class="msg error">${data.message}</div>`;
      return;
    }

    const d = data.data;
    statsEl.innerHTML = `
      <div class="stat-card">
        <div class="stat-title">Tổng dụng cụ</div>
        <div class="stat-value">${d.tongDungCu}</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Sẵn sàng</div>
        <div class="stat-value green">${d.dangHoatDong}</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Sắp hết</div>
        <div class="stat-value orange">${d.sapHet}</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Đã hết / Khóa</div>
        <div class="stat-value red">${d.daHet}</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Hư hỏng</div>
        <div class="stat-value red">${d.huHong}</div>
      </div>
    `;
    
    // Nếu có cảnh báo, có thể render thêm 1 khu vực alert ở đây.
  } catch (err) {
    statsEl.innerHTML = `<div class="msg error">Lỗi tải dữ liệu.</div>`;
  }
}

async function loadVatTuTonKho() {
  const listEl = document.getElementById('vattu-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="empty-state"><i data-lucide="loader-2" class="spin"></i> Đang tải danh sách tồn kho...</div>';
  refreshIcons();

  try {
    const res = await fetch('/api/vat-tu/ton-kho');
    const data = await res.json();
    if (!data.success) {
      listEl.innerHTML = `<div class="msg error">${data.message}</div>`;
      return;
    }

    if (data.data.length === 0) {
      listEl.innerHTML = '<div class="empty-state">Chưa có dữ liệu tồn kho.</div>';
      return;
    }

    let html = '';
    data.data.forEach(nhom => {
      html += `<div class="vattu-group">`;
      html += `<div class="vattu-group-header">
                 <div>${escapeHtml(nhom.tenVT)}</div>
                 <div style="font-size:13px; color:var(--text-secondary)">SL: ${nhom.danhSach.length}</div>
               </div>`;
      
      nhom.danhSach.forEach(cay => {
        const percent = cay.gioiHan > 0 ? (cay.daDung / cay.gioiHan) * 100 : 0;
        let pClass = '';
        let tClass = '';
        if (cay.trangThai.includes('Hỏng') || cay.trangThai.includes('Hết')) {
          pClass = 'danger';
          tClass = 'color: var(--apple-red);';
        } else if (cay.conLai <= 2) {
          pClass = 'warning';
          tClass = 'color: var(--apple-orange);';
        }
        
        html += `
          <div class="vattu-item">
            <div>
              <div class="vt-name" style="${tClass}">${escapeHtml(cay.maQL)}</div>
              <div class="vt-code">Trạng thái: ${escapeHtml(cay.trangThai)}</div>
            </div>
            <div>
              <div style="font-size:12px; color:var(--text-secondary)">Còn lại</div>
              <div style="font-weight:600">${cay.conLai}/${cay.gioiHan}</div>
            </div>
            <div>
              <div class="progress-wrap">
                <div class="progress-bar ${pClass}" style="width: ${percent}%"></div>
              </div>
              <div class="progress-text">Đã dùng ${cay.daDung}</div>
            </div>
            <div style="text-align:right">
              ${cay.trangThai.includes('Sẵn sàng') ? `<button class="btn-ghost small" onclick="baoHongVatTu('${cay.maQL}')" title="Báo hỏng"><i data-lucide="alert-triangle" style="width:14px; height:14px; color:var(--apple-orange)"></i></button>` : ''}
            </div>
          </div>
        `;
      });
      html += `</div>`;
    });
    listEl.innerHTML = html;
    refreshIcons();
  } catch (err) {
    listEl.innerHTML = `<div class="msg error">Lỗi tải dữ liệu tồn kho.</div>`;
  }
}

// Hàm stub cho Báo hỏng (có thể implement gọi API sau)
window.baoHongVatTu = async function(maQL) {
  if(!confirm(`Xác nhận báo hỏng mã: ${maQL}?`)) return;
  try {
    const res = await fetch('/api/vat-tu/bao-hong', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maQL, lyDo: 'Báo hỏng từ giao diện' })
    });
    const data = await res.json();
    if(data.success) {
      alert("Đã ghi nhận hỏng!");
      loadVatTuTongQuan();
      loadVatTuTonKho();
    } else {
      alert(data.message);
    }
  } catch (e) {
    alert("Lỗi: " + e.message);
  }
}
