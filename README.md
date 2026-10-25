# 教育部工作文件進程（不包括HR）

繁體中文儀表板：未完成工作文件狀態總覽、分狀態列表／時間線，以及行政部電郵辦公／非辦公時段統計圖表。

**公開頁**：https://wayneleong-byte.github.io/procure-viz/

資料來源為採購文件追蹤本機 JSON（唯讀）；每日平日約 09:00 Asia/Macau 更新。

設計取向：會議／投影大字、清晰留白；顏色只作角色區分（行政紅／EDU 綠／第三方藍），不以「快／慢」定性。

## 本機預覽
```bash
python3 build_viz.py   # 從 /workspace/procure/ 重產 data/viz.json
python3 -m http.server 8765 --bind 127.0.0.1
# 開 http://127.0.0.1:8765/
```
