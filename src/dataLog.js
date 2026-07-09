const { docSheet, themHang, capNhatVung } = require('./sheetsClient');
const { docSheetDangKy, timCotTheoTuKhoa } = require('./matching');
function chuanHoaTen(ten) {
  return (ten || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}

async function layDanhSachTuKhoaMacTien() {
  let data;
  try {
    data = await docSheet('Thuoc_Mac_Tien');
  } catch (err) {
    return [];
  }
  const ds = [];
  for (let i = 1; i < data.length; i++) {
    const ten = chuanHoaTen(data[i][0]);
    if (ten) ds.push(ten);
  }
  return ds;
}

function kiemTraMacTien(tenMuc, dsTuKhoaMacTien) {
  const tenChuanHoa = chuanHoaTen(tenMuc);
  if (!tenChuanHoa) return false;
  return dsTuKhoaMacTien.some((tk) => tenChuanHoa.includes(tk) || tk.includes(tenChuanHoa));
}

async function layTenMucDaCoTrongCa(maBN, ngayMo) {
  const data = await docSheet('Data_Log');
  const ketQua = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[0] || '').trim() === maBN && String(row[2] || '').trim() === ngayMo) {
      const ten = chuanHoaTen(row[5]);
      ketQua[ten] = (ketQua[ten] || 0) + 1;
    }
  }
  return ketQua;
}

async function laySoLanUploadTiepTheo(maBN, ngayMo) {
  const data = await docSheet('Data_Log');
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[0] || '').trim() === maBN && String(row[2] || '').trim() === ngayMo) {
      max = Math.max(max, Number(row[11]) || 0);
    }
  }
  return max + 1;
}

async function layDuLieuCaCu(maBN, ngayMo) {
  const data = await docSheet('Data_Log');
  let maxLanUpload = 0;
  
  // Tìm LanUpload lớn nhất
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[0] || '').trim() === String(maBN).trim() && String(row[2] || '').trim() === String(ngayMo).trim()) {
      maxLanUpload = Math.max(maxLanUpload, Number(row[11]) || 0);
    }
  }
  
  if (maxLanUpload === 0) return { soLanUploadTruoc: 0, danhSachMucCu: [] };
  
  // Lấy các mục thuộc maxLanUpload
  const danhSachMucCu = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (
      String(row[0] || '').trim() === String(maBN).trim() && 
      String(row[2] || '').trim() === String(ngayMo).trim() &&
      Number(row[11]) === maxLanUpload
    ) {
      danhSachMucCu.push({
        nhom: row[3] || '',
        sttGoc: row[4] || '',
        tenMuc: row[5] || '',
        dvt: row[6] || '',
        sl: row[7] || '',
        duongDung: row[8] || '',
        ghiChu: row[9] || '',
        coMacTien: row[10] === 'TRUE'
      });
    }
  }
  return { soLanUploadTruoc: maxLanUpload, danhSachMucCu };
}


async function capNhatCaseSummary(maBN, hoTen, ngayMo, soLanUpload, thoiGian) {
  const data = await docSheet('Case_Summary');
  let dongTimThay = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === maBN && String(data[i][2] || '').trim() === ngayMo) {
      dongTimThay = i + 1; // số dòng thật trong sheet (1-based, có header)
      break;
    }
  }

  if (dongTimThay === -1) {
    await themHang('Case_Summary', [[maBN, hoTen, ngayMo, 'Dang cap nhat', '', '', '', soLanUpload, thoiGian]]);
    return;
  }

  const trangThaiHienTai = data[dongTimThay - 1][3];
  let ghiChu = data[dongTimThay - 1][4] || '';
  if (trangThaiHienTai === 'Da xac nhan day du') {
    ghiChu = `(Có cập nhật mới lúc ${thoiGian} SAU KHI đã xác nhận đầy đủ - cần kiểm tra lại) ${ghiChu}`;
  }

  await capNhatVung(`Case_Summary!D${dongTimThay}:I${dongTimThay}`, [
    ['Dang cap nhat', ghiChu, data[dongTimThay - 1][5] || '', data[dongTimThay - 1][6] || '', soLanUpload, thoiGian]
  ]);
}

