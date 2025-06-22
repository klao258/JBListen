const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let nodeProcess = null;
let listenerProcess = null;

function waitForOutput(proc, keyword, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`⏰ 超时：未检测到 "${keyword}" 输出`));
    }, timeout);

    proc.stdout.on('data', (data) => {
      const output = data.toString();
      process.stdout.write(output);  // 显示输出
      if (output.includes(keyword)) {
        clearTimeout(timer);
        resolve();  // 检测到关键字就继续执行
      }
    });

    proc.stderr.on('data', (data) => {
      process.stderr.write(data.toString());
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`❌ 进程异常退出，退出码: ${code}`));
      }
    });
  });
}

async function runProcess(cmd, args, name) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd: __dirname,
      stdio: 'inherit',
    });

    p.on('exit', (code) => {
      if (code === 0) {
        console.log(`✅ ${name} 成功退出`);
        resolve();
      } else {
        reject(new Error(`❌ ${name} 异常退出，退出码 ${code}`));
      }
    });

    p.on('error', (err) => {
      reject(err);
    });
  });
}

async function startAll() {
  try {
    console.log('🚀 启动 Node 服务...');
    nodeProcess = spawn('node', ['node/index.js'], {
      cwd: __dirname,
      stdio: ['inherit', 'pipe', 'pipe'],  // 监听 stdout
    });

    console.log('⏳ 等待 node Telegram 登录成功...');
    await waitForOutput(nodeProcess, '✅ Node TG 登录成功');

    console.log('📦 执行 generate_session.py...');
    await runProcess('python3', ['python/generate_session.py'], '生成 session');

    console.log('📡 启动监听服务 listener.py...');
    listenerProcess = spawn('python3', ['python/listener.py'], {
      cwd: __dirname,
      stdio: 'inherit',
    });

    listenerProcess.on('exit', (code) => {
      console.log(`⚠️ listener.py 已退出，退出码: ${code}`);
    });

  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log('\n🛑 捕获到 Ctrl+C，正在清理子进程...');
  if (listenerProcess) listenerProcess.kill('SIGINT');
  if (nodeProcess) nodeProcess.kill('SIGINT');
  process.exit();
});

startAll();
