# TasteTrip 两分钟演示

从「两个人的口味冲突」走到「撕开的票根被订成一张行程」。按这个顺序点，页面和动画就是这个顺序。全程大约 2 分钟。预览地址写在 README 的 Preview 一节。

口味是固定这一对：旅人 A《布达佩斯大饭店》/ 爵士 / 火锅，旅人 B Marvel / 嘻哈 / 寿司。没有服务器密钥时，行程来自录好的 Qloo 回放，不是手写的四站。海报位是标了 placeholder 的纸纹，不是照片。

## 0:00 一句话

打开页面，停在纸色第一屏。读标题：

> 两个人的口味冲突 → 找出重叠

不要先讲功能清单。这句话就是产品。

## 0:20 一键试玩

点墨色按钮 **一键试玩**。页面滚到 Agent 四步。四格一开始都是「等待」。

## 0:30 解析口味

第一格 **解析口味** 标成完成，中间结果是两边的六个词：

> A 《布达佩斯大饭店》 / 爵士 Jazz / 火锅 · B Marvel / 嘻哈 Hip-hop / 寿司

## 0:50 询问 Qloo

第二格 **询问 Qloo** 完成。没有服务器密钥时，结果写着 **回放 · qloo:replay**，并带上实体名和亲和度，例如 The Grand Budapest Hotel 0.22。浏览器只把口味文字 POST 到 `/api/qloo`。密钥只在服务器上。没有密钥时代理不打 Qloo，改为播放 `fixtures/qloo`。

## 1:10 标出冲突

第三格 **标出冲突** 完成，下面两张票根滑进来。

- 左边实线票根是旅人 A，右边虚线票根是旅人 B。同一支墨色，不是两种颜色。
- 中间裂口是 **冲突**。
- 三处，每处带 `qloo:replay`：城市气质 / City vibe（The Grand Budapest Hotel 对 Marvel Cinematic Universe），音乐场 / Music room，用餐方式 / Dining style。

指着裂口说：不是把两个人平均成一个无聊的中间点，而是先承认这两处对不上。

## 1:25 重排

第四格 **重排路线** 完成后，朱红行程线从裂口下面展开。实线和虚线还在左右，表示两张票被订回一张。

交集是 **夜城交叉 / Night-city crossing**。四站都有标签 **为什么两人都喜欢 · Why both will like it**，并标着 `qloo:replay`：

1. 19:30 Szimpla Night Court（affinity 0.84）
2. 20:10 Menza After Dark
3. 21:40 Instant Fogas
4. 23:15 Uránia Roof

读第 1 站的理由。它来自洞察里的地点亲和度，不是「对称旅馆大堂」。

## 1:50 收束

指着行程底部：这些标记是 `qloo:replay`。服务器配上密钥之后，第二步会打 `https://hackathon.api.qloo.com` 的 search 和 insights，标记应变成 `qloo:entity`，不应再出现 `mock:fixture`。限流、超时或宕机会留下一枚朱红小签，票根和回放行程还在，页面不会空白。

如果还剩十几秒，点 **对照页**。左栏是刚才的 Qloo 回放。右栏是不读图谱的规则，停站回到对称旅馆大堂那一套，标记 `mock:fixture`。不要说谁赢了。

到这里大约 2 分钟。如果要再看一遍动画，滚回顶部再点一次 **一键试玩**。