async function ghiDuLieuCa({ maBN, hoTen, ngayMo, tenFile, nguoiUpload, danhSachMuc }) {
  const dsMacTien = await layDanhSachTuKhoaMacTien();
  const dsSoLanTruocDo = await layTenMucDaCoTrongCa(maBN, ngayMo);
  const soLanUploadHienTai = await laySoLanUploadTiepTheo(maBN, ngayMo);
  const thoiGianGhi = new Date().toLocaleString('vi-VN');

  const canhBaoTrung = [];
  const hangMoi = danhSachMuc.map((muc) => {
    const tenChuanHoa = chuanHoaTen(muc.tenMuc);
    const coMacTien = kiemTraMacTien(muc.tenMuc, dsMacTien);

    const soLanSauKhiThem = (dsSoLanTruocDo[tenChuanHoa] || 0) + 1;
    dsSoLanTruocDo[tenChuanHoa] = soLanSauKhiThem;

    if (soLanSauKhiThem >= 2) {
      canhBaoTrung.push({ tenMuc: muc.tenMuc, nhom: muc.nhom, soLan: soLanSauKhiThem });
    }

    return [
      maBN, hoTen, ngayMo, muc.nhom, muc.sttGoc, muc.tenMuc,
      muc.dvt, muc.sl, muc.duongDung, muc.ghiChu,
      coMacTien ? 'TRUE' : 'FALSE',
      soLanUploadHienTai, tenFile, nguoiUpload, thoiGianGhi
    ];
  });

  await themHang('Data_Log', hangMoi);
  await capNhatCaseSummary(maBN, hoTen, ngayMo, soLanUploadHienTai, thoiGianGhi);

  return { soMucDaGhi: hangMoi.length, canhBaoTrung };
}

