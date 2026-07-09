/**
 * Module xác thực người dùng (Auth)
 * - Đăng nhập: kiểm tra Username/Password từ sheet Users
 * - Đăng ký: thêm user mới với trạng thái "Cho duyet"
 * - Duyệt: Admin chuyển trạng thái sang "Active"
 * - Hash password: sử dụng crypto PBKDF2 (tương thích với format hiện có trong sheet)
 */
const crypto = require('crypto');
const { docSheet, themHang, capNhatVung } = require('./sheetsClient');

const SHEET_USERS = 'Users';

// ---- HASH PASSWORD ----
// Format hiện có trong sheet: "uuid:base64Hash"
// uuid là salt, base64Hash là PBKDF2 của password+salt

function hashPassword(password) {
  const salt = crypto.randomUUID();
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('base64');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, hash] = storedHash.split(':');
  const computed = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('base64');
  return computed === hash;
}

// ---- ĐỌC DANH SÁCH USERS ----
async function layDanhSachUsers() {
  const data = await docSheet(SHEET_USERS);
  if (data.length <= 1) return [];
  // headers: Username, PasswordHash, HoTen, VaiTro, KhoaPhong, TrangThai, Email, NgayTao
  return data.slice(1).map((row, idx) => ({
    rowIndex: idx + 2, // 1-indexed, skip header
    username: String(row[0] || '').trim(),
    passwordHash: String(row[1] || ''),
    hoTen: String(row[2] || ''),
    vaiTro: String(row[3] || ''),
    khoaPhong: String(row[4] || ''),
    trangThai: String(row[5] || ''),
    email: String(row[6] || ''),
    ngayTao: String(row[7] || '')
  }));
}

// ---- ĐĂNG NHẬP ----
async function dangNhap(username, password) {
  const users = await layDanhSachUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase().trim());
  
  if (!user) {
    return { success: false, message: 'Tên đăng nhập không tồn tại.' };
  }
  
  if (user.trangThai !== 'Active') {
    if (user.trangThai === 'Cho duyet') {
      return { success: false, message: 'Tài khoản đang chờ Admin phê duyệt. Vui lòng liên hệ quản trị viên.' };
    }
    return { success: false, message: `Tài khoản bị khóa (Trạng thái: ${user.trangThai}).` };
  }
  
  if (!verifyPassword(password, user.passwordHash)) {
    return { success: false, message: 'Mật khẩu không chính xác.' };
  }
  
  return {
    success: true,
    user: {
      username: user.username,
      hoTen: user.hoTen,
      vaiTro: user.vaiTro,
      khoaPhong: user.khoaPhong,
      email: user.email
    }
  };
}

// ---- ĐĂNG KÝ ----
async function dangKy({ username, password, hoTen, khoaPhong, email, vaiTro }) {
  const users = await layDanhSachUsers();
  const existing = users.find(u => u.username.toLowerCase() === username.toLowerCase().trim());
  
  if (existing) {
    return { success: false, message: 'Tên đăng nhập đã tồn tại.' };
  }
  
  const passHash = hashPassword(password);
  const now = new Date();
  const ngayTao = `${now.toLocaleDateString('vi-VN')} ${now.toLocaleTimeString('vi-VN')}`;
  
  await themHang(SHEET_USERS, [[
    username.trim(),
    passHash,
    hoTen || '',
    vaiTro || 'NV_PM',
    khoaPhong || '',
    'Cho duyet',
    email || '',
    ngayTao
  ]]);
  
  return { success: true, message: 'Đăng ký thành công! Tài khoản đang chờ Admin duyệt.' };
}

// ---- DUYỆT TÀI KHOẢN (Admin) ----
async function duyetTaiKhoan(username) {
  const users = await layDanhSachUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase().trim());
  
  if (!user) return { success: false, message: 'Không tìm thấy user.' };
  if (user.trangThai === 'Active') return { success: false, message: 'Tài khoản đã Active.' };
  
  // Update cell F (col 6) tại row
  await capNhatVung(`${SHEET_USERS}!F${user.rowIndex}`, [['Active']]);
  return { success: true, message: `Đã duyệt tài khoản "${username}".` };
}

// ---- KHÓA TÀI KHOẢN (Admin) ----
async function khoaTaiKhoan(username) {
  const users = await layDanhSachUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase().trim());
  
  if (!user) return { success: false, message: 'Không tìm thấy user.' };
  
  await capNhatVung(`${SHEET_USERS}!F${user.rowIndex}`, [['Khoa']]);
  return { success: true, message: `Đã khóa tài khoản "${username}".` };
}

// ---- XÁC THỰC CHÉO (Bước 3: xác nhận người chốt) ----
async function xacThucCheo(username, password) {
  const users = await layDanhSachUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase().trim());
  
  if (!user) return { success: false, message: 'Không tìm thấy tài khoản.' };
  if (user.trangThai !== 'Active') return { success: false, message: 'Tài khoản không active.' };
  if (!verifyPassword(password, user.passwordHash)) return { success: false, message: 'Mật khẩu sai.' };
  
  return { success: true, hoTen: user.hoTen };
}

// ---- LẤY DANH SÁCH NHÂN VIÊN (từ CSDL_NhanSu) ----
async function layDanhSachNhanSu() {
  try {
    const data = await docSheet('CSDL_NhanSu');
    if (data.length <= 1) return [];
    // headers: MaNV, TenDayDu, TenTrenLich, NhomNS_Chinh, ChuyenMon, ZaloID, TrangThai, Email
    return data.slice(1).map(row => ({
      maNV: String(row[0] || ''),
      tenDayDu: String(row[1] || ''),
      tenTrenLich: String(row[2] || ''),
      nhom: String(row[3] || ''),
      chuyenMon: String(row[4] || '')
    }));
  } catch (err) {
    console.error('Lỗi đọc CSDL_NhanSu:', err);
    return [];
  }
}

module.exports = {
  dangNhap,
  dangKy,
  duyetTaiKhoan,
  khoaTaiKhoan,
  xacThucCheo,
  layDanhSachNhanSu,
  layDanhSachUsers,
  verifyPassword
};
