const cheerio = require('cheerio');

const NHOM_HOP_LE = ['Chỉ định', 'Vật tư y tế', 'Thuốc, dịch truyền', 'Chưa phân nhóm'];
const NHAN_KE_TIEP = [
  'Giới tính', 'Ngày sinh', 'Số giường', 'Số buồng', 'Ngày vào viện',
  'Địa chỉ', 'Chẩn đoán', 'Mã ID', 'Họ tên'
];

function chuanHoaKhoangTrang(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function layGiaTriTheoMau(text, nhan, regexGiaTri) {
  const idx = text.toLowerCase().indexOf(nhan.toLowerCase());
  if (idx === -1) return '';
  const cuaSo = text.slice(idx + nhan.length, idx + nhan.length + 200);
  const m = cuaSo.match(regexGiaTri);
  return m ? chuanHoaKhoangTrang(m[1] || m[0]) : '';
}

function timBangMuc($) {
  let target = null;
  let maxCount = 0;

  $('table').each((i, table) => {
    // Bỏ qua bảng có chứa bảng con (không phải bảng lá) -> tránh đếm trùng bảng ngoài bọc bảng trong
    if ($(table).find('table').length > 0) return;

    let count = 0;
    $(table).find('tr').each((j, tr) => {
      const firstCell = chuanHoaKhoangTrang($(tr).find('td').first().text());
      if (/^\d+$/.test(firstCell)) count++;
    });

    if (count > maxCount) {
      maxCount = count;
      target = table;
    }
  });

  return { table: target, soDongMuc: maxCount };
}

function trichXuatDanhSachMuc($, bangMuc) {
  const ketQua = [];
  let nhomHienTai = 'Chưa phân nhóm';

  $(bangMuc).find('tr').each((i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length === 0) return;

    const cell0 = chuanHoaKhoangTrang($(tds[0]).text());

    const khopNhom = NHOM_HOP_LE.find((n) => cell0.toLowerCase().startsWith(n.toLowerCase()));
    if (khopNhom) {
      nhomHienTai = khopNhom;
      return;
    }

    if (/^\d+$/.test(cell0)) {
      ketQua.push({
        nhom: nhomHienTai,
        sttGoc: cell0,
        tenMuc: chuanHoaKhoangTrang($(tds[1]).text()),
        dvt: chuanHoaKhoangTrang($(tds[2]).text()),
        sl: chuanHoaKhoangTrang($(tds[3]).text()),
        duongDung: chuanHoaKhoangTrang($(tds[4]).text()),
        ghiChu: chuanHoaKhoangTrang($(tds[5]).text())
      });
    }
  });

  return ketQua;
}

function phanTichPhieuHtml(html) {
  const $ = cheerio.load(html);
  const wholeText = chuanHoaKhoangTrang($('body').text() || $.root().text());

  const KY_TU_HOA_VN = 'A-ZÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ';
  const dauPhieu = {
    maBN: layGiaTriTheoMau(wholeText, 'Mã ID', /(\d{6,15})/),
    hoTen: layGiaTriTheoMau(wholeText, 'Họ tên', new RegExp(':?\\s*([' + KY_TU_HOA_VN + '][' + KY_TU_HOA_VN + '\\s]{2,60})')),
    ngayVaoVien: layGiaTriTheoMau(wholeText, 'Ngày vào viện', /(\d{1,2}:\d{2}\s+\d{1,2}\/\d{1,2}\/\d{4})/)
  };
  // Loại bỏ 1 ký tự hoa lẻ dính ở cuối (do vô tình bắt luôn chữ cái đầu của nhãn kế tiếp, vd "... TRÀ MY G")
  dauPhieu.hoTen = dauPhieu.hoTen.replace(new RegExp('\\s+[' + KY_TU_HOA_VN + ']$'), '').trim();

  const { table: bangMuc, soDongMuc } = timBangMuc($);
  const danhSachMuc = bangMuc ? trichXuatDanhSachMuc($, bangMuc) : [];

  return { dauPhieu, danhSachMuc, soDongMucTimThay: soDongMuc };
}

module.exports = { phanTichPhieuHtml };
