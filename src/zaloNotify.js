const { docSheetVatTu } = require('./sheetsClient');

// Hàm lấy cấu hình Zalo
function getZaloConfig() {
  return {
    active: process.env.ZALO_ACTIVE === 'true',
    token: process.env.ZALO_TOKEN || '',
    apiUrl: process.env.ZALO_API_URL || 'https://bot-api.zapps.me/bot'
  };
}

// Gửi tin nhắn qua Zapps.me
async function sendMessageZalo(userId, text) {
  const config = getZaloConfig();
  if (!config.active || !config.token) return false;

  try {
    const url = `${config.apiUrl}${config.token}/sendMessage`;
    const payload = {
      chat_id: userId,
      text: text
    };

    // Note: Fetch is available globally in Node.js 18+
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.text();
    console.log(`Zalo Response (${userId}):`, result);
    return true;
  } catch (e) {
    console.error("Lỗi gửi Zalo:", e.message);
    return false;
  }
}

// Đọc tab QuanLy lấy danh sách Zalo ID
async function getZaloManagers() {
  try {
    const data = await docSheetVatTu('QuanLy');
    if (!data || data.length === 0) return [];

    const managers = [];
    // Dữ liệu từ dòng 2 (index 1)
    for (let i = 1; i < data.length; i++) {
      // Giả định Zalo User ID nằm ở cột C (index 2)
      const uid = String(data[i][2] || '').trim();
      if (uid && uid.length > 5) {
        managers.push(uid);
      }
    }
    return managers;
  } catch (error) {
    console.error("Lỗi đọc danh sách quản lý Zalo:", error);
    return [];
  }
}

// Gửi thông báo hết hạn, hỏng, v.v.
async function guiThongBaoVatTu(toolName, toolID, limit, used, type) {
  const config = getZaloConfig();
  if (!config.active) return;

  const managers = await getZaloManagers();
  if (managers.length === 0) return;

  let message = "";

  if (type === "HẾT HẠN") {
    message = `[THÔNG BÁO HẾT HẠN SỬ DỤNG]
--------------------------------
• Vật tư: ${toolName.toUpperCase()}
• Mã QL: ${toolID}
• Tình trạng: Đã dùng ${used}/${limit}
--------------------------------
LƯU Ý: Mã đã bị KHÓA. Vui lòng lập báo cáo và thay mới.`;
  } else if (type === "SẮP HẾT") {
    const remain = limit - used;
    message = `[CẢNH BÁO SẮP HẾT]
--------------------------------
• Vật tư: ${toolName}
• Mã QL: ${toolID}
• Hiện tại: ${used}/${limit} (Còn lại: ${remain})
--------------------------------
Đề nghị bộ phận chuẩn bị phương án thay mới.`;
  } else if (type === "HỎNG") {
    message = `[BÁO CÁO HƯ HỎNG VẬT TƯ]
--------------------------------
• Vật tư: ${toolName.toUpperCase()}
• Mã QL: ${toolID}
• Tình trạng: Đã dùng ${used}/${limit}
--------------------------------
LƯU Ý: Vật tư đã được đánh dấu HỎNG.`;
  }

  if (!message) return;

  // Gửi cho tất cả manager
  for (const uid of managers) {
    await sendMessageZalo(uid, message);
    // Sleep một chút để tránh spam API
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

module.exports = {
  guiThongBaoVatTu,
  getZaloManagers,
  sendMessageZalo
};
