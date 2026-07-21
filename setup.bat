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
echo SAN SANG! Bam phim bat ky de khoi dong server (npm start)...
echo ===================================================
pause
npm start
