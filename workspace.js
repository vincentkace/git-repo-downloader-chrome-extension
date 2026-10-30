const { git, LightningFS, http, fflate } = window.BrowserGit;
const repoInput = document.getElementById("repo");
const branchInput = document.getElementById("branch");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const cloneButton = document.getElementById("clone");
const exportButton = document.getElementById("export");
const clearCacheButton = document.getElementById("clearCache");
const progress = document.getElementById("progress");
const statusBox = document.getElementById("status");
const githubClientIdInput = document.getElementById("githubClientId");
const saveGithubClientIdButton = document.getElementById("saveGithubClientId");
const connectGithubButton = document.getElementById("connectGithub");
const disconnectGithubButton = document.getElementById("disconnectGithub");
const githubAuthStatus = document.getElementById("githubAuthStatus");
const deviceCodeContainer = document.getElementById("deviceCodeContainer");
const deviceCodeElement = document.getElementById("deviceCode");
const deviceCodeLink = document.getElementById("deviceCodeLink");
const fs = new LightningFS("browser-git-clone-v1");
const pfs = fs.promises;
let githubAccessToken = null;
let githubAuthInProgress = false;

function githubAuthMessage(message, kind = "") {
  githubAuthStatus.textContent = message;
  githubAuthStatus.dataset.kind = kind;
}

async function requestGithubPermission() {
  const granted = await chrome.permissions.request({ origins: ["https://github.com/*"] });
  if (!granted) throw new Error("未授予 github.com 网络访问权限，无法开始 GitHub 授权。");
}

async function postGithubForm(path, values) {
  let response;
  try {
    response = await fetch(`https://github.com${path}`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(values)
    });
  } catch (error) {
    throw new Error(`无法连接 GitHub 授权服务：${error?.message || error}。请检查网络或企业代理策略。`);
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`GitHub 授权服务返回了无法识别的响应（HTTP ${response.status}）。`); }
  if (!response.ok) throw new Error(`GitHub 授权服务错误（HTTP ${response.status}）：${data.error_description || data.message || data.error || "请求失败"}`);
  return data;
}

async function waitForGithubAuthorization(clientId, deviceCode, interval, expiresIn) {
  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, interval * 1000));
    if (!githubAuthInProgress) return null;
    let data;
    try {
      data = await postGithubForm("/login/oauth/access_token", {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      });
    } catch (error) {
      throw error;
    }
    if (data.access_token) return data.access_token;
    switch (data.error) {
      case "authorization_pending":
        githubAuthMessage("等待你在 GitHub 页面确认授权…");
        break;
      case "slow_down":
        interval += 5;
        githubAuthMessage("GitHub 要求降低轮询频率，正在稍后重试…");
        break;
      case "access_denied":
        throw new Error("你在 GitHub 页面拒绝了授权。");
      case "expired_token":
        throw new Error("授权验证码已过期，请重新点击“连接 GitHub”。");
      default:
        throw new Error(`GitHub 授权未完成：${data.error_description || data.error || "未知错误"}`);
    }
  }
  throw new Error("授权等待超时（15 分钟）。请重新点击“连接 GitHub”。");
}

chrome.storage.local.get({ githubClientId: "" }).then(({ githubClientId }) => {
  githubClientIdInput.value = githubClientId;
}).catch(error => githubAuthMessage(`读取 Client ID 配置失败：${error.message || error}`, "error"));

saveGithubClientIdButton.addEventListener("click", async () => {
  const clientId = githubClientIdInput.value.trim();
  if (!clientId) {
    githubAuthMessage("请先填写 GitHub App Client ID。", "error");
    return;
  }
  try {
    await chrome.storage.local.set({ githubClientId: clientId });
    githubAuthMessage("Client ID 已保存在此浏览器扩展的本地配置中。", "success");
  } catch (error) {
    githubAuthMessage(`保存配置失败：${error.message || error}`, "error");
  }
});

