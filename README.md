# Browser Git Clone

Manifest V3 Chrome extension that performs an actual HTTPS Git clone in the browser using `isomorphic-git` and an IndexedDB-backed filesystem. It keeps `.git`, complete commit history, fetched branches, and tags. Export creates a ZIP containing the repository directory and its `.git` metadata.

## Install

1. Open `chrome://extensions` and enable Developer mode.
2. Click **Load unpacked** and select this folder.
3. Open the extension and enter a repository URL, for example `https://gitee.com/owner/repo.git` or `https://github.com/owner/repo.git`. Optionally enter a branch name to check out; the clone still fetches all branches, tags, and full history.
4. For a public repository, leave the credential fields empty. For a private Gitee or other Git HTTPS repository, enter that service's Git HTTPS username and password/token in the credentials section. For a GitHub account with 2FA, use the GitHub App authorization below or enter a GitHub access token as the password; a GitHub account login password will not work for Git HTTPS.
5. Click **克隆完整仓库** and grant access to that HTTPS host. After completion, click **导出包含 .git 的 ZIP** and choose where to save it. Click **清除缓存** to delete every cloned repository and its Git history from this browser; extension settings such as the GitHub App Client ID are preserved.

## Authentication and privacy

- Gitee and other Git HTTPS credentials are only held in the workspace page's memory while cloning. The extension does not write them to browser storage or Git config, and clears the input after the operation.
- GitHub App Client ID is stored in extension local settings; it is an app identifier, not a secret. The GitHub user access token is held only in the current workspace page's memory and is cleared when you disconnect or close/reload the page.
- To enable GitHub sign-in, create a GitHub App under **Settings → Developer settings → GitHub Apps → New GitHub App**. Set repository permissions **Contents: Read-only**, enable **Device Flow**, and install the app on the repositories you want to clone. No client secret or callback URL is needed for Device Flow. Copy the app's **Client ID** (not App ID) into the workspace and click **Connect GitHub**. Follow the link, enter the displayed code, and complete GitHub login and 2FA. The extension polls until authorization completes.
- The resulting GitHub App user access token is sent as the password for HTTPS Git access (`x-access-token` username) only when cloning `https://github.com/...`. The extension does not put it in the repository URL, browser storage, or Git config. This login does not reuse an already-open github.com cookie. The GitHub App flow is recommended for accounts with 2FA; the account login password is not accepted for Git HTTPS.

### GitHub App setup, step by step

1. On GitHub, open **Settings → Developer settings → GitHub Apps → New GitHub App**. You can create the app under your personal account. Give it a recognizable name and a homepage URL (for personal use, your GitHub profile URL is fine).
2. In **Repository permissions**, set **Contents** to **Read-only**. Leave unrelated permissions at **No access**.
3. Enable **Device Flow**. A callback URL and Client Secret are not used by this extension's Device Flow.
4. Save the app. On its settings page, copy **Client ID** (not **App ID**). The Client ID is not a secret and can be entered in the extension.
5. Install the GitHub App on your account and select the private repository/repositories you want to clone. For organization repositories, an organization owner may need to approve the installation or requested permissions.
6. In the extension workspace, paste the Client ID and click **连接 GitHub**. Open the displayed `github.com/login/device` link, enter the one-time code, sign in, and complete your normal 2FA challenge. Keep the workspace page open while it waits for approval.
7. Enter a `https://github.com/OWNER/REPO.git` URL and click **克隆完整仓库**. The app authorization applies only to GitHub; other Git hosts continue to use the username/password-or-token fields.
- Git HTTPS usually uses HTTP Basic authentication. Many services no longer accept account passwords and require an access token instead. For GitHub, use a fine-grained token with **Contents: Read-only** access to the target repository. For Gitee, use the account username and the Git password/token required by that account or organization.
- The existing web login cookie is not reused for Git smart-HTTP. Enter the Git HTTPS credentials or token when needed.
- Credentials and Git traffic are sent directly from Chrome to the entered HTTPS host. No proxy service is used by this extension.

## Error messages

- HTTP 401: credentials rejected or token expired/unsupported.
- HTTP 403: account lacks read access, SSO/token authorization is missing, or server policy blocks the operation.
- HTTP 404: repository URL is wrong or a private repository is hidden from this credential.
- HTTP 5xx: remote Git server error.
- `Failed to fetch` / NetworkError: Chrome did not expose an HTTP response. Browser JavaScript cannot distinguish DNS failure, TLS/certificate problems, proxy/firewall blocking, and a disconnected network; the message explains this limitation.

## Limits

- Git HTTPS only; SSH URLs and self-signed certificates are not supported.
- Git LFS payloads and submodule working trees are not downloaded; the repository's LFS pointer files and `.gitmodules` metadata remain in the clone.
- A full clone can be large and consumes browser IndexedDB quota. Enterprise browser policy may clear or limit extension storage.
- Export ZIP includes `.git` and all checked out files. On very large repositories, memory/storage limits or the ZIP format limit may apply.
- The extension clones and exports; it does not implement push, merge, or arbitrary Git command execution.

## Build bundled runtime

The extension ships local bundles to comply with Manifest V3's no-remote-code requirement. With Node.js installed, run `npm install` and `npm run build` to rebuild `vendor.js`.
