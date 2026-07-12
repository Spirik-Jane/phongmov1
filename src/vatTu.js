const { docSheetVatTu, capNhatVungVatTu, themHangVatTu } = require('./sheetsClient');
const { guiThongBaoVatTu } = require('./zaloNotify');

// Helper chuẩn hóa chuỗi để so khớp
function normalizeStr(str) {
  return (str || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}

// 1. Lấy tổng quan (Dashboard Vật Tư)
async function layTongQuan() {
  const db = await docSheetVatTu('DB_VatTu');
  const result = {
    tongDungCu: 0,
    dangHoatDong: 0,
    sapHet: 0,
    daHet: 0,
    huHong: 0,
    danhSachCanhBao: []
  };

  for (let i = 1; i < db.length; i++) {
    const maQL = String(db[i][0] || '').trim();
    if (!maQL) continue;
    
    result.tongDungCu++;
    
    const tenVT = String(db[i][2] || '').trim();
    const gioiHan = parseInt(db[i][3]) || 0;
    const daDung = parseInt(db[i][4]) || 0;
    const trangThai = String(db[i][5] || '');

    if (trangThai.includes('Hỏng')) {
      result.huHong++;
    } else if (trangThai.includes('Hết')) {
      result.daHet++;
      result.danhSachCanhBao.push({ maQL, tenVT, daDung, gioiHan, trangThai: 'Đã hết' });
    } else if (trangThai.includes('Sẵn sàng')) {
      if (daDung > 0) result.dangHoatDong++;
      
      const conLai = gioiHan - daDung;
      if (conLai <= 2) {
        result.sapHet++;
        result.danhSachCanhBao.push({ maQL, tenVT, daDung, gioiHan, trangThai: 'Sắp hết' });
      }
    }
  }

  return result;
}

// 2. Lấy tồn kho chi tiết
async function layTonKho() {
  const db = await docSheetVatTu('DB_VatTu');
  const tonKho = {};

  for (let i = 1; i < db.length; i++) {
    const maQL = String(db[i][0] || '').trim();
    if (!maQL) continue;

    const maBC = String(db[i][1] || '').trim();
    const tenVT = String(db[i][2] || '').trim();
    const gioiHan = parseInt(db[i][3]) || 0;
    const daDung = parseInt(db[i][4]) || 0;
    const trangThai = String(db[i][5] || '');
    const thongBao = String(db[i][7] || '');

    if (!tonKho[tenVT]) {
      tonKho[tenVT] = { tenVT, danhSach: [] };
    }

    tonKho[tenVT].danhSach.push({
      maQL, maBC, gioiHan, daDung, conLai: gioiHan - daDung, trangThai, thongBao
    });
  }

  return Object.values(tonKho);
}

// 3. Khớp chỉ định (Lấy gợi ý cho Frontend khi bấm Chốt ca)
async function goiYChiDinh(maBN, ngayMo) {
  // Lấy Data_Log từ sheet chính
  const { docSheet } = require('./sheetsClient');
  const dataLog = await docSheet('Data_Log');
  
  // Tìm các chỉ định của ca này (lấy lần upload mới nhất)
  let maxLanUpload = 0;
  for (let i = 1; i < dataLog.length; i++) {
    if (String(dataLog[i][0] || '').trim() === maBN && String(dataLog[i][2] || '').trim() === ngayMo) {
      maxLanUpload = Math.max(maxLanUpload, Number(dataLog[i][11]) || 0);
    }
  }
  
  if (maxLanUpload === 0) return [];
  
  const chiDinhCuaCa = [];
  for (let i = 1; i < dataLog.length; i++) {
    if (String(dataLog[i][0] || '').trim() === maBN && 
        String(dataLog[i][2] || '').trim() === ngayMo &&
        Number(dataLog[i][11]) === maxLanUpload) {
      chiDinhCuaCa.push(normalizeStr(dataLog[i][5])); // tenMuc
    }
  }

  // Đọc KhopChiDinh (bảng ánh xạ)
  const khopData = await docSheetVatTu('KhopChiDinh');
  const dsAnhXa = [];
  // Bảng KhopChiDinh: A=Từ khóa HIS, B=Tên vật tư
  if (khopData && khopData.length > 0) {
    for (let i = 1; i < khopData.length; i++) {
      const keyword = normalizeStr(khopData[i][0]);
      const tenVatTu = String(khopData[i][1] || '').trim();
      if (keyword && tenVatTu) {
        dsAnhXa.push({ keyword, tenVatTu });
      }
    }
  }

  // Tìm tên vật tư cần thiết cho ca mổ
  const tenVatTuCanDung = new Set();
  for (const tenChiDinh of chiDinhCuaCa) {
    for (const anhXa of dsAnhXa) {
      if (tenChiDinh.includes(anhXa.keyword) || anhXa.keyword.includes(tenChiDinh)) {
        tenVatTuCanDung.add(anhXa.tenVatTu);
      }
    }
  }

  if (tenVatTuCanDung.size === 0) return [];

  // Tìm các cây Sẵn sàng trong DB_VatTu
  const db = await docSheetVatTu('DB_VatTu');
  const danhSachGoiY = [];
  
  for (const tenVT of tenVatTuCanDung) {
    const cacCaySanSang = [];
    for (let i = 1; i < db.length; i++) {
      const dbTenVT = String(db[i][2] || '').trim();
      const trangThai = String(db[i][5] || '');
      if (dbTenVT === tenVT && trangThai.includes('Sẵn sàng')) {
        const daDung = parseInt(db[i][4]) || 0;
        const gioiHan = parseInt(db[i][3]) || 0;
        cacCaySanSang.push({
          maQL: String(db[i][0] || '').trim(),
          tenVT: dbTenVT,
          daDung,
          gioiHan,
          dongTrongDB: i + 1
        });
      }
    }
    
    // Sort ưu tiên cây đã dùng nhiều nhất (để dùng cho hết)
    cacCaySanSang.sort((a, b) => b.daDung - a.daDung);
    danhSachGoiY.push({
      tenVatTuYeuCau: tenVT,
      danhSachCay: cacCaySanSang // Trả về tất cả để frontend hiện dropdown
    });
  }

  return danhSachGoiY;
}

// 4. Xử lý ghi nhận sử dụng (Sau khi user chọn các cây cụ thể)
async function xuLyKhiChot(maBN, ngayMo, infoCa, danhSachVatTuChon) {
  if (!danhSachVatTuChon || danhSachVatTuChon.length === 0) return;

  const db = await docSheetVatTu('DB_VatTu');
  const thoiGianGhi = new Date().toLocaleString('vi-VN');
  const logsToInsert = [];

  for (const maQLChon of danhSachVatTuChon) {
    // Tìm dòng tương ứng trong DB_VatTu
    let dongTimThay = -1;
    let tenVT = '';
    let gioiHan = 0;
    let daDung = 0;

    for (let i = 1; i < db.length; i++) {
      if (String(db[i][0] || '').trim() === maQLChon) {
        dongTimThay = i + 1;
        tenVT = String(db[i][2] || '').trim();
        gioiHan = parseInt(db[i][3]) || 0;
        daDung = parseInt(db[i][4]) || 0;
        break;
      }
    }

    if (dongTimThay > -1) {
      const daDungMoi = daDung + 1;
      let trangThaiMoi = "🟢 Sẵn sàng";
      let guiZalo = null;

      if (daDungMoi >= gioiHan) {
        trangThaiMoi = "🔴 Hết";
        guiZalo = "HẾT HẠN";
      } else if (daDungMoi === gioiHan - 1 || daDungMoi === gioiHan - 2) {
        guiZalo = "SẮP HẾT";
      }

      // Cập nhật cell DB_VatTu
      await capNhatVungVatTu(`DB_VatTu!E${dongTimThay}:F${dongTimThay}`, [[daDungMoi, trangThaiMoi]]);

      // Lưu trữ log để insert bulk
      // Log_SuDung: ThoiGian, MaBN, HoTenBN, ChanDoan, PPPT, PTV, MaQL_VatTu, LanDungThu
      logsToInsert.push([
        thoiGianGhi, maBN, infoCa.hoTenBN || '', infoCa.chanDoan || '', infoCa.pppt || '', infoCa.ptv || '', maQLChon, daDungMoi
      ]);

      // Gửi Zalo nếu cần (asynchronous chạy ngầm)
      if (guiZalo) {
        guiThongBaoVatTu(tenVT, maQLChon, gioiHan, daDungMoi, guiZalo).catch(err => console.error("Lỗi gửi Zalo ngầm:", err));
      }
    }
  }

  if (logsToInsert.length > 0) {
    await themHangVatTu('Log_SuDung', logsToInsert);
  }
}

// 5. Báo hỏng
async function baoHongVatTu(maQL, lyDo) {
  const db = await docSheetVatTu('DB_VatTu');
  let dongTimThay = -1;
  let tenVT = '';
  let gioiHan = 0;
  let daDung = 0;

  for (let i = 1; i < db.length; i++) {
    if (String(db[i][0] || '').trim() === maQL) {
      dongTimThay = i + 1;
      tenVT = String(db[i][2] || '').trim();
      gioiHan = parseInt(db[i][3]) || 0;
      daDung = parseInt(db[i][4]) || 0;
      break;
    }
  }

  if (dongTimThay === -1) throw new Error('Không tìm thấy mã vật tư này.');

  const trangThaiMoi = `🔴 Hỏng - ${lyDo}`;
  await capNhatVungVatTu(`DB_VatTu!F${dongTimThay}:F${dongTimThay}`, [[trangThaiMoi]]);

  // Gửi Zalo báo hỏng
  guiThongBaoVatTu(tenVT, maQL, gioiHan, daDung, "HỎNG").catch(err => console.error(err));
  
  return { success: true };
}

// 6. Nhập vật tư mới
async function nhapVatTuMoi(data) {
  const { code, tenVatTu, soLuong, gioiHan } = data;
  
  const db = await docSheetVatTu('DB_VatTu');
  let maxSuffix = 0;
  const prefix = tenVatTu.trim();

  // Tìm index lớn nhất hiện tại (VD: Dao Harmonic-005 thì max = 5)
  for (let i = 1; i < db.length; i++) {
    const maQL = String(db[i][0] || '').trim();
    if (maQL.startsWith(prefix)) {
      const parts = maQL.split('-');
      const suffix = parseInt(parts[parts.length - 1]);
      if (!isNaN(suffix) && suffix > maxSuffix) {
        maxSuffix = suffix;
      }
    }
  }

  const rows = [];
  const ngayNhap = new Date().toLocaleString('vi-VN');
  
  for (let i = 1; i <= soLuong; i++) {
    const n = (maxSuffix + i).toString().padStart(3, '0');
    const maQLMoi = `${prefix}-${n}`;
    // DB_VatTu cols: MaQL, MaBC, TenVatTu, GioiHan, DaDung, TrangThai, NgayNhap, ThongBao
    rows.push([maQLMoi, code, prefix, gioiHan, 0, '🟢 Sẵn sàng', ngayNhap, '']);
  }

  if (rows.length > 0) {
    await themHangVatTu('DB_VatTu', rows);
  }
  
  return { success: true, message: `Đã nhập ${soLuong} cây ${prefix}` };
}

module.exports = {
  layTongQuan,
  layTonKho,
  goiYChiDinh,
  xuLyKhiChot,
  baoHongVatTu,
  nhapVatTuMoi
};