connectGithubButton.addEventListener("click", async () => {
  if (githubAuthInProgress) return;
  const clientId = githubClientIdInput.value.trim();
  if (!clientId) {
    githubAuthMessage("请先填写 GitHub App Client ID。", "error");
    githubClientIdInput.focus();
    return;
  }
  githubAuthInProgress = true;
  connectGithubButton.disabled = true;
  deviceCodeContainer.hidden = true;
  githubAuthMessage("正在申请 GitHub 设备授权码…");
  try {
    await requestGithubPermission();
    await chrome.storage.local.set({ githubClientId: clientId });
    const device = await postGithubForm("/login/device/code", { client_id: clientId });
    if (!device.device_code || !device.user_code || !device.verification_uri) {
      throw new Error(`GitHub 没有返回完整设备授权信息：${device.error_description || device.error || "请确认 Client ID 正确且已启用 Device Flow"}`);
    }
    const verificationUrl = new URL(device.verification_uri);
    if (verificationUrl.protocol !== "https:" || verificationUrl.hostname !== "github.com") {
      throw new Error("GitHub 返回了非预期的授权地址，已停止授权以保护账号安全。");
    }
    deviceCodeElement.textContent = device.user_code;
    deviceCodeLink.href = verificationUrl.href;
    deviceCodeContainer.hidden = false;
    githubAuthMessage("请在 GitHub 页面输入上方验证码并完成登录/2FA 授权。", "success");
    const token = await waitForGithubAuthorization(clientId, device.device_code, device.interval || 5, device.expires_in || 900);
    if (!token) return;
    githubAccessToken = token;
    disconnectGithubButton.disabled = false;
    githubAuthMessage("GitHub 已连接。克隆 github.com 私有仓库时会使用此授权；令牌只在当前页面内存中。", "success");
  } catch (error) {
    githubAuthMessage(error?.message || String(error), "error");
  } finally {
    githubAuthInProgress = false;
    connectGithubButton.disabled = false;
    deviceCodeContainer.hidden = true;
  }
});

disconnectGithubButton.addEventListener("click", () => {
  githubAccessToken = null;
  disconnectGithubButton.disabled = true;
  githubAuthMessage("已退出 GitHub；内存中的访问令牌已清除。");
});

function status(message, kind = "") {
  statusBox.textContent = message;
  statusBox.dataset.kind = kind;
}

function parseRepo(value) {
  let url;
  try { url = new URL(value.trim()); }
  catch { throw new Error("输入错误：请填写完整的 HTTPS Git 仓库地址。"); }
  if (url.protocol !== "https:") throw new Error("地址错误：目前只允许 HTTPS 仓库，避免凭据明文传输。");
  if (url.username || url.password) throw new Error("安全提示：不要把账号密码写进仓库 URL，请使用下面的凭据输入框。");
  if (!url.hostname || url.pathname.split("/").filter(Boolean).length < 2) {
    throw new Error("地址错误：应类似 https://gitee.com/组织/仓库.git 或 https://github.com/组织/仓库.git。");
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "").replace(/\.git$/i, "") + ".git";
  const segments = url.pathname.split("/").filter(Boolean);
  const repoName = segments.at(-1).replace(/\.git$/i, "");
  const safeId = `${url.hostname}-${segments.join("-")}`.replace(/[^a-zA-Z0-9._-]/g, "_");
  return { url: url.href, origin: url.origin, repoName, safeId };
}

function formatCloneError(error) {
  const text = `${error?.name || ""} ${error?.message || error || ""}`;
  const code = error?.statusCode || error?.status || error?.data?.statusCode;
  if (code === 401 || /HTTPError.*401|status code 401/i.test(text)) {
    return "认证失败（HTTP 401）：用户名或密码/令牌无效、已过期，或此 Git 服务要求用令牌代替账户密码。";
  }
  if (code === 403 || /HTTPError.*403|status code 403/i.test(text)) {
    return "访问被拒绝（HTTP 403）：账号可能没有仓库读取权限、组织 SSO 尚未授权令牌，或服务端策略禁止克隆。";
  }
  if (code === 407) return "代理认证失败（HTTP 407）：当前网络代理要求额外登录，Git 扩展无法取得代理凭据。";
  if (code === 408) return "连接超时（HTTP 408）：Git 服务或代理未能及时响应。";
  if (code === 429) return "请求过于频繁（HTTP 429）：Git 服务触发了限流，请稍后重试。";
  if (code === 404 || /HTTPError.*404|status code 404/i.test(text)) {
    return "仓库不存在或不可见（HTTP 404）：请检查 URL；私有仓库也可能因未认证而被服务端隐藏。";
  }
  if (code === 400 || code === 415 || /InvalidResponseError/i.test(text)) {
    return `Git 协议响应错误（HTTP ${code || "?"}）：地址可能不是 Git HTTPS 克隆端点，或服务器/代理没有正确提供 Git Smart HTTP。\n${text}`;
  }
  if (code >= 500) return `Git 服务端错误（HTTP ${code}）：服务暂时不可用，请稍后重试。\n${text}`;
  if (error?.name === "QuotaExceededError" || /QuotaExceededError|quota exceeded/i.test(text)) {
    return "浏览器存储空间不足：完整 Git 历史无法写入 IndexedDB。请清理浏览器空间或尝试较小的仓库。";
  }
  if (/未授予 .* 的网络访问权限/.test(text)) return `扩展权限被拒绝：${text}`;
  if (error?.name === "NotFoundError" || /ENOENT|NotFoundError/i.test(text)) {
    return `仓库路径或本地浏览器文件系统状态错误。\n${text}`;
  }
  if (Number.isInteger(code) && code >= 400) {
    return `Git 服务返回 HTTP ${code}${error?.data?.statusMessage ? ` ${error.data.statusMessage}` : ""}。请检查仓库 URL、Git HTTPS 服务状态或网络代理策略。`;
  }
  if (error instanceof TypeError || /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(text)) {
    return "网络连接失败：浏览器没有拿到 HTTP 响应。页面脚本无法进一步区分 DNS、TLS 证书、代理/防火墙拦截或网络断开。请先在此 Chrome 中打开仓库域名确认可访问，并检查企业网络策略。";
  }
  return `克隆失败：${text}`;
}

