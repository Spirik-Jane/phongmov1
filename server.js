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
    const result = await duyetTaiKhoan(req.body.username);
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
    const { maBN, ngayMo, nguoiXacNhan, ghiChuChung, passwordXacNhan } = req.body;
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
    for (let i = 1; i < summaryData.length; i++) {
      if (String(summaryData[i][0] || '').trim() === maBN && String(summaryData[i][2] || '').trim() === ngayMo) {
        dongTimThay = i + 1;
        break;
      }
    }

    const thoiGian = new Date().toLocaleString('vi-VN');
    if (dongTimThay === -1) {
      return res.json({ success: false, message: 'Không tìm thấy ca trong Case_Summary. Hãy upload dữ liệu trước.' });
    }

    // Cập nhật: TrangThai=Da chot, NoteChung, NguoiXacNhanCuoi, ThoiGianXacNhan
    await capNhatVung(`Case_Summary!D${dongTimThay}:G${dongTimThay}`, [
      ['Da chot', ghiChuChung || '', nguoiXacNhan, thoiGian]
    ]);

    res.json({ success: true, message: `Đã chốt vật tư. Người xác nhận: ${nguoiXacNhan}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
