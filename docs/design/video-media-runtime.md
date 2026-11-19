# 视频媒体工具与恢复验证

日期：2026-11-12。此页保留媒体技术验证依据；下载、预览与入库的产品完成状态统一见[实施进度](video-download-progress.md)。当前 Python 维护版本与许可见[运行材料](video-runtime-notices.md)。

## 独立工具

- 使用发布方 [Gyan Windows FFmpeg 构建](https://www.gyan.dev/ffmpeg/builds/)的 `9.0.2-essentials_build`，工具在 MOWO 的 `data/video-runtime/tools/`，不使用 LINE 的虚拟环境或系统 PATH。
- 固定来源、包哈希和两个可执行文件哈希保存在 `scripts/video/media-runtime.json`。包 SHA-256：`4705843ccaaf54257c16ad90f3e952ece33c17df964ecf7bfdbb0f49c7171077`，已与发布方记录核对。
- `setup-media.ps1` 验证包哈希、归档路径、提取后程序哈希及运行版本；保留上游 LICENSE、README。当前依赖 Windows 自带、支持 7z 的 tar；不支持的系统会明确报错。
- 上游 README 标明 GPL v3，程序 `-L` 标明 GPL v3 或后续版本；构建启用了 libx264/libx265。对应源码为 [FFmpeg commit 946fcce07b](https://github.com/FFmpeg/FFmpeg/commit/946fcce07b)。当前仅验证本机工具调用；未来安装包需一并确定源码提供与许可材料的交付方式。

## 预览验证

`media.py` 使用 ffprobe 检查视频轨、尺寸、有效时长及需要时的音轨；MP4/H.264/yuv420p/AAC 只是浏览器兼容候选，不能替代浏览器播放验证。

预览保留原文件，单独输出最大 1280×720、保持比例且不放大小视频的 H.264/AAC MP4。输出先写随机临时文件，通过媒体和时长检查后替换预览缓存。原片与目标同一路径或同一文件时拒绝执行。无声视频无需伪造音轨。HDR 转 SDR 的色调映射尚未实现，当前会明确失败并保留原片，不输出颜色不正确的“成功预览”。

用户样本 `BV1bv411T7et` 的 HEVC 原片为 1920×1080、136.811746 秒；预览为 1280×720 H.264/AAC，时长一致。Chrome 无头模式实际解码并定位到约 68.406 秒，测试服务收到 Range 请求。原有 H.264 原片也通过解码与定位播放。续下后的完整原片与生成预览均经过 FFmpeg 全片解码检查，退出码为 0。

## 续下判定

- 下载前重新解析并核对公开 BV/分 P、格式 ID、尺寸/编码、媒体对象路径哈希及提取器版本；identity.json 不保存 Cookie 或签名媒体 URL。
- 身份不匹配、缺失有效媒体对象或存在没有身份记录的部分文件时，保留文件并返回需要明确重试的错误，不能自动拼接或改画质。
- 存在已验证部分文件时先报告 `candidate`；只有下载请求确实使用对应非零偏移、返回匹配 Content-Range 的 HTTP 206 才报告 `continued`。普通分块请求不能被当成跨进程续下。服务器忽略 Range 时报告 `restarted`，不能声称保留了进度。
- 本机 Range 测试验证了续下与忽略 Range 两种路径，最终内容 SHA-256 都正确。实际 B 站样本在中断后留下 523046 字节，新工作进程从同一偏移继续成功，完成后 ffprobe 与全片解码均通过。
- 多 P 元数据样本 `BV1ms411Q7vw?p=4` 返回 `_p4`，未退回第一 P；未下载该多 P 样本视频。

这些结论仅覆盖独立引擎与受测样本。Job 收束、残留进程处理及应用启动原型也已完成验证，见[生命周期验证](video-process-lifecycle.md)。当前首版接最小任务记录、单执行者和基本文件保护；完整读租约、SQL 租约与自动恢复系统移至后续清单，不作为剩余首版工作。

## 重复验证

```powershell
powershell -NoProfile -File scripts/video/setup-media.ps1
data/video-runtime/python/python.exe scripts/video/test_media.py
data/video-runtime/python/python.exe scripts/video/test_recovery.py
node scripts/video/verify-live-media.mjs
node scripts/video/verify-preview-browser.mjs <生成的预览文件路径>
```

前两项测试使用自己生成的短视频及本机 HTTP 服务；live-media 会访问用户提供的 B 站视频、故意中断一次下载并重新读取已保存的加密凭据，非默认离线测试。浏览器验证使用安装的 Chrome，或通过 `MOWO_TEST_CHROME` 提供可执行文件。工具和验证数据均不进入 Git。