function repoDir(safeId, branch = "") {
  const branchKey = branch.trim() ? `-branch-${encodeURIComponent(branch.trim())}` : "";
  return `/clones/${safeId}${branchKey}`;
}

function cloneLabel(repoName, branch = "") {
  const safeBranch = branch.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safeBranch ? `${repoName}-${safeBranch}` : repoName;
}

async function ensureBase() {
  try { await pfs.stat("/clones"); }
  catch { await pfs.mkdir("/clones"); }
}

async function hasClone(dir) {
  try { await pfs.stat(`${dir}/.git/HEAD`); return true; }
  catch { return false; }
}

async function removeTree(path) {
  let stat;
  try { stat = await pfs.stat(path); }
  catch { return; }
  if (stat.isDirectory()) {
    for (const name of await pfs.readdir(path)) await removeTree(`${path}/${name}`);
    await pfs.rmdir(path);
  } else {
    await pfs.unlink(path);
  }
}

cloneButton.addEventListener("click", async () => {
  let credential = null;
  let workingDir = null;
  let cloneStarted = false;
  let cloneSucceeded = false;
  cloneButton.disabled = true;
  exportButton.disabled = true;
  clearCacheButton.disabled = true;
  progress.value = 0;
  try {
    const repo = parseRepo(repoInput.value);
    const branch = branchInput.value.trim();
    const granted = await chrome.permissions.request({ origins: [`${repo.origin}/*`] });
    if (!granted) throw new Error(`未授予 ${repo.origin} 的网络访问权限。`);

    await ensureBase();
    const dir = repoDir(repo.safeId, branch);
    workingDir = dir;
  if (await hasClone(dir)) throw new Error("该仓库已克隆到此浏览器工作区。可直接导出 ZIP；如需重新克隆，请先点击“清除缓存”。");
    await removeTree(dir);

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const useGithubToken = repo.origin === "https://github.com" && Boolean(githubAccessToken);
    if (!useGithubToken && Boolean(username) !== Boolean(password)) throw new Error("认证输入不完整：用户名和密码/令牌需要同时填写；公开仓库则两项都留空。");
    credential = useGithubToken
      ? { username: "x-access-token", password: githubAccessToken }
      : (username || password ? { username, password } : null);
    usernameInput.value = "";
    passwordInput.value = "";
    status(`正在连接 ${repo.origin} 并开始完整克隆${branch ? `，检出分支 ${branch}` : "，检出默认分支"}…`);

    cloneStarted = true;
    await git.clone({
      fs,
      http,
      dir,
      url: repo.url,
      ref: branch || undefined,
      singleBranch: false,
      noTags: false,
      onAuth: () => credential || undefined,
      onProgress: event => {
        const pct = event.lengthComputable && event.total ? Math.min(99, Math.round(event.loaded / event.total * 100)) : 0;
        progress.value = pct;
        const phase = event.phase || "正在接收 Git 对象";
        status(`${phase}${event.loaded ? ` · ${event.loaded}${event.total ? ` / ${event.total}` : ""}` : ""}`);
      }
    });
    cloneSucceeded = true;
    progress.value = 100;
    status(`完整克隆完成${branch ? `，当前检出 ${branch}` : "，当前检出默认分支"}。所有分支和 .git 历史已保存在浏览器 IndexedDB 中；点击“导出包含 .git 的 ZIP”保存到电脑。`, "success");
    exportButton.disabled = false;
  } catch (error) {
    if (cloneStarted && !cloneSucceeded && workingDir) try { await removeTree(workingDir); } catch {}
    status(formatCloneError(error), "error");
  } finally {
    credential = null;
    usernameInput.value = "";
    passwordInput.value = "";
    cloneButton.disabled = false;
    clearCacheButton.disabled = false;
  }
});

