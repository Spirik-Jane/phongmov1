require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const { phanTichPhieuHtml } = require('./src/parsePhieu');
const { timCacCaTheoPID, timCaTheoPidHoacTen } = require('./src/matching');
const { layDanhSachTuKhoaMacTien, kiemTraMacTien, layDuLieuCaCu, ghiDuLieuCa, layChiTietCa, chuanHoaTen } = require('./src/dataLog');
const { dangNhap, dangKy, duyetTaiKhoan, khoaTaiKhoan, xacThucCheo, layDanhSachNhanSu, layDanhSachUsers } = require('./src/auth');
const { capNhatVung } = require('./src/sheetsClient');
const vatTu = require('./src/vatTu');

// ============ EMAIL (NODEMAILER) ============
let nodemailer;
try { nodemailer = require('nodemailer'); } catch(e) { nodemailer = null; }

async function guiEmailDuyetTaiKhoan(user) {
  if (!nodemailer) { console.log('[Email] Nodemailer chưa cài đặt, bỏ qua gửi email.'); return; }
  if (!process.env.EMAIL_PASS) { console.log('[Email] EMAIL_PASS chưa cấu hình trong .env, bỏ qua.'); return; }
  if (!user.email) { console.log('[Email] User chưa có email, bỏ qua.'); return; }

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: false,
    auth: { user: 'gaymehoisuc@bvdkgiadinh.com', pass: process.env.EMAIL_PASS }
  });

  const vaiTroLabel = user.vaiTro === 'NV_PM' ? 'Nhân viên Phòng Mổ' : 'Nhân viên Khoa/Trại';
  const huongDan = user.vaiTro === 'NV_PM'
    ? `Bạn có quyền truy cập vào 2 chức năng:\n\n1. **Dữ liệu HIS**: Xem lịch mổ, upload file HIS, chốt vật tư cho từng ca mổ, ghi chú liên lạc với khoa trại.\n2. **Quản lý Thuốc & Vật Tư**: Theo dõi tồn kho, nhập kho, báo hỏng và xuất báo cáo vật tư tiêu hao.`
    : `Bạn có quyền truy cập vào chức năng:\n\n1. **Dữ liệu HIS**: Xem lịch mổ theo ngày, tìm kiếm theo PID hoặc tên bệnh nhân, kiểm tra trạng thái chốt vật tư và ghi chú cho Phòng Mổ.`;

  await transporter.sendMail({
    from: `"Khoa PT-Gây Mê Hồi Sức - BVĐK Gia Định" <gaymehoisuc@bvdkgiadinh.com>`,
    to: user.email,
    subject: '[PM System] Tài khoản của bạn đã được kích hoạt',
    text: [
      `Kính gửi ${user.hoTen},`,
      ``,
      `Tài khoản PM System của bạn (username: ${user.username}) với vai trò [${vaiTroLabel}] đã được phê duyệt và kích hoạt.`,
      ``,
      huongDan,
      ``,
      `Truy cập hệ thống tại địa chỉ nội bộ do bộ phận IT cung cấp.`,
      ``,
      `Trân trọng,`,
      `Khoa Phẫu Thuật - Gây Mê Hồi Sức`,
      `Bệnh Viện Đa Khoa Gia Định`
    ].join('\n')
  });
  console.log(`[Email] Đã gửi email kích hoạt tới ${user.email}`);
}

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============ SESSION ĐƠN GIẢN (IN-MEMORY, phù hợp server local BV) ============
const sessions = {};
const SESSION_COOKIE = 'pm_session';
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000; // 8 giờ

function taoSession(userData) {
  const id = crypto.randomUUID();
  sessions[id] = { ...userData, createdAt: Date.now() };
  return id;
}

function laySession(req) {
  // Lấy session từ cookie hoặc header
  let sid = null;
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (match) sid = match[1];
  if (!sid) sid = req.headers['x-session-id'];
  if (!sid || !sessions[sid]) return null;
  // Check expiry
  if (Date.now() - sessions[sid].createdAt > SESSION_MAX_AGE) {
    delete sessions[sid];
    return null;
  }
  return sessions[sid];
}

// Middleware kiểm tra đăng nhập (chỉ áp dụng cho API cần auth)
function yeuCauDangNhap(req, res, next) {
  const session = laySession(req);
  if (!session) {
    return res.status(401).json({ success: false, message: 'Chưa đăng nhập.', requireLogin: true });
  }
  req.currentUser = session;
  next();
}

