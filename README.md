# Hệ thống Kiểm soát Vật tư & Chỉ định Ca mổ

Backend Node.js + giao diện web, dùng Google Sheet làm database (qua Service Account).

## 1. Cài Node.js (chỉ 1 lần)

Tải và cài từ https://nodejs.org (chọn bản LTS). Cài xong mở CMD/PowerShell gõ `node -v` để kiểm tra.

## 2. Tạo Service Account (để server đọc/ghi được Google Sheet)

1. Vào https://console.cloud.google.com → tạo 1 project mới (miễn phí, không cần thẻ tín dụng cho việc này).
2. Vào **APIs & Services > Library** → tìm "Google Sheets API" → bấm **Enable**.
3. Vào **APIs & Services > Credentials** → **Create Credentials > Service Account** → đặt tên bất kỳ (vd `pm-system-bot`) → Create and Continue → Done.
4. Bấm vào Service Account vừa tạo → tab **Keys** → **Add Key > Create new key** → chọn **JSON** → tải file JSON về.
5. Đổi tên file JSON đó thành `service-account.json`, bỏ vào thư mục `credentials/` trong project này (tạo thư mục nếu chưa có).
6. Mở file JSON đó, tìm dòng `"client_email"` → copy địa chỉ email dạng `xxx@xxx.iam.gserviceaccount.com`.
7. Mở Google Sheet "ĐĂNG KÍ LỊCH MỔ..." → bấm **Chia sẻ (Share)** → dán email Service Account vào → chọn quyền **Editor** → Gửi.

## 3. Cấu hình project

1. Copy file `.env.example` thành `.env`.
2. Mở `.env`, điền `GOOGLE_SHEET_ID` (lấy từ URL Google Sheet, đoạn giữa `/d/` và `/edit`).
3. Đảm bảo `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` trỏ đúng tới file JSON ở bước 2.5 (mặc định `./credentials/service-account.json`).

## 4. Cài thư viện & chạy thử trên máy mới

### Cách 1: Tự động (Khuyên dùng trên Windows)
Tải code từ GitHub về, click đúp vào file `setup.bat` (hoặc chạy `.\setup.bat` trong CMD/PowerShell). Script sẽ tự động:
1. Cài đặt các thư viện (`npm install`).
2. Tự tạo file `.env` nếu thiếu.
3. Kiểm tra file `credentials/service-account.json` và nhắc nhở nếu chưa chép sang.
4. Tự khởi động server (`npm start`).

### Cách 2: Thủ công
Mở CMD/PowerShell tại thư mục project:

```bash
npm install
npm start
```

Thấy dòng `Server đang chạy tại http://localhost:3000` là thành công. Mở trình duyệt vào địa chỉ đó.

## 5. Yêu cầu về Google Sheet

Sheet phải có sẵn các tab sau (đã tạo ở bước trước bằng Apps Script `SetupSheets.gs`, nếu chưa có thì chạy script đó trước hoặc tự tạo tay đúng tên cột):

- `Đăng kí` (hoặc `Đăng ký`) — có cột chứa "Mã bệnh", "Họ tên", "Chẩn đoán", "Bác sĩ phẫu thuật", "Thời gian"
- `Data_Log` — 15 cột: MaBN, HoTenBN, NgayMo, Nhom, STTGoc, TenMuc, DVT, SL, DuongDung, GhiChu, CoMacTien, LanUpload, TenFileGoc, NguoiUpload, ThoiGianUpload
- `Case_Summary` — 9 cột: MaBN, HoTenBN, NgayMo, TrangThai, NoteChung, NguoiXacNhanCuoi, ThoiGianXacNhan, SoLanUpload, LastUpdated
- `Thuoc_Mac_Tien` — 2 cột: TenThuocVatTu, GhiChu

## 6. Truy cập từ máy khác trong mạng nội bộ

Sau khi `npm start` chạy trên máy tính bàn cơ quan, các máy khác trong cùng mạng LAN có thể truy cập qua địa chỉ IP nội bộ của máy đó, ví dụ `http://192.168.1.15:3000` (xem IP bằng lệnh `ipconfig` trên máy chạy server). Cần mở firewall Windows cho cổng 3000 nếu bị chặn.

## Lưu ý quan trọng

- Bản này **CHƯA có đăng nhập/phân quyền** — tạm thời mọi người vào link đều dùng được, phù hợp để bạn kiểm tra logic upload trước. Module đăng nhập/phân quyền + dashboard xem theo ngày sẽ được thêm ở bước kế tiếp.
- Máy chạy server cần **bật máy + chạy `npm start`** trong giờ làm việc thì mọi người mới truy cập được. Nếu tắt máy, hệ thống ngưng hoạt động.
