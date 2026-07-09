const { docSheet } = require('./sheetsClient');

const TEN_SHEET_DANG_KY_UNG_VIEN = ['Đăng kí', 'Đăng ký'];

function timCotTheoTuKhoa(hangTieuDe, dsTuKhoa, boQuaChiSo = -1) {
  for (const tuKhoa of dsTuKhoa) {
    for (let i = 0; i < hangTieuDe.length; i++) {
      if (i === boQuaChiSo) continue;
      const tieuDe = String(hangTieuDe[i] || '').toLowerCase();
      if (tieuDe.includes(tuKhoa.toLowerCase())) return i;
    }
  }
  return -1;
}

async function docSheetDangKy() {
  let loiCuoi = null;
  for (const ten of TEN_SHEET_DANG_KY_UNG_VIEN) {
    try {
      const data = await docSheet(ten);
      if (data.length) return { ten, data };
    } catch (err) {
      loiCuoi = err;
      const laLoiTenSheet = /unable to parse range|not found/i.test(err.message || '');
      if (!laLoiTenSheet) throw err; // lỗi auth/kết nối thật -> báo ngay, không thử tên khác
    }
  }
  throw new Error(
    'Không tìm thấy sheet "Đăng kí" (hoặc "Đăng ký") trong Google Sheet.' +
    (loiCuoi ? ' Chi tiết: ' + loiCuoi.message : '')
  );
}

async function timCacCaTheoPID(maBN) {
  const { data } = await docSheetDangKy();
  const tieuDe = data[0];

  const idxMaBenh = timCotTheoTuKhoa(tieuDe, ['mã bệnh']);
  const idxHoTen = timCotTheoTuKhoa(tieuDe, ['họ tên']);
  const idxChanDoan = timCotTheoTuKhoa(tieuDe, ['chẩn đoán']);
  const idxPTV = timCotTheoTuKhoa(tieuDe, ['bác sĩ phẫu thuật', 'phẫu thuật viên']);
  const idxDauThoiGian = timCotTheoTuKhoa(tieuDe, ['dấu thời gian']);
  const idxThoiGian = timCotTheoTuKhoa(tieuDe, ['thời gian'], idxDauThoiGian);
  const idxKhu = timCotTheoTuKhoa(tieuDe, ['phòng mổ', 'phong mo']);

  const ketQua = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const giaTriMaBenh = idxMaBenh > -1 ? String(row[idxMaBenh] || '').trim() : '';
    if (giaTriMaBenh && giaTriMaBenh === String(maBN).trim()) {
      ketQua.push({
        maBN: giaTriMaBenh,
        hoTen: idxHoTen > -1 ? row[idxHoTen] || '' : '',
        chanDoan: idxChanDoan > -1 ? row[idxChanDoan] || '' : '',
        ptv: idxPTV > -1 ? row[idxPTV] || '' : '',
        thoiGianMo: idxThoiGian > -1 ? row[idxThoiGian] || '' : '',
        khu: idxKhu > -1 ? row[idxKhu] || '' : ''
      });
    }
  }
  return ketQua;
}

async function timCaTheoPidHoacTen(tuKhoa) {
  const { data } = await docSheetDangKy();
  const tieuDe = data[0];

  const idxMaBenh = timCotTheoTuKhoa(tieuDe, ['mã bệnh']);
  const idxHoTen = timCotTheoTuKhoa(tieuDe, ['họ tên']);
  const idxChanDoan = timCotTheoTuKhoa(tieuDe, ['chẩn đoán']);
  const idxDauThoiGian = timCotTheoTuKhoa(tieuDe, ['dấu thời gian']);
  const idxThoiGian = timCotTheoTuKhoa(tieuDe, ['thời gian'], idxDauThoiGian);

  const tuKhoaChuanHoa = (tuKhoa || '').toLowerCase().trim();
  if (!tuKhoaChuanHoa) return [];

  const ketQua = [];
  for (let i = 1; i < data.length && ketQua.length < 20; i++) {
    const row = data[i];
    const maBenh = idxMaBenh > -1 ? String(row[idxMaBenh] || '').trim() : '';
    const hoTen = idxHoTen > -1 ? String(row[idxHoTen] || '').trim() : '';
    if (maBenh.toLowerCase().includes(tuKhoaChuanHoa) || hoTen.toLowerCase().includes(tuKhoaChuanHoa)) {
      ketQua.push({
        maBN: maBenh,
        hoTen,
        chanDoan: idxChanDoan > -1 ? row[idxChanDoan] || '' : '',
        thoiGianMo: idxThoiGian > -1 ? row[idxThoiGian] || '' : ''
      });
    }
  }
  return ketQua;
}

module.exports = { timCacCaTheoPID, timCaTheoPidHoacTen, timCotTheoTuKhoa, docSheetDangKy };
