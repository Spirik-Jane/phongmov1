@echo off
chcp 65001 > NUL
echo ===================================================
echo   HET THONG KIEM SOAT VAT TU & CHI DINH CA MO
echo   Kiem tra va khoi tao moi truong chay tren may moi
echo ===================================================
echo.

rem Step 1: Install dependencies
echo [1/3] Dang cai dat cac thu vien (npm install)...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [LOI] Cai dat npm install that bai! Vui long kiem tra Node.js.
    pause
    exit /b %ERRORLEVEL%
)
echo [OK] Da cai dat xong cac thu vien Node.js.
echo.

rem Step 2: Check .env file
echo [2/3] Kiem tra file cau hinh .env...
if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env
        echo [TAO MOI] Da tao file .env tu .env.example.
        echo [LUI Y] Vui long mo file .env de dien dung GOOGLE_SHEET_ID cua ban!
    ) else (
        echo [LOI] Khong tim thay file .env.example!
    )
) else (
    echo [OK] File .env da ton tai.
)
echo.

rem Step 3: Check credentials/service-account.json
echo [3/3] Kiem tra file khoai Google (service-account.json)...
if not exist "credentials\service-account.json" (
    if not exist "credentials" mkdir credentials
    echo.
    echo ----------------------------------------------------------------------
    echo [CANH BAO THIEU FILE] 
    echo File credentials\service-account.json KHONG TON TAI!
    echo Vi ly do bao mat, file nay khong duoc dua len GitHub.
    echo.
    echo VUI LONG:
    echo 1. Copy file service-account.json tu may cu / USB.
    echo 2. Dan vao thu muc: credentials\service-account.json
    echo ----------------------------------------------------------------------
) else (
    echo [OK] File credentials\service-account.json da san sang.
)

echo.
echo ===================================================
echo CHUAN BI KHOI DONG SERVER...
echo ===================================================
echo Chon che do chay he thong:
echo [1] Chay binh thuong (Hien cua so de theo doi)
echo [2] Chay an (Thu nho cua so, giup khong bi tat nham)
echo [3] Chay ngam chuyen nghiep voi PM2 (Chong saps server, tu khoi dong lai)
echo [0] Thoat
set /p choice="Nhap lua chon cua ban (0-3): "

if "%choice%"=="1" (
    npm start
) else if "%choice%"=="2" (
    echo Dang khoi dong che do thu nho...
    start /min cmd /k "npm start"
) else if "%choice%"=="3" (
    echo Dang cai dat cong cu PM2 (Process Manager)...
    call npm install -g pm2
    
    rem Lay ten thu muc hien tai de dat ten cho PM2
    for %%I in (.) do set ProjectName=%%~nxI
    call pm2 start server.js --name "%ProjectName%"
    call pm2 save
    
    echo ===================================================
    echo DA CAI DAT XONG! Server dang chay ngam hoan toan.
    echo Ban co the tat cua so nay. 
    echo De xem trang thai, mo terminal moi va go: pm2 status
    echo ===================================================
    pause
) else (
    exit /b 0
)
