# 採購文件可視化

繁體中文儀表板：未完成採購文件來回時間線 ＋ 相關電郵時段（上班／非上班）。

**公開頁**：https://wayneleong-byte.github.io/procure-viz/

資料來源為採購文件追蹤本機 JSON（唯讀）；每日平日約 09:00 Asia/Macau 更新。

## 本機預覽
```bash
python3 build_viz.py   # 從 /workspace/procure/ 重產 data/viz.json
python3 -m http.server 8765 --bind 127.0.0.1
# 開 http://127.0.0.1:8765/
```
