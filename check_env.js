// check_env.js
const fs = require("fs");
const path = require("path");

const nodeSessionPath = path.join(__dirname, "node", "node.session");
const pythonSessionDir = path.join(__dirname, 'python/sessions');

let hasError = false;

// 检查 Node session 文件
if (!fs.existsSync(nodeSessionPath)) {
  console.error(`❌ 检测失败：未找到 Node 会话文件: ${nodeSessionPath}`);
  hasError = true;
} else {
  console.log("✅ Node session 文件已存在");
}

// 检查 python/sessions 目录下是否至少有一个文件
if (!fs.existsSync(pythonSessionDir)) {
  console.error(`❌ 检测失败：未找到目录: ${pythonSessionDir}`);
  hasError = true;
} else {
  const files = fs.readdirSync(pythonSessionDir).filter(file => file.endsWith('.session'));
  
  if (files.length === 0) {
    console.error(`❌ 检测失败：python/sessions 目录中没有 .session 文件`);
    hasError = true;
  } else {
    console.log(`✅ 检测成功：发现 ${files.length} 个 Python session 文件`);
  }
}



// 如果任一失败，终止构建
if (hasError) {
  console.error("🚫 检测未通过，请先手动运行项目以完成登录，构建终止！");
  process.exit(1);
} else {
  console.log("✅ 所有检测通过，继续 Jenkins 自动部署流程...");
  process.exit(0);
}
