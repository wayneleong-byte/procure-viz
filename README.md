# 教育部工作文件進程（不包括HR）

繁體中文儀表板（**方案 2｜3D 玻璃看板室**）：狀態泳道玻璃柱、KPI 圓環、篩選、時間線、已完成／供應商／電郵分析。

**正式頁**：https://wayneleong-byte.github.io/procure-viz/

**對照預覽**（與正式同視覺；標明對照）：https://wayneleong-byte.github.io/procure-viz/preview/

資料來源為採購文件追蹤本機 JSON（唯讀）；每日平日約 09:00 Asia/Macau 更新。

設計取向：暗色指揮室＋透視玻璃柱；顏色以 cyan／slate／amber 為主，時間線角色仍用行政紅／EDU 綠／第三方藍。

舊版列表介面備份：`assets/legacy-app.css`、`assets/legacy-app.js`（主頁唔再載入）。

## 本機預覽
```bash
python3 build_viz.py   # 從 /workspace/procure/ 重產 data/viz.json
python3 -m http.server 8765 --bind 127.0.0.1
# 正式：http://127.0.0.1:8765/
# 對照：http://127.0.0.1:8765/preview/
```
