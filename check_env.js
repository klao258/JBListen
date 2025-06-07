// check_env.js
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env");
const pythonSessionPath = path.join(__dirname, "python", "python.session");

let hasError = false;

// 读取 .env 文件
let envContent = "";
if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, "utf8");
}

const nodeSession = envContent
  .split("\n")
  .find(line => line.startsWith("NODE_SESSION="))
  ?.split("=")[1]
  ?.trim();

if (!nodeSession) {
  console.error("❌ 检测失败：未在 .env 中找到 NODE_SESSION，请先登录 Telegram（Node.js）！");
  hasError = true;
} else {
  console.log("✅ NODE_SESSION 已找到");
}

if (!fs.existsSync(pythonSessionPath)) {
  console.error(`❌ 检测失败：未找到 Python 会话文件: ${pythonSessionPath}`);
  hasError = true;
} else {
  console.log("✅ Python session 文件已存在");
}

if (hasError) {
  console.error("🚫 检测未通过，构建终止！");
  process.exit(1);
} else {
  console.log("✅ 所有检测通过，继续 Jenkins 自动部署流程...");
  process.exit(0);
}
