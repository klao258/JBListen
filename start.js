const { spawn } = require('child_process');
const path = require('path');

let listenerProcess = null; // 保存 listener.py 的子进程引用

function runProcess(cmd, args, name, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd: __dirname,
      stdio: ['inherit', 'pipe', 'inherit'],
      ...options,
    });

    p.stdout.on('data', (data) => {
      const output = data.toString();
      process.stdout.write(output);

      if (name === 'Node 服务' && output.includes('✅ 已写入 NODE_SESSION 到 .env 文件')) {
        resolve(p); // 提前 resolve，不等待退出
      }
    });

    p.on('error', (err) => {
      reject(new Error(`❌ ${name} 启动异常: ${err.message}`));
    });

    p.on('exit', (code) => {
      if (name !== 'Node 服务') {
        if (code === 0) {
          console.log(`✅ ${name} 成功退出`);
          resolve();
        } else {
          reject(new Error(`❌ ${name} 异常退出，退出码 ${code}`));
        }
      }
    });
  });
}

async function startAll() {
  try {
    console.log('🚀 启动 Node 服务...');
    await runProcess('node', ['node/index.js'], 'Node 服务');

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

// 捕获 Ctrl+C 退出信号，确保 listener.py 被杀死
process.on('SIGINT', () => {
  console.log('\n🛑 捕获到 Ctrl+C，正在清理子进程...');
  if (listenerProcess) {
    listenerProcess.kill('SIGINT');
  }
  process.exit();
});

startAll();