clearCacheButton.addEventListener("click", async () => {
  if (cloneButton.disabled || clearCacheButton.disabled) return;
  const confirmed = window.confirm("清除缓存会删除此浏览器中所有已克隆仓库及其完整 Git 历史，不能撤销。GitHub App Client ID 等扩展配置会保留。继续吗？");
  if (!confirmed) return;

  clearCacheButton.disabled = true;
  cloneButton.disabled = true;
  exportButton.disabled = true;
  progress.value = 0;
  status("正在清除浏览器中保存的仓库克隆…");
  try {
    await removeTree("/clones");
    await ensureBase();
    status("缓存已清除：所有仓库克隆和 Git 历史已删除，扩展配置已保留。", "success");
  } catch (error) {
    status(`清除缓存失败：${error?.message || error}`, "error");
  } finally {
    cloneButton.disabled = false;
    clearCacheButton.disabled = false;
  }
});

async function listRepoFiles(rootPath, relative = "", output = []) {
  const entries = await pfs.readdir(rootPath);
  for (const name of entries) {
    const absolute = `${rootPath}/${name}`;
    const rel = relative ? `${relative}/${name}` : name;
    const stat = await pfs.stat(absolute);
    if (stat.isDirectory()) await listRepoFiles(absolute, rel, output);
    else if (stat.isFile()) output.push({ absolute, relative: rel });
  }
  return output;
}

async function exportZip(dir, basename, fileHandle) {
  const files = await listRepoFiles(dir);
  if (!files.length) throw new Error("克隆目录为空，无法导出。");
  let writable = fileHandle ? await fileHandle.createWritable() : null;
  let chunks = null;
  if (!writable) chunks = [];

  const zip = new fflate.Zip();
  let writeChain = Promise.resolve();
  let rejectZip;
  let resolveZip;
  const zipDone = new Promise((resolve, reject) => { resolveZip = resolve; rejectZip = reject; });
  zip.ondata = (error, chunk, final) => {
    if (error) { rejectZip(error); return; }
    if (chunk?.length) {
      if (writable) {
        writeChain = writeChain.then(() => writable.write(chunk));
        writeChain.catch(rejectZip);
      }
      else chunks.push(chunk);
    }
    if (final) resolveZip();
  };

  const top = basename.replace(/[^\w.-]+/g, "-");
  try {
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      const bytes = await pfs.readFile(item.absolute);
      const entry = new fflate.ZipDeflate(`${top}/${item.relative}`, { level: 1 });
      zip.add(entry);
      entry.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), true);
      if (i % 30 === 0 || i === files.length - 1) {
        status(`正在打包仓库文件和 .git 元数据：${i + 1} / ${files.length}`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    zip.end();
    await zipDone;
    await writeChain;
    if (writable) {
      await writable.close();
    } else {
      const blob = new Blob(chunks, { type: "application/zip" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${top}-full-clone.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    }
    status(`导出完成：${top}-full-clone.zip，包含 .git、完整提交历史、分支与标签。`, "success");
  } catch (error) {
    try { await writable?.abort(); } catch {}
    throw error;
  }
}

exportButton.addEventListener("click", async () => {
  clearCacheButton.disabled = true;
  try {
    const repo = parseRepo(repoInput.value);
    const branch = branchInput.value.trim();
    const label = cloneLabel(repo.repoName, branch);
    let fileHandle = null;
    if (window.showSaveFilePicker) {
      // Open the picker synchronously from the user's click, before any async
      // filesystem work consumes the transient user activation.
      fileHandle = await window.showSaveFilePicker({
        suggestedName: `${label}-full-clone.zip`,
        types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }]
      });
    }
    const dir = repoDir(repo.safeId, branch);
    if (!(await hasClone(dir))) throw new Error("此浏览器工作区里还没有该仓库的克隆。");
    exportButton.disabled = true;
    await exportZip(dir, label, fileHandle);
  } catch (error) {
    status(error?.name === "AbortError" ? "用户取消了导出。" : (error?.message || String(error)), error?.name === "AbortError" ? "" : "error");
  } finally {
    exportButton.disabled = false;
    clearCacheButton.disabled = false;
  }
});

repoInput.addEventListener("change", async () => {
  try {
    const repo = parseRepo(repoInput.value);
    const branch = branchInput.value.trim();
    exportButton.disabled = !(await hasClone(repoDir(repo.safeId, branch)));
    if (!exportButton.disabled) status(`发现此前保存在此浏览器的完整克隆${branch ? `（分支 ${branch}）` : ""}，可以直接导出。`, "success");
  } catch {
    exportButton.disabled = true;
  }
});

branchInput.addEventListener("input", async () => {
  try {
    const repo = parseRepo(repoInput.value);
    exportButton.disabled = !(await hasClone(repoDir(repo.safeId, branchInput.value.trim())));
  } catch {
    exportButton.disabled = true;
  }
});