async function layDanhSachDashboard(ngayYYYYMMDD) {
  // ngayYYYYMMDD format: e.g. '2026-07-04'
  let dsDangKy = [];
  let idxMaBenh = -1, idxHoTen = -1, idxChanDoan = -1, idxDauThoiGian = -1, idxThoiGian = -1, idxKhoa = -1;
  try {
    const { data } = await docSheetDangKy();
    if (data.length > 0) {
      const tieuDe = data[0];
      idxMaBenh = timCotTheoTuKhoa(tieuDe, ['mã bệnh']);
      idxHoTen = timCotTheoTuKhoa(tieuDe, ['họ tên']);
      idxChanDoan = timCotTheoTuKhoa(tieuDe, ['chẩn đoán']);
      idxDauThoiGian = timCotTheoTuKhoa(tieuDe, ['dấu thời gian']);
      idxThoiGian = timCotTheoTuKhoa(tieuDe, ['thời gian'], idxDauThoiGian);
      idxKhoa = timCotTheoTuKhoa(tieuDe, ['khoa phòng']);
      
      // Filter by the date. The date in 'thời gian' could be '11:00 1/7/2026'
      // Or in '_Date' column if exists. We'll check both.
      const idxDate = timCotTheoTuKhoa(tieuDe, ['_date']);
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        let rowDateStr = '';
        if (idxDate > -1 && row[idxDate]) {
          // '09/01/2026' -> '2026-01-09' (assuming dd/mm/yyyy)
          const parts = row[idxDate].split('/');
          if (parts.length === 3) rowDateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        if (!rowDateStr && idxThoiGian > -1 && row[idxThoiGian]) {
          // Fallback parsing from something like '11:00 1/7/2026'
          const m = row[idxThoiGian].match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (m) rowDateStr = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        }
        
        if (rowDateStr === ngayYYYYMMDD) {
          dsDangKy.push({
            maBN: idxMaBenh > -1 ? String(row[idxMaBenh] || '').trim() : '',
            hoTen: idxHoTen > -1 ? row[idxHoTen] || '' : '',
            chanDoan: idxChanDoan > -1 ? row[idxChanDoan] || '' : '',
            khoa: idxKhoa > -1 ? row[idxKhoa] || '' : '',
            thoiGianMo: idxThoiGian > -1 ? row[idxThoiGian] || '' : ''
          });
        }
      }
    }
  } catch (err) {
    console.error('Lỗi lấy Đăng ký:', err);
  }

  // Get Case_Summary to map status
  let caseSummary = [];
  try {
    const summaryData = await docSheet('Case_Summary');
    // headers: MaBN, HoTenBN, NgayMo, TrangThai, NoteChung, NguoiXacNhanCuoi, ThoiGianXacNhan, SoLanUpload, LastUpdated
    for (let i = 1; i < summaryData.length; i++) {
      caseSummary.push({
        maBN: String(summaryData[i][0] || '').trim(),
        ngayMo: String(summaryData[i][2] || '').trim(),
        trangThai: String(summaryData[i][3] || ''),
        noteChung: String(summaryData[i][4] || ''),
        nguoiXacNhan: String(summaryData[i][5] || ''),
        lanUpload: parseInt(summaryData[i][7] || '0', 10),
        lastUpdated: String(summaryData[i][8] || '')
      });
    }
  } catch (err) {
    console.error('Lỗi lấy Case_Summary:', err);
  }

  let dataLog = [];
  try {
    const data = await docSheet('Data_Log');
    for (let i = 1; i < data.length; i++) {
      dataLog.push({
         maBN: String(data[i][0] || '').trim(),
         ngayMo: String(data[i][2] || '').trim(),
         nhom: String(data[i][3] || '').trim(),
         tenMuc: data[i][5] || '',
         sl: data[i][7] || '',
         coMacTien: data[i][10] === 'TRUE',
         lanUpload: parseInt(data[i][11] || '0', 10)
      });
    }
  } catch (err) {
    console.error('Lỗi lấy Data_Log:', err);
  }

  // Map status to dashboard list
  return dsDangKy.map(ca => {
    const summary = caseSummary.find(s => s.maBN === ca.maBN && s.ngayMo === ca.thoiGianMo);
    let noteChung = '', dsMacTien = [], dsLapLai = [];
    
    if (summary) {
      noteChung = summary.noteChung;
      const logCa = dataLog.filter(d => d.maBN === ca.maBN && d.ngayMo === ca.thoiGianMo && d.lanUpload === summary.lanUpload);
      
      // Compute dsMacTien
      dsMacTien = logCa.filter(d => d.coMacTien).map(d => ({ tenMuc: d.tenMuc, sl: d.sl }));
      
      // Compute dsLapLai
      const countMap = {};
      logCa.forEach(d => {
        // Normalize Vietnamese text to avoid unicode issues
        const nhomNorm = (d.nhom || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd');
        if (nhomNorm.includes('chi dinh')) {
          const key = chuanHoaTen(d.tenMuc);
          if (!countMap[key]) countMap[key] = { tenMuc: d.tenMuc, count: 0 };
          
          // Cộng dồn số lượng thay vì chỉ đếm số dòng
          const sl = parseInt(d.sl, 10) || 1;
          countMap[key].count += sl;
        }
      });
      dsLapLai = Object.values(countMap).filter(v => v.count >= 2).map(v => ({ tenMuc: v.tenMuc, soLan: v.count }));
      
      return { ...ca, trangThai: summary.trangThai, nguoiXacNhan: summary.nguoiXacNhan, lanUpload: summary.lanUpload, lastUpdated: summary.lastUpdated, noteChung, dsMacTien, dsLapLai };
    }
    return { ...ca, trangThai: 'Chưa cập nhật', nguoiXacNhan: '', lanUpload: 0, lastUpdated: '', noteChung: '', dsMacTien: [], dsLapLai: [] };
  });
}

async function layChiTietCa(maBN, ngayMo) {
  const { soLanUploadTruoc, danhSachMucCu } = await layDuLieuCaCu(maBN, ngayMo);
  const data = await docSheet('Case_Summary');
  let summary = null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === maBN && String(data[i][2] || '').trim() === ngayMo) {
      summary = {
        trangThai: String(data[i][3] || ''),
        noteChung: String(data[i][4] || ''),
        nguoiXacNhan: String(data[i][5] || ''),
        lastUpdated: String(data[i][8] || '')
      };
      break;
    }
  }
  return { soLanUpload: soLanUploadTruoc, danhSachMuc: danhSachMucCu, summary };
}

module.exports = {
  chuanHoaTen, kiemTraMacTien, layDanhSachTuKhoaMacTien,
  layTenMucDaCoTrongCa, laySoLanUploadTiepTheo, layDuLieuCaCu, capNhatCaseSummary, ghiDuLieuCa, layDanhSachDashboard, layChiTietCa
};