// Middleware kiểm tra vai trò được phép truy cập Vật tư
function yeuCauQuyenVatTu(req, res, next) {
  const vaiTro = req.currentUser.vaiTro;
  // Khoa Trại chỉ xem HIS, không được truy cập Vật tư
  // NV PM, Phụ trách, Admin... thì được
  if (vaiTro === 'NV_KHOA_TRAI') {
    return res.status(403).json({ success: false, message: 'Bạn thuộc Khoa Trại, không có quyền truy cập Vật tư phòng mổ.' });
  }
  next();
}

function yeuCauAdmin(req, res, next) {
  if (req.currentUser.vaiTro !== 'Admin') {
    return res.status(403).json({ success: false, message: 'Bạn không có quyền quản trị.' });
  }
  next();
}

// ============ PHÂN TÍCH FILE (chưa ghi dữ liệu) ============
app.post('/api/phan-tich', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Không nhận được file.' });
    }

    const html = req.file.buffer.toString('utf8');
    const { dauPhieu, danhSachMuc } = phanTichPhieuHtml(html);

    if (!dauPhieu.maBN) {
      return res.json({ success: false, message: 'Không tìm được Mã ID trong file. Kiểm tra đúng file HTML export từ HIS.' });
    }
    if (!danhSachMuc.length) {
      return res.json({ success: false, message: 'Không đọc được mục nào (Chỉ định/Vật tư/Thuốc) trong file.' });
    }

    const dsMacTien = await layDanhSachTuKhoaMacTien();
    danhSachMuc.forEach((m) => { m.coMacTien = kiemTraMacTien(m.tenMuc, dsMacTien); });

    const cacCa = await timCacCaTheoPID(dauPhieu.maBN);

    res.json({ success: true, tenFile: req.file.originalname, dauPhieu, danhSachMuc, cacCa });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

