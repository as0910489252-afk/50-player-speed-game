# 50 人手速王者爭霸賽

## 功能
- 最多 50 人、10 組、每組最多 5 人
- 手機瀏覽器加入，個人與團體排行榜即時更新
- 3 輪，每輪依序有極速點擊、反應神手、眼明手快
- 管理員開始、提早切換關卡、重設賽事
- Render 部署設定檔 `render.yaml`

## 重要限制（第一版）
本版本適合單一 Render Web Service 的活動測試。玩家、分組與分數目前存放在伺服器記憶體中，重新部署、服務重新啟動或重設賽事後會清空；請在活動前先測試，避免在正式比賽期間重新部署。免費服務可能休眠。
管理員密鑰請在 Render 環境變數設定 `ADMIN_TOKEN`，使用長且難猜的值。不要把密鑰交給參賽者。
本版本使用伺服器端時間和點擊頻率限制，但不是專業反作弊系統；高風險正式賽事應加上持久化資料庫、身分驗證及更嚴格的伺服器端賽事狀態驗證。

## GitHub + Render 部署
1. 在 GitHub 建立新的空白 repository，例如 `50-player-speed-game`。
2. 將本資料夾中的所有檔案上傳至 repository 根目錄（不要只上傳 zip）。
3. 到 Render Dashboard → **New +** → **Web Service**，連接該 GitHub repository。
4. 設定：
   - Runtime：Node
   - Build Command：`npm install`
   - Start Command：`npm start`
   - Health Check Path：`/health`
5. 在 Render 的 **Environment** 加入 `ADMIN_TOKEN`，值請自行設定為一段長且難猜的密鑰，儲存後等待重新部署。
6. 開啟 Render 給你的 `https://....onrender.com` 網址。
7. 主辦人先在控制台輸入 `ADMIN_TOKEN`。參賽者輸入頁面顯示的房間代碼、暱稱與組別。
8. 確認人數和組別無誤後，主辦人按「開始比賽」。

## QR Code
部署完成後，把網站網址轉成 QR Code。若要讓參賽者自動帶入房間代碼，QR Code 網址格式為：
`https://你的網站.onrender.com/?code=房間代碼`
房間代碼可在網站「賽事資訊」查看。若重設賽事，房間代碼會改變，請重新製作 QR Code。

## 本機測試
需要 Node.js 20 或更新版本。在資料夾執行：
```bash
npm install
ADMIN_TOKEN=replace-with-a-long-secret npm start
```
Windows PowerShell：
```powershell
npm install
$env:ADMIN_TOKEN="replace-with-a-long-secret"
npm start
```
瀏覽器開啟 `http://localhost:3000`。本機手機測試時，手機與電腦需在同一 Wi-Fi，並用電腦的區域網路 IP 取代 localhost。
