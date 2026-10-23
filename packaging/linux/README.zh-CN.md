# AIVORA Linux x64 桌面

这是未签名的 Linux 预览包，和 Windows 安装包同一代产品。包内有 Electron、Python 后端和 FFmpeg，不需要再安装 Node、Python 或系统 FFmpeg。

## 安装系统库

Ubuntu 桌面通常已经带有这些库。缺库时再安装：

Ubuntu 22.04：

```sh
sudo apt-get install libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxkbcommon0 xdg-utils libsecret-1-0 gnome-keyring
```

Ubuntu 24.04：

```sh
sudo apt-get install libgtk-3-0t64 libnss3 libasound2t64 libgbm1 libxss1 libxkbcommon0 xdg-utils libsecret-1-0 gnome-keyring
```

`xdg-utils` 用来打开系统浏览器。`libsecret-1-0` 和 `gnome-keyring` 用来把 Grok 登录令牌放进系统密钥环。

## 启动

```sh
tar -xzf AIVORA-Desktop-0.2.4-linux-x64.tar.gz
cd AIVORA-Desktop-0.2.4-linux-x64
./launch-aivora.sh
```

`./launch-aivora.sh --check` 只检查内置后端和 FFmpeg，不打开窗口，也不碰你的作品。

## 登录

点击 Grok 登录后，系统浏览器打开 `https://auth.x.ai`。同意之后，回调回到本机 `http://127.0.0.1:56121/callback`。这一步不复制验证码。

登录日志：`~/.config/AIVORA/logs/grok-login.log`。日志只记状态码，不写令牌。

令牌存放见 `~/.config/AIVORA/grok-official/storage-backend.txt`：

- `gnome_libsecret`：Electron safeStorage 通过 libsecret / gnome-keyring 保存。
- `kwallet`、`kwallet5` 或 `kwallet6`：通过 KWallet 保存。
- `file_key`：这台机器没有可用的密钥环（Electron 只能用 basic_text，或加密不可用）。令牌改为本目录 `fallback.key` 做 AES-256-GCM，密钥文件权限是 0600。这是应用自己的后备，不是系统密钥环。

作品在 `~/.config/AIVORA/workspace`。

FFmpeg 是随包的 GPL-3.0-or-later 构建，只用于本机草稿和探测，不是正式发行许可。
