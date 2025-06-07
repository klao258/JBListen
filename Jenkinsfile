pipeline {
    agent any

    environment {
        NODE_ENV = 'production'
        PM2_HOME = "${env.WORKSPACE}/.pm2"
    }

    triggers {
        githubPush()
    }

    stages {
        stage('拉取代码') {
            steps {
                echo '📥 拉取 GitHub 最新代码...'
                checkout scm
            }
        }

        stage('检测 Telegram Session') {
            steps {
                echo '🔍 检查 Node 和 Python 会话是否存在'
                sh 'node check_env.js'
            }
        }

        stage('安装依赖') {
            steps {
                echo '📦 安装依赖...'
                sh 'npm run installAll'
            }
        }

        steps {
            echo '🚀 使用 PM2 启动 Launcher（start.js）...'

            // 删除旧服务
            sh 'pm2 delete JBListen || true'

            // 启动封装脚本
            sh 'pm2 start ecosystem.config.js --only JBListen'

            // 保存 PM2 状态（可选）
            sh 'pm2 save'

            // 显示当前状态
            sh 'pm2 list'
        }
    }

    post {
        success {
            echo '✅ 部署完成，访问地址：http://jblisten.sso66s.cc'
        }
        failure {
            echo '❌ 部署失败，请检查日志'
        }
    }
}