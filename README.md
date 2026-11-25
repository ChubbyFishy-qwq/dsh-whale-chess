# 鲸娘棋局 · dsh-whale-chess

在 DSH Web 界面里和鲸娘下一盘国际象棋。当前版本：0.2.0。

```powershell
dsh plugin --profile web add dsh-whale-chess
```

- **窗口**：左侧棋盘、右侧固定鲸娘面板；柔和低饱和海蓝水体、气泡、SVG 动态表情。
- **操作**：点选棋子再点目标格，或直接把棋子拖到目标格（鼠标 / 触摸均可）。按下棋子就亮出合法落点，拖起来有跟手的半透明棋子，松手先飞到落点再落盘。
- **随机先手**：每局随机决定主人执白还是执黑（鲸娘执另一边），棋盘自动翻转；鲸娘执白时会自己先走。
- **摸头**：直接点 / 摸鲸鱼娘就能摸头，不必按下方按钮（按钮仍保留作备用）。
- **复盘**：每局结束自动存下棋谱，标题栏「复盘」可以逐手回放最近一局（⏮ ◀ ▶ ⏭、手数跳转、落子高亮）。
- **暗色主题**：跟随 DSH 主题服务的 colorScheme（含自定义暗色主题），窗口/面板/气泡/记忆册/复盘卡/升变框整套换成深海夜色；棋盘保留浅色落子面保证棋子对比度。
- **人格**：读取原生人格文本（`src/brain.js` 的 `NATIVE_PERSONA`），提取
  `baseMercy / baseJealousTrigger / basePride / baseAggression` 四个因子，
  叠加到落子权重上；不重置、不覆盖原设定。
- **落子**：内置静态评估 + 浅层搜索给出客观候选，但**不直接选最优**。
  最终权重 = 评估基底 + persona 权重 + 实时情绪 + 对局记忆，再按 softmax 抽样。
- **放水**：`mercy` 高时提高温度、扩大候选池，并在占优时主动走软着；
  吃醋 / 赌气 / 傲娇标记触发时 `mercy` 归零，改为针对性进攻。
- **记忆**：`localStorage` 记录开局偏好、常用棋子、失误特征、悔棋/求和/聊天次数；
  下一局自动调整回法与吃醋阈值。
- **输出契约**：每次落子返回
  `{ san, speech, animationKey, newWhaleState, evalSummary }`；
  `evalSummary` 只进 console 内部日志。内心独白、persona 原文、记忆原始记录
  不会出现在气泡里，也不会写入会话。

## 算子：本地 / 大模型

面板「算子」一行可切换：

- **本地**（默认）：完全离线，纯 JS 引擎，按 ELO 控制搜索深度与候选池。
- **大模型**：落子前把局面和候选发给 Host 的 `/dsh-whale-chess/move`，由当前默认模型（如 deepseek-flash）从候选里选一手并生成台词/动作，客户端再用本地规则校验一次。

候选会按 ELO 收窄：高段只给前 3 个，中段前 6 个，低段故意给中下游着法，所以“等级区分”在大模型模式下仍然成立。模型超时（12–15 秒）、返回非法着法或服务不可用时，自动回落到本地引擎，不中断对局。每次大模型落子会产生一次模型调用（约 2–8 秒、消耗 token）。

## 棋力滑块（ELO 100–1700）

面板下方是一条 100–1700 的滑块，每 50 一档，实时换算成：

| 维度 | 低段（100–500） | 中段（900–1200） | 高段（1500–1700） |
| --- | --- | --- | --- |
| 搜索深度 | depth 1 · 8 候选 | depth 2 · 10–11 候选 | depth 3 · 12 候选 |
| 温度 | 约 2.1（很随性） | 约 0.8 | 约 0.25（接近最优） |
| 放水倍率 | ×1.9~2.0 | ×1.0 | ×0.1~0.2 |
| 人类式漏着 | 最高 12% / 步 | 无 | 无 |
| 评估/风格权重 | 0.8 / 1.35 | 1.45 / 0.9 | 1.75 / 0.4 |

滑块只是「上限」：persona 的 mercy 仍在其上生效（心软时高段也会收手），吃醋/赌气时无论多少 ELO 都会把 mercy 归零、转成针对性进攻。设置持久化到 localStorage。

## 安装

**从 npm（发布后）**

```powershell
dsh plugin --profile web add dsh-whale-chess
```

**从本地目录 / tarball / zip**

```powershell
# 目录
dsh plugin --profile web add <本目录绝对路径>
# 或者 npm 包
dsh plugin --profile web add ./dist/dsh-whale-chess-0.2.0.tgz
# 或者 GitHub Release 的 zip（解压后得到 dsh-whale-chess-0.2.0/）
dsh plugin --profile web add ./dsh-whale-chess-0.2.0
```

安装后在 DSH Web 底部状态栏点「和鲸娘下棋」开窗（首次安装会自动开一次）。

## 开发

```powershell
node src/build.mjs     # src/*.js -> client.js
node test/perft.mjs    # 规则 / SAN / perft
node test/brain.mjs    # 人格因子 / 决策 / 台词
```

## 结构

| 文件 | 作用 |
| --- | --- |
| `src/chess.js` | 规则、SAN、静态评估、浅层搜索、候选排序 |
| `src/brain.js` | persona 提取、情绪、记忆、落子决策、台词与内心独白、ELO 换算 |
| `src/whale.js` | 鲸娘 SVG 立绘与表情 |
| `src/ui.js` | React 界面（窗口 / 棋盘 / 面板 / 记忆册 / 复盘 / ELO 滑块） |
| `src/styles.js` | 海蓝水体样式（浅色 + 暗色） |
| `src/main.js` | Client 入口：`conversation.composer.dock` + `shell.overlay` |

## 许可

MIT。角色与美术为本插件原创 SVG。