// ============ KIỂM TRA DỮ LIỆU CŨ VÀ TẠO DIFF ============
app.post('/api/kiem-tra-cap-nhat', async (req, res) => {
  try {
    const { maBN, ngayMo, danhSachMucMoi } = req.body;
    if (!maBN || !ngayMo || !danhSachMucMoi) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin' });
    }

    const { soLanUploadTruoc, danhSachMucCu } = await layDuLieuCaCu(maBN, ngayMo);
    if (soLanUploadTruoc === 0) {
      return res.json({ success: true, coDuLieuCu: false });
    }

    // Logic diff
    const mapCu = {};
    danhSachMucCu.forEach(m => {
      const ten = chuanHoaTen(m.tenMuc);
      mapCu[ten] = m;
    });

    const mapMoi = {};
    danhSachMucMoi.forEach(m => {
      const ten = chuanHoaTen(m.tenMuc);
      mapMoi[ten] = m;
    });

    const them = [];
    const xoa = [];
    const doi = [];
    const giuNguyen = [];

    // Kiểm tra thêm mới, thay đổi, giữ nguyên
    danhSachMucMoi.forEach(mMoi => {
      const ten = chuanHoaTen(mMoi.tenMuc);
      const mCu = mapCu[ten];
      if (!mCu) {
        them.push(mMoi);
      } else {
        // So sánh số lượng (SL) - parse Float để tránh so sánh chuỗi lỗi
        const parseSoLuong = (val) => {
          if (val == null || val === '') return 0;
          const str = String(val).replace(/,/g, '.').trim();
          const num = parseFloat(str);
          return isNaN(num) ? String(val).trim() : num;
        };

        if (parseSoLuong(mCu.sl) !== parseSoLuong(mMoi.sl)) {
          doi.push({ cu: mCu, moi: mMoi });
        } else {
          giuNguyen.push(mMoi);
        }
      }
    });

    // Kiểm tra xóa
    danhSachMucCu.forEach(mCu => {
      const ten = chuanHoaTen(mCu.tenMuc);
      if (!mapMoi[ten]) {
        xoa.push(mCu);
      }
    });

    res.json({
      success: true,
      coDuLieuCu: true,
      soLanUploadTruoc,
      chiTietDiff: { them, xoa, doi, giuNguyen }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

// ============ XÁC NHẬN & GHI DỮ LIỆU ============
app.post('/api/luu', async (req, res) => {
  try {
    const { maBN, hoTen, ngayMo, tenFile, danhSachMuc, nguoiUpload } = req.body;
    if (!maBN || !ngayMo || !danhSachMuc || !danhSachMuc.length) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin để lưu (Mã BN / Ngày mổ / danh sách mục).' });
    }

    const ketQua = await ghiDuLieuCa({
      maBN, hoTen, ngayMo, tenFile,
      nguoiUpload: nguoiUpload || 'chua-dang-nhap',
      danhSachMuc
    });

    res.json({ success: true, ...ketQua });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

// ============ TÌM CA THỦ CÔNG THEO PID/TÊN ============
app.get('/api/tim-ca', async (req, res) => {
  try {
    const ketQua = await timCaTheoPidHoacTen(req.query.q || '');
    res.json({ success: true, ketQua });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ LẤY DỮ LIỆU DASHBOARD ============
app.get('/api/dashboard', async (req, res) => {
  try {
    const date = req.query.date; // format YYYY-MM-DD
    if (!date) {
      return res.status(400).json({ success: false, message: 'Thiếu tham số date' });
    }
    const { layDanhSachDashboard } = require('./src/dataLog');
    const data = await layDanhSachDashboard(date);
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

// ============ LẤY CHI TIẾT CA ============
app.get('/api/chi-tiet-ca', yeuCauDangNhap, async (req, res) => {
  try {
    const { maBN, ngayMo } = req.query;
    if (!maBN || !ngayMo) return res.status(400).json({ success: false, message: 'Thiếu maBN hoặc ngayMo' });
    const data = await layChiTietCa(maBN, ngayMo);
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

// ============ AUTH API ============
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Thiếu tên đăng nhập hoặc mật khẩu.' });
    }
    const result = await dangNhap(username, password);
    if (!result.success) return res.json(result);

    const sid = taoSession(result.user);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; Max-Age=${SESSION_MAX_AGE / 1000}`);
    res.json({ success: true, user: result.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, hoTen, khoaPhong, email, vaiTro } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Thiếu tên đăng nhập hoặc mật khẩu.' });
    }
    const result = await dangKy({ username, password, hoTen, khoaPhong, email, vaiTro });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

app.post('/api/logout', (req, res) => {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (match && sessions[match[1]]) delete sessions[match[1]];
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  const session = laySession(req);
  if (!session) return res.json({ success: false, loggedIn: false });
  res.json({ success: true, loggedIn: true, user: { username: session.username, hoTen: session.hoTen, vaiTro: session.vaiTro, khoaPhong: session.khoaPhong } });
});

// ============ ADMIN API ============
app.get('/api/admin/users', yeuCauDangNhap, yeuCauAdmin, async (req, res) => {
  try {
    const users = await layDanhSachUsers();
    res.json({ success: true, users: users.map(u => ({ username: u.username, hoTen: u.hoTen, vaiTro: u.vaiTro, khoaPhong: u.khoaPhong, trangThai: u.trangThai, email: u.email, ngayTao: u.ngayTao })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/duyet', yeuCauDangNhap, yeuCauAdmin, async (req, res) => {
  try {
    const users = await layDanhSachUsers();
    const targetUser = users.find(u => u.username === req.body.username);
    const result = await duyetTaiKhoan(req.body.username);
    if (result.success && targetUser && targetUser.email) {
      guiEmailDuyetTaiKhoan(targetUser).catch(e => console.error('Email error:', e.message));
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/khoa', yeuCauDangNhap, yeuCauAdmin, async (req, res) => {
  try {
    const result = await khoaTaiKhoan(req.body.username);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ USER PROFILE ============
app.put('/api/users/profile', yeuCauDangNhap, async (req, res) => {
  try {
    const { hoTen, khoaPhong, email, newPassword } = req.body;
    const { updateProfile, hashPassword } = require('./src/auth');
    
    let newPasswordHash = undefined;
    if (newPassword) {
      newPasswordHash = hashPassword(newPassword);
    }
    
    const result = await updateProfile(req.currentUser.username, { hoTen, khoaPhong, email, newPasswordHash });
    
    if (result.success) {
      // Cập nhật session
      const session = laySession(req);
      if (session) {
        if (hoTen) session.hoTen = hoTen;
        if (khoaPhong) session.khoaPhong = khoaPhong;
        if (email !== undefined) session.email = email;
      }
      res.json(result);
    } else {
      res.json(result);
    }
  } catch (err) {
    console.error('Lỗi profile:', err);
    res.json({ success: false, message: 'Lỗi server.' });
  }
});

// ============ GHI CHÚ CA MỔ ============
app.put('/api/his/note', yeuCauDangNhap, async (req, res) => {
  try {
    const { maBN, ngayMo, ghiChu, nguoiGhi, khoaGhi, passwordXacNhan } = req.body;
    if (!maBN || !ngayMo || !ghiChu || !nguoiGhi) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin ghi chú.' });
    }
    // Xác thực chéo
    const currentUser = req.currentUser;
    if (currentUser.hoTen !== nguoiGhi) {
      if (!passwordXacNhan) {
        return res.json({ success: false, needPassword: true, message: 'Cần mật khẩu của người ghi chú.' });
      }
      const users = await layDanhSachUsers();
      const targetUser = users.find(u => u.hoTen === nguoiGhi && u.trangThai === 'Active');
      if (!targetUser) return res.json({ success: false, message: 'Người ghi chú không có tài khoản Active.' });
      const xacThuc = await xacThucCheo(targetUser.username, passwordXacNhan);
      if (!xacThuc.success) return res.json({ success: false, message: 'Mật khẩu xác nhận sai.' });
    }
    // Ghi vào Google Sheets (cột H = Note)
    const { docSheet, capNhatVung } = require('./src/sheetsClient');
    const summaryData = await docSheet('Case_Summary');
    let dongTimThay = -1;
    for (let i = 1; i < summaryData.length; i++) {
      if (String(summaryData[i][0] || '').trim() === maBN && String(summaryData[i][2] || '').trim() === ngayMo) {
        dongTimThay = i + 1;
        break;
      }
    }
    if (dongTimThay === -1) return res.json({ success: false, message: 'Không tìm thấy ca mổ.' });
    const thoiGian = new Date().toLocaleString('vi-VN');
    const noteText = `[${thoiGian}] ${nguoiGhi} (${khoaGhi}): ${ghiChu}`;
    await capNhatVung(`Case_Summary!H${dongTimThay}`, [[noteText]]);
    res.json({ success: true, note: noteText });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi: ' + err.message });
  }
});

// ============ DANH SÁCH NHÂN VIÊN (cho dropdown chốt) ============
app.get('/api/nhan-su', yeuCauDangNhap, async (req, res) => {
  try {
    const ds = await layDanhSachNhanSu();
    res.json({ success: true, data: ds });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ CHỐT VẬT TƯ ============
app.post('/api/chot-vat-tu', yeuCauDangNhap, async (req, res) => {
  try {
    const { maBN, ngayMo, nguoiXacNhan, ghiChuChung, passwordXacNhan, danhSachVatTuChon } = req.body;
    if (!maBN || !ngayMo || !nguoiXacNhan) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin chốt.' });
    }

    // Xác thực chéo: nếu người xác nhận khác người đang đăng nhập thì cần mật khẩu
    const currentUser = req.currentUser;
    if (currentUser.hoTen !== nguoiXacNhan) {
      if (!passwordXacNhan) {
        return res.json({ success: false, needPassword: true, message: 'Cần mật khẩu của người xác nhận.' });
      }
      // Tìm username của người xác nhận dựa trên HoTen
      const users = await layDanhSachUsers();
      const targetUser = users.find(u => u.hoTen === nguoiXacNhan && u.trangThai === 'Active');
      if (!targetUser) {
        return res.json({ success: false, message: 'Người xác nhận không có tài khoản Active.' });
      }
      const xacThuc = await xacThucCheo(targetUser.username, passwordXacNhan);
      if (!xacThuc.success) {
        return res.json({ success: false, message: 'Mật khẩu xác nhận sai.' });
      }
    }

    // Cập nhật Case_Summary: tìm dòng theo maBN + ngayMo
    const { docSheet } = require('./src/sheetsClient');
    const summaryData = await docSheet('Case_Summary');
    let dongTimThay = -1;
    let infoCa = {}; // Lấy thêm infoCa để log
    for (let i = 1; i < summaryData.length; i++) {
      if (String(summaryData[i][0] || '').trim() === maBN && String(summaryData[i][2] || '').trim() === ngayMo) {
        dongTimThay = i + 1;
        infoCa = { hoTenBN: summaryData[i][1] };
        break;
      }
    }

    const thoiGian = new Date().toLocaleString('vi-VN');
    if (dongTimThay === -1) {
      return res.json({ success: false, message: 'Không tìm thấy ca trong Case_Summary. Hãy upload dữ liệu trước.' });
    }

    // Log_SuDung cần đủ thông tin lâm sàng của đúng ca đã chọn, không chỉ Họ tên từ Case_Summary.
    const cacCaDangKy = await timCacCaTheoPID(maBN);
    const caDangKy = cacCaDangKy.find(ca => String(ca.thoiGianMo || '').trim() === String(ngayMo).trim());
    if (caDangKy) {
      infoCa = {
        ...infoCa,
        chanDoan: caDangKy.chanDoan || '',
        pppt: caDangKy.pppt || '',
        ptv: caDangKy.ptv || ''
      };
    }

    // Chỉ chốt khi đã chọn đủ các cây vật tư được yêu cầu bởi chỉ định đã khớp.
    const danhSachGoiY = await vatTu.goiYChiDinh(maBN, ngayMo);
    const kiemTraVatTu = vatTu.kiemTraLuaChonVatTu(danhSachVatTuChon, danhSachGoiY);
    if (!kiemTraVatTu.hopLe) {
      return res.json({ success: false, message: kiemTraVatTu.message });
    }

    // Cập nhật: TrangThai=Da chot, NoteChung, NguoiXacNhanCuoi, ThoiGianXacNhan
    await capNhatVung(`Case_Summary!D${dongTimThay}:G${dongTimThay}`, [
      ['Da chot', ghiChuChung || '', nguoiXacNhan, thoiGian]
    ]);

    // Hook: Xử lý vật tư tiêu hao nếu có chọn
    if (danhSachVatTuChon && danhSachVatTuChon.length > 0) {
      await vatTu.xuLyKhiChot(maBN, ngayMo, infoCa, danhSachVatTuChon);
    }

    res.json({ success: true, message: `Đã chốt vật tư. Người xác nhận: ${nguoiXacNhan}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

// ============ API VẬT TƯ TIÊU HAO ============

app.get('/api/vat-tu/tong-quan', yeuCauDangNhap, yeuCauQuyenVatTu, async (req, res) => {
  try {
    const data = await vatTu.layTongQuan();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/vat-tu/ton-kho', yeuCauDangNhap, yeuCauQuyenVatTu, async (req, res) => {
  try {
    const data = await vatTu.layTonKho();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/vat-tu/goi-y-chi-dinh', yeuCauDangNhap, yeuCauQuyenVatTu, async (req, res) => {
  try {
    const { maBN, ngayMo } = req.query;
    if (!maBN || !ngayMo) return res.status(400).json({ success: false, message: 'Thiếu maBN hoặc ngayMo' });
    const data = await vatTu.goiYChiDinh(maBN, ngayMo);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Khớp ngay dữ liệu vừa phân tích, không cần chờ lưu vào Data_Log.
app.post('/api/vat-tu/goi-y-tu-upload', yeuCauDangNhap, yeuCauQuyenVatTu, async (req, res) => {
  try {
    const { danhSachMuc } = req.body;
    if (!Array.isArray(danhSachMuc)) {
      return res.status(400).json({ success: false, message: 'Thiếu danh sách chỉ định.' });
    }
    const data = await vatTu.goiYChiDinhTuDanhSachMuc(danhSachMuc);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/vat-tu/nhap', yeuCauDangNhap, yeuCauQuyenVatTu, async (req, res) => {
  try {
    const { tenVatTu, maKeToan, gioiHan, soLuong, nguoiNhap, matKhauXacNhan } = req.body;
    let tenNguoiNhap = req.currentUser.hoTen;

    // Nếu chọn người khác nhập
    if (nguoiNhap && nguoiNhap !== req.currentUser.username) {
      // Xác thực người được chọn
      const kqXacThuc = await xacThucCheo(nguoiNhap, matKhauXacNhan || '');
      if (!kqXacThuc.success) {
        return res.status(403).json({ success: false, message: 'Xác thực chéo thất bại: ' + kqXacThuc.message });
      }
      tenNguoiNhap = kqXacThuc.hoTen;
    }

    const result = await vatTu.nhapVatTuMoi({
      code: maKeToan,
      tenVatTu,
      soLuong,
      gioiHan,
      nguoiNhap: tenNguoiNhap
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/vat-tu/bao-hong', yeuCauDangNhap, yeuCauQuyenVatTu, async (req, res) => {
  try {
    const { maQL, lyDo } = req.body;
    if (!maQL) return res.status(400).json({ success: false, message: 'Thiếu mã quản lý' });
    const result = await vatTu.baoHongVatTu(maQL, lyDo || '');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/vat-tu/bao-cao', yeuCauDangNhap, yeuCauQuyenVatTu, async (req, res) => {
  try {
    const { maQL } = req.query;
    if (!maQL) return res.status(400).json({ success: false, message: 'Thiếu mã quản lý (maQL)' });
    const data = await vatTu.layLichSuVatTu(maQL);
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

// ============ XUẤT BÁO CÁO QUA GOOGLE SHEETS (GIỐNG GAS CŨ) ============
app.get('/api/vat-tu/export', yeuCauDangNhap, yeuCauQuyenVatTu, async (req, res) => {
  const { maQL, type } = req.query;
  if (!maQL || !type) return res.status(400).json({ success: false, message: 'Thiếu maQL hoặc type' });

  let sheetIdToDelete = null;
  try {
    // 1. Tạo sheet tạm + format đẹp trên Google Sheets
    const exportResult = await vatTu.xuatBaoCao(maQL);
    sheetIdToDelete = exportResult.sheetId;

    const exportUrl = type === 'excel' ? exportResult.excelUrl : exportResult.pdfUrl;
    const ext = type === 'excel' ? 'xlsx' : 'pdf';
    const mimeType = type === 'excel'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';

    // 2. Fetch file từ Google bằng Service Account token
    const { google } = require('googleapis');
    const KEY_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './credentials/service-account.json';
    const auth = new google.auth.GoogleAuth({
      keyFile: KEY_FILE,
      scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly']
    });
    const authClient = await auth.getClient();
    const tokenResponse = await authClient.getAccessToken();
    const accessToken = tokenResponse.token || tokenResponse.res?.data?.access_token;

    const googleRes = await fetch(exportUrl, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });

    if (!googleRes.ok) {
      throw new Error('Google trả lỗi: ' + googleRes.status + ' ' + googleRes.statusText);
    }

    // 3. Stream file về client
    res.setHeader('Content-Type', mimeType);
    const safeMaQL = maQL.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9-]/g, "_");
    res.setHeader('Content-Disposition', `attachment; filename="BaoCao_${safeMaQL}.${ext}"`);

    // Pipe response body
    if (googleRes.body && typeof googleRes.body.pipe === 'function') {
      googleRes.body.pipe(res);
      googleRes.body.on('end', () => {
        // 4. Xóa sheet tạm sau khi stream xong
        vatTu.xoaSheetTam(sheetIdToDelete).catch(e => console.error('Cleanup error:', e));
      });
    } else {
      // Fallback: dùng arrayBuffer
      const buffer = Buffer.from(await googleRes.arrayBuffer());
      res.send(buffer);
      vatTu.xoaSheetTam(sheetIdToDelete).catch(e => console.error('Cleanup error:', e));
    }
  } catch (err) {
    console.error('Export error:', err);
    // Nếu lỗi, vẫn cố xóa sheet tạm
    if (sheetIdToDelete) {
      vatTu.xoaSheetTam(sheetIdToDelete).catch(() => { });
    }
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Lỗi xuất báo cáo: ' + err.message });
    }
  }
});

app.get('/api/vat-tu/danh-muc', yeuCauDangNhap, yeuCauQuyenVatTu, async (req, res) => {
  try {
    const data = await vatTu.layDanhMucVatTu();
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

// Endpoint cho list nhân sự PM (dùng cho xác thực chéo + dropdown nhập kho)
app.get('/api/users', yeuCauDangNhap, async (req, res) => {
  try {
    // Chỉ trả về users có role không phải Khoa Trai để họ chọn
    const users = await layDanhSachUsers();
    const activeUsers = users
      .filter(u => u.trangThai === 'Active' && u.vaiTro !== 'Khoa Trai')
      .map(u => ({ username: u.username, hoTen: u.hoTen, vaiTro: u.vaiTro }));
    res.json({ success: true, data: activeUsers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const os = require('os');
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  const localIp = getLocalIp();
  console.log(`==================================================`);
  console.log(` Server đang chạy thành công!`);
  console.log(` - Truy cập tại máy này:  http://localhost:${PORT}`);
  console.log(` - Truy cập từ MÁY KHÁC (cùng wifi/LAN): http://${localIp}:${PORT}`);
  console.log(`==================================================`);
});

