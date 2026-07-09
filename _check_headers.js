require('dotenv').config();
const { timCotTheoTuKhoa } = require('./src/matching');
const { docSheet } = require('./src/sheetsClient');

async function main() {
  let data;
  try { data = await docSheet('Đăng kí'); } catch(e) {
    try { data = await docSheet('Đăng ký'); } catch(e2) { console.log('Error:', e2.message); return; }
  }
  const tieuDe = data[0];
  
  const idxKhu = timCotTheoTuKhoa(tieuDe, ['phòng mổ', 'phong mo']);
  console.log('idxKhu (phong mo):', idxKhu, '-> Header:', JSON.stringify(tieuDe[idxKhu]));
  
  // Show first matching row's value
  if (data.length > 1 && idxKhu > -1) {
    console.log('Row 1 value:', JSON.stringify(data[1][idxKhu]));
  }
}
main();
