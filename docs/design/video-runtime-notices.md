# 视频运行环境来源与许可材料

交付基线（2026-11-12）：Windows x64，本机独立进程调用。运行文件、第三方许可原文和凭据均不提交 Git；重建脚本从固定来源下载并校验哈希，不依赖系统 Python、PATH 或其他项目。

| 组件 | 固定版本与来源 | 许可材料 |
|---|---|---|
| CPython | [3.14.10 官方维护发布](https://www.python.org/downloads/release/python-31410/)，Windows x64 embed | 嵌入包自带 LICENSE.txt；来源、目录和 SHA-256 统一见 [Python 清单](../../scripts/video/python-runtime.json) |
| yt-dlp | 2026.10.21，PyPI 纯 Python wheel | wheel 的 `yt_dlp-2026.10.21.dist-info/licenses/LICENSE`，Unlicense；包 URL/SHA-256 固定在 [安装脚本](../../scripts/video/setup-runtime.ps1) |
| qrcode | 8.2，PyPI wheel | `qrcode-8.2.dist-info/LICENSE` 包含 BSD 条款和上游 MIT 来源声明；保留全部原文，固定 URL/SHA-256 同上 |
| FFmpeg / ffprobe | Gyan `9.0.2-essentials_build` | [媒体清单](../../scripts/video/media-runtime.json)固定归档/程序哈希、源码提交和 GPL-3.0-or-later；setup-media 保留上游 LICENSE/README |

Python 在 `data/video-runtime/python-3.14.10`，工具在 `data/video-runtime/tools`。旧实验 Python 目录保留以便回查，不用于普通启动。Python 升级后，扫码加密、引擎、媒体和实际进程守护通过 `npm run test:video-engine` 回归；运行版本也通过存储信息接口显示。

自动分镜运行环境（2026-11-17）：`npm run video:setup-shots` 在项目内 Python 目录安装 PyAV 19.0.2、NumPy 2.4.5、ONNX Runtime DirectML 1.24.4 及其固定哈希依赖；模型位于 `data/video-runtime/models/transnet-split.onnx`，安装时校验 SHA-256。安装脚本保留 wheel 内的许可文件，具体固定 URL 和哈希见 [分镜安装脚本](../../scripts/video/setup-shots.ps1)。模型文件目前由用户提供；其来源与再分发许可需在制作安装包前单独确认。本机已验证项目内运行环境能完成海贼王样本的 4352 帧分析并得到 72 个切点；尚未在另一台电脑验收。

本轮交付源码、重建脚本和固定清单，不新增 Windows 安装器。未来制作包含第三方二进制的安装包时，应保留对应许可、版权与源码材料；不把清单当成已完成安装包分发工作的证明。FFmpeg 的当前对应源码地址由发布方 README/清单记录为 [946fcce07b](https://github.com/FFmpeg/FFmpeg/commit/946fcce07b)。
